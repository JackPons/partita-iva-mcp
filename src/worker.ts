/**
 * Entrypoint Cloudflare Workers: server MCP remoto, stateless, su /mcp
 * (Streamable HTTP). Nessuna sessione: ogni richiesta crea server e
 * transport, che è il pattern consigliato per worker serverless.
 *
 * GET /        pagina minima con le istruzioni di collegamento
 * GET /health  stato
 * GET /stats   statistiche d'uso aggregate (richiede STATS_TOKEN)
 * POST /mcp    endpoint MCP, con conteggio chiamate (D1) e rate limit opzionali
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { creaServer, SERVER_INFO } from "./server.js";
import {
  contestoDaRichiesta,
  controllaLimite,
  esitoDaRisposta,
  estraiEventi,
  pulisciVecchie,
  registra,
  statistiche,
  tokenValido,
  type DbMinimo,
  type RateLimiterMinimo,
} from "./telemetria.js";

export interface Env {
  /** D1 per il conteggio delle chiamate. Se assente, nessuna telemetria. */
  DB?: DbMinimo;
  /** Binding di rate limiting. Se assente, nessun limite. */
  LIMITER?: RateLimiterMinimo;
  /** Segreto per /stats: `npx wrangler secret put STATS_TOKEN`. */
  STATS_TOKEN?: string;
  /** Sale per l'hash degli IP: `npx wrangler secret put HASH_SALT`. */
  HASH_SALT?: string;
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-expose-headers": "mcp-session-id",
};

function paginaIniziale(origin: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>${SERVER_INFO.name}</title>
<style>body{font:16px/1.5 system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#222}code,pre{background:#f3f3f3;padding:.1em .3em;border-radius:4px}</style>
<h1>${SERVER_INFO.name} <small>v${SERVER_INFO.version}</small></h1>
<p>Server MCP per verificare partite IVA, codici fiscali e IBAN italiani, con arricchimento da VIES e IPA. Gratuito, senza registrazione.</p>
<p><strong>Endpoint MCP:</strong> <code>${origin}/mcp</code> (Streamable HTTP)</p>
<h2>Collegamento rapido</h2>
<pre>claude mcp add partita-iva -t http ${origin}/mcp</pre>
<p>Oppure, in un client che accetta configurazione JSON:</p>
<pre>{ "mcpServers": { "partita-iva": { "url": "${origin}/mcp" } } }</pre>
<h2>Strumenti</h2>
<ul>
<li><code>valida_partita_iva</code>, <code>valida_codice_fiscale</code>, <code>valida_iban</code>: validazione offline</li>
<li><code>verifica_partita_iva</code>: stato su VIES</li>
<li><code>scheda_soggetto</code>: quadro completo (VIES + IPA)</li>
</ul>
<p>Fonti: VIES (Commissione Europea), IPA (indicepa.gov.it). I dati restituiti sono soggetti alle licenze delle fonti originali.</p>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function jsonRpcErrore(status: number, codice: number, messaggio: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: codice, message: messaggio } }), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

async function gestisciMcp(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const inizio = Date.now();
  const contesto = await contestoDaRichiesta(request, env.HASH_SALT ?? "partita-iva-mcp");

  let eventi: ReturnType<typeof estraiEventi> = [];
  if (request.method === "POST") {
    try {
      eventi = estraiEventi(await request.clone().json());
    } catch {
      // body non JSON: ci pensa il transport a rispondere con l'errore giusto
    }
  }

  if (!(await controllaLimite(env.LIMITER, contesto.utente))) {
    ctx.waitUntil(registra(env.DB, contesto, eventi, "limitato", Date.now() - inizio));
    return jsonRpcErrore(429, -32000, "Troppe richieste: riprova tra un minuto.");
  }

  const server = creaServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: nessuna sessione tra richieste
    enableJsonResponse: true, // risposta JSON secca invece di SSE
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request);

  // leggiamo il body una volta: serve sia per l'esito sia per rispondere
  const testo = response.body ? await response.text() : "";
  let esito: "ok" | "errore" = response.status >= 400 ? "errore" : "ok";
  if (testo) {
    try {
      esito = esitoDaRisposta(response.status, JSON.parse(testo));
    } catch {
      /* non JSON: teniamo l'esito dallo status */
    }
  }
  ctx.waitUntil(registra(env.DB, contesto, eventi, esito, Date.now() - inizio));

  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(testo || null, { status: response.status, headers });
}

async function gestisciStats(request: Request, env: Env, url: URL): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const token = bearer ?? url.searchParams.get("token");
  if (!tokenValido(env.STATS_TOKEN, token)) {
    return new Response("Non autorizzato", { status: 401 });
  }
  if (!env.DB) return Response.json({ errore: "D1 non configurato" }, { status: 503 });
  const giorni = Math.min(Math.max(Number(url.searchParams.get("giorni") ?? 30) || 30, 1), 90);
  return Response.json(await statistiche(env.DB, giorni), { headers: { "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === "/" || url.pathname === "") {
      return paginaIniziale(url.origin);
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, ...SERVER_INFO });
    }
    if (url.pathname === "/stats") {
      return gestisciStats(request, env, url);
    }
    if (url.pathname === "/mcp") {
      return gestisciMcp(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },

  /** Cron giornaliero: cancella le righe più vecchie di 90 giorni. */
  async scheduled(_evento: unknown, env: Env, ctx: Ctx): Promise<void> {
    if (env.DB) ctx.waitUntil(pulisciVecchie(env.DB, 90));
  },
};
