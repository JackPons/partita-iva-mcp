/**
 * Tabelle locali (nessuna chiamata di rete): comuni per codice catastale,
 * stati esteri per codice Z, banche per codice ABI, lista sanzioni UE.
 * I JSON in src/data/ partono come SEED e vengono sostituiti da
 * `npm run dati` (scripts/aggiorna-dati.ts) con le tabelle ufficiali.
 */
import comuniJson from "../data/comuni.json" with { type: "json" };
import statiJson from "../data/stati-esteri.json" with { type: "json" };
import abiJson from "../data/abi.json" with { type: "json" };
import sanzioniJson from "../data/sanzioni.json" with { type: "json" };

export interface Comune {
  comune: string;
  provincia: string;
  regione: string;
  codice_istat?: string;
}

export interface SoggettoSanzionato {
  id: string;
  tipo: string; // "P" persona, "E" ente, altro
  nomi: string[];
  programmi: string[];
}

const comuni = comuniJson.comuni as Record<string, Comune>;
const stati = statiJson.stati as Record<string, string>;
const abi = abiJson.abi as Record<string, string>;
const sanzioni = sanzioniJson.soggetti as SoggettoSanzionato[];

export const infoTabelle = {
  comuni: { fonte: comuniJson._fonte, voci: Object.keys(comuni).length },
  stati: { fonte: statiJson._fonte, voci: Object.keys(stati).length },
  abi: { fonte: abiJson._fonte, voci: Object.keys(abi).length },
  sanzioni: { fonte: sanzioniJson._fonte, aggiornato: sanzioniJson._aggiornato, voci: sanzioni.length },
};

export function comuneDaCatastale(codice: string): Comune | undefined {
  return comuni[codice.toUpperCase()];
}

export function statoDaCodice(codice: string): string | undefined {
  return stati[codice.toUpperCase()];
}

export function bancaDaAbi(codice: string): string | undefined {
  return abi[codice];
}

/** Ricerca comune per nome (case-insensitive, esatta), opzionalmente filtrata per provincia. */
export function cercaComune(nome: string, provincia?: string): (Comune & { codice_catastale: string }) | undefined {
  const n = normalizzaNome(nome);
  for (const [codice, c] of Object.entries(comuni)) {
    if (normalizzaNome(c.comune) === n && (!provincia || c.provincia === provincia.toUpperCase())) {
      return { ...c, codice_catastale: codice };
    }
  }
  return undefined;
}

export function listaSanzioni(): SoggettoSanzionato[] {
  return sanzioni;
}

export function normalizzaNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
