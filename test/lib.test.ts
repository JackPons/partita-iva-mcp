import { test } from "node:test";
import assert from "node:assert/strict";
import { validaPartitaIva, checkDigitPartitaIva } from "../src/lib/partita-iva.js";
import { validaCodiceFiscale, checkCharCodiceFiscale } from "../src/lib/codice-fiscale.js";
import { validaIban, calcolaCin } from "../src/lib/iban.js";
import { parseIndirizzoItaliano } from "../src/lib/vies.js";

test("partita IVA: check digit e normalizzazione", () => {
  // 0000000000 -> somma 0 -> check 0
  assert.equal(checkDigitPartitaIva("0000000000"), 0);
  const ok = validaPartitaIva("IT 00000000000");
  assert.equal(ok.valida, true);
  assert.equal(ok.normalizzata, "00000000000");

  const corta = validaPartitaIva("123");
  assert.equal(corta.valida, false);
  assert.match(corta.errore!, /11 cifre/);

  const sbagliata = validaPartitaIva("00000000001");
  assert.equal(sbagliata.valida, false);
  assert.match(sbagliata.errore!, /controllo/);
});

test("partita IVA: codice ufficio 999 segnala non residente", () => {
  const prime10 = "0000000999";
  const cd = checkDigitPartitaIva(prime10);
  const r = validaPartitaIva(prime10 + cd);
  assert.equal(r.valida, true);
  assert.equal(r.ufficio, "999");
  assert.match(r.note!, /non residente/);
});

test("codice fiscale: esempio noto e omocodia", () => {
  // Esempio didattico ricorrente: RSSMRA85T10A562S (Mario Rossi, 10/12/1985, Atri)
  const r = validaCodiceFiscale("rssmra85t10a562s");
  assert.equal(r.valido, true);
  assert.equal(r.tipo, "persona_fisica");
  assert.equal(r.dati?.sesso, "M");
  assert.equal(r.dati?.data_nascita, "1985-12-10");
  assert.equal(r.dati?.codice_catastale, "A562");
  assert.equal(r.dati?.omocodia, false);

  // Versione omocodica: ultime cifre sostituite da lettere, check ricalcolato
  const omo15 = "RSSMRA85T10A56N";
  const omo = omo15 + checkCharCodiceFiscale(omo15);
  const ro = validaCodiceFiscale(omo);
  assert.equal(ro.valido, true);
  assert.equal(ro.dati?.omocodia, true);
  assert.equal(ro.dati?.codice_catastale, "A562");
});

test("codice fiscale: donna, controllo errato, persona giuridica", () => {
  const prime15 = "BNCLRA90A41F205";
  const cf = prime15 + checkCharCodiceFiscale(prime15);
  const r = validaCodiceFiscale(cf);
  assert.equal(r.valido, true);
  assert.equal(r.dati?.sesso, "F");
  assert.equal(r.dati?.data_nascita, "1990-01-01");

  const errato = validaCodiceFiscale(prime15 + (cf[15] === "A" ? "B" : "A"));
  assert.equal(errato.valido, false);

  const pg = validaCodiceFiscale("00000000000");
  assert.equal(pg.tipo, "persona_giuridica");
  assert.equal(pg.valido, true);
});

test("IBAN: mod 97, CIN italiano, formattazione", () => {
  // Costruiamo un IBAN italiano coerente: ABI 03069, CAB 09606, conto 100000000000
  const abi = "03069", cab = "09606", conto = "100000000000";
  const cin = calcolaCin(abi, cab, conto);
  const bban = cin + abi + cab + conto;
  // check digits: 98 - mod97(bban + "IT00")
  const num = (s: string) => s.split("").map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join("");
  let resto = 0;
  for (const ch of num(bban + "IT00")) resto = (resto * 10 + Number(ch)) % 97;
  const check = String(98 - resto).padStart(2, "0");
  const iban = `IT${check}${bban}`;

  const r = validaIban(iban.replace(/(.{4})/g, "$1 "));
  assert.equal(r.valido, true, r.errore);
  assert.equal(r.paese, "IT");
  assert.equal(r.italia?.abi, abi);
  assert.equal(r.italia?.cab, cab);
  assert.equal(r.italia?.cin_valido, true);
  assert.equal(r.formattato?.length, 27 + 6);

  const rotto = validaIban(iban.slice(0, -1) + (iban.endsWith("0") ? "1" : "0"));
  assert.equal(rotto.valido, false);

  const corto = validaIban("IT60X0542811101");
  assert.equal(corto.valido, false);
  assert.match(corto.errore!, /27 caratteri/);
});

test("IBAN estero valido (esempio canonico tedesco)", () => {
  const r = validaIban("DE89 3704 0044 0532 0130 00");
  assert.equal(r.valido, true);
  assert.equal(r.paese, "DE");
  assert.equal(r.italia, undefined);
});

test("parsing indirizzo VIES", () => {
  const p = parseIndirizzoItaliano("VIA ROMA 1 \n00100 ROMA RM\n");
  assert.equal(p.via, "VIA ROMA 1");
  assert.equal(p.cap, "00100");
  assert.equal(p.comune, "Roma"); // normalizzato dalla tabella ISTAT
  assert.equal(p.provincia, "RM");
  const q = parseIndirizzoItaliano("PIAZZA DEL DUOMO 2\n20121 MILANO MI");
  assert.equal(q.comune, "Milano");
  assert.equal(q.cap, "20121");
});
