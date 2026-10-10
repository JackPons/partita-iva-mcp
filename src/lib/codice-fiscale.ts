/**
 * Codice fiscale italiano (persona fisica): 16 caratteri.
 * - 3 lettere cognome, 3 lettere nome
 * - 2 cifre anno, 1 lettera mese, 2 cifre giorno (+40 per le donne)
 * - 4 caratteri codice catastale del comune (o Z + 3 cifre per l'estero)
 * - 1 carattere di controllo
 * Gestisce anche l'omocodia (cifre sostituite da lettere L..V).
 *
 * Un codice fiscale di 11 cifre è quello di una persona giuridica e
 * coincide con la partita IVA: viene delegato a validaPartitaIva.
 */

import { validaPartitaIva } from "./partita-iva.js";
import { comuneDaCatastale, statoDaCodice } from "./tabelle.js";
import type { CodiceFiscaleCheck } from "../schemi.js";

const MESI = "ABCDEHLMPRST";
const OMOCODIA = "LMNPQRSTUV";

const DISPARI: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

function pari(c: string): number {
  return /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
}

/**
 * Carattere di controllo a pesi pari/dispari mod 26. Lo stesso algoritmo
 * calcola il CIN degli IBAN italiani (su ABI + CAB + conto).
 */
export function checkCharCodiceFiscale(caratteri: string): string {
  let somma = 0;
  for (let i = 0; i < caratteri.length; i++) {
    const c = caratteri[i];
    somma += i % 2 === 0 ? DISPARI[c] : pari(c);
  }
  return String.fromCharCode(65 + (somma % 26));
}

function deOmocodia(cf: string): { cf: string; omocodia: boolean } {
  // posizioni che devono essere cifre: 6,7, 9,10, 12,13,14
  const posizioni = [6, 7, 9, 10, 12, 13, 14];
  let omocodia = false;
  const chars = cf.split("");
  for (const p of posizioni) {
    const idx = OMOCODIA.indexOf(chars[p]);
    if (idx >= 0) {
      chars[p] = String(idx);
      omocodia = true;
    }
  }
  return { cf: chars.join(""), omocodia };
}

export function validaCodiceFiscale(raw: string): CodiceFiscaleCheck {
  const normalizzato = raw.trim().toUpperCase().replace(/\s/g, "");
  const base: CodiceFiscaleCheck = { input: raw, normalizzato, valido: false };

  if (/^\d{11}$/.test(normalizzato)) {
    const piva = validaPartitaIva(normalizzato);
    return {
      ...base,
      valido: piva.valida,
      tipo: "persona_giuridica",
      errore: piva.errore,
    };
  }

  if (!/^[A-Z0-9]{16}$/.test(normalizzato)) {
    return { ...base, errore: "Il codice fiscale deve avere 16 caratteri alfanumerici (o 11 cifre per le persone giuridiche)." };
  }
  if (!/^[A-Z]{6}/.test(normalizzato)) {
    return { ...base, errore: "I primi 6 caratteri devono essere lettere (cognome e nome)." };
  }

  const atteso = checkCharCodiceFiscale(normalizzato.slice(0, 15));
  if (atteso !== normalizzato[15]) {
    return { ...base, errore: `Carattere di controllo errato (atteso ${atteso}).` };
  }

  const { cf, omocodia } = deOmocodia(normalizzato);
  if (!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(cf)) {
    return { ...base, errore: "Struttura del codice fiscale non valida." };
  }

  const mese = MESI.indexOf(cf[8]);
  if (mese < 0) return { ...base, errore: `Lettera del mese non valida: ${cf[8]}.` };

  let giorno = Number(cf.slice(9, 11));
  const sesso: "M" | "F" = giorno > 40 ? "F" : "M";
  if (sesso === "F") giorno -= 40;

  const aa = Number(cf.slice(6, 8));
  const annoCorrente = new Date().getFullYear();
  const anno = 2000 + aa <= annoCorrente ? 2000 + aa : 1900 + aa;
  // la data deve esistere davvero (niente 31 febbraio); Date "sposta" i giorni fuori mese
  if (giorno < 1 || new Date(Date.UTC(anno, mese, giorno)).getUTCDate() !== giorno) {
    return { ...base, errore: "Giorno di nascita non valido." };
  }

  const codiceCatastale = cf.slice(11, 15);
  const natoEstero = codiceCatastale.startsWith("Z");
  let luogoNascita: string | undefined;
  let provinciaNascita: string | undefined;
  if (natoEstero) {
    luogoNascita = statoDaCodice(codiceCatastale);
  } else {
    const c = comuneDaCatastale(codiceCatastale);
    if (c) {
      luogoNascita = `${c.comune} (${c.provincia})`;
      provinciaNascita = c.provincia;
    }
  }

  return {
    ...base,
    valido: true,
    tipo: "persona_fisica",
    dati: {
      sesso,
      data_nascita: `${anno}-${String(mese + 1).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`,
      anno_ambiguo: true,
      codice_catastale: codiceCatastale,
      nato_estero: natoEstero,
      luogo_nascita: luogoNascita,
      provincia_nascita: provinciaNascita,
      omocodia,
    },
  };
}
