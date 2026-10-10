/**
 * Entrypoint Cloudflare Workers: server MCP remoto, stateless, su /mcp
 * (Streamable HTTP). Nessuna sessione: ogni richiesta crea server e
 * transport, che è il pattern consigliato per worker serverless.
 *
 * GET / restituisce una pagina minima con le istruzioni di collegamento.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { creaServer, SERVER_INFO } from "./server.js";

interface Env {
  // Futuro: API key, KV per il conteggio delle chiamate, ecc.
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

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
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

    if (url.pathname === "/mcp") {
      const server = creaServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: nessuna sessione tra richieste
        enableJsonResponse: true, // risposta JSON secca invece di SSE
      });
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }

    return new Response("Not found", { status: 404 });
  },
};
