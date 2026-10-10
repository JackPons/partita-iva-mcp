/**
 * Client per IPA (Indice delle Pubbliche Amministrazioni), via il portale
 * open data CKAN di indicepa.gov.it. Serve a capire se un codice fiscale
 * appartiene a una PA e a recuperare codice IPA, PEC e sito.
 *
 * Il resource_id del dataset "enti" cambia nel tempo: lo scopriamo a runtime
 * tramite package_show e lo mettiamo in cache per il processo.
 *
 * Portale: https://indicepa.gov.it/ipa-dati/
 */

import type { IpaResult } from "../schemi.js";

const CKAN_BASE = "https://indicepa.gov.it/ipa-dati/api/3/action";
const PACKAGE_ENTI = "enti";

let cacheResourceId: string | undefined;

async function scopriResourceId(fetchImpl: typeof fetch): Promise<string> {
  if (cacheResourceId) return cacheResourceId;
  const res = await fetchImpl(`${CKAN_BASE}/package_show?id=${PACKAGE_ENTI}`);
  if (!res.ok) throw new Error(`IPA package_show HTTP ${res.status}`);
  const data = (await res.json()) as {
    success: boolean;
    result?: { resources?: { id: string; name?: string; format?: string; datastore_active?: boolean }[] };
  };
  const risorse = data.result?.resources ?? [];
  const candidata =
    risorse.find((r) => r.datastore_active && /enti/i.test(r.name ?? "")) ??
    risorse.find((r) => r.datastore_active) ??
    risorse[0];
  if (!candidata) throw new Error("IPA: nessuna risorsa 'enti' trovata nel dataset.");
  cacheResourceId = candidata.id;
  return candidata.id;
}

export async function cercaInIpa(codiceFiscale: string, fetchImpl: typeof fetch = fetch): Promise<IpaResult> {
  const base: IpaResult = { fonte: "IPA", e_pubblica_amministrazione: false, servizio_disponibile: true };
  try {
    const resourceId = await scopriResourceId(fetchImpl);
    const filtri = encodeURIComponent(JSON.stringify({ Codice_fiscale_ente: codiceFiscale }));
    const res = await fetchImpl(`${CKAN_BASE}/datastore_search?resource_id=${resourceId}&filters=${filtri}&limit=1`);
    type Risposta = { success: boolean; result?: { records?: Record<string, string>[] } };
    // anche un 200 non JSON (pagina di manutenzione) conta come ricerca fallita
    const data = res.ok ? ((await res.json().catch(() => undefined)) as Risposta | undefined) : undefined;
    if (!data?.success) {
      // probabilmente il resource_id in cache non esiste più: la prossima chiamata lo riscopre
      cacheResourceId = undefined;
      throw new Error(`IPA datastore_search fallita (HTTP ${res.status})`);
    }
    const rec = data.result?.records?.[0];
    if (!rec) return base;
    return {
      ...base,
      e_pubblica_amministrazione: true,
      codice_ipa: rec.Codice_IPA,
      denominazione: rec.Denominazione_ente,
      tipologia: rec.Tipologia,
      pec: rec.Mail1,
      sito_web: rec.Sito_istituzionale,
      comune: rec.Comune,
      provincia: rec.Provincia,
    };
  } catch (e) {
    return { ...base, servizio_disponibile: false, errore: `IPA non disponibile: ${(e as Error).message}` };
  }
}
