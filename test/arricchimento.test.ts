import { test } from "node:test";
import assert from "node:assert/strict";
import { validaCodiceFiscale, checkCharCodiceFiscale } from "../src/lib/codice-fiscale.js";
import { validaIban, calcolaCin } from "../src/lib/iban.js";
import { parseIndirizzoItaliano } from "../src/lib/vies.js";
import { controllaSanzioni, somiglianza, tokenizza } from "../src/lib/sanzioni.js";
import { cercaComune, comuneDaCatastale, infoTabelle, normalizzaNome } from "../src/lib/tabelle.js";

test("codice fiscale: comune di nascita dalla tabella (seed)", () => {
  const r = validaCodiceFiscale("RSSMRA85T10A562S");
  assert.equal(r.dati?.luogo_nascita, "San Giuliano Terme (PI)");
  assert.equal(r.dati?.provincia_nascita, "PI");
});

test("codice fiscale: nato all'estero → nome dello stato", () => {
  const prime15 = "RSSMRA85T10Z404";
  const cf = prime15 + checkCharCodiceFiscale(prime15);
  const r = validaCodiceFiscale(cf);
  assert.equal(r.valido, true);
  assert.equal(r.dati?.nato_estero, true);
  assert.equal(r.dati?.luogo_nascita, "Stati Uniti d'America");
});

test("IBAN: banca dalla tabella ABI (seed)", () => {
  const abi = "03069", cab = "09606", conto = "100000000000";
  const bban = calcolaCin(abi, cab, conto) + abi + cab + conto;
  const num = (s: string) => s.split("").map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join("");
  let resto = 0;
  for (const ch of num(bban + "IT00")) resto = (resto * 10 + Number(ch)) % 97;
  const iban = `IT${String(98 - resto).padStart(2, "0")}${bban}`;
  const r = validaIban(iban);
  assert.equal(r.valido, true);
  assert.equal(r.italia?.banca, "Intesa Sanpaolo");
});

test("indirizzo VIES: comune riconosciuto e normalizzato", () => {
  const p = parseIndirizzoItaliano("VIA ROMA 1 \n20121 MILANO MI\n");
  assert.equal(p.comune_riconosciuto, true);
  assert.equal(p.comune, "Milano");
  assert.equal(p.regione, "Lombardia");
  assert.equal(p.codice_catastale, "F205");

  const q = parseIndirizzoItaliano("VIA X 1\n12345 COMUNEINESISTENTE XX");
  assert.equal(q.comune_riconosciuto, false);
  assert.equal(q.comune, "COMUNEINESISTENTE");
});

test("tabelle: ricerca comune per nome e catastale", () => {
  assert.equal(cercaComune("roma")?.codice_catastale, "H501");
  assert.equal(cercaComune("Roma", "MI"), undefined);
  assert.equal(comuneDaCatastale("g702")?.comune, "Pisa");
  assert.equal(normalizzaNome("Società  Città-Più S.r.l."), "SOCIETA CITTA PIU S R L");
});

test("sanzioni: tokenizzazione e somiglianza", () => {
  assert.deepEqual(tokenizza("Esempio Sanzionata Ltd."), ["ESEMPIO", "SANZIONATA"]);
  assert.equal(somiglianza(["A", "B"], ["A", "B"]), 1);
  assert.equal(somiglianza(["A", "B", "C"], ["A", "B"]), 0.85); // contenimento
  assert.ok(somiglianza(["A", "B"], ["C", "D"]) === 0);
});

test("sanzioni: esito coerente con lo stato della lista", () => {
  const r = controllaSanzioni("Esempio Sanzionata S.r.l.");
  assert.equal(r.esito, infoTabelle.sanzioni.aggiornato ? "nessuna_corrispondenza" : "lista_non_caricata");
});

test("sanzioni: matching su lista iniettata", () => {
  const lista = [
    { id: "1", tipo: "E", nomi: ["ROSSI TRADING LLC", "ROSSI TRADE"], programmi: ["RUS"] },
    { id: "2", tipo: "P", nomi: ["MARIO BIANCHI"], programmi: ["IRN"] },
  ];
  // forziamo la lista "caricata" passando per il parametro; l'esito dipende da infoTabelle
  // quindi testiamo direttamente la logica di matching tramite somiglianza
  const t = tokenizza("Rossi Trading S.r.l.");
  const best = Math.max(...lista[0].nomi.map((n) => somiglianza(t, tokenizza(n))));
  assert.ok(best >= 0.8, `atteso match forte, ottenuto ${best}`);
  const noMatch = Math.max(...lista[1].nomi.map((n) => somiglianza(t, tokenizza(n))));
  assert.ok(noMatch < 0.5);
});
