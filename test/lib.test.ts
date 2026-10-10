import { test } from "node:test";
import assert from "node:assert/strict";
import { validaPartitaIva, checkDigitPartitaIva } from "../src/lib/partita-iva.js";
import { validaCodiceFiscale, checkCharCodiceFiscale } from "../src/lib/codice-fiscale.js";
import { validaIban, calcolaCin } from "../src/lib/iban.js";
import { interrogaVies, parseIndirizzoItaliano } from "../src/lib/vies.js";

test("partita IVA: check digit e normalizzazione", () => {
  // 0000000000 -> somma 0 -> check 0
  assert.equal(checkDigitPartitaIva("0000000000"), 0);
  const ok = validaPartitaIva("IT 00159560366");
  assert.equal(ok.valida, true);
  assert.equal(ok.normalizzata, "00159560366");

  const corta = validaPartitaIva("123");
  assert.equal(corta.valida, false);
  assert.match(corta.errore!, /11 cifre/);

  const sbagliata = validaPartitaIva("00000000001");
  assert.equal(sbagliata.valida, false);
  assert.match(sbagliata.errore!, /controllo/);
});

test("partita IVA: codice ufficio 999 segnala non residente", () => {
  const prime10 = "1234567999";
  const cd = checkDigitPartitaIva(prime10);
  const r = validaPartitaIva(prime10 + cd);
  assert.equal(r.valida, true);
  assert.equal(r.ufficio, "999");
  assert.match(r.note!, /non residente/);
});

test("codice fiscale: esempio noto e omocodia", () => {
  // Esempio didattico ricorrente: RSSMRA85T10A562S (Mario Rossi, 10/12/1985, A562 = San Giuliano Terme)
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

  const pg = validaCodiceFiscale("00159560366");
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

test("partita IVA: matricola nulla rifiutata, ufficio fuori range solo segnalato", () => {
  assert.match(validaPartitaIva("00000000000").errore!, /Matricola nulla/);
  const conUfficio = (u: string) => "1234567" + u + checkDigitPartitaIva("1234567" + u);
  for (const u of ["000", "500"]) {
    const r = validaPartitaIva(conUfficio(u));
    assert.equal(r.valida, true);
    assert.match(r.note!, /non assegnato/);
  }
  assert.equal(validaPartitaIva(conUfficio("121")).note, undefined);
  assert.equal(validaPartitaIva(conUfficio("888")).note, "Gruppo IVA.");
});

test("codice fiscale numerico di ente (8/9…): valido, senza ufficio", () => {
  const cf = (p10: string) => p10 + checkDigitPartitaIva(p10);
  for (const n of [cf("8001234567"), cf("9712345678")]) {
    const r = validaPartitaIva(n);
    assert.equal(r.valida, true, n);
    assert.equal(r.ufficio, undefined);
    assert.match(r.note!, /ente/);
    assert.equal(validaCodiceFiscale(n).valido, true);
  }
});

test("VIES: tra comuni omonimi sceglie quello della provincia indicata", () => {
  for (const [riga, provincia, catastale] of [
    ["22010 PEGLIO CO", "CO", "G415"],
    ["61049 PEGLIO PU", "PU", "G416"],
    ["24060 CASTRO BG", "BG", "C337"],
    ["73030 CASTRO LE", "LE", "M261"],
    ["98030 SAN TEODORO ME", "ME", "I328"],
  ]) {
    const r = parseIndirizzoItaliano(`VIA ROMA 1 \n${riga}\n`);
    assert.equal(r.comune_riconosciuto, true, riga);
    assert.equal(r.provincia, provincia);
    assert.equal(r.codice_catastale, catastale);
  }
  // provincia che non corrisponde a nessuno degli omonimi: niente aggancio
  assert.equal(parseIndirizzoItaliano("VIA ROMA 1 \n00100 CASTRO RM\n").comune_riconosciuto, false);
});

test("codice fiscale: la data di nascita deve esistere", () => {
  const cf = (p15: string) => p15 + checkCharCodiceFiscale(p15);
  assert.match(validaCodiceFiscale(cf("RSSMRA80B31H501")).errore!, /Giorno/); // 31 febbraio
  assert.match(validaCodiceFiscale(cf("RSSMRA80D31H501")).errore!, /Giorno/); // 31 aprile
  assert.equal(validaCodiceFiscale(cf("RSSMRA80B29H501")).dati?.data_nascita, "1980-02-29"); // bisestile
  assert.equal(validaCodiceFiscale(cf("RSSMRA81B69H501")).valido, false); // 29 feb 1981, donna
});

test("VIES: una pagina HTML con status 200 è 'non disponibile', non un'eccezione", async () => {
  const r = await interrogaVies("00159560366", async () => new Response("<html>manutenzione</html>", { status: 200 }));
  assert.equal(r.servizio_disponibile, false);
  assert.match(r.errore!, /non JSON/);
});
