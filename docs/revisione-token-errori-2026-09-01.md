# Revisione: come mandiamo i token agli agent, e come muoiono gli errori

**1 settembre 2026** — revisione chiesta dall'utente sul percorso dei token (prompt →
adapter → journal → SSE → UI) e sulla gestione degli errori nei due adapter. Ogni voce
porta il file e la riga di quando è stata trovata; lo stato dice cosa ne è stato fatto
**in questo stesso giro** (branch `worktree-revisione-token-errori`). Task board: #10–#14.

Cosa era già giusto, e va detto prima dei difetti: il disegno regge. `systemPrompt`
chiesto per nome, riconciliazione MCP prima di ogni turno, FIFO dei prompt per non far
fondere i turni, retry misurati su OpenCode con `session.retried` nel flusso, guardiano
del primo segno di vita, cache dell'elenco che legge solo la coda del journal, SSE con
`?from=` e backoff nel client. I difetti qui sotto sono i buchi **fra** queste scelte,
non nelle scelte.

---

## A. Critici — già costati incidenti reali (task #10)

### A1. Errore fatale in Claude Code: il turno resta aperto per sempre — RISOLTO

`consume()` (`src/adapters/claude-code/adapter.ts`) nel `catch` emetteva
`session.error fatal` e poi `closed`, ma **nessun `turn.ended`** per il turno aperto, e
non svuotava la fila. Journal con turno aperto per sempre → alla rilettura la chat dice
«working» in eterno. OpenCode faceva giusto (`chiudiTurno()` su ogni via d'uscita);
Claude Code no.

**Cura**: nel `catch` si chiude il turno aperto (`turn.ended reason:'error'` col
messaggio come `detail`), si svuota la fila (`svuota()`), si svegliano i `settled()`.

### A2. Il registry non ritira MAI una sessione morta — RISOLTO

`onPayload` (`src/daemon/registry.ts`) scriveva e basta: nessuno guardava
`session.error fatal`. Il loop dell'adapter moriva → l'entry restava nella `live` Map →
`list()` diceva `live:true`, e ogni `prompt()` successivo finiva in una `PromptQueue`
**senza consumatore**: `turn.started` scritto, «queued» per sempre. È la sessione
`61f480c1` del 1 settembre (ENOSPC), chiusa a mano via API — il «Next Steps» di quella
giornata, mai fatto.

**Cura**: il registry adesso osserva ciò che scrive. `session.error fatal:true` alza una
bandierina; il `session.state: closed` che segue fa partire `ritiraMorta()` — fuori
dallo stack dell'adapter (`setTimeout(0)`), con `adapter.close()` prima del `retire()`
così le risorse (refcount OpenCode compreso) si liberano. Un prompt su una sessione
ritirata torna `session not active`, e la UI sa già offrire il risveglio.

Non si ritira sul `closed` nudo: il sonno emette `closed` e **poi** `session.slept`, e
ritirare lì chiuderebbe il journal sotto una riga ancora in volo.

### A3. ENOSPC = circolo vizioso: l'errore di scrittura si segnala scrivendo — RISOLTO

`journal.append` che lancia (disco pieno, journal chiuso) risaliva dentro `emit()` fino
al `catch` di `consume()`, il cui rimedio era… emettere di nuovo → secondo lancio → loop
morto senza `closed`, rejection non gestita su `this.loop`.

**Cura**: `applica()` nel registry — l'append è dentro un try/catch; se il disco rifiuta
la riga, lo snapshot e chi guarda restano veri (l'evento si fabbrica in memoria con
`seq` continuo), il guasto va nel log del daemon. Il journal perde righe **e lo dice**;
la sessione non muore più per questo. Vale anche per la riga che arriva a journal già
chiuso (la corsa sul sonno).

---

## B. Gestione errori OpenCode (task #11)

### B1. Lo stream degli eventi muore in silenzio — RISOLTO

`ascolta()` (`src/adapters/opencode/adapter.ts`) chiudeva con `.catch(() => {})`: il
server OpenCode crasha o viene riavviato → il for-await finisce → **adapter sordo per
sempre**. Nessun evento, nessun errore, nessun notice; il turno in corso appeso (la
guardia copre solo l'avvio, e un permesso già arrivato l'aveva smontata).

**Cura**: `mortoIlServer()` — se il flusso finisce e non siamo stati noi ad abortirlo
(`ac.signal.aborted`), si dichiara: guardia giù, fila svuotata, bloccante pendente
abbandonato, `session.error fatal`, turno chiuso in errore, `closed`. Da lì la cascata
di A2 ritira la sessione e libera il refcount del server; il risveglio riapre su un
server nuovo, e la conversazione è nel database di OpenCode — non si perde niente.
La riconnessione automatica resta un possibile seguito; prima si dice la verità.

### B2. `passeggero()` non riconosceva la rete locale — RISOLTO

La classificazione copriva `429/5xx/rate limit/timeout/overload` ma non
`ECONNREFUSED`, `ECONNRESET`, `fetch failed`, `socket hang up` — cioè proprio il caso
«server che sta riavviando» dove il retry servirebbe. Aggiunti (con prove in
`offline-check`). `401`/`not supported`/budget esaurito restano NON passeggeri, per le
ragioni già misurate il 27 agosto.

### B3. Retry possibile su sessione senza turno aperto — RISOLTO

`forseRitentaErrore` guardava solo `ultimoPrompt` (mai azzerato a fine turno) e
`fermato`. Un `session.error` **globale** (senza `sessionID` passa `miaSessione()`) a
chat ferma faceva partire il messaggio di ripresa → turno vero sul runner senza turno
canonico aperto → eventi orfani appiccicati all'ultimo turno chiuso, quota spesa.

**Cura**: guardia `tr.turnoAperto() !== null` in entrambe le vie di retry, e
`ultimoPrompt` azzerato quando `scrivi()` vede passare un `turn.ended`.

### B4. Invio fallito → errore secco, senza valutare se era passeggero — RISOLTO

Il `catch` di `consegna()` chiudeva subito il turno in errore. Adesso passa prima da
`forseRitenta` (stessa regola, stesso annuncio `session.retried`): un `ECONNRESET`
sull'invio si riprova come uno step fallito.

### B5. Risposta a un permesso: il 404 spariva di nuovo — RISOLTO

`rispondiPermesso` guardava solo il **throw**, ma con `ThrowOnError` al default l'SDK
non lancia: un errore HTTP torna in `result.error` — la stessa identica lezione già
pagata su `rispondiDomanda` (30 agosto), applicata a una rotta e non all'altra. E in
ogni caso di fallimento la guardia era già smontata: tool `running` per sempre, zero
timeout.

**Cura**: si legge anche `result.error`, si ritenta una volta dopo 1s, e se fallisce
ancora si dice nel flusso **e si rimonta la guardia**, così il turno muto viene
dichiarato invece di durare per sempre.

### B6. Finestra di leak sul refcount del server — RISOLTO

`preso = true` arrivava dopo **entrambi** i client: un fallimento fra `clientPer` (che
incrementa `quante`) e quella riga lasciava il server vivo per sempre (già visto: 12
`opencode serve` da 300–900 MB in una giornata). Ora `preso = true` sta subito dopo
`clientPer`.

---

## C. Card orfane e troncamenti invisibili (task #12)

### C1. Permessi/domande/piani orfani su turno morto, per TUTTI gli adapter — RISOLTO

Il fix del 30 agosto (`abbandonaBloccantePendente`) esisteva **solo su OpenCode**. Su
Claude Code un Stop o un errore con una card aperta lasciava la `Promise` pendente
nella mappa `pending` del registry e la card in `pendingPermissions` dello snapshot,
finché l'utente non la cliccava (`scartaOrfano`).

**Cura**: nel posto che vale per qualunque adapter, presente e futuro — il registry.
Quando passa un `turn.ended` con `reason !== 'completed'`, `chiudiOrfani()` rifiuta
d'ufficio tutto ciò che era in attesa (`permission.replied reject`,
`question.rejected`, `plan.replied rejected`) e toglie le entry dalla mappa. Le
`Promise` non si risolvono — non c'è più nessuno dall'altra parte, stessa scelta di
`scartaOrfano`. Su OpenCode il suo abbandono locale corre prima e questo sweep trova
vuoto: nessun doppione. La costruzione dei rifiuti è una funzione pura esportata
(`rifiutiOrfani`), provata in `offline-check`.

### C2. `message_delta` ignorato: un troncamento `max_tokens` era invisibile — RISOLTO

Il traduttore Claude Code non leggeva `message_delta`: `step.ended` usciva sempre con
`finish:'stop'`. Una risposta troncata dal limite di output era indistinguibile da un
turno normale.

**Cura**: si legge `stop_reason` da `message_delta`, `step.ended` porta il finish vero,
e un `max_tokens` produce un `notice` a livello `warn` che lo dice a chi guarda.

---

## D. Percorso caldo dei token (task #13)

### D1. `RawLog`: open+write+close per OGNI messaggio nativo — RISOLTO

`appendFileSync` riapre il file a ogni riga: una risposta da 300 delta sono ~900
syscall, e un ENOSPC lì dentro **lanciava dentro `onRaw`**, cioè dentro il for-await
dell'adapter — un file di diagnosi capace di uccidere la sessione che doveva
diagnosticare.

**Cura**: fd persistente (come il `Journal` accanto), scritture con try/catch (è
diagnosi, non verità: non deve rompere niente), `close()` chiamato dal `retire()` del
registry — prima non lo chiudeva nessuno.

### D2. `JSON.stringify` per watcher sul flusso SSE — RISOLTO

Due pannelli sulla stessa chat = due serializzazioni per ogni delta. Ora una `WeakMap`
in `server.ts` serializza ogni evento una volta sola, chiunque stia guardando.

### D3. Avvio OpenCode: 4 round-trip in fila — RISOLTO

`elencoModelli` → `elencoModi` → `elencoTool` → `elencoComandi` erano sequenziali senza
dipendenze: ora un `Promise.all`. E un catalogo modelli **vuoto** adesso produce un
notice che dice cosa guardare, invece di una tendina vuota senza spiegazione.

---

## E. Minori (task #14)

- **`settled()` di Claude Code teneva un solo waiter** (il secondo sovrascriveva il
  primo, che non si svegliava più): ora è una lista, come già su OpenCode. — RISOLTO
- **Corpo troppo grande → 500**: ora risponde `413`, che è il suo nome. — RISOLTO
- **Cataloghi OpenCode in catch silenzioso**: vedi D3 (notice sui modelli vuoti). — RISOLTO

## Non fatto, di proposito

- **Estrarre la FIFO comune ai due adapter in `core/`**: le due code si somigliano ma
  differiscono dove gli agent differiscono (`annunciato`/`pendingTurn` esistono solo
  dove la sessione nasce dopo il primo prompt; il traduttore OpenCode possiede
  l'apertura del turno). Un'astrazione forzata su un meccanismo tarato a misure sarebbe
  rischio senza guadagno: si rifà il giorno in cui arriva il terzo adapter, che è anche
  il giorno in cui si scopre quale metà è davvero comune.
- **Riconnessione automatica dello stream OpenCode**: B1 dichiara la morte invece di
  nasconderla, e la via del risveglio è corta e onesta. Riconnettersi da soli è
  possibile (il server è una riga di database più un processo) ma è una decisione di
  prodotto — un server che riparte da solo è un server che lavora senza che nessuno
  gliel'abbia chiesto, ed è la stessa ragione del «niente avvio automatico al boot».
