/**
 * Informativa privacy servita su GET /privacy.
 *
 * Titolare e contatto arrivano dalle variabili PRIVACY_TITOLARE e
 * PRIVACY_EMAIL (wrangler.jsonc → "vars"), così non stanno nel codice.
 * Il testo descrive cosa fa davvero il worker: se cambi la telemetria
 * (src/telemetria.ts) o le fonti esterne, aggiorna anche questa pagina.
 */

export const PRIVACY_AGGIORNATA_AL = "2026-10-09";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function paginaPrivacy(opts: { titolare?: string; email?: string; nomeServizio: string; origin: string }): Response {
  const titolare = esc(opts.titolare?.trim() || "[titolare da configurare]");
  const email = opts.email?.trim();
  const contatto = email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : "[email da configurare]";
  const servizio = esc(opts.nomeServizio);

  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy · ${servizio}</title>
<style>
  :root{color-scheme:light dark;--fg:#1d1d1f;--bg:#fff;--muted:#555;--code:#f3f3f3}
  @media (prefers-color-scheme:dark){:root{--fg:#e8e8e8;--bg:#16161a;--muted:#aaa;--code:#26262c}}
  body{font:16px/1.6 system-ui,sans-serif;max-width:44rem;margin:2.5rem auto;padding:0 1rem;color:var(--fg);background:var(--bg)}
  h1{font-size:1.6rem;margin-bottom:.2rem} h2{font-size:1.15rem;margin-top:2rem}
  .muted{color:var(--muted)} code{background:var(--code);padding:.1em .3em;border-radius:4px}
  table{border-collapse:collapse;width:100%;margin:.5rem 0} td,th{border-bottom:1px solid #8884;padding:.4rem .3rem;text-align:left;vertical-align:top}
</style>
</head>
<body>
<h1>Informativa privacy</h1>
<p class="muted">${servizio} · server MCP all'indirizzo <code>${esc(opts.origin)}/mcp</code> · aggiornata al ${PRIVACY_AGGIORNATA_AL}</p>

<h2>In breve</h2>
<p>Il servizio verifica partite IVA, codici fiscali e IBAN e restituisce il risultato all'assistente AI che lo ha chiamato. <strong>I valori che invii (partite IVA, codici fiscali, IBAN, nomi) non vengono salvati</strong>: sono elaborati solo per il tempo della richiesta. Salviamo solo statistiche d'uso anonime, per 90 giorni.</p>

<h2>Titolare e contatti</h2>
<p>Titolare del trattamento: ${titolare}. Per domande o richieste sui dati: ${contatto}.</p>

<h2>Quali dati trattiamo e perché</h2>
<table>
<tr><th>Dato</th><th>Uso</th><th>Conservazione</th></tr>
<tr><td>Argomenti degli strumenti (partita IVA, codice fiscale, IBAN, nome da verificare)</td><td>Eseguire la verifica richiesta</td><td>Non conservati: elaborati in memoria e scartati a fine richiesta</td></tr>
<tr><td>Metadati della chiamata: data e ora, strumento usato, esito, durata, nome del client (es. <code>Claude-User</code>), paese di provenienza</td><td>Statistiche d'uso aggregate e diagnosi di errori</td><td>90 giorni, poi cancellati automaticamente</td></tr>
<tr><td>Indirizzo IP</td><td>Limite di 60 richieste al minuto e conteggio degli utenti distinti in una giornata</td><td>L'IP <strong>non viene salvato</strong>: si conserva solo un codice derivato (hash con chiave segreta) che cambia ogni giorno e non permette di risalire all'IP né di collegare le visite di giorni diversi</td></tr>
</table>
<p>Non usiamo cookie, profilazione, pubblicità né strumenti di analisi di terze parti. Non vendiamo né cediamo dati.</p>

<h2>Servizi di terze parti</h2>
<ul>
<li><strong>VIES</strong> (Commissione Europea): per gli strumenti <code>verifica_partita_iva</code> e <code>scheda_soggetto</code> la partita IVA viene inviata a VIES per verificarne lo stato.</li>
<li><strong>IPA – Indice delle Pubbliche Amministrazioni</strong> (AgID, indicepa.gov.it): per <code>scheda_soggetto</code> la partita IVA viene cercata nell'indice per riconoscere gli enti pubblici.</li>
<li><strong>GLEIF</strong> (Global Legal Entity Identifier Foundation, api.gleif.org): per <code>scheda_soggetto</code> la partita IVA viene cercata nel registro pubblico dei LEI per recuperare forma giuridica e gruppo societario.</li>
<li><strong>Cloudflare</strong>: fornitore di hosting del servizio e del database delle statistiche. Cloudflare può trattare dati tecnici di connessione (come l'indirizzo IP) per erogare e proteggere il servizio, secondo la propria informativa.</li>
</ul>
<p>Gli altri strumenti (codice fiscale, IBAN, comuni, sanzioni UE) funzionano su tabelle locali e non inviano dati a terzi.</p>

<h2>Base giuridica</h2>
<p>Legittimo interesse a fornire il servizio richiesto, a proteggerlo da abusi e a misurarne l'uso in forma aggregata.</p>

<h2>I tuoi diritti</h2>
<p>Puoi chiedere accesso, rettifica, cancellazione o opporti al trattamento scrivendo a ${contatto}. Poiché non conserviamo gli argomenti né gli IP, nella maggior parte dei casi non abbiamo dati riconducibili a te. Hai anche diritto di proporre reclamo al Garante per la protezione dei dati personali.</p>

<h2>Natura dei risultati</h2>
<p>I risultati provengono da fonti pubbliche e da tabelle che possono essere incomplete o non aggiornate. Lo screening sulle sanzioni UE è indicativo e non sostituisce verifiche antiriciclaggio professionali.</p>

<hr>
<h2 lang="en">English summary</h2>
<p lang="en">Tool arguments (VAT numbers, tax codes, IBANs, names) are processed in memory and <strong>never stored</strong>. We store only usage metadata (timestamp, tool, outcome, duration, client name, country) for 90 days; IP addresses are not stored, only a keyed hash that rotates daily. VAT numbers are sent to VIES (European Commission) IPA (Italian public administration index) and GLEIF (LEI registry) only for the tools that query them. Hosting by Cloudflare. No cookies, tracking or data sales. Contact: ${contatto}.</p>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
