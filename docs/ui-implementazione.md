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
mkdir -p /tmp/finto/sessioni
cp /tmp/stark-offline-*/s.jsonl /tmp/finto/sessioni/$(uuidgen).jsonl
STARK_HOME=/tmp/finto STARK_PORT=4571 npm run stark &
node tools/shot.mjs "http://127.0.0.1:4571/?token=<token>" /tmp/ui.png ".sit"
DARK=1 node tools/shot.mjs "http://127.0.0.1:4571/?token=<token>" /tmp/ui-scuro.png ".sit"
```

`STARK_HOME` tiene i journal finti fuori da `~/.stark`, dove stanno quelli veri.
Dal terzo argomento in poi sono **selettori da premere in fila**, prima di fotografare: le
schermate che non stanno all'apertura sono a due passi, per esempio
`"text=il titolo" ".effbtn" "text=By time"`. **Guardare le schermate invece di descriverle è
una regola del progetto**, non un vezzo: vedi `CLAUDE.md`.

> Non usare `waitUntil: 'networkidle'` in `shot.mjs`: la UI tiene aperti **due** flussi SSE —
> quello dell'elenco e quello della chat — quindi la rete non sta mai ferma e l'attesa scade
> sempre. È già `'load'` più una pausa; se un giorno torna un timeout, la causa è questa.

### Guardare gli stati che hanno bisogno di un processo vero

Casella di scrittura, Stop, permessi e domande esistono solo se dietro c'è un processo: la UI
li spegne apposta quando `live` è falso, perché una casella che accetta un messaggio senza
nessuno che lo raccolga lo perde in silenzio. Aprire una sessione **non costa quota** — è solo
l'handshake, nessun turno di modello:

```bash
curl -s -X POST http://127.0.0.1:4571/api/sessions -H "Authorization: Bearer <token>" \
  -H 'content-type: application/json' -d '{"cwd":"/tmp/prova"}'
```

Per vedere la card di un permesso serve `"askTools":["Bash"]` nello stesso corpo, e poi un
prompt vero — quello **sì** costa, quindi che sia minuscolo. E si preme *Allow*, non *Always
allow*: il secondo scrive davvero una regola in `.claude/settings.local.json` della cartella.

### Controlli

| | |
|---|---|
| `npm run ui:check` | tipi della UI. Obbligatorio: la trasformazione di Svelte non controlla niente |
| `npm run typecheck` | tipi del motore |
| `npm run check` | 30 verifiche sulla catena, costo zero di quota |

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
ui/src/components/Sidebar.svelte       elenco per stato e progetto, tasto destro, rinomina in riga
ui/src/components/Conversation.svelte  turni richiudibili, parti, risposte date, file in linea
ui/src/components/Dock.svelte          il blocco in basso nei suoi tre stati
ui/src/components/Ask.svelte           permesso e domanda, dentro il dock
ui/src/components/Status.svelte        la barra che si preme: modalità, MCP, modello, quota
ui/src/components/Effects.svelte       per file / in ordine di tempo, al posto della conversazione
ui/src/components/FileBlock.svelte     un file che si apre sul confronto
ui/src/components/Diff.svelte          affiancato, e a colonna unica su schermo stretto
ui/src/components/NewChat.svelte       il riquadro sopra l'app
ui/src/components/Icon.svelte          <use> nello sprite
ui/src/components/Sprite.svelte        GENERATO da tools/gen-icons.mjs
ui/src/components/Logo.svelte          GENERATO da tools/gen-logo.py
```

Funziona, e verificato guardandolo: elenco raggruppato in Waiting / Working / Sleeping con un
colore per progetto; conversazione dal vivo dal flusso SSE con riconnessione; **scrittura e
Stop**; **permessi e domande** nel blocco in basso, con la risposta che resta nel flusso;
**effetti** nelle due letture con il confronto affiancato; **barra di stato** che cambia
modalità e modello a caldo; **nuova chat, risveglio, rinomina, sleep, elimina**; tema chiaro e
scuro.

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
| `GET /api/stream` | **flusso dell'elenco**: manda le righe quando cambiano, al più ogni 250 ms |
| `POST /api/sessions` | apre o **risveglia**: `{cwd, model?, mode?, resume?, askTools?}` |
| `GET /api/sessions/:id` | lo snapshot |
| `DELETE /api/sessions/:id` | cancella il journal. Non c'è cestino |
| `GET /api/sessions/:id/events?from=N` | rilettura del journal |
| `GET /api/sessions/:id/stream?from=N` | flusso SSE della conversazione |
| `POST /api/sessions/:id/command` | i comandi del §11 |

**Comandi che il registro gestisce davvero**: `session.prompt`, `session.interrupt`,
`session.setModel`, `session.setMode`, `session.rename`, `session.sleep`, `session.close`,
`permission.reply`, `question.reply`, `question.reject`.

`session.rename` è l'unico che il registro gestisce **prima** del controllo «è attiva?»: si
rinomina soprattutto ciò che dorme.

`state` nelle righe dell'elenco **non** ripete alla lettera l'ultimo stato scritto: una sessione
senza processo dietro che risulterebbe `busy`, `starting` o `awaiting` viene riportata `closed`.
Il journal di una conversazione che il riavvio del daemon ha interrotto finisce a metà di un
turno, e ripeterlo la lascerebbe in *Working* per sempre.

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
> | Scegliere i server MCP per chat | **niente**: il daemon non li elenca, e ogni chat parte con nessuno |
> | Sfogliare le cartelle in «New chat» | **nessuna rotta**: il percorso si scrive a mano |
> | ~~Barra laterale dal vivo~~ | ~~nessun flusso globale~~ — **fatto**: `GET /api/stream` |
>
> `session.wake` è dichiarato e non gestito, ma **non serve**: il risveglio si fa con
> `POST /api/sessions {cwd, resume:{ref: <sessionId>}}`, che riusa l'id e fa **continuare** il
> journal invece di biforcarlo. Attenzione: `POST /command` su una sessione dormiente
> risponde `sessione non attiva`, quindi il risveglio **non** può passare di lì.

---

## 5. Le fette, e cosa si è imparato scrivendole

Fatte 5.1 → 5.5, più l'import. Ogni riga dice **dove sta** adesso e la trappola, che nel
frattempo è passata da previsione a fatto verificato.

### 5.1 Scrivere e fermare — `Dock.svelte`

`{c:'session.prompt', text}` e `{c:'session.interrupt'}`. Invio manda, Maiusc+Invio va a capo.

**Trappola confermata:** dopo il POST non si aggiorna niente a mano. Il turno nuovo arriva come
`turn.started` dal flusso, e `applyTo` lo mette dov'è giusto.

**Trappola nuova:** tutto ciò che è «in corso» va condizionato a `store.live`, non solo allo
stato dello snapshot. Il journal di una sessione interrotta dal riavvio del daemon finisce a
metà di un turno: ripeterlo alla lettera mostra una rotellina che gira su niente e una casella
di scrittura che accetta un messaggio senza nessuno che lo raccolga.

### 5.2 I due stati bloccanti — `Ask.svelte`

`snap.pendingPermissions` e `snap.pendingQuestions`. Le richieste **non compaiono nel flusso**:
si espande il blocco in basso. Nel flusso resta *cosa hai risposto*, ed è una parte vera dello
snapshot (`AnswerPartView`), non un pezzo di stato della UI.

**Trappola confermata:** `scope` nasce da `savable`, non si inventa.

**Trappola nuova, e non era prevista:** lo Stop non va legato a `busy`. Quando arriva una
richiesta lo stato canonico diventa `awaiting`, quindi `busy` è falso — e il pulsante
sparirebbe proprio nel momento in cui serve di più. Si condiziona a `store.live`.

**Cosa è cambiato nel daemon:** «Consenti sempre» ora salva davvero. Il registro traduce lo
`scope` in `{type:'addRules', behavior:'allow', destination:'localSettings'}` per l'SDK. Prima
il pulsante si comportava come «Consenti» mentre il journal scriveva `always`.

### 5.3 Effetti e confronto affiancato — `Effects.svelte`, `FileBlock.svelte`, `Diff.svelte`

`core/diff.ts` dà già tutto: `sideBySide`, `unified`, `stats`, `intraLine`. **Non calcolare
diff nella UI.**

**Trappola confermata:** su una `Write` di file nuovo `structuredPatch` è vuoto e l'hunk è
sintetizzato dall'adapter. `npm run check` lo copre.

**Trappola nuova:** `SideRow` e `UnifiedRow` hanno gli stessi nomi di riga (`context`,
`removed`, `added`) con dentro campi diversi. In un'unione sola non c'è modo di sapere quale
si ha in mano: si costruisce **una forma alla volta**, scegliendo su `narrow`.

**Un bug che si vede solo su una conversazione vera:** `.conv` è una colonna flex, e senza
`flex:none` sui turni un turno lungo schiaccia tutti gli altri fino a farli sparire a otto
pixel. Con tre turni non si nota; con dodici sì. È la domanda con cui si valuta una grafica in
questo progetto — *con quattrocento blocchi dentro, regge?* — e vale anche per il CSS.

### 5.4 Barra di stato toccabile — `Status.svelte`

`{c:'session.setModel'}` e `{c:'session.setMode'}` cambiano a caldo. `bypassPermissions` si
mostra spento **con la spiegazione**, Haiku è scegliibile ma avvisa.

**Cosa è cambiato nel modello:** gli elenchi non sono scritti nella UI. `session.created` porta
`models: ModelChoice[]` e `modes: ModeChoice[]`, perché i nomi dei modelli sono vocabolario
dell'agent e «chi rifiuta `bypassPermissions` e perché» lo sa solo l'adapter. Su un journal
vecchio gli elenchi sono vuoti: le modalità si mostrano lo stesso (sono canoniche), il chip del
modello no.

**Niente percentuale di contesto inventata.** Lo snapshot non sa quanto della finestra resta:
si mostrano i token passati di qui e, quando `quota.updated` è arrivato, quando la finestra si
riapre. Su una chat importata `usage` è vuoto e si sommano i turni.

### 5.5 Nuova chat, import, risveglio, menu contestuale

`NewChat.svelte` è **un riquadro con due linguette**, non due schermate e non una tendina sul
`+`: la ragione sta in testa al file e nell'anteprima. Il risveglio è `POST /api/sessions` con
`resume`, **non** un comando — `POST /command` su una sessione senza processo risponde
«sessione non attiva». Rinomina, sleep ed elimina stanno nel tasto destro sulla riga.

**L'import passa dall'SDK** (`catalogue.ts` → `listSessions`), non da uno scandaglio nostro.
L'unica cosa che l'SDK non dà è il percorso del trascritto: lo si cerca per nome dentro
`<config>/projects/`, ed è l'unico pezzo di conoscenza interna, confinato in quel file.

**Trappola nuova:** un trascritto importato non ha un `session.created`, quindi senza aiuto la
conversazione finisce senza cartella, senza progetto, senza colore e senza il modo di
risvegliarla. `importTranscript` ora legge `cwd` e `model` dalle voci del trascritto e li
scrive in testa, e chiude con `session.state: 'idle'`.

### 5.6 Impostazioni

**Richiedono lavoro sul daemon prima** — vedi la tabella al §4.

---

## 6. Debiti noti, da chiudere quando si passa di lì

- ~~La barra laterale interroga `/api/sessions` ogni 3 secondi~~ — **chiuso**: `GET /api/stream`.
- ~~Il riassunto di cosa fa un tool lo indovina la UI~~ — **chiuso**: arriva in
  `tool.input.ended.summary`, scritto da `adapters/claude-code/summary.ts`. La UI ha ancora un
  ripiego per i journal scritti prima, ma mostra `inputRaw` troncato senza interpretarlo.
- ~~Il titolo non si può rinominare~~ — **chiuso**: `session.rename` → `session.renamed`.
- **Non c'è instradamento**: la chat scelta vive in memoria, quindi un ricaricamento la perde.
  Il daemon serve già la pagina su qualunque rotta, quindi `/chat/<id>` è pronto quando servirà.
- **Nessuna notifica di sistema e nessun suono.** Il pallino nell'elenco funziona solo se stai
  già guardando STARK, e il punto era poter guardare altrove (`ui-schermate.md` §1).
- **L'avviso «forse è aperta in un terminale»** nell'import è una stima sull'ora dell'ultima
  scrittura (cinque minuti), non un fatto: il trascritto non dice se un processo è vivo.
  Sbagliare per eccesso costa una frase in più da leggere; per difetto, non avvisare qualcuno
  che sta per guidare la stessa conversazione da due posti.
- **La riga dell'elenco non dice cosa sta facendo adesso** né da quanto tempo è ferma, che
  `ui-schermate.md` §1 mette fra le cose che fanno decidere se entrare. Il dato c'è nello
  snapshot; manca nella riga, che oggi porta solo `lastTs`.

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
