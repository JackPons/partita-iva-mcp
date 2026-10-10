import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validaPartitaIva } from "./lib/partita-iva.js";
import { validaCodiceFiscale } from "./lib/codice-fiscale.js";
import { validaIban } from "./lib/iban.js";
import { interrogaVies } from "./lib/vies.js";
import { cercaInIpa } from "./lib/ipa.js";
import { controllaSanzioni } from "./lib/sanzioni.js";
import { cercaComune, comuneDaCatastale, infoTabelle } from "./lib/tabelle.js";
import {
  ANNOTAZIONI_OFFLINE,
  ANNOTAZIONI_ONLINE,
  outCercaComune,
  outControllaSanzioni,
  outSchedaSoggetto,
  outValidaCodiceFiscale,
  outValidaIban,
  outValidaPartitaIva,
  outVerificaPartitaIva,
} from "./schemi.js";

export const SERVER_INFO = {
  name: "partita-iva-mcp",
  version: "0.4.2",
};

function json(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

/**
 * Costruisce il server. `fetchImpl` è iniettabile per i test.
 */
export function creaServer(fetchImpl: typeof fetch = fetch): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Strumenti per verificare identificativi italiani (partita IVA, codice fiscale, IBAN) " +
      "e arricchirli con fonti ufficiali gratuite (VIES, IPA). " +
      "Usa `scheda_soggetto` quando serve un quadro completo di un'azienda o ente a partire dalla partita IVA; " +
      "usa gli altri strumenti per validazioni puntuali e veloci (senza chiamate esterne). " +
      "`controlla_sanzioni` è uno screening indicativo sulla lista UE: un esito 'da_verificare' va sempre confermato da un operatore.",
  });

  server.registerTool(
    "controlla_sanzioni",
    {
      title: "Screening sanzioni UE",
      description:
        "Confronta un nome (persona o ente) con la lista consolidata delle sanzioni finanziarie UE, con matching tollerante " +
        "(ignora forme societarie e accenti). Restituisce le possibili corrispondenze con un punteggio 0-1. " +
        "Screening indicativo, non un sistema AML certificato: 'da_verificare' significa che un umano deve controllare.",
      inputSchema: {
        nome: z.string().describe("Denominazione o nome e cognome da verificare"),
        soglia: z.number().min(0.5).max(1).optional().describe("Soglia di somiglianza (default 0.8)"),
      },
      outputSchema: outControllaSanzioni,
      annotations: ANNOTAZIONI_OFFLINE,
    },
    async ({ nome, soglia }) => json(controllaSanzioni(nome, { soglia })),
  );

  server.registerTool(
    "cerca_comune",
    {
      title: "Cerca comune italiano",
      description:
        "Trova un comune italiano per nome (con provincia opzionale) o per codice catastale, dalla tabella ISTAT locale. " +
        "Restituisce denominazione canonica, provincia, regione, codice catastale e codice ISTAT.",
      inputSchema: {
        nome: z.string().optional().describe("Nome del comune, es. 'Atri'"),
        provincia: z.string().length(2).optional().describe("Sigla provincia per disambiguare, es. 'TE'"),
        codice_catastale: z.string().length(4).optional().describe("Codice catastale, es. 'A562'"),
      },
      outputSchema: outCercaComune,
      annotations: ANNOTAZIONI_OFFLINE,
    },
    async ({ nome, provincia, codice_catastale }) => {
      if (codice_catastale) {
        const c = comuneDaCatastale(codice_catastale);
        return json(c ? { trovato: true, codice_catastale: codice_catastale.toUpperCase(), ...c } : { trovato: false, tabella: infoTabelle.comuni });
      }
      if (nome) {
        const c = cercaComune(nome, provincia);
        return json(c ? { trovato: true, ...c } : { trovato: false, tabella: infoTabelle.comuni });
      }
      return json({ trovato: false, errore: "Indica nome o codice_catastale." });
    },
  );

  server.registerTool(
    "valida_partita_iva",
    {
      title: "Valida partita IVA (formale)",
      description:
        "Controllo formale e offline di una partita IVA italiana: lunghezza, cifra di controllo, codice ufficio. " +
        "Non dice se la partita IVA è attiva: per quello usa `verifica_partita_iva`.",
      inputSchema: { partita_iva: z.string().describe("Partita IVA, con o senza prefisso IT, spazi o punti") },
      outputSchema: outValidaPartitaIva,
      annotations: ANNOTAZIONI_OFFLINE,
    },
    async ({ partita_iva }) => json(validaPartitaIva(partita_iva)),
  );

  server.registerTool(
    "verifica_partita_iva",
    {
      title: "Verifica partita IVA su VIES",
      description:
        "Verifica se una partita IVA italiana è attiva interrogando VIES (Commissione Europea). " +
        "Restituisce anche denominazione e indirizzo quando disponibili. " +
        "Se la partita IVA non supera il controllo formale, VIES non viene interrogato.",
      inputSchema: { partita_iva: z.string().describe("Partita IVA italiana, 11 cifre") },
      outputSchema: outVerificaPartitaIva,
      annotations: ANNOTAZIONI_ONLINE,
    },
    async ({ partita_iva }) => {
      const formale = validaPartitaIva(partita_iva);
      if (!formale.valida) return json({ formale, vies: null });
      const vies = await interrogaVies(formale.normalizzata, fetchImpl);
      return json({ formale, vies });
    },
  );

  server.registerTool(
    "valida_codice_fiscale",
    {
      title: "Valida codice fiscale",
      description:
        "Validazione offline di un codice fiscale italiano. Per le persone fisiche (16 caratteri) verifica il carattere di controllo, " +
        "gestisce l'omocodia ed estrae sesso, data di nascita (anno con secolo dedotto) e codice catastale del comune. " +
        "Per le persone giuridiche (11 cifre) applica il controllo della partita IVA.",
      inputSchema: { codice_fiscale: z.string().describe("Codice fiscale, 16 caratteri o 11 cifre") },
      outputSchema: outValidaCodiceFiscale,
      annotations: ANNOTAZIONI_OFFLINE,
    },
    async ({ codice_fiscale }) => json(validaCodiceFiscale(codice_fiscale)),
  );

  server.registerTool(
    "valida_iban",
    {
      title: "Valida IBAN",
      description:
        "Validazione offline di un IBAN (mod 97, lunghezza per paese). Per gli IBAN italiani verifica anche il CIN " +
        "e scompone ABI, CAB e numero di conto. Non verifica l'esistenza del conto.",
      inputSchema: { iban: z.string().describe("IBAN, con o senza spazi") },
      outputSchema: outValidaIban,
      annotations: ANNOTAZIONI_OFFLINE,
    },
    async ({ iban }) => json(validaIban(iban)),
  );

  server.registerTool(
    "scheda_soggetto",
    {
      title: "Scheda soggetto da partita IVA",
      description:
        "Quadro completo di un soggetto italiano a partire dalla partita IVA: controllo formale, stato su VIES con denominazione " +
        "e indirizzo normalizzato (via, CAP, comune ISTAT, provincia, regione), screening sanzioni UE sulla denominazione, " +
        "e se il soggetto è una Pubblica Amministrazione i dati IPA (codice IPA, PEC, sito). " +
        "Ogni blocco indica la fonte e se il servizio era raggiungibile. " +
        "Per un'azienda privata la scheda non include soci, cariche o bilanci (dati a pagamento del Registro Imprese).",
      inputSchema: {
        partita_iva: z.string().describe("Partita IVA italiana, 11 cifre"),
        sanzioni: z.boolean().optional().describe("Esegui lo screening sanzioni sulla denominazione VIES (default true)"),
      },
      outputSchema: outSchedaSoggetto,
      annotations: ANNOTAZIONI_ONLINE,
    },
    async ({ partita_iva, sanzioni }) => {
      const formale = validaPartitaIva(partita_iva);
      if (!formale.valida) {
        return json({ formale, vies: null, ipa: null, sanzioni: null, riepilogo: "Partita IVA formalmente non valida: nessuna fonte interrogata." });
      }
      const [vies, ipa] = await Promise.all([
        interrogaVies(formale.normalizzata, fetchImpl),
        cercaInIpa(formale.normalizzata, fetchImpl),
      ]);
      const esitoSanzioni = sanzioni !== false && vies.denominazione ? controllaSanzioni(vies.denominazione) : null;

      const parti: string[] = [];
      if (!vies.servizio_disponibile) parti.push("VIES non raggiungibile");
      else parti.push(vies.attiva ? `partita IVA attiva${vies.denominazione ? ` (${vies.denominazione})` : ""}` : "partita IVA NON attiva su VIES");
      if (vies.indirizzo?.comune_riconosciuto) parti.push(`sede a ${vies.indirizzo.comune} (${vies.indirizzo.provincia})`);
      if (ipa.e_pubblica_amministrazione) parti.push(`Pubblica Amministrazione, codice IPA ${ipa.codice_ipa}`);
      else if (!ipa.servizio_disponibile) parti.push("IPA non raggiungibile");
      if (esitoSanzioni?.esito === "da_verificare") parti.push(`ATTENZIONE: ${esitoSanzioni.possibili_corrispondenze.length} possibili corrispondenze in lista sanzioni UE`);
      else if (esitoSanzioni?.esito === "lista_non_caricata") parti.push("lista sanzioni non caricata");

      return json({ formale, vies, ipa, sanzioni: esitoSanzioni, riepilogo: parti.join("; ") + "." });
    },
  );

  return server;
}
