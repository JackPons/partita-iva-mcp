/**
 * Client per VIES (VAT Information Exchange System) della Commissione Europea.
 * API REST pubblica, senza chiave. Per le partite IVA italiane restituisce
 * di norma anche denominazione e indirizzo.
 *
 * Doc: https://ec.europa.eu/taxation_customs/vies/#/technical-information
 */
import { cercaComuni } from "./tabelle.js";
import type { IndirizzoParsato, ViesResult } from "../schemi.js";

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

/**
 * VIES per l'Italia restituisce indirizzi del tipo:
 *   "VIA ROMA 1 \n00100 ROMA RM\n"
 * Estraiamo CAP, comune e sigla provincia con una regex tollerante.
 */
export function parseIndirizzoItaliano(raw: string): IndirizzoParsato {
  const righe = raw.split(/\n/).map((r) => r.trim()).filter(Boolean);
  const out: IndirizzoParsato = { comune_riconosciuto: false };
  for (const riga of righe) {
    const m = riga.match(/^(\d{5})\s+(.+?)\s+([A-Z]{2})$/);
    if (m) {
      out.cap = m[1];
      out.comune = m[2];
      out.provincia = m[3];
    } else if (!out.via) {
      out.via = riga;
    }
  }
  if (out.comune) {
    const trovati = cercaComuni(out.comune, out.provincia);
    const c = trovati.length === 1 ? trovati[0] : undefined; // omonimi senza provincia: non indoviniamo
    if (c) {
      out.comune = c.comune; // forma canonica ISTAT
      out.regione = c.regione;
      out.codice_catastale = c.codice_catastale;
      out.codice_istat = c.codice_istat;
      out.comune_riconosciuto = true;
    }
  }
  return out;
}

export async function interrogaVies(
  partitaIva: string,
  fetchImpl: typeof fetch = fetch,
  paese = "IT",
): Promise<ViesResult> {
  const base: ViesResult = {
    fonte: "VIES",
    interrogato_il: new Date().toISOString(),
    paese,
    partita_iva: partitaIva,
    attiva: false,
    servizio_disponibile: true,
  };

  let res: Response;
  try {
    res = await fetchImpl(VIES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ countryCode: paese, vatNumber: partitaIva }),
    });
  } catch (e) {
    return { ...base, servizio_disponibile: false, errore: `VIES non raggiungibile: ${(e as Error).message}` };
  }

  if (!res.ok) {
    return { ...base, servizio_disponibile: false, errore: `VIES ha risposto HTTP ${res.status}` };
  }

  let data: { valid?: boolean; name?: string; address?: string; userError?: string; requestDate?: string };
  try {
    data = await res.json();
  } catch {
    // capita una pagina HTML di manutenzione con status 200
    return { ...base, servizio_disponibile: false, errore: "VIES ha risposto con un contenuto non JSON" };
  }

  // VIES segnala indisponibilità del paese con userError (es. MS_UNAVAILABLE)
  if (data.userError && data.userError !== "VALID" && data.userError !== "INVALID") {
    return { ...base, servizio_disponibile: false, errore: `VIES: ${data.userError}` };
  }

  const pulisci = (s?: string) => (s && s !== "---" ? s.trim() : undefined);
  const denominazione = pulisci(data.name);
  const indirizzoGrezzo = pulisci(data.address);

  return {
    ...base,
    interrogato_il: data.requestDate ?? base.interrogato_il,
    attiva: data.valid === true,
    denominazione,
    indirizzo_grezzo: indirizzoGrezzo,
    indirizzo: indirizzoGrezzo ? parseIndirizzoItaliano(indirizzoGrezzo) : undefined,
  };
}
