import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { creaServer } from "../src/server.js";
import { infoTabelle } from "../src/lib/tabelle.js";

/** fetch finto: simula VIES e IPA senza rete */
const fetchFinto: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("vies")) {
    const body = JSON.parse(String(init?.body));
    const attiva = body.vatNumber === "00000000000";
    return Response.json({
      countryCode: "IT",
      vatNumber: body.vatNumber,
      requestDate: "2026-10-09T00:00:00Z",
      valid: attiva,
      name: attiva ? "ESEMPIO S.R.L." : "---",
      address: attiva ? "VIA ROMA 1 \n00100 ROMA RM\n" : "---",
    });
  }
  if (url.includes("package_show")) {
    return Response.json({ success: true, result: { resources: [{ id: "res-enti", name: "enti", datastore_active: true }] } });
  }
  if (url.includes("datastore_search")) {
    const filtri = JSON.parse(decodeURIComponent(url.split("filters=")[1].split("&")[0]));
    const pa = filtri.Codice_fiscale_ente === "00000000000";
    return Response.json({
      success: true,
      result: { records: pa ? [{ Codice_IPA: "c_h501", Denominazione_ente: "COMUNE DI ESEMPIO", Mail1: "pec@esempio.it", Comune: "ROMA", Provincia: "RM" }] : [] },
    });
  }
  throw new Error("URL inatteso: " + url);
};

async function clientCollegato() {
  const server = creaServer(fetchFinto);
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(c);
  return client;
}

test("il server espone i sette strumenti", async () => {
  const client = await clientCollegato();
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["cerca_comune", "controlla_sanzioni", "scheda_soggetto", "valida_codice_fiscale", "valida_iban", "valida_partita_iva", "verifica_partita_iva"],
  );
});

test("scheda_soggetto combina VIES e IPA", async () => {
  const client = await clientCollegato();
  const res = await client.callTool({ name: "scheda_soggetto", arguments: { partita_iva: "00000000000" } });
  const out = res.structuredContent as any;
  assert.equal(out.formale.valida, true);
  assert.equal(out.vies.attiva, true);
  assert.equal(out.vies.indirizzo.comune, "Roma");
  assert.equal(out.vies.indirizzo.comune_riconosciuto, true);
  assert.equal(out.sanzioni.esito, infoTabelle.sanzioni.aggiornato ? "nessuna_corrispondenza" : "lista_non_caricata");
  assert.equal(out.ipa.e_pubblica_amministrazione, true);
  assert.equal(out.ipa.codice_ipa, "c_h501");
  assert.match(out.riepilogo, /attiva/);
  assert.match(out.riepilogo, /c_h501/);
});

test("scheda_soggetto non interroga le fonti se la P.IVA è formalmente errata", async () => {
  const client = await clientCollegato();
  const res = await client.callTool({ name: "scheda_soggetto", arguments: { partita_iva: "12345" } });
  const out = res.structuredContent as any;
  assert.equal(out.formale.valida, false);
  assert.equal(out.vies, null);
  assert.equal(out.ipa, null);
});

test("valida_iban risponde offline", async () => {
  const client = await clientCollegato();
  const res = await client.callTool({ name: "valida_iban", arguments: { iban: "DE89370400440532013000" } });
  assert.equal((res.structuredContent as any).valido, true);
});
