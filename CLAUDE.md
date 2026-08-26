# STARK

Interfaccia web locale per gestire le sessioni con gli agent AI installati sulla macchina
(Claude Code, OpenCode, Codex, …).

## Principio di prodotto fondante

> STARK non è un terminale nel browser. È una **GUI che sostituisce la TUI**.
> Ogni volta che una scelta tecnica ci costringe a "simulare il terminale", è la scelta sbagliata.

## PRIMA DI LAVORARE: leggi la memoria di progetto

Le decisioni, le motivazioni e la roadmap NON stanno in questo repo: stanno su **Notion**
(workspace Digitizers). Il repo contiene solo il codice e le specifiche che cambiano col codice.

Pagina radice: https://app.notion.com/p/3c3fef5cacd98116bbedfc31ce29c6f1

**PARTI DA QUI** → **Punto della situazione** — https://app.notion.com/p/3c3fef5cacd9817ea071eb098c381dc6
Dice dove siamo, qual è la domanda aperta in questo momento e cosa viene subito dopo.
Le conversazioni con l'agent non si sincronizzano fra le macchine: quella pagina è il ponte,
e va aggiornata a fine sessione prima di cambiare PC.

- **Visione e principi di prodotto** — https://app.notion.com/p/3c3fef5cacd981fa914feb29624de853
- **Registro delle decisioni (ADR)** — https://app.notion.com/p/3c3fef5cacd98121ac5bf2b4a7597121
  - ADR-001 — Canale di comunicazione con gli agent
  - ADR-002 — Piattaforma: web app locale
  - ADR-003 — Dove vive la memoria di progetto
  - ADR-004 — Un solo adapter nell'MVP (Claude Code)
  - ADR-005 — Ciclo di vita delle sessioni (daemon persistente + Sleep)
  - ADR-006 — Modello dei permessi — SUPERATA da ADR-008
  - ADR-008 — Permessi basati su auto mode (default: zero card, toggle opzionali)
  - ADR-007 — Stack tecnologico e persistenza (Node + TS, journal JSONL)
  - ADR-009 — Agent SDK ufficiale invece del protocollo a mano (supera in parte ADR-001)
  - ADR-010 — Con cosa si scrive la UI (Vite + Svelte 5; il daemon resta senza build)
- **Riferimento tecnico — Claude Code come piattaforma** — https://app.notion.com/p/3c5fef5cacd981f1b556fbe1e2b7bd0e
  Cosa è documentato ufficialmente e cosa no, con le versioni verificate. **Da leggere prima di
  toccare l'adapter**: dice quali pezzi sono garantiti e quali possono cambiare senza preavviso.
- **Spike tecnico — Risultati** — https://app.notion.com/p/3c3fef5cacd9817c8612ea39506f9bf9
- **Architettura del core** — https://app.notion.com/p/3c3fef5cacd981ea8b9ee41142c7aa3e
- **Roadmap** — https://app.notion.com/p/3c3fef5cacd981b7a796df6f09a16f2d
- **Interfaccia — decisioni e perché** — https://app.notion.com/p/3c5fef5cacd98109b2bede9a07442f11
  Le decisioni sulla UI e le premesse su cui sono state prese, comprese quelle **scartate**.
  Com'è fatta oggi invece sta nel repo, perché cambia col codice (ADR-003):
  `docs/ui-schermate.md` a parole, `docs/ui-anteprima.html` come anteprima da pubblicare.
- **Domande aperte** — https://app.notion.com/p/3c3fef5cacd981f688d2c486c3119b04

**Se stai per lavorare sulla UI** → leggi `docs/ui-implementazione.md`. Dice cos'è già
scritto, cosa manca **nel daemon** prima di poter fare una certa schermata, in che ordine
procedere e dove sono le trappole. È il documento che evita di scoprire a metà di un
componente che la rotta che gli serve non esiste.

Nota: ADR-003 definisce dove vive cosa. Le specifiche accoppiate al codice (modello di eventi
canonico, contratti degli adapter) NON vanno su Notion ma in `docs/` in questo repo.

Ogni decisione strutturale va registrata come **ADR con la motivazione**, così che se in futuro
la si rimette in discussione si sappia su quali premesse era stata presa.

## Stato attuale

Spike concluso. Specifica del modello di eventi scritta (`docs/event-model.md`).
**Il motore è implementato e funzionante**: sessione Claude Code reale sopra l'Agent SDK →
eventi canonici → journal JSONL → Sleep → risveglio con `--resume` → stato ricostruito dal
journal, identico a quello dal vivo. Il **daemon esiste** (HTTP + SSE su `127.0.0.1`, registro
multi-sessione, perimetro di sicurezza), e così l'import di conversazioni nate nella CLI.

**La UI scrive.** Vite + Svelte 5 in `ui/`, servita dal daemon. Funziona, ed è stato verificato
guardandolo su sessioni vere: elenco raggruppato per stato e progetto agganciato a un flusso
globale; conversazione dal vivo con turni richiudibili; **casella di scrittura e Stop**;
**permessi e domande** nel blocco in basso, con la risposta che resta nel flusso; **effetti**
nelle due letture con il confronto affiancato; **barra di stato** che cambia modello e modalità
a caldo; **nuova chat, import da terminale, risveglio, rinomina, sleep, elimina**; tema chiaro
e scuro. Tutte le schermate sono disegnate in `docs/ui-anteprima.html`.

**E ti chiama quando guardi altrove** (24 agosto 2026): notifica di sistema e suono per *ti
aspetta*, *ha finito*, *si è fermata da sola*, con la campanella in cima all'elenco come
interruttore; e la riga dell'elenco dice **cosa sta facendo adesso e da quanto sta così**.
Provato dal vivo, notifica compresa.

**Gli strumenti esterni si scelgono per chat**: il chip MCP nella barra di stato elenca i server
della macchina e li accende uno per uno, spenti di default, con la scelta che torna col
risveglio. E i **comandi slash** si scrivono: la casella li propone appena scrivi `/`, con
argomenti e alias.

**I prompt fanno la fila** (26 agosto 2026): mandarne uno mentre l'agent lavora non lo
piega più dentro il turno in corso — apre **un turno suo** e aspetta, **FIFO**. La fila è di
STARK, non del CLI: si consegna un messaggio alla volta e a sessione ferma, perché un lotto
consegnato insieme il CLI lo fonde in un turno solo. **Stop svuota la fila** (chi preme il
quadrato rosso non vuole che parta il prossimo mezzo secondo dopo) e il turno interrotto
dall'utente ora si chiama `aborted`, non `error`. Erano tre bug in uno: il terzo stava nel
reducer, che attaccava le parti all'**ultimo** turno invece che al **primo aperto** — così la
risposta al primo prompt compariva dentro il secondo. Provato dal vivo: `npm run queue`.

**Il pannellino della quota dice quanto ne resta** (26 agosto 2026): tre voci e basta —
contesto di questa chat, finestra da **5 ore**, **settimana** (più le settimane per modello, se
il piano ne manda), col reset scritto nei due formati, «fra 6d 12h · Sep 01 23:00». Il livello
non si deduce dai token: è del **piano**, non della conversazione, e lo si chiede con
`quota.windows` — avvio, fine turno, e quando apri il pannellino. Sorgente: il metodo
`usage_EXPERIMENTAL_…` dell'SDK, instabile per ammissione sua, isolato in
`adapters/claude-code/quota.ts` con la cattura vera in `npm run check`. Resta disegnato e non
fatto: dire **su quale profilo** sta contando.

**La compattazione si vede**: una riga nel flusso con quanto c'era, quanto è rimasto e se
l'hai chiesta tu o si era riempito. Prima l'evento finiva in un `break`.

**L'indirizzo dice dove sei** (`/chat/<id>`, `/chat/<id>/effects`): un ricaricamento non perde
la chat, e «indietro» torna alla conversazione dagli effetti.

**Il prompt non è più solo testo**: si incollano e si trascinano immagini (PNG, JPEG, GIF,
WebP). Nel journal va il **riferimento**, non i byte: quello si rilegge tutto a ogni risveglio.

**Il daemon sopravvive al terminale**: `npm run stark:start` lo stacca, `stark:status` e
`stark:stop` lo governano, l'indirizzo è fisso e il token sta in `~/.stark/token`. Una scheda
aperta si ricollega da sola dopo un riavvio.

Come si esegue: `README.md`. Node **≥ 22.18** (i `.ts` del daemon girano diretti, senza build;
la UI invece si compila, vedi ADR-010). `npm run check` prova tutta la catena a costo zero di
quota — 71 verifiche; `npm run ui:build` poi `npm run stark` aprono STARK nel browser;
`npm run slice` apre una sessione vera.

Per **guardare** la UI invece di descriverla:
`node tools/shot.mjs <url> <fuori.png> [selettore ...]` la fotografa senza spendere quota, e i
selettori si premono in fila per arrivare alle schermate che stanno a due passi. Un journal da
dare in pasto al daemon lo produce `npm run check`; e aprire una sessione con
`POST /api/sessions` **non costa quota** (è solo l'handshake), che è come si guardano gli stati
che hanno bisogno di un processo vero. Vedi `docs/ui-implementazione.md` §1.

**Le impostazioni ci sono**, sei sezioni: permessi per categoria (salvati sulla macchina,
applicati alle chat nuove), colore per progetto, notifiche, tema, spazio su disco, diagnostica.
Quello che STARK non sa ancora fare sta in elenco **spento con la spiegazione**, mai nascosto.

**Il profilo di Claude è per progetto** (25 agosto 2026): `OpenSpec` porta un `configDir` che il
registro preferisce al default, e `settings.ts` lo ricorda per cartella — quindi la scelta
sopravvive al riavvio ed è quella che il risveglio riusa da solo. In «New chat» compare **solo**
se la macchina ha più di un profilo e la cartella è nuova per STARK. Nello stesso giro: il
**percorso si sfoglia** (`GET /api/browse`) invece di scriverlo a mano, e un blocco `reasoning`
chiuso senza un solo `delta` non è più una riga da aprire su «…».

**La risposta a parole è Markdown** (`ui/src/lib/markdown.ts`): `marked` per il parsing,
**DOMPurify** per pulire l'HTML prima di `{@html}` — quel testo può contenere qualunque cosa
l'agent abbia letto, quindi non è fidato solo perché arriva da noi. I link vanno in una scheda
nuova: STARK non ha una barra degli indirizzi con cui tornare indietro. Sono le **prime
dipendenze dopo l'SDK**, quindi dopo un `git pull` `npm install` non si salta più.

**Bugfix B1 e feature F2, dalla pagina «Bugfix and future features» di Notion** (26 agosto 2026):
la domanda finale evidenziava tutto il blocco, non il paragrafo che la conteneva — lo stile è
passato dal contenitore all'ultimo elemento renderizzato (`markdown.ts`). E la riga di un tool
mostra ora **perché** è stato lanciato, non solo cosa: quando l'agent ha scritto una
`description`, è quella la riga — «Search for summarize definition» invece di
`grep -rn "summary" src/adapters/`. Non generata da STARK (costerebbe quota su ogni tool di ogni
turno): è testo che l'agent scrive già da sé e prima veniva buttato via. Verificato dal vivo che
dipende dal modello — con Opus quasi sempre, con Sonnet su comandi brevi spesso manca — e che il
comando esatto resta raggiungibile (tooltip, e per intero aprendo la riga).

**Feature F3, stessa pagina** (26 agosto 2026): un bottone «cartella aperta» accanto alla riga di
un tool con un percorso (`file_path`/`path`/`notebook_path`, gli stessi campi che `summary.ts`
riconosce già) e accanto al blocco di un file modificato — apre il gestore di file della macchina
col file **selezionato**, senza sostituire il clic che apre il confronto. `POST /api/reveal`,
dietro le stesse quattro difese di ogni altra rotta (`src/daemon/reveal.ts`). Su WSL2 (le due
macchine reali) usa Explorer via `wslpath`, verificato su entrambe le forme di percorso
(`/mnt/…` e nativo). Il ramo Linux nativo/Nautilus non è verificato dal vivo — nessuna delle due
macchine lo è — e lo dice il codice, non solo questa riga.

**F1, stessa pagina, fatta** (26 agosto 2026): un link riconosciuto (oggi solo Notion) porta un
bottone **«Open in Notion»** accanto — il link resta quello che era, il bottone è la seconda via.
Decisione dell'utente, non la mia proposta iniziale: niente riscrittura silenziosa dell'`href`
(rischiava di sorprendere chi si aspettava il browser), due vie esplicite. L'app che non c'è si
scopre **prima** di tentare — `HKCR\<schema>` su WSL, `xdg-mime` su Linux — perché Windows non
avvisa chi lancia un protocollo non registrato, fallisce muto. Verificato dal vivo per davvero,
non solo per esito HTTP: cliccato nella UI vera, ha aperto la pagina Notion giusta, due volte,
con conferma diretta di cosa si vedeva sullo schermo — l'unica cosa che non potevo controllare da
sola. Su WSL2 passa da `cmd.exe /c start` con l'URL tradotto nello schema dell'app, lanciato dalla
cartella di sistema di Windows (dalla cartella del daemon, un percorso WSL, fallisce — verificato,
non dedotto). Il perimetro non si fida del client: `POST /api/open-app` ricontrolla da sé che il
dominio appartenga al servizio dichiarato. `core/services.ts` è il posto dove aggiungerne un
altro, un servizio alla volta. `npm run daemon` passa a **24** verifiche.

**Due rifiniture volute dall'utente, stessa sera**: il blocco del prompt è **blu-azzurro**
(`--user`/`--user-bg` in `app.css`, distinto da `--accent` e da `--work`) — ogni turno si
riconosce scorrendo la conversazione senza doverlo leggere, chiuso o aperto. **Il colore però è
del blocco, non del testo**: il prompt sta in `--ink` e l'ora in `--muted` a peso normale
(corretto il 26 agosto su segnalazione dell'utente — ciano su fondo azzurro ha poco contrasto, e
quel testo è la cosa da leggere; l'ora è un riferimento, non un titolo, e in blu grassetto
competeva col prompt. A firmare il blocco resta lo sfondo, che da solo basta). E la riga di un tool
con una motivazione (F2) diventa **due righe**: sopra nome e perché, sotto — piccolo, monospace —
il comando o il percorso esatto, che prima stava solo in un tooltip. Senza motivazione la riga
resta una sola linea, identica a prima. Lo stesso blu-azzurro copre anche il blocco «You
answered»: è di nuovo l'utente a parlare, solo rispondendo invece di chiedere, e riconoscerlo
scorrendo vale la stessa ragione.

**Il contesto diceva 100% quando non lo era** (bug segnalato dall'utente, 26 agosto 2026). La
percentuale era calcolata da STARK — token dell'ultimo turno diviso una finestra indovinata dal
nome del modello — e su Opus con contesto esteso quel nome arriva con le parentesi
(`claude-opus-5[1m]`, verificato sull'handshake vero): il confronto non lo riconosceva, la
finestra usata era 200K invece del milione vero, e un contesto reale al 21% appariva 100%. Non
era la cache, come si sospettava: era il denominatore. Corretto smettendo di indovinare —
`getContextUsage()`, un metodo **stabile** dell'SDK (non `EXPERIMENTAL` come quello della
quota), è la stessa domanda a cui risponde `/context` nel terminale, con `percentage` già
calcolata. La barra mostra ora le categorie vere di Claude Code (prompt di sistema, tool, MCP,
memoria, riserva di auto-compattazione…), non più `input`/`output`/`cache*`. Stessi tre momenti
della quota: avvio, fine turno, apertura del pannellino (`context.usage`, §10 del modello di
eventi). `npm run check` passa a **76**.

**L'uscita di un comando locale (`/usage`, `/model`, `/cost`, …) si perdeva** (bug segnalato
dall'utente, 26 agosto 2026, nella stessa sera). Il turno si chiudeva regolarmente — non
un'interruzione — ma restava senza un solo blocco dentro: il CLI esegue quei comandi da sé, a
costo zero, e torna un **unico** messaggio `assistant` completo (`model: "<synthetic>"`), senza
streaming prima. Il traduttore aveva una regola sola per `assistant` — ignoralo, tanto una
risposta vera arriva già per streaming — e quella sintetica ci cadeva dentro allo stesso modo.
`translate.ts` ora distingue il caso sintetico e lo trasforma nello stesso ciclo
`text.started`/`text.delta`/`text.ended` di ogni altra parte, con tutto il testo in un colpo
solo invece che a pezzi. Verificato dal vivo mandando `/usage` per davvero: il pannellino della
UI mostra ora l'output identico a quello del terminale. `npm run check` passa a **78**.

**`/clear` si vede, e chiude quello che c'era prima** (chiesto dall'utente, 26 agosto 2026).
Prima il comando passava e non succedeva niente a schermo: il turno restava vuoto e la
conversazione continuava a scorrere identica, come se contasse ancora tutta. Adesso tutto ciò
che precede un `/clear` — **il turno del comando compreso** — si raccoglie in un **capitolo
chiuso**, una riga sola che taglia il flusso («Context cleared · 3 turns before · 16:18») e si
riapre cliccandoci: azzerato non vuol dire cancellato, il journal ce l'ha ancora. Riaperto
resta rientrato e più spento, se no quei turni tornerebbero identici a quelli veri e sarebbe di
nuovo invisibile dove il contesto smette di valere.
Che `/clear` azzeri **davvero** non è stato dedotto dal nome: `spike/clear-probe.ts` lo ha
misurato con tre prompt veri (BANANA → `/clear` → «che parola?» → «NONLOSO»). Da lì sono usciti
due fatti che non si indovinano: il CLI lo annuncia con un messaggio suo, `conversation_reset`,
dentro il turno del comando — quindi **STARK non legge i prompt** per capire cosa fanno, chiede
al CLI; e il `new_conversation_id` di quel messaggio **non** è il riferimento per il risveglio
(sono diversi: `31830557…` contro `f98faabe…`), che invece arriva col `system:init` successivo
ed era già gestito. Nuovo evento canonico `context.cleared` (§10) e `TurnView.clearedAt`: un
campo del turno, non una parte, perché la compattazione avviene *dentro* il flusso mentre
questo è un taglio *del* flusso. Provato dal vivo sul daemon vero, non solo per esito HTTP.
`npm run check` passa a **80**. Resta aperto: dopo un `/clear` il titolo della chat è ancora
quello del primo prompt, che ora sta dentro il capitolo chiuso.

**Il turno-fantasma: un `kill` mal mirato ha ammazzato il daemon due volte, e uno dei due
turni interrotti è rimasto aperto per sempre** (26 agosto 2026, dal portatile). Causa esterna,
non nostra: un'altra sessione ha fermato un daemon di prova con `ps | grep "stark.ts run" |
kill`, che non distingue due daemon con `STARK_HOME` diversi — è la stessa riga in `ps`, li
prende entrambi. A morire due volte è stato anche quello di produzione. Fix esterno (non
nostro, non lo tocchiamo): `process.title` con l'home dentro, in `stark.ts`.
Il bug nostro stava nel reducer: un turno troncato a metà da un `kill` non scrive mai il
proprio `turn.ended`, e `applyTo` cerca "il primo turno non chiuso" per decidere dove
attaccare le parti in arrivo (fix del 26 agosto precedente per la coda). Un turno mai chiuso
resta "il primo aperto" **per sempre** — quindi tutto quello che arriva dopo, turni nuovi
compresi, ci finisce dentro invece che nel proprio. Il primo tentativo di fix (chiudere "il
primo aperto" ogni volta che ne parte uno nuovo) rompeva il caso sano: `npm run queue` ha
mostrato subito che il turno N+1 legittimamente parte prima che N registri la sua chiusura.
Il fix corretto si aggancia a `session.created`, che arriva solo quando nasce un **processo
figlio nuovo** — mai durante una sessione viva. Un processo appena nato non può aver
ereditato un turno davvero in corso: se lo trova aperto è per forza un residuo di crash, e lo
chiude con un motivo nuovo e onesto (`'interrupted'`, quarto valore accanto a
`completed`/`aborted`/`error` — la UI lo mostra già senza modifiche). Verificato con una prova
sintetica che riproduce esattamente la sequenza reale di questo journal (turno troncato →
`session.created` di ripresa → turno nuovo), non solo sul caso sano.

**Il push su iPhone falliva con `403 BadJwtToken`, e non era il telefono** (26 agosto, stessa
sessione). La sonda (`tools/sonda-telefono/`) usava `mailto:sonda@stark.local` come soggetto
VAPID: Apple rifiuta qualunque dominio finto nel `sub` del JWT — stesso sintomo documentato
altrove (github.com/openclaw/openclaw#83134). Corretto rilevando l'hostname Tailscale vero
all'avvio (`tailscale status --json` → `Self.DNSName`), con avviso esplicito se Tailscale non
c'è invece di fallire muto. Verificato end-to-end riusando l'iscrizione già registrata dal
telefono: `push-inviato` (niente più 403) → `push-RICEVUTO-dal-telefono` in ~3s.

**Il trasporto per il telefono è deciso e misurato: Tailscale, STARK invariato** — risponde a
§5.1 di "Continua da telefono". `tailscale serve` fa da proxy TLS locale verso `127.0.0.1`
(era già installato e connesso su questa macchina, portatile e iPhone nella stessa tailnet):
SSE, chunked e WebSocket passano tutti puliti, a differenza del quick tunnel Cloudflare che li
bufferizzava tutti. Il perimetro (`security.ts`) ora riconosce anche l'hostname Tailscale su
`Host` e `Origin` — auto-rilevato allo stesso modo, con la stessa `Self.DNSName` — restando
solo-localhost se Tailscale non c'è. La difesa sull'indirizzo socket non cambia: `tailscale
serve` si collega da `127.0.0.1`, quindi la connessione resta "da questa macchina" anche col
telefono fuori casa. **Decisione presa con l'utente, non da soli**: aprire il perimetro oltre
localhost è esplicitamente riservato a lui (vedi "Sicurezza" più sotto).
Trovati e sistemati nello stesso giro due debiti del perimetro: il motivo di un rifiuto
(`{error:"vietato"}`) non veniva mai scritto nei log nonostante il commento lo promettesse —
ora `console.error` lo fa davvero; e il cookie di sessione non aveva `Secure`, candidato
concreto (non ancora confermato del tutto) al perché un refresh su Safari via HTTPS perdeva
la credenziale — su `127.0.0.1` restava comunque un contesto attendibile, quindi il loopback
non cambia. La domanda aperta §5 ("che durata deve avere la credenziale sul telefono") resta
aperta: il workaround di oggi è riaprire il link col token.

**La grafica da telefono, prima passata di rifiniture** (26 agosto, su segnalazione
dell'utente con screenshot veri). L'impianto lista/chat a tutto schermo (§8 di
`ui-schermate.md`, deciso il 24 agosto) esisteva solo come `store.narrow`, mai collegato al
layout vero: ora `App.svelte` alterna sidebar e conversazione sotto gli 860px, con una freccia
indietro in `Conversation.svelte` che torna alla lista passando dall'indirizzo (non
`history.back()` — un link diretto da notifica potrebbe non avere una voce precedente).
La casella di scrittura aveva incollare e trascinare, **zero vie da touch**: aggiunto un
bottone graffetta (apre il selettore file nativo) e uno di invio accanto a Invio da tastiera,
due icone nuove nello sprite (`i-clip`, `i-send`). La barra di stato stringeva cinque controlli
su una riga pensata per lo schermo largo, col percorso tagliato di netto senza puntini (niente
ellissi, e il contenitore lo nascondeva oltre il bordo invece di scorrere): ora va a capo in
due righe sotto gli 860px, e il percorso ha un'ellissi vera. Il bottone «N files · M commands»
lascia solo l'icona sotto la stessa soglia — stessa funzione, un'etichetta che lì non c'entra.
Font e bottoni erano tarati per un mouse: esteso `Sizer` (già lì per la preferenza di
dimensione testo, con `zoom` invece di riscrivere ~150 dichiarazioni) con un fattore ×1,35
solo sotto lo schermo stretto, **sommato** alla preferenza scelta e non al suo posto —
verificato che `zoom` non tocca `window.innerWidth`, quindi nessun rischio che la soglia
`narrow` oscilli da sola. Ultimo pezzo, il più istruttivo: i popup di modalità/MCP/modello si
ancoravano ciascuno al **proprio bottone** (`.pop .menu` scoped dentro `Status.svelte`, mai
guardato prima) — «mode» capitava bene per posizione, «MCP» (290px) sconfinava di ~113px a
destra, «model» partiva a ~225px fuori schermo a sinistra. Misurato con coordinate esatte, non
indovinato; corretto ancorando tutti e tre allo stesso punto fisso vicino al fondo sotto la
soglia stretta, invece che al bottone che li apre.

Passo corrente: **da decidere**. Restano i divieti veri (`deny`), le due misure di quota mai
fatte, e sul filone telefono la durata della credenziale (§5) e la seconda misura di
sopravvivenza SSE a schermo spento (§5.4, ora fattibile sul trasporto giusto).

Cosa manca ancora: **regole di divieto** (il riquadro «Never» esiste disegnato e spento: senza
`deny` sarebbe una promessa non mantenibile); la **scelta dei suoni**; e una prova automatica
dell'instradamento.

Due cose non ancora misurate, e toccano la risorsa scarsa: **quanto costa in quota il
classificatore** di auto mode (§16.6 della specifica) e **quanto costa risvegliare una
conversazione lunga** (P16). Le sonde usano prompt minuscoli, quindi non dicono niente su un
trascritto vero: finché non c'è quella misura, lo Sleep non va presentato come indolore.

Decisioni già prese:
- canale strutturato JSON verso gli agent, NON un PTY (ADR-001)
- il canale lo implementa l'**Agent SDK ufficiale**, non codice nostro (ADR-009). Il vocabolario
  canonico, il journal e la UI restano nostri: l'SDK sostituisce il trasporto, non la traduzione.
- web app locale: daemon + UI nel browser, NON app nativa (ADR-002)
- un solo adapter nell'MVP: Claude Code (ADR-004)
- daemon persistente, con Sleep esplicito per sessione; TTL automatico rimandato (ADR-005)
- permessi: sessioni in `auto`, zero card di default; i toggle aggiungono attrito dove serve (ADR-008)
- Node + TypeScript, journal JSONL append-only per sessione (ADR-007)
- TypeScript **eseguito diretto**, non compilato: ciclo modifica→esegui da 1,8 s a 0,125 s e
  tracce di stack che puntano al sorgente vero. `tsc --noEmit` resta obbligatorio, perché lo
  stripping dei tipi non controlla nulla. Il sorgente resta compilabile
  (`rewriteRelativeImportExtensions`), quindi la scelta è reversibile con un comando.
  Il prerequisito Node è passato da ≥20 a ≥22.18: ADR-007 su Notion è già stato corretto.
- UI in **Vite + Svelte 5** (ADR-010). Il daemon resta senza build: le due metà divergono di
  proposito, perché la misura di ADR-007 era stata presa su `tsc` che emette `dist/` e su Node
  che riparte, condizioni che nel browser non esistono.
- la UI non tiene un modello proprio: tiene lo `SessionSnapshot` e ci applica sopra gli eventi
  con lo **stesso `applyTo`** del daemon. L'invariante del §4 non è una regola da rispettare, è
  l'unica cosa che sa fare. Corollario applicato più volte scrivendo la UI: quando un dato
  manca, si aggiunge **allo snapshot**, non a uno stato parallelo — è così che sono nati
  `startedAt`, il riassunto dei tool e la risposta data come parte del turno.
- avviare un lavoro e importarne uno dal terminale stanno nello **stesso riquadro, dietro due
  linguette**: una tendina sul `+` si apre solo se sai già che c'è qualcosa da scegliere, e la
  seconda porta va vista per essere usata.
- la riga dell'elenco dice **da quanto sta in quello stato**, non da quando ha scritto
  l'ultima riga: su un lavoro che procede coincidono, su uno piantato no — ed è il caso in cui
  si vuole saperlo. «Cosa sta facendo adesso» invece compare **solo sulle righe vive**: su una
  sessione senza processo dietro sarebbe falsa, perché il suo journal è rimasto aperto a metà.
- le notifiche si spengono e si accendono da **una campanella sola**, non per chat: il permesso
  del browser si può chiedere solo dentro un gesto, e il **suono non ne ha bisogno** — perciò
  un permesso negato non toglie il comando, lo spiega.
- i **server MCP si scelgono per chat**, spenti di default. Non con `--strict-mcp-config`, che
  li spegnerebbe e basta: si spengono per nome, così restano accendibili. È la differenza fra
  un default e un limite.
- le impostazioni vivono in **due posti diversi, di proposito**: sulla macchina ciò che cambia
  cosa fa l'agent (i permessi) e ciò che descrive un progetto (colore, silenzio); nel browser
  ciò che è del dispositivo (tema, suoni). Non è un dettaglio: «voglio i suoni su questo
  portatile» non è un fatto del progetto.
- il pannello dei permessi mostra **sei categorie, non nomi di tool**: la traduzione in `Bash` e
  `mcp__*` sta nell'adapter, che è l'unico a conoscerli (§1).
- i **comandi slash** si completano dalla casella, con argomenti e alias. Quelli legati al
  terminale restano in elenco con l'etichetta: il CLI li ha, e a dire che lì non funzionano è
  l'agent — non STARK a indovinarlo.
- il **token sta su disco** (`~/.stark/token`, `0600`) e la porta è fissa. Costo accettato: è
  un segreto a riposo, ma sta accanto ai journal, che contengono già tutto ciò che l'agent ha
  letto. In cambio l'indirizzo si può tenere aperto, che è il senso di un daemon che dura.
- dentro un gruppo l'elenco si ordina per **`since`**, non per ultimo evento: `lastTs` avanza a
  ogni token, quindi due chat che lavorano insieme si scavalcherebbero di continuo. `since`
  cambia solo quando cambia lo stato, e chi finisce per primo cambia gruppo con un `since`
  nuovo — quindi sale in cima al suo senza bisogno di un caso speciale.
- pannello terminale per sessione: **dopo** l'MVP

Ancora aperte: accesso (solo localhost o anche LAN con auth), uso da mobile, il nome STARK per il
branding (vincolo: "Claude Code" non è utilizzabile per il branding di un prodotto;
"STARK, Powered by Claude" sì).

## Versioni su cui stiamo costruendo (verificate il 23 agosto 2026)

Claude Code CLI **2.1.241** · `@anthropic-ai/claude-agent-sdk` **0.3.241** · Node 24.13.1.
Il patch dell'SDK insegue quello del CLI (0.3.**241** ↔ 2.1.**241**): vanno aggiornati insieme.
Per capire cosa una versione supporta **non si confrontano stringhe**: `system/init` porta un array
`capabilities` con i nomi dei comportamenti di protocollo, ed è documentato usare quello.

## STARK non deve mai poter meno del CLI

Lo scopo è **fare tutto quello che si fa da CLI, con una UI/UX migliore**. Ogni volta che si sta
per non esporre qualcosa "per sicurezza", la domanda giusta è: *il CLI lo consente?* Se sì, STARK
deve consentirlo. Se il CLI lo rifiuta, STARK mostra la voce **disabilitata con la spiegazione**,
mai nascosta.

Distinzione da tenere ferma: i controlli del daemon (token, `Origin`, `Host`) **non** limitano ciò
che l'utente può fare. Limitano *chi altro* può guidare l'agent. Il CLI non ne ha bisogno perché
non ha superficie di rete: ci si scrive dentro solo dalla tastiera. Una web app quella protezione
implicita la perde, e il token la restituisce.

## Come lavorare su questo progetto

Regole date dall'utente. Non sono preferenze di stile: ognuna nasce da una volta in cui ho
sbagliato, e la ragione conta quanto la regola.

### Se esiste qualcosa di ufficiale e già pronto, si preferisce sempre

Un SDK, una libreria, un protocollo documentato. Vale anche quando la versione fatta in casa
funziona già e adottare quella ufficiale costringe a rifare del lavoro. La ragione non è la
comodità: è **scalare e adattarsi aggiornandosi**, invece di riparare qualcosa che imita una
cosa che cambia. A dover essere motivato è il **non** usarlo.

*Da dove nasce:* l'adapter era stato scritto a mano quando esisteva l'Agent SDK ufficiale, in
TypeScript come noi. Vedi ADR-009.

### Non dedurre vincoli: verificarli, o chiedere

Prima di dire che qualcosa non si può fare, o di dedurre un limite da com'è messo l'ambiente,
va **verificato**. Se non è verificabile da soli, si **chiede all'utente se quel vincolo esiste
davvero** invece di darlo per buono.

Un'assenza osservata in una configurazione non è un'assenza in generale. Quando l'osservazione è
"questa cosa non c'è", il passo successivo non è prenderne atto ma chiedersi **perché** non c'è.

*Da dove nasce:* avevo registrato come un fatto che `AskUserQuestion`, `ExitPlanMode` e
`TodoWrite` "non esistono in headless", concludendone che una GUI sarebbe valsa sempre meno della
TUI. Era falso, e quella premessa aveva già iniziato a rimpicciolire il perimetro dell'MVP.
Stessa cosa con la versione di Node, che sembrava un vincolo e non lo era.

### Sulla UI: l'anteprima prima delle parole

L'impianto **è deciso** (vedi sotto), quindi non serve più fermarsi prima di toccarla. Resta però
il modo: quando si propone qualcosa di grafico, si **pubblica l'anteprima e si dà il collegamento
per primo**, poi si spiega. Mai il contrario.

Una descrizione a parole di una grafica costringe a immaginarla, e su un'immagine mentale non si
giudica niente. Guardandola prima, tutto ciò che viene scritto dopo è commento a qualcosa che
l'utente ha già visto, e può contraddire subito invece che a lettura finita.

Sorgente dell'anteprima: `docs/ui-anteprima.html`. Si ripubblica **sullo stesso indirizzo**
passandolo come `url`: https://claude.ai/code/artifact/ea5bfede-34b3-4fa7-b267-286409f964fb

### L'impianto della UI, in breve

Elenco compatto sempre a fianco — raggruppato per stato e, dentro, per progetto **sempre**.
Conversazione larga, turni richiudibili. Tutti i comandi in basso attorno alla casella di
scrittura, e **quello stesso blocco si espande** per permessi e domande, che quindi non compaiono
nel flusso. Sotto, una barra di stato. Gli effetti prendono il posto della conversazione, in due
letture: per file e in ordine di tempo.

Il dettaglio sta in `docs/ui-schermate.md`; il perché, e cosa è stato scartato, su Notion.

## Vincoli dell'ambiente da tenere presenti

- Si opera come **root**: `--dangerously-skip-permissions` e `--permission-mode
  bypassPermissions` sono rifiutati **dal CLI stesso**, non da una policy nostra
  ("cannot be used with root/sudo privileges"). Le altre cinque modalità funzionano.
  **Attenzione a non dedurne troppo**: `--permission-mode auto` è una modalità DIVERSA, non è un
  bypass, e da root funziona (verificato in headless). È il default di STARK per ADR-008.
  Con un modello che non supporta auto mode — Haiku non lo supporta — la sessione riparte in
  Manual e torna a chiedere tutto.
- `--tools ""` NON spegne i tool MCP. `--strict-mcp-config` sì, ma li rende anche
  **irraggiungibili**, e STARK non lo usa più: il default «nessun server» si ottiene spegnendoli
  per nome con `toggleMcpServer` dell'SDK, così restano accendibili per chat. Resta vero il
  motivo per cui sono spenti di default: ereditarli tutti significa ~5x di contesto per turno e
  una via d'uscita ai dati che nessuno ha chiesto.
  **Attenzione**: i connettori di claude.ai **non ci sono ancora** quando la sessione nasce,
  compaiono qualche secondo dopo. Spegnerli una volta sola all'avvio non basta — misurato: 71
  tool `mcp__` entrati in un turno che doveva averne zero. La riconciliazione gira prima di
  ogni turno.
- L'utente è su **abbonamento a quota fissa**: `total_cost_usd` è un valore nominale, NON una
  spesa reale. La risorsa scarsa è la quota (rate limit), non i dollari.
  Corollario per ADR-005: risvegliare una sessione dormiente rilegge tutto il contesto, quindi
  costa quota. Lo Sleep libera RAM, non quota.
- **Due macchine**, e i trascritti NON si sincronizzano fra loro (vedi il Punto della situazione).
  Node: **24.13.1** sul fisso (`/mnt/m/devs-development/stark/stark`), **22.23.2** sul portatile
  (`/root/DevsMachna/stark`, aggiornato il 24 agosto 2026). Il prerequisito di ADR-007 è ≥ 22.18:
  ora è soddisfatto su entrambe.
- **`CLAUDE_CONFIG_DIR` non vale uguale sulle due macchine**: sul fisso punta a
  `/root/.claude-digitizers`; sul portatile non è impostata e le sessioni stanno in `~/.claude`.
  Va propagata al processo figlio (opzione `env` dell'SDK), altrimenti quello guarda nella
  cartella sbagliata, non trova sessioni da riprendere e sembra rotto senza motivo apparente.
- **Sul fisso** il repo vive su un mount DrvFs (`/mnt/…`): `git status` segnala come modificati
  file il cui contenuto è identico a HEAD. È una limitazione dello stat cache di git su quel
  filesystem, non una modifica reale — verificare sempre con `git diff` prima di crederci.
  Sul portatile il repo sta su ext4 e il problema non si presenta.

## Sicurezza (requisito, non accorgimento)

STARK esegue comandi arbitrari **come root**. Quindi: ascolto su localhost per default,
autenticazione obbligatoria per qualunque esposizione oltre localhost, apertura sulla LAN
sempre come scelta esplicita dell'utente e mai come default.
