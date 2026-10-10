-- Registro delle chiamate MCP. Non contiene gli argomenti degli strumenti
-- (partite IVA, codici fiscali, IBAN): solo metadati d'uso.
CREATE TABLE IF NOT EXISTS chiamate (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,              -- ISO 8601 UTC
  giorno      TEXT    NOT NULL,              -- YYYY-MM-DD, per aggregare
  metodo      TEXT    NOT NULL,              -- initialize, tools/list, tools/call, ...
  strumento   TEXT,                          -- nome del tool se metodo = tools/call
  client      TEXT,                          -- clientInfo.name (initialize) o user-agent troncato
  paese       TEXT,                          -- request.cf.country
  utente      TEXT,                          -- hash(IP + giorno + sale): cambia ogni giorno
  esito       TEXT    NOT NULL,              -- ok | errore | limitato
  durata_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chiamate_giorno ON chiamate (giorno);
CREATE INDEX IF NOT EXISTS idx_chiamate_strumento ON chiamate (strumento, giorno);
