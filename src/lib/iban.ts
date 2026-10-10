/**
 * IBAN: validazione mod 97-10 (ISO 7064) per qualunque paese,
 * più la scomposizione della struttura italiana:
 *   IT + 2 check + 1 CIN + 5 ABI + 5 CAB + 12 conto = 27 caratteri
 * Il CIN italiano è verificato con l'algoritmo dei pesi pari/dispari.
 */
import { bancaDaAbi } from "./tabelle.js";
import { checkCharCodiceFiscale } from "./codice-fiscale.js";
import type { IbanCheck } from "../schemi.js";

const LUNGHEZZE: Record<string, number> = {
  IT: 27, SM: 27, VA: 22, DE: 22, FR: 27, ES: 24, CH: 21, AT: 20, NL: 18, BE: 16,
  GB: 22, PT: 25, IE: 22, LU: 20, MC: 27, PL: 28, GR: 27, HR: 21, SI: 19, SK: 24,
  CZ: 24, HU: 28, RO: 24, BG: 22, DK: 18, SE: 24, FI: 18, NO: 15, LT: 20, LV: 21,
  EE: 20, MT: 31, CY: 28, LI: 21,
};

/** Lettere → numeri (A=10 … Z=35), poi resto mod 97 su tutto il numero. */
function mod97(s: string): number {
  return Number(BigInt(s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))) % 97n);
}

/** Il CIN usa lo stesso algoritmo del carattere di controllo del codice fiscale. */
export function calcolaCin(abi: string, cab: string, conto: string): string {
  return checkCharCodiceFiscale((abi + cab + conto).toUpperCase());
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
  if (mod97(riordinato) !== 1) {
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
