# STARK — implementare la UI

> Documento operativo per chi riprende il lavoro sulla UI con una conversazione nuova.
> Si legge **dopo** `CLAUDE.md` e **prima** di toccare `ui/`.
>
> Il *cosa* deve esserci sta in `docs/ui-schermate.md` e nell'anteprima
> `docs/ui-anteprima.html`. Il *contratto* con il motore sta in `docs/event-model.md`.
> Qui c'è **cosa è già scritto, cosa manca, in che ordine farlo e dove sono le trappole**.

---

## 1. Come si esegue e come si guarda

```
npm install
npm run ui:build      # la UI è servita dal daemon, va compilata
npm run stark         # stampa l'indirizzo con il token dentro
```

L'indirizzo contiene il token una volta sola: al primo caricamento la UI lo sposta in un
cookie e lo toglie dalla barra degli indirizzi.

In sviluppo, con la ricarica a caldo: `STARK_PORT=4571 npm run stark` in un terminale e
`npm run ui:dev` nell'altro. Vite fa da proxy su `/api` verso il daemon, così UI e API
restano sulla stessa origine — senza, il guard rifiuterebbe l'`Origin`.

### Guardare la UI senza spendere quota

Serve un journal, e non serve una sessione vera per averlo:

```bash
npm run check                                  # scrive eventi canonici finti in /tmp/stark-offline-XXXX
cp /tmp/stark-offline-*/s.jsonl ~/.stark/sessioni/$(uuidgen).jsonl
STARK_PORT=4571 npm run stark &
node tools/shot.mjs "http://127.0.0.1:4571/?token=<token>" /tmp/ui.png ".sit"
DARK=1 node tools/shot.mjs "http://127.0.0.1:4571/?token=<token>" /tmp/ui-scuro.png ".sit"
```

Il terzo argomento è un selettore da cliccare prima di fotografare. **Guardare le schermate
invece di descriverle è una regola del progetto**, non un vezzo: vedi `CLAUDE.md`.

### Controlli

| | |
|---|---|
| `npm run ui:check` | tipi della UI. Obbligatorio: la trasformazione di Svelte non controlla niente |
| `npm run typecheck` | tipi del motore |
| `npm run check` | 26 verifiche sulla catena, costo zero di quota |

---

## 2. Cos'è già scritto

```
vite.config.ts              root su ui/, alias $core → src/core, proxy /api in sviluppo
ui/src/main.ts              monta App
ui/src/app.css              il vestito, estratto da docs/ui-anteprima.html
ui/src/App.svelte           guscio: barra laterale + area principale, stati di errore
ui/src/lib/api.ts           client del daemon: token, fetch, SSE a mano, riconnessione
ui/src/lib/store.svelte.ts  lo stato dell'app: righe, selezione, snapshot, collegamento
ui/src/lib/view.ts          traduzioni: gruppo, etichetta, progetto, colore, orario
ui/src/components/Sidebar.svelte       elenco per stato e progetto, pallino, orario+stato
ui/src/components/Conversation.svelte  turni richiudibili, parti, dock in sola lettura
ui/src/components/Icon.svelte          <use> nello sprite
ui/src/components/Sprite.svelte        GENERATO da tools/gen-icons.mjs
ui/src/components/Logo.svelte          GENERATO da tools/gen-logo.py
```

Funziona: elenco raggruppato in Waiting / Working / Sleeping con un colore per progetto,
apertura di una chat, conversazione dal vivo dal flusso SSE, riconnessione con attesa
crescente, tema chiaro e scuro.

---

## 3. Le convenzioni già fissate — non rimetterle in discussione

- **La UI è in inglese.** Documentazione e commenti in italiano.
- **La UI non tiene un modello proprio.** Tiene lo `SessionSnapshot` di `core/reduce.ts` e ci
  applica sopra gli eventi con **lo stesso `applyTo`** del daemon. È così che l'invariante del
  §4 smette di essere una regola da rispettare. Se ti trovi a scrivere un secondo stato
  parallelo, fermati: quasi certamente il dato manca nello snapshot e va aggiunto **lì**
  (come è stato fatto per `lastTs`).
- **Il CSS viene da `docs/ui-anteprima.html`.** Se il disegno cambia, cambia prima nell'anteprima
  e poi in `ui/src/app.css`. L'anteprima resta il riferimento.
- **Le icone non si disegnano.** `npm run icons` le rigenera da `lucide-static`. Per aggiungerne
  una si tocca la mappa in `tools/gen-icons.mjs`.
- **Niente `EventSource`.** Non sa mandare intestazioni: il token finirebbe nella query string.
  Si usa `fetch` più `ReadableStream` (`api.ts`), e la riconnessione la governiamo noi con
  `?from=N` — `EventSource` rimanderebbe `Last-Event-ID`, che il daemon non legge.
- **Le sottorisorse passano per il cookie**, messo servendo la pagina. Non toglierlo: senza,
  script e fogli di stile prendono 403 e lo schermo resta bianco.
- **Un comando risponde solo «accettato».** Ciò che accade torna dal **flusso**, mai dalla
  risposta (§18). Se un comando rispondesse col proprio effetto, quell'effetto esisterebbe in
  un posto che il journal non conosce.

---

## 4. Il contratto col daemon: cosa c'è e cosa manca

| Rotta | |
|---|---|
| `GET /api/sessions` | elenco: `id, title, state, cwd, model, turns, lastSeq, lastTs, live` |
| `POST /api/sessions` | apre o **risveglia**: `{cwd, model?, mode?, resume?, askTools?}` |
| `GET /api/sessions/:id` | lo snapshot |
| `GET /api/sessions/:id/events?from=N` | rilettura del journal |
| `GET /api/sessions/:id/stream?from=N` | flusso SSE |
| `POST /api/sessions/:id/command` | i comandi del §11 |

**Comandi che il registro gestisce davvero**: `session.prompt`, `session.interrupt`,
`session.setModel`, `session.setMode`, `session.sleep`, `session.close`, `permission.reply`,
`question.reply`, `question.reject`.

<br>

> ### ⚠️ Cosa manca nel daemon, e va scritto **prima** della schermata che lo usa
>
> Scoprirlo a metà di un componente costa più che leggerlo adesso.
>
> | Serve a | Cosa manca |
> |---|---|
> | Impostazioni → Permessi | `permissions.setRules` è **dichiarato nel §11 ma non gestito** dal registro |
> | Import di conversazioni | **nessuna rotta**: `listSessions()` dell'SDK non è esposto su HTTP |
> | Impostazioni → Projects / System | **niente**: profili, colori e diagnostica non esistono lato daemon |
> | Barra laterale dal vivo | **nessun flusso globale**: oggi la UI interroga `/api/sessions` ogni 3 s |
>
> `session.wake` è dichiarato e non gestito, ma **non serve**: il risveglio si fa con
> `POST /api/sessions {cwd, resume:{ref: <sessionId>}}`, che riusa l'id e fa **continuare** il
> journal invece di biforcarlo. Attenzione: `POST /command` su una sessione dormiente
> risponde `sessione non attiva`, quindi il risveglio **non** può passare di lì.

---

## 5. L'ordine del lavoro

Una fetta per volta, ognuna verificabile guardandola. In ogni riga: cosa serve dal modello,
quale schermata dell'anteprima la descrive, e la trappola.

### 5.1 Scrivere e fermare

`{c:'session.prompt', text}` e `{c:'session.interrupt'}`. Il dock mostra l'operazione in corso
quando `snap.state === 'busy'`, con il pulsante `circle-stop` rosso a destra.

**Trappola:** dopo il POST non aggiornare niente a mano. Il turno nuovo arriva come
`turn.started` dal flusso, e `applyTo` lo mette dov'è giusto.

### 5.2 I due stati bloccanti del dock

`snap.pendingPermissions` e `snap.pendingQuestions`. Si risponde con
`{c:'permission.reply', requestId, decision:'once'|'always'|'reject', scope?}` e
`{c:'question.reply', requestId, answers, response?}`.

Le richieste **non compaiono nel flusso**: si espande il blocco in basso, sempre nello stesso
posto. Nel flusso resta solo *cosa hai risposto*, dopo. **Il pulsante per fermare resta
visibile anche quando il blocco è espanso**: una domanda arriva mentre l'agent lavora ancora.

**Trappola:** `scope` nasce da `savable` della richiesta, che è ciò che il «Consenti sempre»
può salvare. Non inventarlo.

### 5.3 Effetti e confronto affiancato

`snap.files` (`FileEditView`: `path`, `created`, `hunks`, `callId`) e `snap.shell`.
`core/diff.ts` dà già tutto: `sideBySide(hunks)`, `unified(hunks)`, `stats(hunks)`,
`intraLine(a,b)`. **Non calcolare diff nella UI.**

Due letture: *by file* e *by time*. Gli effetti **prendono il posto** della conversazione, con
una freccia per tornare.

**Trappola:** su una `Write` di file nuovo `structuredPatch` è vuoto e l'hunk è sintetizzato
dall'adapter — è il caso più comune, e senza sarebbe uno schermo bianco. Le 26 verifiche di
`npm run check` lo coprono: se le rompi, l'hai rotto.

### 5.4 Barra di stato toccabile

Modalità, MCP e modello si premono e aprono le tendine disegnate nell'anteprima.
`{c:'session.setModel'}` e `{c:'session.setMode'}` **cambiano a caldo**: nessun «riavvia per
applicare». `bypassPermissions` si mostra spento **con la spiegazione** che è il CLI a
rifiutarlo da root (Principio 5), e Haiku è scegliibile ma avvisa che la sessione ripartirebbe
in Manual.

### 5.5 Nuova chat, risveglio, menu contestuale

Riquadro sopra l'app: agent e cartella, niente opzioni. `POST /api/sessions`.
Risveglio di una Sleeping: stesso POST con `resume`. **Il risveglio rilegge tutto il contesto,
quindi costa quota**: va detto nel momento in cui si preme, non scoperto dopo dal contatore.
Tasto destro sulla riga: rinomina, sleep, elimina.

### 5.6 Import e impostazioni

**Richiedono lavoro sul daemon prima** — vedi la tabella al §4.

---

## 6. Debiti noti, da chiudere quando si passa di lì

- **La barra laterale interroga `/api/sessions` ogni 3 secondi** (`store.svelte.ts`). Il daemon
  espone un flusso per sessione e non uno globale. Funziona, ma non è dal vivo.
- **Il riassunto di cosa fa un tool lo indovina la UI** guardando dentro `input` alla ricerca di
  `command`, `file_path`, `path`… È forma di Claude Code, cioè esattamente ciò che il §1 vieta
  fuori dall'adapter. La bugia è confinata in `subject()` dentro `Conversation.svelte`, con un
  commento che lo dice. **La cura vera è un riassunto già pronto nel modello canonico.**
- **Il titolo non si può rinominare**: `title` nasce dal primo prompt in `registry.ts` e non
  esiste un comando per cambiarlo.
- **Non c'è instradamento**: la chat scelta vive in memoria, quindi un ricaricamento la perde.
  Il daemon serve già la pagina su qualunque rotta, quindi `/chat/<id>` è pronto quando servirà.

---

## 7. Cosa non fare

- Non introdurre uno stato della UI che non nasca dal journal.
- Non mostrare `nominalUsd` come denaro: l'utente è a quota fissa. Si parla di quanto lavoro
  resta e di quando si torna disponibili.
- Non mostrare un'azione bloccata come un errore. **Bloccato non è un fallimento**: è
  «fermato, e puoi consentirlo tu». *(Questo bug c'è già stato una volta: un tool bloccato
  torna anche `ok:false`, e le due classi si sovrapponevano.)*
- Non nascondere una voce che il CLI consente. Se il CLI la rifiuta, si mostra spenta **con la
  spiegazione**.
- Non troncare la risposta a parole. È l'unica cosa scritta per l'utente; il resto è materiale
  di lavorazione.
