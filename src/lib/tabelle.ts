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
export const sanzioni = sanzioniJson.soggetti as SoggettoSanzionato[];

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

export type ComuneConCodice = Comune & { codice_catastale: string };

let perNome: Map<string, ComuneConCodice[]> | undefined;

/**
 * Comuni con quel nome (senza badare a maiuscole e accenti), filtrati per
 * provincia se indicata. Più di un risultato = omonimi da disambiguare.
 */
export function cercaComuni(nome: string, provincia?: string): ComuneConCodice[] {
  if (!perNome) {
    perNome = new Map();
    for (const [codice, c] of Object.entries(comuni)) {
      const k = normalizzaNome(c.comune);
      if (!perNome.has(k)) perNome.set(k, []);
      perNome.get(k)!.push({ ...c, codice_catastale: codice });
    }
  }
  const tutti = perNome.get(normalizzaNome(nome)) ?? [];
  return provincia ? tutti.filter((c) => c.provincia === provincia.toUpperCase()) : tutti;
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
