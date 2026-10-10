/**
 * Screening indicativo contro la lista consolidata delle sanzioni UE.
 * Matching su token: si ignorano le forme societarie (SRL, LTD, ...),
 * si confronta l'insieme dei token e si restituisce un punteggio 0-1.
 * NON è un sistema AML certificato: serve a sollevare una bandierina,
 * la verifica vera resta a un operatore e a un provider specializzato.
 */
import { sanzioni, normalizzaNome, infoTabelle, type SoggettoSanzionato } from "./tabelle.js";
import type { EsitoSanzioni, MatchSanzione } from "../schemi.js";

const FORME_SOCIETARIE = new Set([
  "SRL", "SPA", "SAS", "SNC", "SRLS", "SCARL", "SCRL", "SOC", "SOCIETA", "COOP", "COOPERATIVA",
  "LTD", "LLC", "INC", "CORP", "CO", "GMBH", "AG", "SA", "SARL", "BV", "NV", "PLC", "OOO", "JSC", "PJSC",
  "THE", "OF", "AND", "DI", "DEL", "DELLA", "DEI", "DELLE", "E",
]);

export function tokenizza(nome: string): string[] {
  return normalizzaNome(nome)
    .split(" ")
    .filter((t) => t.length > 1 && !FORME_SOCIETARIE.has(t));
}

/** Somiglianza tra insiemi di token (Dice), con bonus se uno contiene l'altro. */
export function somiglianza(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a), sb = new Set(b);
  let comuni = 0;
  for (const t of sa) if (sb.has(t)) comuni++;
  const dice = (2 * comuni) / (sa.size + sb.size);
  // bonus di contenimento solo con almeno 2 token in comune:
  // un singolo token generico ("BANK") non basta a segnalare un match
  const contenuto = comuni >= 2 && comuni === Math.min(sa.size, sb.size);
  return contenuto ? Math.max(dice, 0.85) : dice;
}

const MASSIMO_RISULTATI = 5;

/** Token dei nomi in lista, calcolati alla prima ricerca e poi riusati. */
let indice: { s: SoggettoSanzionato; nomi: { nome: string; tokens: string[] }[] }[] | undefined;

export function controllaSanzioni(nome: string, opzioni: { soglia?: number } = {}): EsitoSanzioni {
  const soglia = opzioni.soglia ?? 0.8;
  const tokens = tokenizza(nome);

  const base: EsitoSanzioni = {
    fonte: "Lista consolidata sanzioni UE",
    lista_aggiornata_al: infoTabelle.sanzioni.aggiornato,
    voci_in_lista: sanzioni.length,
    nome_cercato: nome,
    soglia,
    possibili_corrispondenze: [],
    esito: "nessuna_corrispondenza",
  };

  if (!infoTabelle.sanzioni.aggiornato) {
    return { ...base, esito: "lista_non_caricata" };
  }

  indice ??= sanzioni.map((s) => ({ s, nomi: s.nomi.map((n) => ({ nome: n, tokens: tokenizza(n) })) }));
  const trovati: MatchSanzione[] = [];
  for (const { s, nomi } of indice) {
    let migliore = 0, nomeMigliore = "";
    for (const n of nomi) {
      const p = somiglianza(tokens, n.tokens);
      if (p > migliore) { migliore = p; nomeMigliore = n.nome; }
    }
    if (migliore >= soglia) {
      trovati.push({ id: s.id, tipo: s.tipo, nome_in_lista: nomeMigliore, programmi: s.programmi, punteggio: Number(migliore.toFixed(2)) });
    }
  }
  trovati.sort((x, y) => y.punteggio - x.punteggio);

  return {
    ...base,
    possibili_corrispondenze: trovati.slice(0, MASSIMO_RISULTATI),
    esito: trovati.length ? "da_verificare" : "nessuna_corrispondenza",
  };
}
