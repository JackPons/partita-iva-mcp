/**
 * Schemi di output degli strumenti MCP.
 *
 * Servono al client per sapere in anticipo la forma della risposta, e l'SDK
 * li usa per validare `structuredContent`: se una risposta non rispetta lo
 * schema lo strumento fallisce, quindi ogni modifica all'output di una
 * funzione in src/lib va riportata qui (i test in test/schemi.test.ts lo
 * verificano su tutti gli strumenti).
 *
 * Gli oggetti sono "loose": campi aggiuntivi sono ammessi, così aggiungere
 * un'informazione non rompe i client esistenti.
 */
import { z } from "zod";

const s = z.string();
const opt = <T extends z.ZodType>(t: T) => t.optional();

// ---- blocchi riusati --------------------------------------------------------

export const formalePartitaIva = z.looseObject({
  input: s,
  normalizzata: s.describe("Partita IVA senza prefisso IT, spazi o punti"),
  valida: z.boolean().describe("true se supera il controllo formale"),
  errore: opt(s),
  ufficio: opt(s).describe("Codice ufficio (cifre 8-10)"),
  note: opt(s),
});

export const indirizzo = z.looseObject({
  via: opt(s),
  cap: opt(s),
  comune: opt(s),
  provincia: opt(s),
  regione: opt(s),
  codice_catastale: opt(s),
  codice_istat: opt(s),
  comune_riconosciuto: z.boolean().describe("true se il comune è stato agganciato alla tabella ISTAT"),
});

export const vies = z.looseObject({
  fonte: z.literal("VIES"),
  interrogato_il: s,
  paese: s,
  partita_iva: s,
  attiva: z.boolean().describe("true se VIES conferma la partita IVA come valida/attiva"),
  denominazione: opt(s),
  indirizzo_grezzo: opt(s),
  indirizzo: opt(indirizzo),
  servizio_disponibile: z.boolean().describe("false se VIES non era raggiungibile: in quel caso 'attiva' non è significativo"),
  errore: opt(s),
});

export const ipa = z.looseObject({
  fonte: z.literal("IPA"),
  e_pubblica_amministrazione: z.boolean(),
  codice_ipa: opt(s),
  denominazione: opt(s),
  tipologia: opt(s),
  pec: opt(s),
  sito_web: opt(s),
  comune: opt(s),
  provincia: opt(s),
  servizio_disponibile: z.boolean(),
  errore: opt(s),
});

export const esitoSanzioni = z.looseObject({
  fonte: s,
  lista_aggiornata_al: s.nullable(),
  voci_in_lista: z.number(),
  nome_cercato: s,
  soglia: z.number(),
  possibili_corrispondenze: z.array(
    z.looseObject({
      id: s,
      tipo: s,
      nome_in_lista: s,
      programmi: z.array(s),
      punteggio: z.number().describe("Somiglianza 0-1"),
    }),
  ),
  esito: z.enum(["nessuna_corrispondenza", "da_verificare", "lista_non_caricata"]),
});

// ---- output per strumento (raw shape, come vuole registerTool) --------------

export const outValidaPartitaIva = formalePartitaIva.shape;

export const outVerificaPartitaIva = {
  formale: formalePartitaIva,
  vies: vies.nullable().describe("null se la partita IVA non supera il controllo formale"),
};

export const outValidaCodiceFiscale = {
  input: s,
  normalizzato: s,
  valido: z.boolean(),
  tipo: opt(z.enum(["persona_fisica", "persona_giuridica"])),
  errore: opt(s),
  dati: opt(
    z.looseObject({
      sesso: z.enum(["M", "F"]),
      data_nascita: s.describe("YYYY-MM-DD; il secolo è dedotto"),
      anno_ambiguo: z.boolean(),
      codice_catastale: s,
      nato_estero: z.boolean(),
      luogo_nascita: opt(s),
      provincia_nascita: opt(s),
      omocodia: z.boolean(),
    }),
  ),
};

export const outValidaIban = {
  input: s,
  normalizzato: s,
  valido: z.boolean(),
  paese: opt(s),
  errore: opt(s),
  italia: opt(
    z.looseObject({
      cin: s,
      cin_valido: z.boolean(),
      abi: s,
      banca: opt(s),
      cab: s,
      conto: s,
    }),
  ),
  formattato: opt(s),
};

export const outCercaComune = {
  trovato: z.boolean(),
  comune: opt(s),
  provincia: opt(s),
  regione: opt(s),
  codice_catastale: opt(s),
  codice_istat: opt(s),
  tabella: opt(z.looseObject({ fonte: s, voci: z.number() })),
  errore: opt(s),
};

export const outControllaSanzioni = esitoSanzioni.shape;

export const outSchedaSoggetto = {
  formale: formalePartitaIva,
  vies: vies.nullable(),
  ipa: ipa.nullable(),
  sanzioni: esitoSanzioni.nullable().describe("null se la P.IVA è formalmente errata, se VIES non dà una denominazione o se disattivato"),
  riepilogo: s.describe("Una frase di sintesi per l'utente"),
};

// ---- annotazioni ------------------------------------------------------------

/** Strumenti che lavorano solo su dati locali. */
export const ANNOTAZIONI_OFFLINE = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Strumenti che interrogano servizi esterni (VIES, IPA). */
export const ANNOTAZIONI_ONLINE = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
