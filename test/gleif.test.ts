/**
 * Test del client GLEIF con risposte finte che riproducono la struttura reale
 * dell'API (verificata su Intesa Sanpaolo e una sua controllata).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cercaLei } from "../src/lib/gleif.js";
import { creaServer } from "../src/server.js";

const record = (lei: string, nome: string, extra: Record<string, unknown> = {}) => ({
  type: "lei-records",
  id: lei,
  attributes: {
    lei,
    entity: {
      legalName: { name: nome, language: "it" },
      legalForm: { id: "P418", other: null },
      registeredAt: { id: "RA000407", other: null },
      registeredAs: "00000000000",
      status: "ACTIVE",
      legalAddress: { addressLines: ["PIAZZA SAN CARLO 156"], city: "TORINO", postalCode: "10121", country: "IT" },
      ...extra,
    },
    registration: { status: "ISSUED", lastUpdateDate: "2026-03-26T21:00:03Z", nextRenewalDate: "2027-04-01T00:00:00Z" },
  },
});

function fetchGleif(opts: { trovato?: boolean; capogruppo?: boolean; figli?: number; giu?: boolean } = {}): typeof fetch {
  return async (input) => {
    const url = decodeURIComponent(String(input));
    if (opts.giu) return new Response("errore", { status: 503 });
    if (url.includes("/lei-records?filter")) {
      return Response.json({ data: opts.trovato === false ? [] : [record("LEIFIGLIA000000000001", "ESEMPIO SPA")] });
    }
    if (url.includes("/entity-legal-forms/P418")) {
      return Response.json({ data: { attributes: { names: [{ localName: "Società Per Azioni", languageCode: "it" }] } } });
    }
    if (url.endsWith("/direct-parent") || url.endsWith("/ultimate-parent")) {
      if (!opts.capogruppo) return new Response("not found", { status: 404 });
      return Response.json({ data: record("LEICAPOGRUPPO0000001", "CAPOGRUPPO SPA") });
    }
    if (url.includes("/direct-children")) {
      return Response.json({ data: [], meta: { pagination: { total: opts.figli ?? 0 } } });
    }
    // VIES e IPA, usati da scheda_soggetto
    if (url.includes("vies")) return Response.json({ valid: true, name: "ESEMPIO SPA", address: "VIA ROMA 1 \n00100 ROMA RM\n" });
    if (url.includes("package_show")) return Response.json({ success: true, result: { resources: [{ id: "r", name: "enti", datastore_active: true }] } });
    if (url.includes("datastore_search")) return Response.json({ success: true, result: { records: [] } });
    throw new Error("URL inatteso: " + url);
  };
}

test("GLEIF: impresa con LEI, forma giuridica in italiano, capogruppo", async () => {
  const r = await cercaLei("00000000000", fetchGleif({ capogruppo: true }));
  assert.equal(r.trovato, true);
  assert.equal(r.lei, "LEIFIGLIA000000000001");
  assert.equal(r.forma_giuridica, "Società Per Azioni");
  assert.equal(r.stato_registrazione_lei, "ISSUED");
  assert.equal(r.lei_aggiornato_al, "2026-03-26");
  assert.equal(r.sede_legale?.comune, "TORINO");
  assert.equal(r.capogruppo?.denominazione, "CAPOGRUPPO SPA");
  assert.equal(r.controllante_diretta?.lei, "LEICAPOGRUPPO0000001");
});

test("GLEIF: capogruppo di se stessa (nessun controllante, 36 controllate)", async () => {
  const r = await cercaLei("00000000000", fetchGleif({ capogruppo: false, figli: 36 }));
  assert.equal(r.capogruppo, null);
  assert.equal(r.controllante_diretta, null);
  assert.equal(r.numero_controllate_dirette, 36);
});

test("GLEIF: nessun LEI è un risultato normale, non un errore", async () => {
  const r = await cercaLei("00000000000", fetchGleif({ trovato: false }));
  assert.equal(r.trovato, false);
  assert.equal(r.servizio_disponibile, true);
});

test("GLEIF giù: segnalato, senza far fallire nulla", async () => {
  const r = await cercaLei("00000000000", fetchGleif({ giu: true }));
  assert.equal(r.servizio_disponibile, false);
  assert.match(r.errore!, /GLEIF/);
});

test("scheda_soggetto include il blocco GLEIF e il riepilogo lo cita (rispettando l'output schema)", async () => {
  const server = creaServer(fetchGleif({ capogruppo: true }));
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(c);
  await client.listTools(); // abilita la validazione dell'output schema lato client
  const res = await client.callTool({ name: "scheda_soggetto", arguments: { partita_iva: "00000000000" } });
  assert.notEqual(res.isError, true, JSON.stringify(res.content));
  const out = res.structuredContent as any;
  assert.equal(out.gleif.trovato, true);
  assert.match(out.riepilogo, /LEI LEIFIGLIA000000000001/);
  assert.match(out.riepilogo, /gruppo CAPOGRUPPO SPA/);
});
