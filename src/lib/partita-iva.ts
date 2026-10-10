/**
 * Partita IVA italiana: 11 cifre, le prime 7 identificano il soggetto,
 * le cifre 8-10 l'ufficio provinciale (o 999 per soggetti non residenti
 * identificati direttamente, 888 per gruppi IVA), l'ultima è il check digit
 * calcolato con un algoritmo di tipo Luhn.
 */
import type { PartitaIvaCheck } from "../schemi.js";

export function normalizzaPartitaIva(raw: string): string {
  return raw.trim().toUpperCase().replace(/^IT/, "").replace(/[\s.-]/g, "");
}

export function checkDigitPartitaIva(prime10: string): number {
  let somma = 0;
  for (let i = 0; i < 10; i++) {
    const n = Number(prime10[i]);
    if (i % 2 === 0) {
      somma += n;
    } else {
      const d = n * 2;
      somma += d > 9 ? d - 9 : d;
    }
  }
  return (10 - (somma % 10)) % 10;
}

export function validaPartitaIva(raw: string): PartitaIvaCheck {
  const normalizzata = normalizzaPartitaIva(raw);
  const base: PartitaIvaCheck = { input: raw, normalizzata, valida: false };

  if (!/^\d{11}$/.test(normalizzata)) {
    return { ...base, errore: "La partita IVA deve essere composta da 11 cifre." };
  }
  const atteso = checkDigitPartitaIva(normalizzata.slice(0, 10));
  if (atteso !== Number(normalizzata[10])) {
    return { ...base, errore: `Carattere di controllo errato (atteso ${atteso}).` };
  }

  if (normalizzata.startsWith("0000000")) {
    return { ...base, errore: "Matricola nulla: non è una partita IVA assegnabile." };
  }
  // Codici fiscali numerici di enti (comuni, ASL, scuole, associazioni): iniziano
  // per 8 o 9, hanno lo stesso check digit ma le cifre 8-10 non sono un ufficio.
  if (/^[89]/.test(normalizzata)) {
    return { ...base, valida: true, note: "Codice fiscale numerico di un ente (inizia per 8 o 9): le cifre 8-10 non indicano un ufficio." };
  }
  // uffici: 001-100 e 120-121 provinciali, 888 gruppi IVA, 999 non residenti.
  // Un ufficio fuori range è solo una nota: rifiutare un identificativo vero
  // costa più che accettarne uno strano.
  const ufficio = normalizzata.slice(7, 10);
  const u = Number(ufficio);
  let note: string | undefined;
  if (u === 999) note = "Soggetto non residente identificato direttamente in Italia.";
  else if (u === 888) note = "Gruppo IVA.";
  else if (u === 0 || u > 121) note = `Codice ufficio ${ufficio} non assegnato: verifica il numero.`;
  else if (u > 100 && u < 120) note = "Codice ufficio provinciale non standard.";

  return { ...base, valida: true, ufficio, note };
}
