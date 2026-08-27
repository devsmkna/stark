# Riprendere una chat per id (terza linguetta «Resume»)

## Perché

`claude -r <id>` riprende qualunque conversazione della CLI di cui si conosce l'id, da
qualunque cartella. STARK oggi ha lo stesso meccanismo (`resume: {ref}` nel daemon) ma
ci si arriva solo passando per «Import», che elenca — non cerca — le conversazioni. Se
l'id lo conosci già (copiato da un terminale, da un log, da un collega), scriverlo
direttamente è più diretto che cercarlo in un elenco.

## Cosa già esiste (verificato, non dedotto)

- Il daemon sa già aprire con `resume: {ref}` un id qualsiasi (`registry.open`,
  `src/daemon/registry.ts:242`) — è lo stesso meccanismo che usa `wake()` per
  risvegliare una chat che STARK già conosce.
- Ma un id **mai aperto in STARK** ha il journal vuoto: il CLI non reinvia la
  cronologia come eventi nativi durante il resume. Va prima **importata** — tradotta da
  trascritto a journal — con `registry.importSession` (`registry.ts:436`).

## Due lacune reali in `importSession` di oggi

1. Cerca l'id dentro `listTranscripts()` (i **60 trascritti più recenti** — limite di
   `listSessions` dell'SDK). Un id più vecchio non si trova, anche se il file esiste
   su disco. `transcriptPath(sessionId, configDir)`
   (`src/adapters/claude-code/catalogue.ts:60`) invece cerca **per nome file**, senza
   limite — è la funzione giusta per un id scritto a mano.
2. Cerca solo nel profilo Claude di default del daemon (`this.defaults.configDir`). Se
   la macchina ha più profili (`listProfiles()`, `src/adapters/claude-code/profiles.ts:82`,
   già usata dal pannello Impostazioni → Projects), un id di un altro profilo non si
   trova nemmeno se esiste.

## Design

### Backend — `registry.importSession` riscritta

Cerca il trascritto con `transcriptPath` prima nel profilo di default, poi — se non lo
trova — in ognuno dei profili di `listProfiles()`. Se lo trova in un profilo diverso
dal default, lo dice nel risultato:

```ts
async importSession(sessionId: string):
  Promise<{ ok: true; id: string; configDir?: string } | { ok: false; error: string }>
```

`configDir` è presente **solo** quando il profilo trovato non è quello di default —
stessa regola di `NewChat.svelte` per il profilo di un progetto nuovo: non si ripete
un'informazione che è già il comportamento normale. Nessuna rotta nuova:
`POST /api/importable` esiste già e passa `esito` per intero (`server.ts:200`).

### Frontend

- `NewTab` (`store.svelte.ts`) diventa `'new' | 'import' | 'resume'`.
- `NewChat.svelte`: terza linguetta «Resume», un campo di testo solo per l'id (nessuna
  cartella da scegliere — si legge dal trascritto trovato), un bottone che chiama
  `store.resumeById(id)`.
- `Store.resumeById(id)` (nuovo metodo, stesso stile di `wake()`/`newChat()`):
  1. `api.doImport(id)`. Se fallisce con «già importata» non è un errore vero — l'id è
     già una chat di STARK — si prosegue leggendo comunque il suo snapshot.
  2. Legge il `cwd` dallo snapshot appena creato (o già esistente).
  3. Se l'import ha riportato un `configDir` diverso dal default, lo salva come
     profilo del progetto (`setProject`, stessa regola di `newChat()` quando il
     profilo è nuovo per la cartella) e lo usa per l'apertura.
  4. `api.open({cwd, resume:{ref:id}, configDir?})` — idempotente lato daemon: se la
     chat è già viva, non fa nulla (`registry.open` ritorna subito se `this.live.has(id)`).
  5. `select(id)`.
  6. Un id non trovato in **nessun** profilo: il messaggio del passo 1 resta quello
     mostrato (`refused`), nessun residuo — stessa disciplina di `open()` sul confine.

## Fuori scope

- Scegliere a mano il profilo quando lo stesso id esiste in più di uno (caso limite
  non misurato, confermato dall'utente come non necessario ora).
- Cambiare l'elenco di Import: resta bounded ai 60 recenti, è un limite accettabile
  per un elenco da sfogliare — non per un id scritto a mano.
