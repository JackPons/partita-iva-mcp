# partita-iva-mcp

Server [MCP](https://modelcontextprotocol.io/) per verificare identificativi italiani — **partita IVA, codice fiscale, IBAN** — e arricchirli con fonti ufficiali gratuite (**VIES**, **IPA**, **ISTAT**, **lista sanzioni UE**). Nessuna chiave, nessuna registrazione.

Pensato per chi costruisce agenti AI che devono fare controlli su aziende ed enti italiani (onboarding, KYC leggero, fatturazione verso la PA, pulizia anagrafiche) senza integrare quattro API diverse.

## Strumenti

| Strumento | Cosa fa | Chiamate esterne |
|---|---|---|
| `valida_partita_iva` | Controllo formale (11 cifre, cifra di controllo, codice ufficio) | no |
| `verifica_partita_iva` | Stato su VIES: attiva/non attiva, denominazione, indirizzo | VIES |
| `valida_codice_fiscale` | Carattere di controllo, omocodia, sesso, data e **luogo di nascita** (comune ISTAT o stato estero); 11 cifre → persona giuridica | no |
| `valida_iban` | Mod 97 per tutti i paesi; per l'Italia anche CIN, ABI → **banca**, CAB, conto | no |
| `cerca_comune` | Comune per nome o codice catastale: provincia, regione, codice ISTAT | no |
| `controlla_sanzioni` | Screening indicativo di un nome contro la lista consolidata UE, matching tollerante con punteggio | no |
| `scheda_soggetto` | Quadro completo da partita IVA: formale + VIES con indirizzo normalizzato su ISTAT + screening sanzioni + dati IPA se è una PA | VIES, IPA |

Ogni risposta indica la **fonte** e se il servizio era **raggiungibile**, così l'agente non confonde "non attiva" con "non ho potuto verificare".

## Avvio rapido (locale)

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

## Pubblicazione nei registry

1. Repo pubblico su GitHub.
2. Aggiorna `server.json` con il tuo utente GitHub e l'URL del worker.
3. Registry ufficiale: `npx @modelcontextprotocol/publisher login github` poi `npx @modelcontextprotocol/publisher publish` (PulseMCP e Glama lo raccolgono da lì).
4. Smithery: `npx @smithery/cli mcp publish <url> -n <utente>/partita-iva-mcp`.
5. Catalogo italiano: PR su [bsab/italia-mcp-servers](https://github.com/bsab/italia-mcp-servers).

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
    tabelle.ts    accesso alle tabelle locali
    sanzioni.ts   matching contro la lista UE
  data/           tabelle JSON (seed → aggiornate da npm run dati)
  server.ts       definizione degli strumenti MCP (condivisa)
  stdio.ts        entrypoint locale
  worker.ts       entrypoint Cloudflare Workers (Streamable HTTP, stateless)
scripts/
  aggiorna-dati.ts  scarica e converte le tabelle ufficiali
test/             node:test, con fetch finto per VIES e IPA
```

## Fonti e limiti

- **VIES** (Commissione Europea): stato della partita IVA ai fini IVA intracomunitaria. Per l'Italia restituisce di solito denominazione e indirizzo; a volte è temporaneamente non disponibile, e il server lo segnala.
- **IPA** (indicepa.gov.it, open data CKAN): usato per riconoscere le Pubbliche Amministrazioni e recuperare codice IPA, PEC e sito.
- **ISTAT** (elenco comuni): normalizzazione di comuni e codici catastali.
- **Lista consolidata sanzioni UE**: screening per nome, indicativo. Non sostituisce un provider AML né il giudizio di un operatore; i nomi traslitterati (arabo, cirillico) possono sfuggire al matching su token.
- Il server **non** accede al Registro Imprese: soci, cariche, bilanci e protesti sono dati a pagamento e restano fuori da questa versione.
- La data di nascita estratta dal codice fiscale ha il secolo dedotto (`anno_ambiguo: true`).

I dati restituiti sono soggetti alle licenze delle fonti originali.

## Roadmap

- [x] Comune da codice catastale, stato estero da codice Z
- [x] Banca da ABI (tabella parziale)
- [x] Screening sanzioni UE
- [ ] Conteggio chiamate per strumento (KV) per capire cosa viene usato
- [ ] API key opzionale con limiti più alti
- [ ] CAP → comune (ISTAT/Poste)
- [ ] ANAC (appalti aggiudicati) e RNA (aiuti di Stato) nella scheda soggetto
- [ ] Descrizione codice ATECO
- [ ] Registro Imprese via rivenditore (soci, cariche, bilanci, protesti) — a pagamento

## Licenza

MIT.
