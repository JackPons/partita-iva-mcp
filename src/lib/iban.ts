/**
 * IBAN: validazione mod 97-10 (ISO 7064) per qualunque paese,
 * più la scomposizione della struttura italiana:
 *   IT + 2 check + 1 CIN + 5 ABI + 5 CAB + 12 conto = 27 caratteri
 * Il CIN italiano è verificato con l'algoritmo dei pesi pari/dispari.
 */
import { bancaDaAbi } from "./tabelle.js";

export interface IbanCheck {
  input: string;
  normalizzato: string;
  valido: boolean;
  paese?: string;
  errore?: string;
  italia?: {
    cin: string;
    cin_valido: boolean;
    abi: string;
    banca?: string; // da tabella ABI locale, se nota
    cab: string;
    conto: string;
  };
  formattato?: string;
}

const LUNGHEZZE: Record<string, number> = {
  IT: 27, SM: 27, VA: 22, DE: 22, FR: 27, ES: 24, CH: 21, AT: 20, NL: 18, BE: 16,
  GB: 22, PT: 25, IE: 22, LU: 20, MC: 27, PL: 28, GR: 27, HR: 21, SI: 19, SK: 24,
  CZ: 24, HU: 28, RO: 24, BG: 22, DK: 18, SE: 24, FI: 18, NO: 15, LT: 20, LV: 21,
  EE: 20, MT: 31, CY: 28, LI: 21,
};

function mod97(numerico: string): number {
  let resto = 0;
  for (const ch of numerico) {
    resto = (resto * 10 + Number(ch)) % 97;
  }
  return resto;
}

function aNumerico(s: string): string {
  let out = "";
  for (const ch of s) {
    out += /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
  }
  return out;
}

const CIN_DISPARI: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
const CIN_PARI: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12,
  N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
};

export function calcolaCin(abi: string, cab: string, conto: string): string {
  const bban = (abi + cab + conto).toUpperCase();
  let somma = 0;
  for (let i = 0; i < bban.length; i++) {
    const c = bban[i];
    somma += i % 2 === 0 ? CIN_DISPARI[c] : CIN_PARI[c];
  }
  return String.fromCharCode(65 + (somma % 26));
}

export function validaIban(raw: string): IbanCheck {
  const normalizzato = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  const base: IbanCheck = { input: raw, normalizzato, valido: false };

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalizzato)) {
    return { ...base, errore: "Formato IBAN non valido." };
  }
  const paese = normalizzato.slice(0, 2);
  const lunghezzaAttesa = LUNGHEZZE[paese];
  if (lunghezzaAttesa && normalizzato.length !== lunghezzaAttesa) {
    return { ...base, paese, errore: `Per ${paese} l'IBAN deve avere ${lunghezzaAttesa} caratteri (trovati ${normalizzato.length}).` };
  }

  const riordinato = normalizzato.slice(4) + normalizzato.slice(0, 4);
  if (mod97(aNumerico(riordinato)) !== 1) {
    return { ...base, paese, errore: "Cifre di controllo IBAN errate." };
  }

  const formattato = normalizzato.replace(/(.{4})/g, "$1 ").trim();
  const out: IbanCheck = { ...base, valido: true, paese, formattato };

  if (paese === "IT") {
    const cin = normalizzato[4];
    const abi = normalizzato.slice(5, 10);
    const cab = normalizzato.slice(10, 15);
    const conto = normalizzato.slice(15);
    out.italia = { cin, cin_valido: calcolaCin(abi, cab, conto) === cin, abi, banca: bancaDaAbi(abi), cab, conto };
    if (!out.italia.cin_valido) {
      out.valido = false;
      out.errore = "CIN non coerente con ABI, CAB e numero di conto.";
    }
  }
  return out;
}
