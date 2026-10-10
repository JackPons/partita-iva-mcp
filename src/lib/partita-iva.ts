/**
 * Partita IVA italiana: 11 cifre, le prime 7 identificano il soggetto,
 * le cifre 8-10 l'ufficio provinciale (o 999 per soggetti non residenti
 * identificati direttamente, 888 per gruppi IVA), l'ultima è il check digit
 * calcolato con un algoritmo di tipo Luhn.
 */

export interface PartitaIvaCheck {
  input: string;
  normalizzata: string;
  valida: boolean;
  errore?: string;
  ufficio?: string;
  note?: string;
}

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

  const ufficio = normalizzata.slice(7, 10);
  let note: string | undefined;
  if (ufficio === "999") note = "Soggetto non residente identificato direttamente in Italia.";
  else if (ufficio === "888") note = "Gruppo IVA.";
  else if (Number(ufficio) > 100 && Number(ufficio) < 120) note = "Codice ufficio provinciale non standard.";

  return { ...base, valida: true, ufficio, note };
}
