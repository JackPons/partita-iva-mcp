import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estraiEventi,
  esitoDaRisposta,
  hashUtente,
  controllaLimite,
  tokenValido,
  registra,
  type DbMinimo,
} from "../src/telemetria.js";
import worker from "../src/worker.js";

/** D1 finto: registra le insert e risponde alle select con righe vuote. */
function dbFinto() {
  const righe: unknown[][] = [];
  const db: DbMinimo = {
    prepare(sql: string) {
      const stmt = {
        bind: (...valori: unknown[]) => ({
          run: async () => {
            if (sql.startsWith("INSERT")) righe.push(valori);
            return {};
          },
          all: async <T>() => ({ results: [] as T[] }),
        }),
        all: async <T>() => ({ results: [] as T[] }),
        run: async () => ({}),
      };
      return stmt;
    },
  };
  return { db, righe };
}

const ctxFinto = () => {
  const attese: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (p: Promise<unknown>) => attese.push(p) }, finito: () => Promise.all(attese) };
};

function richiestaMcp(body: unknown, ip = "1.2.3.4") {
  return new Request("https://esempio.workers.dev/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "cf-connecting-ip": ip,
      "user-agent": "test-agent/1.0",
    },
    body: JSON.stringify(body),
  });
}

test("estraiEventi: tools/call, initialize, batch, notifiche ignorate", () => {
  assert.deepEqual(estraiEventi({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "valida_iban", arguments: { iban: "X" } } }), [
    { metodo: "tools/call", strumento: "valida_iban" },
  ]);
  assert.deepEqual(estraiEventi({ method: "initialize", params: { clientInfo: { name: "claude-ai", version: "0.1" } } }), [
    { metodo: "initialize", client: "claude-ai 0.1" },
  ]);
  assert.equal(estraiEventi([{ method: "tools/list" }, { method: "notifications/initialized" }]).length, 1);
  // protocollo stateless: clientInfo in _meta
  assert.deepEqual(
    estraiEventi({ method: "tools/call", params: { name: "valida_iban", _meta: { "io.modelcontextprotocol/clientInfo": { name: "claude-ai", version: "2" } } } }),
    [{ metodo: "tools/call", strumento: "valida_iban", client: "claude-ai 2" }],
  );
  assert.deepEqual(estraiEventi("non json"), []);
});

test("gli argomenti degli strumenti non finiscono mai negli eventi", () => {
  const ev = estraiEventi({ method: "tools/call", params: { name: "valida_codice_fiscale", arguments: { codice_fiscale: "RSSMRA85T10A562S" } } });
  assert.ok(!JSON.stringify(ev).includes("RSSMRA"));
});

test("esitoDaRisposta", () => {
  assert.equal(esitoDaRisposta(200, { result: { content: [] } }), "ok");
  assert.equal(esitoDaRisposta(200, { result: { isError: true } }), "errore");
  assert.equal(esitoDaRisposta(200, { error: { code: -32602 } }), "errore");
  assert.equal(esitoDaRisposta(500, {}), "errore");
  // method not found (es. server/discover) non è un errore
  assert.equal(esitoDaRisposta(200, { error: { code: -32601 } }), "non_supportato");
  assert.equal(esitoDaRisposta(404, { error: { code: -32601 } }), "non_supportato");
});

test("hash utente: stabile nel giorno, diverso il giorno dopo, nessun IP in chiaro", async () => {
  const a = await hashUtente("1.2.3.4", "2026-10-09", "sale");
  const b = await hashUtente("1.2.3.4", "2026-10-09", "sale");
  const c = await hashUtente("1.2.3.4", "2026-10-10", "sale");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(!a.includes("1.2.3.4"));
  assert.equal(a.length, 16);
});

test("rate limit: senza binding passa, con binding rispetta success, se lancia passa", async () => {
  assert.equal(await controllaLimite(undefined, "k"), true);
  assert.equal(await controllaLimite({ limit: async () => ({ success: false }) }, "k"), false);
  assert.equal(await controllaLimite({ limit: async () => { throw new Error("x"); } }, "k"), true);
});

test("tokenValido", () => {
  assert.equal(tokenValido("abc", "abc"), true);
  assert.equal(tokenValido("abc", "abd"), false);
  assert.equal(tokenValido(undefined, "abc"), false);
  assert.equal(tokenValido("abc", null), false);
});

test("registra non rompe il servizio se D1 fallisce", async () => {
  const db: DbMinimo = {
    prepare: () => ({
      bind: () => ({ run: async () => { throw new Error("D1 giù"); }, all: async () => ({ results: [] }) }),
      all: async () => ({ results: [] }),
      run: async () => ({}),
    }),
  };
  await registra(db, { ts: "t", giorno: "g", utente: "u" }, [{ metodo: "tools/list" }], "ok", 1);
});

test("worker: una tools/call viene servita e registrata senza argomenti", async () => {
  const { db, righe } = dbFinto();
  const { ctx, finito } = ctxFinto();
  const res = await worker.fetch(
    richiestaMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "valida_iban", arguments: { iban: "DE89370400440532013000" } } }),
    { DB: db, HASH_SALT: "sale" },
    ctx,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.result.structuredContent.valido, true);
  await finito();
  assert.equal(righe.length, 1);
  const [, , metodo, strumento, client, , utente, esito] = righe[0] as string[];
  assert.equal(metodo, "tools/call");
  assert.equal(strumento, "valida_iban");
  assert.equal(client, "test-agent/1.0");
  assert.equal(esito, "ok");
  assert.ok(!JSON.stringify(righe).includes("DE89"));
  assert.ok(!JSON.stringify(righe).includes("1.2.3.4"));
  assert.equal(utente.length, 16);
});

test("worker: oltre il limite risponde 429 e registra 'limitato'", async () => {
  const { db, righe } = dbFinto();
  const { ctx, finito } = ctxFinto();
  const res = await worker.fetch(
    richiestaMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    { DB: db, LIMITER: { limit: async () => ({ success: false }) } },
    ctx,
  );
  assert.equal(res.status, 429);
  await finito();
  assert.equal((righe[0] as string[])[7], "limitato");
});

test("worker: server/discover viene registrato come non_supportato (caso reale da Claude)", async () => {
  const { db, righe } = dbFinto();
  const { ctx, finito } = ctxFinto();
  await worker.fetch(richiestaMcp({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }), { DB: db }, ctx);
  await finito();
  assert.equal((righe[0] as string[])[2], "server/discover");
  assert.equal((righe[0] as string[])[7], "non_supportato");
});

test("worker: funziona anche senza D1 né limiter", async () => {
  const { ctx } = ctxFinto();
  const res = await worker.fetch(richiestaMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }), {}, ctx);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(body.result.tools.length >= 7);
});

test("worker: /stats senza token → 401, con token → JSON", async () => {
  const { db } = dbFinto();
  const { ctx } = ctxFinto();
  const no = await worker.fetch(new Request("https://x/stats"), { DB: db, STATS_TOKEN: "segreto" }, ctx);
  assert.equal(no.status, 401);
  const si = await worker.fetch(
    new Request("https://x/stats?giorni=7", { headers: { authorization: "Bearer segreto" } }),
    { DB: db, STATS_TOKEN: "segreto" },
    ctx,
  );
  assert.equal(si.status, 200);
  const body = (await si.json()) as any;
  assert.equal(body.periodo_giorni, 7);
  // senza STATS_TOKEN configurato /stats è sempre chiuso
  const chiuso = await worker.fetch(new Request("https://x/stats?token="), { DB: db }, ctx);
  assert.equal(chiuso.status, 401);
});

test("worker: /privacy usa titolare ed email dalla config, senza HTML iniettabile", async () => {
  const { ctx } = ctxFinto();
  const res = await worker.fetch(
    new Request("https://x.workers.dev/privacy"),
    { PRIVACY_TITOLARE: "Mario <b>Rossi</b>", PRIVACY_EMAIL: "privacy@esempio.it" },
    ctx,
  );
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /mailto:privacy@esempio\.it/);
  assert.match(html, /Mario &lt;b&gt;Rossi&lt;\/b&gt;/);
  assert.match(html, /non vengono salvati/);
  const senza = await (await worker.fetch(new Request("https://x/privacy"), {}, ctx)).text();
  assert.match(senza, /da configurare/);
});

test("esito: versione di protocollo non supportata è negoziazione, non errore", () => {
  assert.equal(
    esitoDaRisposta(400, { error: { code: -32000, message: "Bad Request: Unsupported protocol version: 2026-07-28" } }),
    "non_supportato",
  );
  assert.equal(esitoDaRisposta(400, { error: { code: -32000, message: "Bad Request: altro" } }), "errore");
});

test("worker: tools/list da client con Accept generico (curl, bot) viene servito", async () => {
  const { db, righe } = dbFinto();
  const { ctx, finito } = ctxFinto();
  const res = await worker.fetch(
    new Request("https://x/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "*/*", "user-agent": "curl/7.81.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    { DB: db },
    ctx,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.result.tools.length, 7);
  await finito();
  assert.equal((righe[0] as string[])[7], "ok");
});

test("worker: senza header Accept del tutto viene servito", async () => {
  const { ctx } = ctxFinto();
  const res = await worker.fetch(
    new Request("https://x/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    {},
    ctx,
  );
  assert.equal(res.status, 200);
});

test("worker: senza HASH_SALT l'utente non viene registrato", async () => {
  const { db, righe } = dbFinto();
  const { ctx, finito } = ctxFinto();
  await worker.fetch(richiestaMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }), { DB: db }, ctx);
  await finito();
  assert.equal(righe.length, 1);
  assert.equal(righe[0][6], null);
});
