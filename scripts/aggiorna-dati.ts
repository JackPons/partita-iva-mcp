/**
 * Scarica le tabelle ufficiali e le converte nei JSON di src/data/.
 *   npm run dati            -> tutto
 *   npm run dati -- comuni  -> solo una tabella (comuni | sanzioni)
 *
 * Fonti:
 *  - ISTAT, elenco comuni italiani (CSV, latin1, separatore ';'):
 *    https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv
 *  - UE, lista consolidata sanzioni finanziarie (CSV, separatore ';'):
 *    https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw
 *
 * Gli URL e i nomi colonna cambiano di rado ma cambiano: lo script cerca le
 * colonne per pattern e si ferma con un messaggio chiaro se non le trova.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR_DATI = resolve(import.meta.dirname, "../src/data");
const URL_COMUNI = "https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv";
const URL_SANZIONI = "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";

function parseCsv(testo: string, sep = ";"): { intestazioni: string[]; righe: string[][] } {
  // Un solo passaggio: i campi tra virgolette possono contenere a capo (header ISTAT).
  const righe: string[][] = [];
  let riga: string[] = [], cur = "", inQ = false;
  const chiudiRiga = () => {
    riga.push(cur.replace(/\s+/g, " ").trim());
    if (riga.some((c) => c.length > 0)) righe.push(riga);
    riga = []; cur = "";
  };
  for (let i = 0; i < testo.length; i++) {
    const ch = testo[i];
    if (ch === '"') {
      if (inQ && testo[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (ch === sep && !inQ) { riga.push(cur.replace(/\s+/g, " ").trim()); cur = ""; }
    else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && testo[i + 1] === "\n") i++;
      chiudiRiga();
    } else cur += ch;
  }
  if (cur || riga.length) chiudiRiga();
  const [intestazioni, ...resto] = righe;
  return { intestazioni, righe: resto };
}

function colonna(intestazioni: string[], pattern: RegExp, obbligatoria = true): number {
  const i = intestazioni.findIndex((h) => pattern.test(h));
  if (i < 0 && obbligatoria) {
    throw new Error(`Colonna non trovata (${pattern}). Intestazioni: ${intestazioni.join(" | ")}`);
  }
  return i;
}

async function scarica(url: string, charset: "utf-8" | "latin1"): Promise<string> {
  console.log(`→ ${url}`);
  const res = await fetch(url, { headers: { "user-agent": "partita-iva-mcp/aggiorna-dati" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder(charset).decode(buf);
}

async function comuni() {
  const csv = await scarica(URL_COMUNI, "latin1");
  const { intestazioni, righe } = parseCsv(csv);
  const iCat = colonna(intestazioni, /catastale/i);
  const iNome = colonna(intestazioni, /^Denominazione in italiano$/i, false) >= 0
    ? colonna(intestazioni, /^Denominazione in italiano$/i)
    : colonna(intestazioni, /Denominazione.*italiano|Denominazione \(Italiana|^Denominazione$/i);
  const iProv = colonna(intestazioni, /Sigla automobilistica/i);
  const iReg = colonna(intestazioni, /Denominazione Regione/i);
  const iIstat = colonna(intestazioni, /Codice Comune formato alfanumerico/i, false);

  const out: Record<string, { comune: string; provincia: string; regione: string; codice_istat?: string }> = {};
  for (const r of righe) {
    const cat = r[iCat]?.toUpperCase();
    if (!cat || cat.length !== 4) continue;
    out[cat] = {
      comune: r[iNome],
      provincia: r[iProv],
      regione: r[iReg],
      ...(iIstat >= 0 ? { codice_istat: r[iIstat] } : {}),
    };
  }
  const n = Object.keys(out).length;
  if (n < 7000) throw new Error(`Solo ${n} comuni letti: il file ISTAT è cambiato?`);
  scrivi("comuni.json", { _fonte: `ISTAT ${URL_COMUNI}`, _aggiornato: oggi(), comuni: out });
  console.log(`✓ comuni: ${n}`);
}

async function sanzioni() {
  const csv = await scarica(URL_SANZIONI, "utf-8");
  const { intestazioni, righe } = parseCsv(csv);
  const iId = colonna(intestazioni, /^Entity_LogicalId$/i);
  const iTipo = colonna(intestazioni, /^Entity_SubjectType$/i);
  const iNome = colonna(intestazioni, /^NameAlias_WholeName$/i);
  const iProg = colonna(intestazioni, /^Entity_Regulation_Programme$/i, false);

  const map = new Map<string, { id: string; tipo: string; nomi: Set<string>; programmi: Set<string> }>();
  for (const r of righe) {
    const id = r[iId];
    const nome = r[iNome];
    if (!id || !nome) continue;
    let s = map.get(id);
    if (!s) {
      s = { id, tipo: (r[iTipo] || "?").slice(0, 1).toUpperCase(), nomi: new Set(), programmi: new Set() };
      map.set(id, s);
    }
    s.nomi.add(nome);
    if (iProg >= 0 && r[iProg]) s.programmi.add(r[iProg]);
  }
  const soggetti = [...map.values()].map((s) => ({ id: s.id, tipo: s.tipo, nomi: [...s.nomi], programmi: [...s.programmi] }));
  if (soggetti.length < 1000) throw new Error(`Solo ${soggetti.length} soggetti letti: il formato UE è cambiato?`);
  scrivi("sanzioni.json", { _fonte: "Lista consolidata sanzioni finanziarie UE", _aggiornato: oggi(), soggetti });
  console.log(`✓ sanzioni: ${soggetti.length} soggetti`);
}

function scrivi(nome: string, dati: unknown) {
  writeFileSync(resolve(DIR_DATI, nome), JSON.stringify(dati), "utf-8");
}
function oggi() {
  return new Date().toISOString().slice(0, 10);
}

const cosa = process.argv.slice(2);
const tutto = cosa.length === 0;
try {
  if (tutto || cosa.includes("comuni")) await comuni();
  if (tutto || cosa.includes("sanzioni")) await sanzioni();
  console.log("Fatto. Rilancia i test con `npm test`.");
} catch (e) {
  console.error("ERRORE:", (e as Error).message);
  process.exit(1);
}
