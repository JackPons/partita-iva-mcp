/**
 * Telemetria d'uso e rate limit per il worker.
 *
 * Principio: si registra COSA viene usato, mai SU CHI. Gli argomenti degli
 * strumenti (partite IVA, codici fiscali, IBAN, nomi) non vengono salvati.
 * L'utente è un hash dell'IP che ruota ogni giorno: permette di contare
 * gli utenti distinti in una giornata, non di seguirli nel tempo.
 */

/** Sottoinsieme dell'API D1 che usiamo (così nei test basta un oggetto finto). */
export interface DbMinimo {
  prepare(sql: string): {
    bind(...valori: unknown[]): { run(): Promise<unknown>; all<T = unknown>(): Promise<{ results: T[] }> };
    all<T = unknown>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
  };
  batch?(istruzioni: unknown[]): Promise<unknown>;
}

/** Binding di rate limiting di Cloudflare (opzionale). */
export interface RateLimiterMinimo {
  limit(opzioni: { key: string }): Promise<{ success: boolean }>;
}

export type Esito = "ok" | "errore" | "non_supportato" | "limitato";

export interface Evento {
  metodo: string;
  strumento?: string;
  client?: string;
}

export interface Contesto {
  ts: string;
  giorno: string;
  paese?: string;
  utente: string;
  userAgent?: string;
}

/**
 * Estrae gli eventi da un body JSON-RPC (singolo messaggio o batch).
 * Ignora le notifiche senza metodo e qualunque cosa non sia JSON valido.
 */
export function estraiEventi(body: unknown): Evento[] {
  const messaggi = Array.isArray(body) ? body : [body];
  const eventi: Evento[] = [];
  for (const m of messaggi) {
    if (!m || typeof m !== "object") continue;
    type InfoClient = { name?: unknown; version?: unknown };
    const msg = m as {
      method?: unknown;
      params?: { name?: unknown; clientInfo?: InfoClient; _meta?: Record<string, unknown> };
    };
    if (typeof msg.method !== "string") continue;
    if (msg.method.startsWith("notifications/")) continue;
    const ev: Evento = { metodo: msg.method };
    if (msg.method === "tools/call" && typeof msg.params?.name === "string") {
      ev.strumento = msg.params.name.slice(0, 64);
    }
    // clientInfo arriva in initialize (protocollo classico) o in _meta (protocollo stateless 2026-07-28)
    const info = (msg.method === "initialize" ? msg.params?.clientInfo : undefined) ??
      (msg.params?._meta?.["io.modelcontextprotocol/clientInfo"] as InfoClient | undefined);
    if (info && typeof info.name === "string") {
      const v = typeof info.version === "string" ? ` ${info.version}` : "";
      ev.client = (info.name + v).slice(0, 80);
    }
    eventi.push(ev);
  }
  return eventi;
}

/**
 * Determina l'esito leggendo la risposta JSON-RPC (o lo status HTTP).
 * "Method not found" (-32601) è "non_supportato", non un errore: capita quando
 * un client prova un metodo di una versione del protocollo più nuova
 * (es. server/discover) e poi ripiega su quella che il server supporta.
 */
export function esitoDaRisposta(status: number, body: unknown): Exclude<Esito, "limitato"> {
  const messaggi = Array.isArray(body) ? body : [body];
  let nonSupportato = false;
  for (const m of messaggi) {
    if (!m || typeof m !== "object") continue;
    const r = m as { error?: { code?: unknown }; result?: { isError?: unknown } };
    if (r.result?.isError === true) return "errore";
    if (r.error) {
      if (r.error.code === -32601) {
        nonSupportato = true;
        continue;
      }
      return "errore";
    }
  }
  if (nonSupportato) return "non_supportato";
  return status >= 400 ? "errore" : "ok";
}

export async function hashUtente(ip: string, giorno: string, sale: string): Promise<string> {
  const dati = new TextEncoder().encode(`${ip}|${giorno}|${sale}`);
  const digest = await crypto.subtle.digest("SHA-256", dati);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function contestoDaRichiesta(request: Request, sale: string, adesso = new Date()): Promise<Contesto> {
  const ts = adesso.toISOString();
  const giorno = ts.slice(0, 10);
  const ip = request.headers.get("cf-connecting-ip") ?? "sconosciuto";
  const paese = (request as Request & { cf?: { country?: string } }).cf?.country;
  const userAgent = request.headers.get("user-agent")?.slice(0, 80) ?? undefined;
  return { ts, giorno, paese, utente: await hashUtente(ip, giorno, sale), userAgent };
}

export async function registra(
  db: DbMinimo | undefined,
  ctx: Contesto,
  eventi: Evento[],
  esito: Esito,
  durataMs: number,
): Promise<void> {
  if (!db || eventi.length === 0) return;
  const sql =
    "INSERT INTO chiamate (ts, giorno, metodo, strumento, client, paese, utente, esito, durata_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
  for (const e of eventi) {
    try {
      await db
        .prepare(sql)
        .bind(ctx.ts, ctx.giorno, e.metodo, e.strumento ?? null, e.client ?? ctx.userAgent ?? null, ctx.paese ?? null, ctx.utente, esito, durataMs)
        .run();
    } catch (err) {
      // la telemetria non deve mai rompere il servizio
      console.error("telemetria: insert fallito", (err as Error).message);
    }
  }
}

/** true se la richiesta può passare. Senza binding configurato passa sempre. */
export async function controllaLimite(limiter: RateLimiterMinimo | undefined, chiave: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key: chiave });
    return success;
  } catch {
    return true; // se il limiter ha problemi, meglio servire che bloccare
  }
}

/** Statistiche aggregate per l'endpoint /stats. */
export async function statistiche(db: DbMinimo, giorni = 30) {
  const dal = new Date(Date.now() - giorni * 86_400_000).toISOString().slice(0, 10);
  const q = async <T>(sql: string) => (await db.prepare(sql).bind(dal).all<T>()).results;
  const [totali, perGiorno, perStrumento, perClient, perPaese] = await Promise.all([
    q<{ chiamate: number; chiamate_strumenti: number; errori: number; non_supportati: number; limitati: number }>(
      `SELECT COUNT(*) AS chiamate,
              SUM(metodo = 'tools/call') AS chiamate_strumenti,
              SUM(esito = 'errore') AS errori,
              SUM(esito = 'non_supportato') AS non_supportati,
              SUM(esito = 'limitato') AS limitati
       FROM chiamate WHERE giorno >= ?`,
    ),
    q<{ giorno: string; chiamate_strumenti: number; utenti: number }>(
      `SELECT giorno, SUM(metodo = 'tools/call') AS chiamate_strumenti, COUNT(DISTINCT utente) AS utenti
       FROM chiamate WHERE giorno >= ? GROUP BY giorno ORDER BY giorno DESC`,
    ),
    q<{ strumento: string; chiamate: number; errori: number; durata_media_ms: number }>(
      `SELECT strumento, COUNT(*) AS chiamate, SUM(esito = 'errore') AS errori, CAST(AVG(durata_ms) AS INTEGER) AS durata_media_ms
       FROM chiamate WHERE giorno >= ? AND metodo = 'tools/call' GROUP BY strumento ORDER BY chiamate DESC`,
    ),
    q<{ client: string; chiamate: number; chiamate_strumenti: number }>(
      `SELECT client, COUNT(*) AS chiamate, SUM(metodo = 'tools/call') AS chiamate_strumenti
       FROM chiamate WHERE giorno >= ? GROUP BY client ORDER BY chiamate DESC LIMIT 20`,
    ),
    q<{ paese: string; chiamate: number }>(
      `SELECT paese, COUNT(*) AS chiamate
       FROM chiamate WHERE giorno >= ? GROUP BY paese ORDER BY chiamate DESC LIMIT 20`,
    ),
  ]);
  return {
    periodo_giorni: giorni,
    dal,
    note: [
      "non_supportati: metodi di versioni più nuove del protocollo (es. server/discover) a cui il client rinuncia ripiegando; non sono guasti.",
      "utenti e paese: per i connettori usati da claude.ai/Claude Desktop le richieste partono dai server di Anthropic, quindi non rappresentano le persone. Sono significativi per i client che si collegano direttamente (Claude Code, Cursor, script).",
    ],
    totali: totali[0],
    per_giorno: perGiorno,
    per_strumento: perStrumento,
    per_client: perClient,
    per_paese: perPaese,
  };
}

export async function pulisciVecchie(db: DbMinimo, giorniConservati = 90): Promise<void> {
  const limite = new Date(Date.now() - giorniConservati * 86_400_000).toISOString().slice(0, 10);
  await db.prepare("DELETE FROM chiamate WHERE giorno < ?").bind(limite).run();
}

/** Confronto a tempo costante per il token di /stats. */
export function tokenValido(atteso: string | undefined, ricevuto: string | null): boolean {
  if (!atteso || !ricevuto || atteso.length !== ricevuto.length) return false;
  let diff = 0;
  for (let i = 0; i < atteso.length; i++) diff |= atteso.charCodeAt(i) ^ ricevuto.charCodeAt(i);
  return diff === 0;
}
