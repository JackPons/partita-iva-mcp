/**
 * Client GLEIF (Global Legal Entity Identifier Foundation).
 * API pubblica e gratuita, senza chiave: https://api.gleif.org/api/v1
 * Dati sotto licenza CC0.
 *
 * Per le imprese italiane iscritte al Registro Imprese (registeredAt = RA000407)
 * il campo entity.registeredAs contiene il codice fiscale, che per la maggior
 * parte delle società coincide con la partita IVA. Il LEI esiste per le
 * imprese che operano sui mercati finanziari: tipicamente medio-grandi.
 */

const BASE = "https://api.gleif.org/api/v1";
const REGISTRO_IMPRESE = "RA000407";

export interface SoggettoCollegato {
  lei: string;
  denominazione?: string;
  paese?: string;
}

export interface GleifResult {
  fonte: "GLEIF";
  trovato: boolean;
  lei?: string;
  denominazione?: string;
  forma_giuridica?: string;
  stato_entita?: string; // ACTIVE | INACTIVE
  stato_registrazione_lei?: string; // ISSUED | LAPSED | RETIRED | ...
  lei_aggiornato_al?: string;
  prossimo_rinnovo_lei?: string;
  sede_legale?: { indirizzo?: string; cap?: string; comune?: string; paese?: string };
  controllante_diretta?: SoggettoCollegato | null;
  capogruppo?: SoggettoCollegato | null;
  numero_controllate_dirette?: number;
  servizio_disponibile: boolean;
  errore?: string;
}

type LeiRecord = {
  id: string;
  attributes: {
    entity: {
      legalName?: { name?: string };
      legalForm?: { id?: string; other?: string | null };
      registeredAt?: { id?: string };
      registeredAs?: string;
      status?: string;
      legalAddress?: { addressLines?: string[]; city?: string; postalCode?: string; country?: string };
    };
    registration?: { status?: string; lastUpdateDate?: string; nextRenewalDate?: string };
  };
};

const cacheFormeGiuridiche = new Map<string, string>();

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  const res = await fetchImpl(url, { headers: { accept: "application/vnd.api+json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GLEIF HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function formaGiuridica(codice: string | undefined, other: string | null | undefined, fetchImpl: typeof fetch) {
  if (!codice) return other ?? undefined;
  const inCache = cacheFormeGiuridiche.get(codice);
  if (inCache) return inCache;
  try {
    const d = await getJson<{ data: { attributes: { names?: { localName?: string; languageCode?: string }[] } } }>(
      `${BASE}/entity-legal-forms/${encodeURIComponent(codice)}`,
      fetchImpl,
    );
    const nomi = d?.data.attributes.names ?? [];
    const nome = (nomi.find((n) => n.languageCode === "it") ?? nomi[0])?.localName;
    if (nome) cacheFormeGiuridiche.set(codice, nome);
    return nome ?? codice;
  } catch {
    return codice;
  }
}

async function collegato(lei: string, relazione: "direct-parent" | "ultimate-parent", fetchImpl: typeof fetch) {
  const d = await getJson<{ data: LeiRecord }>(`${BASE}/lei-records/${lei}/${relazione}`, fetchImpl);
  if (!d?.data) return null;
  const e = d.data.attributes.entity;
  return { lei: d.data.id, denominazione: e.legalName?.name, paese: e.legalAddress?.country } satisfies SoggettoCollegato;
}

async function numeroControllate(lei: string, fetchImpl: typeof fetch) {
  const d = await getJson<{ meta?: { pagination?: { total?: number } } }>(
    `${BASE}/lei-records/${lei}/direct-children?page[size]=1`,
    fetchImpl,
  );
  return d?.meta?.pagination?.total ?? 0;
}

/** Cerca il LEI di un soggetto italiano a partire dal codice fiscale (o dalla P.IVA, se coincidono). */
export async function cercaLei(codiceFiscale: string, fetchImpl: typeof fetch = fetch): Promise<GleifResult> {
  const base: GleifResult = { fonte: "GLEIF", trovato: false, servizio_disponibile: true };
  try {
    const url =
      `${BASE}/lei-records?filter[entity.registeredAs]=${encodeURIComponent(codiceFiscale)}` +
      `&filter[entity.legalAddress.country]=IT&page[size]=5`;
    const lista = await getJson<{ data: LeiRecord[] }>(url, fetchImpl);
    const records = lista?.data ?? [];
    // preferiamo il record iscritto al Registro Imprese e con LEI non ritirato
    const rec =
      records.find((r) => r.attributes.entity.registeredAt?.id === REGISTRO_IMPRESE && r.attributes.registration?.status === "ISSUED") ??
      records.find((r) => r.attributes.entity.registeredAt?.id === REGISTRO_IMPRESE) ??
      records[0];
    if (!rec) return base;

    const e = rec.attributes.entity;
    const reg = rec.attributes.registration ?? {};
    // le relazioni sono un arricchimento: se falliscono non perdiamo il resto
    const [forma, diretta, ultima, controllate] = await Promise.all([
      formaGiuridica(e.legalForm?.id, e.legalForm?.other, fetchImpl),
      collegato(rec.id, "direct-parent", fetchImpl).catch(() => undefined),
      collegato(rec.id, "ultimate-parent", fetchImpl).catch(() => undefined),
      numeroControllate(rec.id, fetchImpl).catch(() => undefined),
    ]);

    return {
      ...base,
      trovato: true,
      lei: rec.id,
      denominazione: e.legalName?.name,
      forma_giuridica: forma,
      stato_entita: e.status,
      stato_registrazione_lei: reg.status,
      lei_aggiornato_al: reg.lastUpdateDate?.slice(0, 10),
      prossimo_rinnovo_lei: reg.nextRenewalDate?.slice(0, 10),
      sede_legale: {
        indirizzo: e.legalAddress?.addressLines?.join(", "),
        cap: e.legalAddress?.postalCode,
        comune: e.legalAddress?.city,
        paese: e.legalAddress?.country,
      },
      controllante_diretta: diretta,
      capogruppo: ultima,
      numero_controllate_dirette: controllate,
    };
  } catch (err) {
    return { ...base, servizio_disponibile: false, errore: `GLEIF non disponibile: ${(err as Error).message}` };
  }
}
