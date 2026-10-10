# Verika · partita-iva-mcp

Server [MCP](https://modelcontextprotocol.io/) per verificare identificativi italiani — **partita IVA, codice fiscale, IBAN** — e arricchirli con fonti ufficiali gratuite (**VIES**, **IPA**, **GLEIF**, **ISTAT**, **lista sanzioni UE**).

Pensato per chi usa o costruisce agenti AI che devono fare controlli su aziende ed enti italiani (onboarding, KYC leggero, fatturazione verso la PA, pulizia anagrafiche) senza integrare quattro API diverse.

## Usalo subito

Il server è già online, **gratuito e senza chiave**: non serve installare nulla né registrarsi.

- **Endpoint**: `https://partita-iva-mcp.pons-labs.workers.dev/mcp`
- **Trasporto**: Streamable HTTP (MCP remoto)
- **Autenticazione**: nessuna

**Claude (desktop, web, mobile)** — Impostazioni → Connettori → *Aggiungi connettore personalizzato* → incolla l'endpoint → Aggiungi. In una chat nuova attivalo da **+ → Connettori**. Richiede un piano che supporti i connettori personalizzati.

**Claude Code**

```bash
claude mcp add --transport http partita-iva --scope user https://partita-iva-mcp.pons-labs.workers.dev/mcp
```

**Cursor, VS Code e altri client** con configurazione JSON:

```json
{
  "mcpServers": {
    "partita-iva": { "url": "https://partita-iva-mcp.pons-labs.workers.dev/mcp" }
  }
}
```

È pubblicato anche nel [registry ufficiale MCP](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.JackPons/partita-iva-mcp) come `io.github.JackPons/partita-iva-mcp`.

## Esempi

Domande da fare all'assistente con il connettore attivo:

- *"Fammi la scheda della partita IVA [una P.IVA reale, es. presa da una fattura]: è attiva? Dove ha sede?"* → `scheda_soggetto` restituisce stato VIES, denominazione, sede normalizzata su ISTAT (comune, provincia, regione), screening sanzioni, LEI con forma giuridica e gruppo societario (se l'impresa ne ha uno) e, se è una PA, codice IPA e PEC.
- *"Questo codice fiscale è valido? RSSMRA85T10A562S. Dove è nata questa persona?"* → `valida_codice_fiscale` verifica il carattere di controllo e ricava sesso, data e luogo di nascita (qui: San Giuliano Terme, PI).
- *"Controlla l'IBAN DE89 3704 0044 0532 0130 00"* → `valida_iban` verifica le cifre di controllo; per gli IBAN italiani scompone anche ABI, CAB e conto e indica la banca quando è nota.
- *"Bank Rossiya è nella lista sanzioni UE?"* → `controlla_sanzioni` restituisce le possibili corrispondenze con un punteggio di somiglianza (esito `da_verificare`).
- *"Ho una lista di 10 fornitori con partita IVA: dimmi quali non risultano attivi"* → l'assistente chiama `verifica_partita_iva` per ciascuno e riassume.

Esempio di risposta di `valida_iban` (estratto):

```json
{
  "normalizzato": "DE89370400440532013000",
  "valido": true,
  "paese": "DE",
  "formattato": "DE89 3704 0044 0532 0130 00"
}
```

## Strumenti

| Strumento | Cosa fa | Chiamate esterne |
|---|---|---|
| `valida_partita_iva` | Controllo formale (11 cifre, cifra di controllo, codice ufficio) | no |
| `verifica_partita_iva` | Stato su VIES: attiva/non attiva, denominazione, indirizzo | VIES |
| `valida_codice_fiscale` | Carattere di controllo, omocodia, sesso, data e **luogo di nascita** (comune ISTAT o stato estero); 11 cifre → persona giuridica | no |
| `valida_iban` | Mod 97 per tutti i paesi; per l'Italia anche CIN, ABI → **banca**, CAB, conto | no |
| `cerca_comune` | Comune per nome o codice catastale: provincia, regione, codice ISTAT | no |
| `controlla_sanzioni` | Screening indicativo di un nome contro la lista consolidata UE, matching tollerante con punteggio | no |
| `scheda_soggetto` | Quadro completo da partita IVA: formale + VIES con indirizzo normalizzato su ISTAT + screening sanzioni + dati IPA se è una PA + LEI, forma giuridica, capogruppo e numero di controllate (GLEIF) | VIES, IPA, GLEIF |

Ogni risposta indica la **fonte** e se il servizio era **raggiungibile**, così l'agente non confonde "non attiva" con "non ho potuto verificare".

## Sviluppo locale

Per modificare il server o eseguirne una copia tua. Requisiti: Node.js 22+, npm; per il deploy un account Cloudflare (piano gratuito sufficiente).

```bash
npm install
npm run dati        # scarica le tabelle ISTAT e la lista sanzioni UE in src/data/ (una volta, poi ogni tanto)
npm test            # test unitari, nessuna rete necessaria
npm run inspect     # apre MCP Inspector sul server stdio
npm run dev         # server HTTP locale su http://localhost:8787/mcp
```

In VS Code il file `.vscode/mcp.json` registra già il server stdio: apri la palette → *MCP: List Servers* → `partita-iva-locale`.

Da Claude Code, con il server HTTP locale avviato:

```bash
claude mcp add partita-iva -t http http://localhost:8787/mcp
```

## Deploy su Cloudflare Workers

```bash
npx wrangler login
npm run deploy
```

L'endpoint sarà `https://partita-iva-mcp.<tuo-subdominio>.workers.dev/mcp`. La home page (`/`) mostra le istruzioni di collegamento, `/health` risponde `{ok:true}`.

## Statistiche d'uso e privacy

Il worker conta le chiamate su **Cloudflare D1** e applica un **rate limit** di 60 richieste al minuto per utente. Entrambi sono opzionali: senza configurazione il server funziona uguale.

**Cosa viene salvato** per ogni chiamata: data e ora, metodo MCP, nome dello strumento, client (es. `claude-ai`), paese, esito, durata, e un identificativo utente che è un hash di IP + giorno + sale segreto.

**Cosa NON viene salvato**: gli argomenti degli strumenti (partite IVA, codici fiscali, IBAN, nomi) e gli indirizzi IP. L'hash cambia ogni giorno, quindi permette di contare gli utenti distinti in una giornata ma non di seguirli nel tempo. Le righe più vecchie di 90 giorni vengono cancellate ogni notte.

### Configurazione (una volta)

```bash
npx wrangler d1 create partita-iva-mcp-stats     # copia il database_id in wrangler.jsonc
npm run db:migra                                 # crea la tabella sul D1 remoto
npx wrangler secret put STATS_TOKEN              # una stringa lunga a caso: protegge /stats
npx wrangler secret put HASH_SALT                # un'altra stringa a caso: sale per l'hash degli IP
npm run deploy
```

Per lo sviluppo locale: `npm run db:migra-locale` e un file `.dev.vars` (escluso da git) con `STATS_TOKEN=...` e `HASH_SALT=...`.

### Leggere le statistiche

```bash
curl -H "Authorization: Bearer $STATS_TOKEN" https://<tuo-worker>/stats?giorni=30
```

oppure dal browser `https://<tuo-worker>/stats?token=...`. Restituisce totali, chiamate e utenti per giorno, chiamate ed errori per strumento, client e paesi.

## Pubblicazione nei registry

1. Aggiorna `server.json` (nome `io.github.<utente>/<server>`, versione, URL con `/mcp` in fondo). Ogni pubblicazione richiede una **versione nuova**.
2. Registry ufficiale: installa [`mcp-publisher`](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx), poi `mcp-publisher validate`, `mcp-publisher login github`, `mcp-publisher publish`. PulseMCP e Glama lo raccolgono da lì.
3. Smithery: da [smithery.ai/new](https://smithery.ai/new) con l'URL dell'endpoint; dopo ogni deploy, *Releases → Publish* per una nuova scansione.
4. Catalogo italiano: PR su [bsab/italia-mcp-servers](https://github.com/bsab/italia-mcp-servers) seguendo il loro CONTRIBUTING.

## Tabelle locali (`src/data/`)

I JSON partono come **seed** (poche voci, giusto per i test). `npm run dati` li sostituisce con:

- `comuni.json` — tutti i comuni ISTAT con codice catastale, provincia, regione, codice ISTAT
- `sanzioni.json` — lista consolidata sanzioni finanziarie UE (id, tipo, nomi/alias, programmi)

`stati-esteri.json` (codici Z) e `abi.json` (banche) sono tabelle compilate a mano, parziali: vanno verificate ed estese. Per gli ABI la fonte autorevole è l'elenco degli intermediari di Banca d'Italia; se trovi un CSV ufficiale, aggiungi un caso allo script.

Ogni strumento che usa una tabella dichiara nell'output se la tabella è seed o aggiornata (`infoTabelle`), e `controlla_sanzioni` risponde `lista_non_caricata` finché non hai lanciato `npm run dati`: meglio un "non so" esplicito che un falso "nessuna corrispondenza".

## Struttura

```
src/
  lib/            algoritmi puri e client delle fonti (testabili senza MCP)
    partita-iva.ts
    codice-fiscale.ts
    iban.ts
    vies.ts
    ipa.ts
    gleif.ts      LEI, forma giuridica e gruppo
    tabelle.ts    accesso alle tabelle locali
    sanzioni.ts   matching contro la lista UE
  data/           tabelle JSON (seed → aggiornate da npm run dati)
  server.ts       definizione degli strumenti MCP (condivisa)
  telemetria.ts   conteggio chiamate (D1), rate limit, statistiche
  stdio.ts        entrypoint locale
  worker.ts       entrypoint Cloudflare Workers (Streamable HTTP, stateless)
migrations/       schema SQL del database D1
scripts/
  aggiorna-dati.ts  scarica e converte le tabelle ufficiali
test/             node:test, con fetch finto per VIES, IPA e GLEIF
```

## Fonti e limiti

Tutti gli strumenti sono **in sola lettura**: non modificano dati e non inviano nulla a terzi oltre alle interrogazioni a VIES, IPA e GLEIF. Rate limit: 60 richieste al minuto per utente.

- **VIES** (Commissione Europea): stato della partita IVA ai fini IVA intracomunitaria. Per l'Italia restituisce di solito denominazione e indirizzo; a volte è temporaneamente non disponibile, e il server lo segnala.
- **IPA** (indicepa.gov.it, open data CKAN): usato per riconoscere le Pubbliche Amministrazioni e recuperare codice IPA, PEC e sito.
- **GLEIF** (api.gleif.org, licenza CC0): registro mondiale dei LEI. Ricerca per codice fiscale sulle imprese iscritte al Registro Imprese; restituisce forma giuridica, stato del LEI, controllante diretta, capogruppo e numero di controllate. Il LEI ce l'hanno soprattutto le imprese medio-grandi e chi opera sui mercati finanziari: per una piccola impresa `trovato: false` è normale.
- **ISTAT** (elenco comuni): normalizzazione di comuni e codici catastali.
- **Lista consolidata sanzioni UE**: screening per nome, indicativo. Non sostituisce un provider AML né il giudizio di un operatore; i nomi traslitterati (arabo, cirillico) possono sfuggire al matching su token.
- Il server **non** accede al Registro Imprese: soci, cariche, bilanci e protesti sono dati a pagamento e restano fuori da questa versione.
- La data di nascita estratta dal codice fiscale ha il secolo dedotto (`anno_ambiguo: true`).

I dati restituiti sono soggetti alle licenze delle fonti originali.

## Roadmap

- [x] Comune da codice catastale, stato estero da codice Z
- [x] Banca da ABI (tabella parziale)
- [x] Screening sanzioni UE
- [x] Conteggio chiamate per strumento (D1), senza dati personali
- [x] Rate limit di base
- [x] Output schema e annotazioni read-only su tutti gli strumenti
- [ ] API key opzionale con limiti più alti
- [ ] CAP → comune (ISTAT/Poste)
- [ ] ANAC (appalti aggiudicati) e RNA (aiuti di Stato) nella scheda soggetto
- [ ] Descrizione codice ATECO

## Licenza

MIT.
