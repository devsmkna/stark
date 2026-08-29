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
  - ADR-004 — Un solo adapter nell'MVP (Claude Code) — SUPERATA da ADR-012
  - ADR-005 — Ciclo di vita delle sessioni (daemon persistente + Sleep)
  - ADR-006 — Modello dei permessi — SUPERATA da ADR-008
  - ADR-008 — Permessi basati su auto mode (default: zero card, toggle opzionali)
  - ADR-007 — Stack tecnologico e persistenza (Node + TS, journal JSONL)
  - ADR-009 — Agent SDK ufficiale invece del protocollo a mano (supera in parte ADR-001)
  - ADR-010 — Con cosa si scrive la UI (Vite + Svelte 5; il daemon resta senza build)
  - ADR-011 — Notifiche sul telefono via Web Push, e cosa esce dalla macchina
  - ADR-012 — Il secondo adapter: OpenCode come prova di carico (supera ADR-004)
  - ADR-013 — Come STARK parla a OpenCode: SDK ufficiale, non ACP
  - ADR-014 — La modalità dei permessi diventa «opzioni di sessione»
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

**Da lì in poi è successo molto altro**, e non sta più qui: notifiche e Web Push sul
telefono, fila FIFO dei prompt, pannellino della quota e del contesto, `/clear`, citazione
dei file con `@`, comandi slash, impostazioni, ricerca, pannelli affiancati, accesso da
fuori casa via Tailscale, il secondo adapter (OpenCode), l'installer per Linux/macOS/WSL e
Windows nativo, e un paio di centinaia di difetti trovati misurando.

Il racconto per esteso — con le misure, le ipotesi cadute e il perché di ogni scelta — sta
in **`docs/diario.md`**. Ci stava qui, ed era il **91%** di questo file: 79.319 token
misurati, il 76% di tutto ciò che viene caricato prima che qualcuno scriva una parola. Un
compito qualunque, di quelle 169 voci, ne usa zero o una — quindi si consulta, non si porta
appresso:

```
grep -n "sticky" docs/diario.md        # com'era stato risolto quel caso
grep -n "27 agosto" docs/diario.md     # cosa è successo quel giorno
```

Vale anche `git log`: i messaggi di commit di questo repo sono scritti lunghi apposta, e
sono la stessa storia agganciata alle righe che l'hanno prodotta.

**Come si rilascia** (dal 28 agosto 2026): un push su `main` non arriva a nessuno. Ad
arrivare sono le **release**, cioè un tag `vX.Y.Z` più la stessa versione in
`package.json` — `npm version <x>` poi `git push --follow-tags`. Chi ha STARK installato
se lo vede dire da una banda in cima alla UI, col bottone che aggiorna. Il processo e il
perché delle regole stanno in **`docs/rilascio.md`**.

### Le trappole che si ripagano da sole

Il sedimento di quel diario: dieci righe che servono **prima** di sbagliare, non dopo.
Ognuna è costata almeno un giro di lavoro buttato.

- **I tipi non sono i fatti.** La fonte di verità è l'**handshake**, non il `.d.ts`.
  L'hook `PermissionDenied` è dichiarato e non scatta mai; `TodoWrite` è nei tipi e non
  nella lista runtime; `session.wait` di OpenCode è nei tipi e il server dice «not
  available yet». Vale anche per il filo: lo spec di OpenCode dichiara `properties`, il
  filo manda `data`.
- **Una prova che guarda il posto sbagliato non fallisce: mente**, o resta verde per
  sempre. `blocks` invece di `parts`, `pending` invece di `pendingPermissions`, uno
  `strace` mai agganciato che stampa zero, un `echo` pre-approvato che «dimostra» che il
  meccanismo non scatta. Leggere il nome vero costa dieci secondi; indovinarlo costa un giro.
- **I difetti di layout si misurano nel browser vero.** Rettangoli veri e
  `elementFromPoint`, non ragionamenti sul CSS: più di una volta il colpevole «ovvio» era
  innocente, e più di una volta un bug inesistente stava per essere «corretto».
- **I default dell'SDK non sono i default del CLI.** Un'opzione non passata non compare in
  nessuna diff: `systemPrompt` omesso non lascia fare al CLI, lo azzera. Quando conta la
  parità col terminale, si misura.
- **Una prova automatica non ha il permesso di farsi notare** da chi non l'ha lanciata:
  niente finestre, niente Explorer, niente notifiche addosso a chi sta facendo altro.
- **Un file dell'utente non si riscrive**: si tocca solo il proprio blocco fra delimitatori,
  e un contenuto illeggibile si rifiuta invece di sovrascriverlo (`memoria.ts`, `regole.ts`,
  l'installer col `.bashrc`).
- **L'append-only del journal è una cosa da usare, non solo da rispettare**: chi rilegge un
  file che cresce in coda deve leggere la coda (l'elenco è passato da 619 ms a 0,13).
- **Su Windows un figlio eredita la console del padre**, e se il padre non ne ha una il
  sistema gliene alloca una nuova **con la finestra**. Chi lancia un processo passa da
  `core/platform.ts`; una verifica statica in `npm run check` lo tiene fermo.
- **Lo `zoom` sul root non tocca le coordinate del puntatore.** `clientX` è in pixel veri,
  un `left` scritto su un figlio del root no: va diviso (`ui/src/lib/zoom.ts`).
- **Quando una cosa «non c'è», la domanda dopo è perché non c'è** — non prenderne atto.
  Metà delle assenze registrate come vincoli erano configurazioni, non fatti.
- **`detached` non fa uscire dal cgroup di systemd.** Stacca dal terminale (`setsid`), ma
  un figlio eredita il cgroup: quando l'unità del padre si ferma, systemd uccide tutto
  ciò che c'è dentro. Chi deve sopravvivere al proprio padre parte con `systemd-run`.
- **`npm install` sporca l'albero a ogni esecuzione** (`package-lock.json` e `yarn.lock`),
  e `git checkout` su un albero sporco **non rifiuta**: si porta dietro la modifica in
  silenzio. Chi si fida di git per difendere il lavoro di qualcuno non lo sta difendendo.

Restano i divieti veri (`deny`), e sul filone telefono la durata della credenziale (§5) e la
seconda misura di sopravvivenza SSE a schermo spento (§5.4, ora fattibile sul trasporto
giusto).

Sul filone «cosa manca all'MVP», dopo il giro del 27 agosto restano tre cose, in
quest'ordine di valore: il **lavoro dentro un sub-agent** (oggi se ne vede l'incarico e il
resoconto, non i passi — `parent_tool_use_id` esiste ma il traduttore non lo guarda, ed è una
schermata da disegnare prima che da scrivere, §16.9); la **memoria** della cache dell'elenco
(uno snapshot per conversazione tenuto in vita: la rilettura non si paga più, l'occupazione
sì, ed è l'altra metà della domanda sulla rotazione del journal); e la **ricerca dentro la
conversazione aperta**, che oggi passa dalla stessa casella dell'elenco e quindi risponde
«quale chat», non «dove in questa».

Cosa manca ancora: **regole di divieto** (il riquadro «Never» esiste disegnato e spento: senza
`deny` sarebbe una promessa non mantenibile); la **scelta dei suoni**; e una prova automatica
dell'instradamento.

**Da correggere — «Chat about this» allarga la discussione a tutte le domande** (segnalato
dall'utente il 28 agosto 2026). Una richiesta di `AskUserQuestion` ne porta da 1 a 4, e la voce
serve a dire «su *questa* non ho abbastanza per scegliere»: le altre risposte passano com'erano.
Nei fatti l'agent torna con un approfondimento su **tutte**, comprese quelle a cui si era già
risposto. Quello che parte oggi è `DISCUSS` in `ui/src/components/Ask.svelte:85` — una frase
fissa («walk me through the options…») che **non nomina la domanda** e finisce in `answers`
sotto la sua chiave. Il sospetto, da verificare e non da dare per buono, è che quella chiave
non basti: la frase letta da sola non dice a cosa si riferisce, e l'agent ricomincia da capo.
La cura probabile è citare la domanda dentro il testo che parte, invece di affidarsi alla
posizione nella mappa. Va **misurato dal vivo** su una richiesta con tre domande, di cui una
sola marcata «parliamone»: è l'unico modo di distinguere «la chiave si perde» da «l'agent la
legge e decide comunque di riaprire tutto», che sono due difetti diversi con due cure diverse.
Nota che il commento accanto al codice promette già il comportamento giusto («vale **solo per
quella** — le altre restano risposte»): è una promessa scritta, non una verificata.

~~Due cose non ancora misurate~~ — **fatte** il 27 agosto: vedi «Le due misure mai fatte»
più sopra. Il classificatore resta sotto la risoluzione della misura; il risveglio arriva
come `cache_read` e regge almeno 420 secondi di pausa.

Decisioni già prese:
- **il system prompt si chiede per nome**: `systemPrompt: { type: 'preset', preset: 'claude_code' }`
  in `buildOptions`. Non passarlo non lascia fare al CLI, lo sostituisce con una stringa vuota —
  e un agent istruito meno del terminale è il rovescio del Principio 5. Corollario generale, che
  vale oltre questo campo: **i default dell'SDK non sono i default del CLI**, e quelli che
  divergono si trovano solo misurando, perché un'opzione non passata non compare in nessuna diff.
- canale strutturato JSON verso gli agent, NON un PTY (ADR-001)
- il canale lo implementa l'**Agent SDK ufficiale**, non codice nostro (ADR-009). Il vocabolario
  canonico, il journal e la UI restano nostri: l'SDK sostituisce il trasporto, non la traduzione.
- web app locale: daemon + UI nel browser, NON app nativa (ADR-002)
- ~~un solo adapter nell'MVP: Claude Code (ADR-004)~~ — **superata da ADR-012**: il secondo
  adapter (OpenCode) è scritto, gira, e il contratto del §1 ha retto senza modifiche.
- daemon persistente, con Sleep esplicito per sessione; TTL automatico rimandato (ADR-005)
- permessi: sessioni in `auto`, zero card di default; i toggle aggiungono attrito dove serve (ADR-008)
- Node + TypeScript, journal JSONL append-only per sessione (ADR-007)
- TypeScript **eseguito diretto**, non compilato: ciclo modifica→esegui da 1,8 s a 0,125 s e
  tracce di stack che puntano al sorgente vero. `tsc --noEmit` resta obbligatorio, perché lo
  stripping dei tipi non controlla nulla. Il sorgente resta compilabile
  (`rewriteRelativeImportExtensions`), quindi la scelta è reversibile con un comando.
  Il prerequisito Node è passato da ≥20 a ≥22.18: ADR-007 su Notion è già stato corretto.
- le **notifiche sul telefono** passano dal Web Push mandato dal daemon (ADR-011): spente
  finché non le accendi, e il costo detto dove si accendono — è l'unica cosa di STARK che
  esce dalla macchina, perché su iOS non esiste un altro modo di avvisare a schermo spento.
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
  seconda porta va vista per essere usata. Le linguette restano **due**: aprire un id scritto
  a mano ha avuto per un giorno una terza scheda sua, ed era una scheda di troppo — adesso si
  incolla l'id nella **ricerca** di «Import», che è dove uno cerca una conversazione. La
  capacità non si è persa, ed era il punto: l'elenco mostra i **60 trascritti più recenti**
  (il limite di `listSessions` dell'SDK), mentre `claude -r <id>` apre qualunque id, quindi
  senza quella strada STARK saprebbe fare **meno del CLI** su un id di due mesi fa.
- ogni riga di «Import» porta il **session-id accorciato a otto cifre**, come un hash di git:
  è il manico con cui la si riprende dal terminale, e vederlo rende naturale cercarlo. Intero
  nel `title`, perché trentasei caratteri di uuid spingerebbero fuori il nome.
- ~~la riga dell'elenco dice **da quanto sta in quello stato**~~ — **rovesciata il 26 agosto
  2026 su richiesta dell'utente**: «da quanto» non si mostra più. La premessa era che
  distinguesse un lavoro che procede da uno piantato; a dirlo però è già **«cosa sta facendo
  adesso»**, che sulle righe vive c'è, e per una chat ferma il «da quanto» è un numero che
  cambia ogni secondo senza che nessuno lo guardi. `since` **resta** nel modello e continua a
  **ordinare** dentro il gruppo (vedi la voce qui sotto): a sparire è solo il fatto che si
  vedesse. Dettaglio non ovvio del costo: la stringa la faceva avanzare un `setInterval` da un
  secondo con `now` in `$state`, quindi ogni tick invalidava **tutte** le righe dell'elenco.
  Tolta la riga, l'orologio non serve più a nessuno ed è andato via con lei — l'elenco si
  ridisegna solo quando cambia qualcosa davvero.
- «Cosa sta facendo adesso» compare **solo sulle righe vive**: su una sessione senza processo
  dietro sarebbe falsa, perché il suo journal è rimasto aperto a metà.
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
- le **descrizioni dei comandi** sono un'impostazione (Agent → «Command descriptions»,
  accesa di default) che **non vive in STARK**: scrive una regola nel `CLAUDE.md` globale
  dell'agent, perché quel campo lo scrive il modello e non esiste un'opzione dell'SDK. Vale
  quindi anche nel terminale, e il pannello lo dice invece di lasciarlo scoprire.
- i **file si citano con `@`** dalla stessa casella, e la ricerca è quella del CLI
  (`file_suggestions`), non una nostra: il filtro lo fa lui, noi mostriamo. `@` viene
  **espanso dal CLI**, quindi citare un file è più economico che farglielo aprire.
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
- **si cerca dagli snapshot, non dai file**: la ricerca trova ciò che la UI mostra, e su una
  macchina accesa non rilegge niente. Cercare nelle righe del journal sembrerebbe più diretto ed
  è sbagliato: una risposta arrivata in trecento `text.delta` non è scritta intera da nessuna
  parte. Niente espressioni regolari — una casella in cui `(` fa esplodere tutto è peggio di una
  che trova meno.
- **un lavoro che continua da solo sta sulla riga che lo ha lanciato**, non su una riga nuova:
  un comando in background non è un secondo fatto, è ciò che si scopre dopo su un fatto già
  mostrato. E il suo esito **vince** sull'esito della chiamata, che torna positivo un istante
  dopo il lancio e direbbe «fatto» su un lavoro in corso.
- **il piano è un documento, non un permesso**: si approva leggendolo, non riconoscendone il
  soggetto. Ha i suoi eventi canonici e il suo riquadro, per la stessa ragione per cui le
  domande non sono permessi. E `mode` viaggia **con** l'approvazione: nel terminale approvare
  vuol dire anche scegliere come proseguire.
- **la modalità dei permessi la dichiara il CLI**, non solo STARK: `EnterPlanMode` è un tool
  dell'agent, e approvare un piano la cambia dall'altra parte. Leggerla solo quando la
  imponiamo noi vuol dire mostrarne una falsa per il resto della conversazione.
- **l'append-only del journal è una cosa da usare, non solo da rispettare**: chi rilegge un
  file che cresce in coda deve leggere la coda. Vale per l'elenco (da 619 ms a 0,13) e vale
  per chiunque altro dovrà rileggere un journal a ripetizione.
- le chat si **affiancano** in pannelli ridimensionabili, aperti trascinando una riga
  dell'elenco sul bordo (divide) o sul centro (sostituisce) di un pannello. Un clic
  semplice continua a **sostituire** la chat a fuoco: aggiungere un riquadro è un gesto
  che si fa apposta. Una chat sta in un pannello solo — trascinarne una già aperta la
  sposta. Il layout sta nel browser, non sul daemon: è del dispositivo. Sotto gli 860px
  è ignorato, non rimpicciolito, e resta salvato per quando lo schermo torna largo.
- il **perimetro si allarga dichiarandolo** (`STARK_PUBLIC_HOST`), non facendo mentire un
  proxy su `Host` e `Origin`: quella strada sposterebbe il perimetro in un file di
  configurazione dove nessuno lo cerca e dove si rompe in silenzio. È una variabile
  d'ambiente e non un'impostazione perché `settings.json` si scrive via `PUT
  /api/settings`, e il perimetro non deve essere modificabile dalla superficie che
  protegge.
- il trasporto per l'accesso da fuori è un **VPS proprio** con Traefik, non un tunnel
  Cloudflare: Cloudflare termina il TLS, quindi vedrebbe tutto in chiaro **e** potrebbe
  scrivere verso un processo root. Costo accettato in cambio: il VPS entra nella TCB.
  (Cloudflare Tunnel sarebbe gratis — Zero Trust è libero fino a 50 utenti — quindi la
  scelta non è economica.)
- **dentro un turno, il lavoro sta in un blocco solo**: operazioni e narrazioni di servizio
  insieme, chiuso anche mentre l'agent lavora. Restano fuori le tre volte in cui l'agent si
  rivolge all'utente — il recap finale, la domanda/permesso con la sua risposta, e il testo
  che introduce la domanda — più i tagli del flusso (compattazione, retry) e l'operazione in
  corso. Il confine è **la posizione, non la lunghezza**: misurato, un testo di servizio ha
  mediana 131 caratteri e uno rivolto all'utente 2500 e passa, ma una soglia sarebbe da
  tarare e la posizione no.
- **cosa si puo' allegare a un prompt lo dichiara il modello**, non STARK
  (`ModelChoice.accepts`): dove l'agent ha un parametro lo si legge (OpenCode:
  `capabilities.input`), dove non ce l'ha (Claude Code: `list_models` non dice niente) lo
  scrive l'adapter, misurando cosa il CLI lascia davvero passare. Un modello che non legge
  allegati spegne la graffetta **con la ragione scritta**, mai nascondendola; un tipo
  rifiutato lo dice invece di sparire. Il filtro per tipo e' un'offerta, non una difesa:
  quella resta la tabella del registro, che scrive solo cio' che sa nominare.
- **si installa per utente, senza `sudo`**, e la ragione non è l'attrito: `sudo`
  servirebbe solo a *scrivere* il lanciatore, che non ha il bit setuid — quindi non
  darebbe all'agent nessun permesso in più. A decidere cosa l'agent può fare è **chi
  digita `stark`**, esattamente come chi digita `claude`. Installare di sistema
  inviterebbe a lanciarlo da root, che non è lo stesso STARK con più poteri ma **un
  altro STARK**: `~/.claude` e `~/.stark` seguono l'utente.
- **niente avvio automatico al boot**, per scelta: il daemon tiene in piedi processi di
  agent, e uno che riparte da solo è uno che lavora senza che nessuno gliel'abbia
  chiesto. Restare acceso alla chiusura del terminale sì (unità transiente di systemd,
  `DETACHED_PROCESS` su Windows); sopravvivere allo spegnimento no.
- **l'installer non tocca il Node di sistema**: se quello che c'è è troppo vecchio se ne
  scarica uno ufficiale dentro la cartella di STARK, e ci punta solo il lanciatore con
  percorso assoluto. Corollario imparato sbagliando: allora **anche `npm` va pinnato**,
  con la sua cartella in testa al `PATH` del figlio — se no npm risale al Node del
  `PATH`, che è il Node che si era appena deciso di non usare.
- pannello terminale per sessione: **dopo** l'MVP

Ancora aperte: il nome STARK per il branding (vincolo: "Claude Code" non è utilizzabile per il
branding di un prodotto; "STARK, Powered by Claude" sì) e la distribuzione (strumento personale
o cosa che altri installano).
~~Accesso~~ e ~~uso da mobile~~ non sono più domande: il perimetro si allarga dichiarandolo
(§Sicurezza) e il telefono è un client intero, PWA e Web Push compresi. **Nessuna delle due è
però un ADR su Notion**, e ADR-003 dice che è lì che devono stare: finché non ci sono, la
premessa su cui sono state prese non è rileggibile da nessuna parte.

## Versioni su cui stiamo costruendo (rimisurate il 27 agosto 2026)

`@anthropic-ai/claude-agent-sdk` **0.3.241** · `@opencode-ai/sdk` **1.17.20** ↔ `opencode`
**1.17.20** · Node 24.13.1.
**«Claude Code 2.1.241» va detto con più precisione di così**: sulla macchina il `claude` nel
`PATH` è ormai **2.1.247**, ma STARK non usa quello — usa l'eseguibile che l'SDK porta con sé,
appaiato alla propria versione, cioè **2.1.241** (`pathToClaudeCodeExecutable` resta al bundled
se nessuno passa `executable`, `src/adapters/claude-code/sdk-options.ts`). Le due cose possono
divergere e divergono: ADR-009 lo aveva previsto, ed è successo in quattro giorni. Quando una
misura qui sotto dice «verificato su 2.1.241» parla del bundled; le sonde in `spike/` girano
sulla stessa coppia dell'SDK.
Il patch dell'SDK insegue quello del CLI bundled (0.3.**241** ↔ 2.1.**241**): vanno aggiornati
insieme.
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

### Ogni chat lavora nel suo git worktree

**Da qui in avanti una conversazione non lavora mai direttamente sul checkout principale**:
apre un worktree suo (`EnterWorktree`, che li mette in `.claude/worktrees/`), ci fa il
lavoro, committa lì, e solo alla fine si porta il ramo su `main`. Due chat aperte insieme
sono due processi che scrivono gli stessi file e chiamano lo stesso `git`: senza worktree
non c'è niente che le tenga separate.

*Da dove nasce:* il 28 agosto 2026, in una giornata sola, tre volte.
Una sessione ha messo da parte con `git stash` il lavoro non committato di un'altra
(«WIP non mio»), lasciando in `main` una voce di `CLAUDE.md` che **descriveva un fix il cui
codice non c'era più** — documentazione che mente, e nessuno se ne accorge finché non
riprova il bug. Poi lo stesso stash non si riapplicava più pulito, perché nel frattempo il
file era cambiato sotto. E infine un fix su `platform.ts` e `git.ts` è finito dentro il
commit di un'altra sessione, che parlava di tutt'altro: la history dice una cosa e il
contenuto un'altra, quindi né `git log -- <file>` né una `revert` sanno più separarli.
Nessuno dei tre è un errore di git: sono due scrittori su un albero solo.

Tre cose da sapere prima di usarli, verificate qui e non dedotte:

- `node_modules/` e `ui/dist/` sono **in `.gitignore`**, quindi un worktree nuovo non ne ha
  nessuno dei due: prima di far girare qualcosa servono `npm install` e `npm run ui:build`
  lì dentro.
- il lanciatore `stark` pinna il **percorso assoluto del checkout principale**, quindi il
  daemon acceso serve sempre quello: una modifica alla UI fatta in un worktree non si vede
  in STARK finché non è unita. Per guardarla prima, si accende un daemon di prova dal
  worktree (`STARK_HOME` in `/tmp`, porta effimera), come già fanno le sonde.
- il worktree isola **il codice, non il resto**: `~/.stark` — journal, token, impostazioni —
  e `~/.claude` restano condivisi. Le conversazioni non si separano, e non devono.
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
  Corollario per ADR-005, **corretto il 27 agosto dopo averlo misurato invece di dedurlo**: il
  risveglio rilegge sì tutto il contesto, ma quel contesto arriva come `cache_read`, non come
  input nuovo (`input 2` contro `cache-r 20.564` su una conversazione da 20k token), e regge
  almeno 420 secondi di pausa. Lo Sleep libera RAM; quota ne costa solo oltre la TTL della
  cache, che non è stata misurata. Ed è una premessa **di Claude Code, non del dominio**: su
  OpenCode il server è già in piedi e non c'è nessun contesto da rileggere.
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

**Il perimetro si allarga dichiarandolo** (27 agosto 2026). Prima l'unico modo di far
passare un hostname non-locale era che `tailscale status --json` lo dicesse: chi non usa
Tailscale non aveva una strada. Ora c'è `STARK_PUBLIC_HOST`, che **somma** a Tailscale
invece di sostituirlo. È una variabile d'ambiente e non un'impostazione per una ragione
che decide da sola: `settings.json` si scrive via `PUT /api/settings`, cioè da una
richiesta HTTP — e il perimetro non deve essere modificabile dalla superficie che
protegge. L'alternativa scartata era far **mentire il proxy** (riscrivere `Host:
127.0.0.1`, cancellare `Origin`): sposta il perimetro in un file di configurazione dove
nessuno lo cerca, rende `/api/system` incapace di dire la verità, e si rompe in silenzio
la prima volta che qualcuno tocca quel file.
Quello che **non** si tocca, e il codice dice perché: `isLocal()` sull'indirizzo socket
(ogni tunnel serio si ricollega dal loopback, e resta l'unica rete se l'ascolto finisse
su `0.0.0.0`); `server.listen(port, '127.0.0.1')`; e `X-Forwarded-Proto`/`Forwarded`/
`X-Forwarded-For`, che li scrive il client — dedurne `https` renderebbe la difesa
sull'`Origin` teatro. Il confronto degli host è per **uguaglianza**, mai per suffisso:
c'è una verifica apposta, perché `stark.dominio.it.attaccante.com` è il bug canonico di
una lista di nomi. Niente wildcard, e le voci scartate si **stampano** all'avvio.
Il costo si dice in quattro posti: log d'avvio, `/api/system` (che prima rispondeva
`localhost only` come stringa fissa, cioè **mentiva già** con Tailscale acceso), Settings
→ System, e `stark status`. Non è un interruttore nella UI: si accende sulla macchina e
ha effetto al riavvio, perché il perimetro si legge una volta sola.
Ricaduta corretta nello stesso giro: `soggetto()` in `push.ts` chiamava
`detectTailnetHost()` per conto proprio — secondo `execFileSync` all'avvio e due verità
che potevano differire. Ora il perimetro glielo passa il guard, ed è stato **visto
fallire prima di essere corretto**: con `publicHosts` passata per parametro, il push
stampava «nessun hostname pubblico» mentre il perimetro ne aveva uno.
Come si mette in piedi la macchina attorno (tunnel `ssh -R`, Traefik, mTLS, e le tre
trappole che costano di più): `docs/fuori-casa.md`. Come si verifica che il tunnel non
strozzi il flusso: `npm run tunnel`, a costo zero di quota — misura **quando** arrivano
i pezzi, non quanti, perché un proxy che bufferizza li consegna tutti, solo tutti
insieme alla fine.
