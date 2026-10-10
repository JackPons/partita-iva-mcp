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
  assert.deepEqual(estraiEventi("non json"), []);
});

test("gli argomenti degli strumenti non finiscono mai negli eventi", () => {
  const ev = estraiEventi({ method: "tools/call", params: { name: "valida_codice_fiscale", arguments: { codice_fiscale: "RSSMRA85T10A562S" } } });
  assert.ok(!JSON.stringify(ev).includes("RSSMRA"));
});

test("esitoDaRisposta", () => {
  assert.equal(esitoDaRisposta(200, { result: { content: [] } }), "ok");
  assert.equal(esitoDaRisposta(200, { result: { isError: true } }), "errore");
  assert.equal(esitoDaRisposta(200, { error: { code: -32601 } }), "errore");
  assert.equal(esitoDaRisposta(500, {}), "errore");
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
    { DB: db },
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
