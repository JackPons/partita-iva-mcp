/**
 * Ogni strumento, in ogni ramo (ok, input errato, fonti giù), deve produrre
 * un output che rispetta il suo outputSchema. Il client dell'SDK valida
 * structuredContent contro lo schema dichiarato in tools/list: se uno
 * schema è sbagliato, qui la chiamata fallisce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { creaServer } from "../src/server.js";
import { checkCharCodiceFiscale } from "../src/lib/codice-fiscale.js";

const fetchOk: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("vies")) {
    const body = JSON.parse(String(init?.body));
    return Response.json({ valid: true, name: "ESEMPIO S.R.L.", address: "VIA ROMA 1 \n00100 ROMA RM\n", requestDate: "2026-10-09" , vatNumber: body.vatNumber });
  }
  if (url.includes("package_show")) return Response.json({ success: true, result: { resources: [{ id: "r", name: "enti", datastore_active: true }] } });
  if (url.includes("datastore_search")) return Response.json({ success: true, result: { records: [{ Codice_IPA: "c_h501", Denominazione_ente: "COMUNE", Mail1: "pec@x.it" }] } });
  throw new Error("URL inatteso " + url);
};
const fetchGiu: typeof fetch = async () => {
  throw new Error("rete giù");
};
const fetchViesNonAttiva: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("vies")) return Response.json({ valid: false, name: "---", address: "---" });
  if (url.includes("package_show")) return new Response("errore", { status: 500 });
  throw new Error("URL inatteso " + url);
};

async function client(f: typeof fetch) {
  const server = creaServer(f);
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const cl = new Client({ name: "test", version: "0" });
  await cl.connect(c);
  const { tools } = await cl.listTools(); // il client memorizza gli outputSchema per validare
  return { cl, tools };
}

async function chiama(cl: Client, name: string, args: Record<string, unknown>) {
  const res = await cl.callTool({ name, arguments: args });
  assert.notEqual(res.isError, true, `${name}(${JSON.stringify(args)}) → errore: ${JSON.stringify(res.content)}`);
  assert.ok(res.structuredContent, `${name}: manca structuredContent`);
  return res.structuredContent as any;
}

const cfValido = (() => {
  const p = "RSSMRA85T10H501";
  return p + checkCharCodiceFiscale(p);
})();

test("tutti gli strumenti dichiarano outputSchema e annotazioni read-only", async () => {
  const { tools } = await client(fetchOk);
  assert.equal(tools.length, 7);
  for (const t of tools) {
    assert.ok(t.outputSchema, `${t.name} senza outputSchema`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} senza readOnlyHint`);
    assert.equal(t.annotations?.destructiveHint, false);
  }
  const online = tools.filter((t) => t.annotations?.openWorldHint).map((t) => t.name).sort();
  assert.deepEqual(online, ["scheda_soggetto", "verifica_partita_iva"]);
});

test("output conformi allo schema: rami ok", async () => {
  const { cl } = await client(fetchOk);
  await chiama(cl, "valida_partita_iva", { partita_iva: "IT00159560366" });
  await chiama(cl, "verifica_partita_iva", { partita_iva: "00159560366" });
  await chiama(cl, "valida_codice_fiscale", { codice_fiscale: cfValido });
  await chiama(cl, "valida_codice_fiscale", { codice_fiscale: "00159560366" });
  await chiama(cl, "valida_iban", { iban: "DE89 3704 0044 0532 0130 00" });
  await chiama(cl, "valida_iban", { iban: "IT60X0542811101000000123456" });
  await chiama(cl, "cerca_comune", { nome: "Roma" });
  await chiama(cl, "cerca_comune", { codice_catastale: "H501" });
  await chiama(cl, "controlla_sanzioni", { nome: "Esempio Srl" });
  const scheda = await chiama(cl, "scheda_soggetto", { partita_iva: "00159560366" });
  assert.equal(scheda.vies.attiva, true);
  await chiama(cl, "scheda_soggetto", { partita_iva: "00159560366", sanzioni: false });
});

test("output conformi allo schema: input errati", async () => {
  const { cl } = await client(fetchOk);
  await chiama(cl, "valida_partita_iva", { partita_iva: "123" });
  await chiama(cl, "verifica_partita_iva", { partita_iva: "123" });
  await chiama(cl, "valida_codice_fiscale", { codice_fiscale: "XXX" });
  await chiama(cl, "valida_codice_fiscale", { codice_fiscale: "RSSMRA85T10H501A" });
  await chiama(cl, "valida_iban", { iban: "IT00" });
  await chiama(cl, "valida_iban", { iban: "IT60X0542811101000000123457" });
  await chiama(cl, "cerca_comune", { nome: "Nonesiste" });
  await chiama(cl, "cerca_comune", {});
  await chiama(cl, "scheda_soggetto", { partita_iva: "12345" });
});

test("output conformi allo schema: fonti esterne giù o soggetto non attivo", async () => {
  const giu = await client(fetchGiu);
  const a = await chiama(giu.cl, "scheda_soggetto", { partita_iva: "00159560366" });
  assert.equal(a.vies.servizio_disponibile, false);
  assert.equal(a.ipa.servizio_disponibile, false);
  await chiama(giu.cl, "verifica_partita_iva", { partita_iva: "00159560366" });

  const na = await client(fetchViesNonAttiva);
  const b = await chiama(na.cl, "scheda_soggetto", { partita_iva: "00159560366" });
  assert.equal(b.vies.attiva, false);
  assert.equal(b.sanzioni, null);
});
