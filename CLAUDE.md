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
  - ADR-011 — Notifiche sul telefono via Web Push, e cosa esce dalla macchina
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
Provato dal vivo, notifica compresa. (Il «da quanto» è stato **tolto** il 26 agosto su richiesta
dell'utente — vedi più sotto: resta il «cosa sta facendo».)

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

**E si accende scrivendo `stark`** (26 agosto 2026, chiesto dall'utente: «non voglio runnare
il comando ogni volta»). `npm run stark:install` mette in `/usr/local/bin` un lanciatore di
tre righe — due percorsi assoluti, il codice resta quello del repo, quindi `git pull` lo
aggiorna da sé. Il verbo nuovo è **`up`**, e la ragione per cui non è `start` è che sono due
domande diverse: `start` vuol dire «accendi il daemon» e si arrabbia se ne trova già uno; `up`
vuol dire «voglio usare STARK adesso», quindi è **idempotente** — daemon già acceso non è un
errore, è la condizione normale. Compila anche la UI se `ui/dist` manca (succede dopo un clone
o un pull: è artefatto locale, non sta in git), perché altrimenti il browser si aprirebbe su un
503 che dice «esegui npm run ui:build» — cioè su un comando da digitare, che è esattamente la
cosa che `up` esiste per togliere di mezzo. `--no-open` accende senza browser, per chi entra da
SSH. Il rilevamento WSL, che era la stessa costante copiata in `launch.ts` e `reveal.ts`, alla
terza copia è finito in `core/platform.ts`: lì c'è il **come** si apre una cosa, mentre la
whitelist degli schemi resta in `launch.ts`, perché quella difende una rotta HTTP.

**Le chat fantasma non nascono più** (26 agosto 2026, segnalate dall'utente: «ogni tanto trovo
una chat no-folder stopped e una stark-demon-check»). Erano due, con **due cause diverse**, e
la seconda non riguardava solo le prove. La prima: `npm run daemon` girava sulla `STARK_HOME`
vera, quindi ogni esecuzione lasciava la sua sessione-sandbox (`/tmp/stark-daemon-check`) in
mezzo alle conversazioni dell'utente — adesso la prova ha una casa sua in `/tmp`. L'ordine
degli import lì è **obbligatorio e non stilistico**: `registry.ts` risolve `STARK_HOME` una
volta sola al load del modulo, e un `import` statico verrebbe issato in cima al file, cioè
eseguito prima dell'assegnazione — per questo `startDaemon` si importa dinamicamente.
La seconda, «no folder / stopped», era un **bug del daemon**, non delle prove: `open()` creava
il journal *prima* di far partire il processo, e un'apertura fallita lo lasciava lì. Senza
`session.created` — l'unico evento che porta il `cwd` — restava un file di tre righe che
l'elenco mostrava come chat senza cartella (`ui/src/lib/view.ts:54`). Capitava quindi anche
**aprendo dalla UI**, con una cartella cancellata nel frattempo o un `configDir` sbagliato.
Corretto su due livelli: una `cwd` che non esiste è respinta con **400 al confine**
(`server.ts`), prima di aprire qualunque cosa; e se un'apertura fallisce lo stesso per altri
motivi, il journal mai nato viene rimosso, col motivo scritto in `daemon.log` prima di
toglierlo. La guardia è `startFrom === 0 && !snapshot.cwd`, e la prima metà non è ridondante:
su un **risveglio** fallito l'id è quello della conversazione vera e il file contiene tutta la
sua storia — cancellarlo distruggerebbe ciò che si stava cercando di riaprire.
**La casella restava alta quanto il prompt appena mandato** (26 agosto 2026, segnalato con uno
screenshot: «perché è gigante?»). Dopo un invio la casella vuota restava alta fino a 160px —
cinque volte i 34 di una riga — e ci restava finché non si ridigitava qualcosa.
Non era l'auto-resize classico senza reset: il reset a `'auto'` c'era ed era giusto. Era il
**momento**. `text` è `$state` legato con `bind:value`, e Svelte 5 non scrive nel DOM in modo
sincrono: al ritorno da `text = ''` la textarea contiene ancora il testo di prima, quindi
`grow()` misurava il prompt appena inviato e ne fissava l'altezza in `style.height`. Subito dopo
Svelte svuotava il valore, ma l'altezza inline restava, senza più nessuno a rimisurarla. Fix:
`regrow()`, che aspetta `tick()` prima di misurare. Il difetto era in tutti e tre i punti che
assegnano `text` — svuotare, ripristinare dopo un rifiuto, completare uno slash — e si vedeva
solo nel primo perché è l'unico in cui l'altezza sbagliata è *più grande* di quella giusta.
Verificato **A/B nel browser vero**, non a occhio: stessa prova prima e dopo, 34px → 112px col
testo → **112px da vuota** (bug) contro **34px** (corretto).
Nello stesso giro è caduta un'ipotesi che sembrava ottima e non lo era: che lo `zoom` sul root
falsasse `matchMedia`, creando un anello per cui una volta entrati sotto gli 860px non si
tornava più indietro. Misurato con Playwright: `zoom` **riduce** il layout (viewport da 1000 a
741px effettivi) ma **non tocca** `matchMedia`, che resta `false`. La verifica registrata qui
sopra il 26 agosto era quindi corretta, e il latch non esiste. Vale la pena tenerne memoria
perché era un'ipotesi *coerente con tutti i sintomi* e sbagliata: senza la misura si sarebbe
«corretto» un bug inesistente, spostando una soglia che funziona.

**E `npm run daemon` apriva Esplora Risorse addosso all'utente** (26 agosto 2026, segnalato:
«ogni tanto mi si apre la directory del progetto con package.json evidenziato»). Non era «ogni
tanto» in modo misterioso, ed era la stessa malattia delle chat fantasma in un altro vestito:
la verifica «un file vero del repo si rivela sul serio» faceva `POST /api/reveal` su
`resolve('package.json')` e **riusciva**, cioè apriva una finestra vera — compreso quando a
lanciare la suite era un agent dentro STARK mentre l'utente stava facendo altro sullo stesso
desktop. Il commento lo dichiarava come pregio («prova che il comando gira davvero sulla
macchina»), e il pregio è reale: è il costo a non essere stato considerato.
La regola che ne esce — **una prova automatica non ha il permesso di farsi notare da chi non
l'ha lanciata** — nel file c'era già scritta a mano, ma solo per F1: «il lancio vero non è
automatizzabile senza far comparire Notion sullo schermo di chi esegue `npm run daemon`». F3
la violava. Ora la verifica è dietro `npm run daemon -- --reveal`, e di default è **spenta con
la spiegazione stampata a schermo**, non nascosta — come le voci non ancora fatte nelle
impostazioni. Senza il flag: **25** verifiche.

Nello stesso giro, una prova che mentiva: «una cartella inesistente non apre una sessione» era
**falsa** e verde da sempre — la sessione si apriva eccome (journal creato, processo lanciato),
solo la risposta HTTP era un errore, ed era l'unica cosa che guardava. Il messaggio che
l'utente vedeva veniva dall'SDK e incolpava la **libc** («musl contro glibc»), una pista
completamente sbagliata per chi ha solo sbagliato un percorso. `npm run daemon` fa **25**
verifiche (26 con `--reveal`): le due nuove controllano che il motivo dica qual è il problema
e che non resti niente nell'elenco.

Come si esegue: `README.md`. Node **≥ 22.18** (i `.ts` del daemon girano diretti, senza build;
la UI invece si compila, vedi ADR-010). `npm run check` prova tutta la catena a costo zero di
quota — 71 verifiche; `npm run ui:build` poi `npm run stark` aprono STARK nel browser;
`npm run slice` apre una sessione vera; `npm run tunnel -- https://…` misura se un
tunnel strozza il flusso.

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
riconosce scorrendo la conversazione senza doverlo leggere, chiuso o aperto.
**Corretta il 26 agosto in serata, sempre su richiesta dell'utente: il blu è ora del solo turno
in corso** (`.turn.active>.th`), gli altri tornano ai due valori che avevano prima —
`--surface-2` da chiusi, `--surface` da aperti. La premessa di allora («ogni turno si riconosce
scorrendo») valeva su una conversazione corta; su una da quaranta turni si rovescia, perché un
colore che c'è su tutte le righe non distingue più niente — è lo sfondo della pagina — e nel
frattempo copriva l'unica riga che vale la pena trovare a colpo d'occhio, cioè quella su cui
l'agent sta lavorando adesso. Attenzione all'**ordine**: `.turn.active>.th` e `.turn.open>.th`
hanno la stessa specificità (tre classi) e il turno in corso è quasi sempre anche aperto, quindi
la riga del blu deve stare dopo o non si vede mai. Il blocco «You answered» resta blu: compare di
rado, e lì il colore continua a voler dire «qui parli tu» invece di competere con quaranta righe.
**Il colore però è
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
**Anche il fisso è sulla tailnet** (26 agosto 2026): `deus-stark.tailaa7e75.ts.net`, accanto a
`stark-portatile` e `iphone-11`. Tailscale va installato **dentro WSL**, non su Windows:
`security.ts` invoca `tailscale` dal `PATH` di Linux e **non esiste un override via variabile
d'ambiente**, quindi un'installazione solo-Windows lascerebbe il perimetro cieco. Il dubbio su
WSL2 (serve `/dev/net/tun`, o la modalità userspace) è stato **verificato, non dedotto**:
`tailscaled` parte come servizio systemd normale — `/etc/wsl.conf` ha già `systemd=true` — e
configura il router in modalità kernel.
Il passo che si dimentica è il **riavvio del daemon dopo l'installazione**:
`detectTailnetHost()` gira **una volta sola**, alla costruzione del guard all'avvio. Installare
Tailscale a daemon acceso lascia il perimetro con `tailnetHost = null`, e il telefono si becca
un `403` che sembra un problema di token. Misurato prima di riavviare, per non dedurlo: stessa
richiesta, stesso token, `Host: deus-stark…` → **403**, `Host: 127.0.0.1` → **200**.
Lato telefono **non si configura niente**: la UI non è una PWA, non ha service worker né push
(quelli stanno solo in `tools/sonda-telefono/`, che è un server a parte). È una scheda del
browser su un URL, quindi cambiare macchina è cambiare segnalibro — e i due indirizzi
convivono, perché i journal delle due macchine non si sincronizzano comunque.

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

**La barra di stato da telefono si è sfoltita ancora** (26 agosto 2026, chiesto dal vivo mentre
l'utente era già collegato dal telefono via Tailscale: «voglio solo: modalità, mcp, modello e
contesto — solo la percentuale»). Delle cinque voci di prima (§ rifiniture del 26 agosto), sotto
gli 860px sparisce anche il percorso: `.status .cwd` (separatore, icona cartella, percorso —
raggruppati in `Status.svelte` in un solo figlio flex apposta per poterli nascondere con una
regola sola) va a `display:none` sotto soglia. Resta leggibile il **nome** del progetto,
nell'intestazione della conversazione sopra — a sparire è solo il percorso per esteso, non
l'informazione di dove si è. La percentuale di contesto era già l'unica cosa mostrata di
default (il conteggio a token compare solo nel pannellino al tocco): non c'era altro da
togliere lì. Verificato dal vivo, non a occhio: screenshot Playwright a 390×844 sulla sessione
reale, con lettura del DOM (`.cwd` → `display:none`) oltre che dell'immagine — due righe,
`auto` `MCP 1` sopra, `claude-sonnet-5` `18% context` sotto.
**E poi le due righe sono diventate una** (26 agosto 2026, subito dopo, sempre da telefono):
resta `⚡ · MCP 1 · opus[1m] · 27%`. Andare a capo era la scelta giusta finché le voci
restavano intere, ma spendeva una riga di schermo per informazione che si poteva **togliere**
invece che impilare — quindi via anche le etichette che ripetono ciò che la forma già dice:
il testo della modalità (l'icona *è* la modalità) e la parola «context» (il pannellino che si
apre al tocco comincia con «Context window»). Una classe sola, `.lbl`, e una riga di CSS.
Due trappole trovate misurando, non ragionando. **Svelte taglia lo spazio iniziale dentro un
elemento**: `<span class="lbl"> context</span>` rendeva «27%context» attaccato su desktop — il
bordo destro di «27%» e il sinistro dello span cadevano sullo stesso pixel (1353). Serve
`&nbsp;`, che non è collassabile. E il nome del modello era un **nodo di testo nudo**: dentro un
flex diventa un elemento anonimo, che nessuna regola CSS può raggiungere — avvolto in `.mname`
per poterlo troncare con l'ellissi. Sotto stress (nome di modello lunghissimo, iniettato apposta)
flex accorciava anche «MCP» in «MC», che non vuol dire niente: `.l .tune{flex:none}` fa cedere
solo il modello. Con l'etichetta della modalità nascosta il bottone resterebbe **senza nome
accessibile** (le icone sono `aria-hidden`), quindi porta un `aria-label` che dice quale
modalità è attiva. Verificato a **320, 390, 430 e 1400px**: una riga sola (scarto verticale fra i
centri: 0), niente fuori dal bordo in nessuno dei quattro, desktop invariato.

**L'header della chat, stessa sera, stessa radice**: il titolo andava a capo su **tre righe** da
telefono (header alto 91px invece di 42) e l'icona del bottone «files · commands» sembrava
scentrata nel suo riquadro. Sembravano due difetti; erano **lo stesso**. Misurato: l'icona è
sempre stata centrata *verticalmente* (5px sopra, 5 sotto) ma stava a **13.1px da sinistra e 2
da destra** — non era l'allineamento, era il riquadro schiacciato. Il titolo, senza vincoli di
larghezza, si prendeva tutto lo spazio e comprimeva il bottone finché il padding destro non
spariva. Prova per confronto, non per ipotesi: la luna accanto — che ha già `flex:none` — era
perfetta, 6.8px su tutti e quattro i lati. Due proprietà: `.bar .t` prende
`min-width:0` + `overflow`/`text-overflow`/`white-space` (e `min-width:0` è la metà che si
dimentica: un figlio flex non scende sotto la larghezza del proprio contenuto finché non glielo
si permette, quindi senza di quello `text-overflow` non entra mai in gioco), e `.effbtn` prende
`flex:none`, che è ciò che `.iconb` aveva già. Dopo: titolo **66px → 22px**, icona **13.1/13.1**.
Il titolo intero è finito nel `title` del bottone, perché adesso la riga lo tronca e altrimenti
non ci sarebbe più modo di leggerlo senza entrare in rinomina. Verificato a 320, 390, 430 e
1400px; su desktop `sx=155` non è un difetto ma l'etichetta «N files · M commands» che lì viene
mostrata prima dell'icona.

**E i tre chip della barra erano di altezze diverse** — conseguenza diretta, e non prevista, di
aver tolto l'etichetta alla modalità poche ore prima. Un `.tune` è alto **quanto il suo
contenuto**: con del testo è alto una riga (1.45em), con la sola icona 11px. Misurato:
modalità **19.53px** contro mcp e modello **24.25px**, cioè 4.7px di scarto, e la fila sembrava
sbilanciata. Fix: `min-height:calc(1.45em + 4px)` su `.tune` — legato alla riga di testo invece
che un numero fisso (`1.45em` è la riga alla dimensione del chip, `+4px` sono padding 1+1 e
bordi 1+1, che vanno sommati perché `box-sizing` è `border-box`). Messo **senza media query**,
di proposito: è un'invariante — «i chip della barra sono alti uguali» — non un rattoppo per il
telefono, e così regge anche se un domani un altro chip perde la sua etichetta. Dopo: 24.97px
tutti e tre a 320/390/430px, 18.5px tutti e tre a 1400px (stesso valore CSS, lo zoom ×1,35 dello
schermo stretto spiega la differenza), scarto **0** ovunque.
Vale la pena notare il filo che lega gli ultimi tre giri: togliere l'etichetta della modalità ha
prodotto **due** difetti a valle — prima il bottone «files» schiacciato, poi i chip di altezze
diverse — e nessuno dei due era visibile ragionando sul CSS. Si sono visti solo misurando i
rettangoli veri nel browser.

**E le tendine della barra si aprivano addosso ai bottoni** (26 agosto 2026, segnalato da
telefono con screenshot). Il giro precedente le aveva sganciate dal proprio bottone —
`position:fixed; bottom:12px` — perché ancorate al chip sconfinavano fuori schermo (§ rifiniture
del 26 agosto). Risolveva quello e ne apriva un altro: a filo del fondo finestra la tendina
copriva i chip che l'avevano aperta **e** la casella di scrittura, cioè si sceglieva un server
MCP senza più vedere quale chip lo stava mostrando. Ora si ancorano al **blocco in basso**:
`.dock` prende `position:relative` (non gli serve, fa da riferimento) e la tendina va a
`bottom: calc(100% + 8px)` — finisce dove il blocco comincia, e a essere coperta è la
conversazione, che scorre. Il passaggio non ovvio è il perché servano `.status{position:static}`
e `.pop{position:static}` sotto soglia: `position:absolute` cerca il **primo** antenato
posizionato, e quei due (entrambi `relative`, il secondo per l'ancoraggio su schermo largo)
intercettavano prima di `.dock`. Neutralizzarli lì li salta senza toccare il caso largo.
Misurato a 390px su tutte e tre le tendine: bordo inferiore **674.1** contro dock a **683.9** e
casella a **746.9** — `copreLaCasella:false`, `copreIChip:false`, `dentroSchermo:true`, stesso
bordo e stessa larghezza per tutte e tre. E a 1400px `ancoratoAlChip:true` per tutte e tre,
cioè il desktop è rimasto ancorato al proprio bottone come prima.

**E la modale «New chat» usciva dallo schermo** (26 agosto 2026, segnalato da telefono). Le
modali dichiarano una larghezza **fissa e inline** (`NewChat.svelte:139` — 430px la chat nuova,
560 l'import; 380 la conferma di eliminazione in `App.svelte`), e `.dlg` aveva `max-height` ma
**non** `max-width`: mancava metà della regola. Misurato a 390px: la chat nuova veniva 580px e ne
sfondava **95 per lato**, l'import 756 e ne sfondava **183** — «Cancel» e «Create» fuori schermo.
Fix: `max-width:calc(100% - 26px)`, gli stessi 26px di `max-height` e di `.dlg.wide{inset:13px}`.
Niente media query (un tetto in percentuale vale a ogni larghezza) e nessuna gara di specificità
con lo stile inline, perché `width` e `max-width` sono proprietà **diverse** e la seconda limita
la prima da qualunque parte arrivi. Su desktop la modale resta 430/560px, cioè le misure volute.
Rientrata nello schermo, la larghezza minore ha fatto emergere due difetti a valle che prima non
si vedevano — ed entrambi hanno la stessa causa: `.shell *{min-width:0}` (app.css:74) toglie a
**tutto** il minimo naturale, quindi in un'intestazione stretta si comprime qualunque cosa non
dica il contrario. Le linguette (`.switch`, che ha `overflow:hidden` per l'angolo arrotondato)
non sfondavano: **sparivano**, e «Import» diventava «Impor»; poi, tolta la pressione da lì, la
crocetta di chiusura finiva a 9px con dentro un'icona da 14. Entrambe risolte con `flex:none` —
a cedere dev'essere il titolo, che è testo e sa andare a capo. Restava il caso iPhone SE: a 320px
la parola «conversation» è da sola più larga della colonna rimasta, quindi `overflow-wrap:anywhere`
sul titolo (`anywhere` e non `break-word`, perché solo il primo conta nel calcolo della larghezza
minima — cioè è l'unico che lascia il riquadro stringersi davvero). Verificato a 320, 390, 430 e
1400px su entrambe le linguette: `esceDalloSchermo:false` e **zero** elementi con testo tagliato.

**Il prompt di un turno lungo resta appeso in cima** (26 agosto 2026, chiesto per desktop e
telefono insieme). Un turno aperto è spesso più alto dello schermo, e la riga da cui lo si
richiude è la **prima**: una volta scesi dentro bisognava risalire fino in cima per chiuderlo.
Ora `.turn>.th` è `position:sticky;top:0`, e l'intestazione della chat sta **fuori** dallo
scrollport (`.bar` è sorella di `.scroller`, non figlia), quindi `top:0` vuol dire già «sotto di
lei» senza doverne conoscere l'altezza. Il pezzo che non si indovina è l'altro: `.turn` aveva
`overflow:hidden`, e `hidden` fa dell'elemento un **contenitore di scorrimento** — `sticky` si
aggancia al primo che trova salendo, quindi si sarebbe agganciato al turno, che non scorre mai,
cioè non si sarebbe mosso. Cambiato in `overflow:clip`, che taglia identico sull'angolo
arrotondato ma **non** è un contenitore di scorrimento. Il taglio serve ancora, ed è ciò che fa
sparire il prompt appeso al momento giusto: quando il turno esce, il suo bordo se lo porta via e
il prompt del turno dopo prende il posto senza sovrapporsi.
Misurato con un turno vero più alto dello schermo, su **tutti e tre** i casi: desktop 1400px
(turno 4577px, inizio 2289px sopra il bordo), mobile 390px (turno 1671px, inizio 1163px sopra) e
**WebKit**, cioè il motore vero di Safari, che è quello che l'utente usa dal telefono (turno
2162px, inizio 1654px sopra). Ovunque: prompt visibile, `maiSopraLHeader:true`, e `premibile`
verificato con `elementFromPoint`, non dedotto dal fatto che sia disegnato lì.
`overflow:clip` è supportato da entrambi i motori (`CSS.supports` interrogato dal vivo, non
dedotto dalle tabelle di compatibilità): era l'unico rischio della scelta.
Effetto collaterale della prova, e vale la pena saperlo: **WebKit su `http://` semplice non
carica STARK**. Gli asset tornano 403 perché il cookie di sessione ha `Secure` e WebKit si
rifiuta di conservarlo fuori da un contesto sicuro, mentre Chrome tratta `127.0.0.1` come tale.
Dal telefono non si vede, perché lì si passa da `https://` via Tailscale — ma un Safari puntato
direttamente al loopback resterebbe su una pagina vuota. Non toccato: `Secure` c'è per una
ragione (vedi §Sicurezza), e il caso vero passa da HTTPS.

**La conversazione smetteva di seguire il fondo proprio mentre l'agent scriveva** (26 agosto
2026, chiesto «come WhatsApp o Telegram»). L'auto-scroll c'era già dal principio e sembrava
giusto, ma la sua dipendenza guardava **solo l'ultimo turno**:
`snap.turns[snap.turns.length - 1]`. Il turno che cresce però non è sempre l'ultimo — e il file
lo sapeva già, scritto a mano sopra `isOpen`: «se mandi un messaggio mentre lavora ancora al
precedente, quello nuovo si accoda e non ha ancora un blocco». Quell'intuizione era stata
applicata a *quale turno aprire* e non qui. Con un prompt in coda l'ultimo turno è quello
accodato — vuoto e fermo — quindi la misura restava zero, l'effetto non ripartiva mai e la
pagina restava indietro **esattamente** quando serviva seguire. Sommare su tutti i turni toglie
il caso speciale invece di inseguirlo, e costa un giro sui blocchi già in memoria (`length` di
una stringa non la riconta).
Provato **A/B su una sessione vera**, con due prompt ravvicinati per riprodurre la coda, in una
finestra da 300px perché il contenuto la superasse davvero: senza il fix **817px** di ritardo,
persistente; con il fix la serie dei divari è `[82, 0, 0, 0, 0]` — un solo lampo di un frame,
quello in cui compare la riga del turno accodato, poi zero. La prima misura era stata invalidata
da un artefatto mio (aprire i turni a mano fa crescere il contenuto senza che sia streaming):
vale la pena ricordarlo, perché il numero sembrava confermare la tesi ed era rumore.
Insieme, la via di ritorno: un **bottone freccia in giù** che compare solo quando si è risaliti a
leggere — se ci fosse sempre non direbbe niente, mentre il fatto che appaia è già
l'informazione. Sta fuori dallo scroller, in un contenitore alto **zero** appoggiato sopra il
blocco di scrittura: galleggia senza rubare spazio e senza che nessuno debba sapere quanto è
alto quel blocco, che cambia con la casella, gli allegati e i comandi slash. Premendolo torna in
fondo **e** ricomincia a seguire: scendere e basta lascerebbe `stick` falso, quindi alla riga
dopo si resterebbe di nuovo indietro. Verificato a 1400 e 390px: assente in fondo, presente dopo
essere risaliti (a 10 e 13.5px sopra il blocco, dentro lo schermo, `premibile` con
`elementFromPoint`), e assente di nuovo dopo il clic.

**Una chat nuova apriva sempre su Sonnet, mentre la CLI nuda apre sull'Opus dell'account**
(26 agosto 2026, chiesto dall'utente: «perché qui sembra mettermi sempre Sonnet?»). Causa
unica: `registry.ts` aveva `'claude-sonnet-5'` cablato come modello di partenza quando nessuno
ne chiede uno esplicito — cioè sempre, perché niente nella UI manda mai un `model` all'apertura
(`NewChat.svelte` non lo chiede: modello e modalità si scelgono dalla barra sotto la casella,
**dopo**). Non era una supposizione: verificato **due volte dal vivo**, prima con l'SDK nudo
(uno script fuori da STARK, stessa `CLAUDE_CONFIG_DIR`) e poi col daemon vero isolato, che aprire
una sessione senza passare `model` risolve **`claude-opus-5[1m]`** — il default reale
dell'account, letto dalla voce `value:"default"` che l'SDK stesso restituisce in
`list_models` (non un'invenzione di STARK: `resolveModel`/`modelChoices` in `sdk-options.ts` la
leggevano già, per popolare la tendina "Default (recommended)" — semplicemente STARK non la
usava mai come proprio fallback). Fix: il default passa da `'claude-sonnet-5'` a `'default'`,
la stessa stringa-alias che l'SDK già riconosce — non un modello scelto da STARK al posto
dell'account, ma la richiesta di lasciar decidere all'account, esattamente come fa la CLI nuda
quando non le si dice `--model`.
Trovato nello stesso giro un secondo bug con la stessa radice, più subdolo: **il risveglio non
guardava il modello**. Il commento accanto (`registry.ts`, sulla preservazione dei server MCP:
«risvegliare deve restituire la chat com'era») copriva l'MCP ma non il modello — una chat
spostata su Opus o Fable, addormentata e risvegliata, tornava silenziosamente sul default, senza
che niente lo dicesse. Ora il risveglio guarda prima `snapshot.model` (quello che il journal
ricorda per quella chat) e solo se è vuoto — una chat mai partita — ricade sul default. Prova di
questa parte fatta per lettura del codice (`reduce.ts`, `session.model` già esercitato dal vivo
via `/model` in questa stessa conversazione), non da capo a fondo con un risveglio vero: quello
richiede un turno reale sul journal di prova, e non l'ho speso. `npm run check` resta **80**,
`npm run daemon` **25**.

**E ora il telefono suona anche a STARK chiuso** (26 agosto 2026). Le notifiche che c'erano dal
24 agosto le fa **la pagina** (`new Notification(...)`): valgono finché quella pagina è viva, e
su un telefono non lo è quasi mai — a schermo spento o con Safari in secondo piano nella scheda
non gira niente. L'unico modo di avvisare un telefono che non ti sta guardando è il **Web Push**:
il daemon consegna al servizio di push del sistema, che sveglia un Service Worker senza pagina.
Non è stato un salto nel buio: la sonda in `tools/sonda-telefono/` aveva già fatto arrivare un
push vero su questo iPhone in ~3s, e questo lavoro è quella prova portata dentro il daemon.
Il pezzo che rende tutto **una regola sola** è `core/calls.ts`: `callFor` stava in
`store.svelte.ts`, cioè nella UI, ma ora la stessa domanda se la pongono in due — il browser per
suonare, il daemon per mandare il push. Due copie avrebbero voluto dire che un giorno il telefono
suona e il portatile no, senza sapere quale dei due ha ragione.
Lato daemon: `push.ts` tiene le chiavi VAPID e le iscrizioni in `~/.stark/push.json` (`0600`,
come il token: la chiave privata lì dentro permette di mandare notifiche a nome di questo STARK),
`vigila()` guarda l'elenco con la stessa attesa di 250ms del flusso — `bump()` scatta a ogni
delta di testo, e senza quella il telefono suonerebbe a ogni parola — e le iscrizioni morte
(`404`/`410`) si tolgono da sole. Il primo giro non notifica niente, se no riavviare il daemon
manderebbe una raffica di «ha finito» per conversazioni ferme da ore.
Lato telefono: `ui/public/sw.js` (nessuna cache, di proposito: senza daemon non c'è niente da
mostrare, e una cache sarebbe solo un altro posto in cui restare indietro), manifest, e le icone
generate dal marchio che c'è già con `tools/gen-app-icons.mjs` — la «A» col gradiente presa da
`Logo.svelte`, perché la scritta intera a 180px diventa cinque macchie.
**Il vincolo che decide come si usa**: su iOS il push arriva **solo** a un sito aggiunto alla
schermata Home. Non è una scelta nostra, è Safari: in una scheda normale `PushManager` non
esiste proprio. Per questo l'interruttore, quando il supporto manca, non è un bottone morto ma
dice cosa fare («Condividi → Aggiungi alla schermata Home»). Ed è anche il motivo per cui il
tipo MIME del manifest è stato corretto (`application/manifest+json`): servito come
`octet-stream` il manifest viene ignorato, e senza manifest l'aggiunta alla Home non vale.
Costo dichiarato in chiaro nelle impostazioni: il contenuto viaggia **cifrato** da capo a fondo,
ma il *fatto* che una notifica parta passa dai server di Apple. È l'unica parte di STARK che non
resta sulla macchina, e per questo è **spenta finché non la accendi** — senza iscrizioni il
daemon non manda niente.
`npm run check` passa a **89**: le nove nuove provano la regola (un turno finito chiama, una chat
appena aperta **no**) e il giro completo con un registro finto — una notifica sola, col progetto,
il prompt e l'id per aprire la chat giusta al tocco, e nessuna seconda notifica se lo stato non
cambia. Verificato nel browser vero: manifest col tipo giusto, `apple-touch-icon`, Service Worker
registrato su scope `/`, chiave VAPID servita. L'**iscrizione** vera no: headless non ha un
servizio di push, quindi quel passo si prova solo dal telefono.

**E anche le impostazioni sono due schermate da telefono** (26 agosto 2026): prima il menu delle
sei sezioni, poi la sezione, con la freccia per tornare — la stessa idea di elenco e
conversazione (§8 di `ui-schermate.md`), applicata dove mancava. Affiancate a 390px la colonna
delle sezioni si prendeva 132px, un terzo dello schermo, per restare comunque stretta, e alla
sezione ne restavano due terzi.
Due cose che si scoprono solo facendolo. La prima: la X per chiudere sta nell'intestazione della
colonna **di destra**, che sotto soglia è l'altra schermata — senza aggiungerne una al menu,
quello sarebbe stato un vicolo cieco da cui si esce solo entrando in una sezione a caso. La
seconda: `.via{display:none}` non bastava, perché `.dlgcol{display:flex}` è dichiarato **più in
basso** nello stesso foglio e a parità di specificità vince l'ultima — la sezione restava
visibile anche stando sul menu. Risolto con `.dlg .via`, un selettore in più invece di
`!important`, che avrebbe nascosto il problema invece di risolverlo.
Nello stesso giro l'evidenziazione della voce scelta sparisce sotto soglia: su schermo largo
dice «è questa che stai guardando accanto», ma lì accanto non c'è niente e resterebbe un colore
senza significato sulla riga da cui sei appena tornato. Al suo posto un chevron, che dice che la
riga **apre** invece di selezionare. Verificato a 320, 390 e 1400px: menu da solo → sezione da
sola con la freccia → ritorno, chiudibile da entrambe, e desktop invariato (due colonne insieme,
nessuna freccia).

**L'app aggiunta alla schermata Home non si collegava** (26 agosto 2026, segnalato dall'utente
appena provato: «mi aggiunge solo il path base senza token»). Tre cose che si sommavano, e
nessuna delle tre si vede finché non si prova sul telefono vero.
La prima: iOS **non salva l'indirizzo che stai guardando**, salva `start_url` del manifest — e
lì c'era `"/"` scritto in un file statico, che un token non può contenerlo. La seconda: `GET /`
senza token risponde **403** (verificato), quindi l'app partiva su una porta chiusa. La terza,
quella che toglie ogni via di scampo: su iOS un'app della schermata Home ha una **memoria sua**,
separata da Safari — il cookie preso nella scheda non è lì, e nemmeno `sessionStorage`.
Il manifest si compone quindi nel daemon, con `start_url: /?token=…`, e non è un peggioramento:
sta dietro lo stesso guard di tutto, quindi lo riceve solo chi è già autenticato, ed è lo stesso
token dell'indirizzo che l'utente apre. Il file in `ui/public` resta senza token, quindi in git
non finisce niente. Costo dichiarato: iOS **congela** `start_url` al momento in cui aggiungi
l'app, perciò rigenerare il token (`stark token --new`) obbliga a rifare l'icona; e il manifest
si serve con `no-store`, se no un manifest vecchio in cache manderebbe l'app su un indirizzo che
non funziona più.
Il token ora si ricorda anche in `localStorage` oltre che in `sessionStorage`: un'app della
schermata Home viene chiusa e riaperta di continuo dal sistema, e a ogni riapertura la sessione
è vuota. Non indebolisce niente — i due depositi sono **ugualmente** leggibili dal JavaScript
della pagina, cambia solo quanto durano.
Trovato per strada un difetto latente che questo caso ha messo in luce: la UI mandava
`Authorization: Bearer ` **vuoto** quando non aveva un token, e un Bearer vuoto viene preso per
un tentativo, fallisce, e **impedisce al daemon di guardare il cookie** — cioè una pagina che
avrebbe potuto autenticarsi da sola si beccava un 403. Ora senza token l'intestazione non si
manda affatto.
Verificato A/B simulando il lancio dalla Home in un contesto **nuovo** (niente cookie, niente
storage, come su iOS): con `start_url` nudo **HTTP 403**, col manifest composto la UI si carica;
e regge anche il rilancio successivo con `sessionStorage` svuotato a mano.
**Non bastava**, e il secondo giro ha trovato la causa vera (segnalata con un altro screenshot:
«No token» dentro l'app della Home). Per **specifica** un `<link rel="manifest">` viene
richiesto **senza cookie**, e il nostro sta dietro il guard: tornava 403, iOS restava senza
manifest e ripiegava sull'indirizzo della pagina come `start_url` — che a quel punto è `/` nudo,
perché `bootToken()` il token l'ha appena tolto dalla barra. Serve
`crossorigin="use-credentials"` sul link, che è l'unica cosa che fa viaggiare il cookie con
quella richiesta. Misurato: il manifest senza credenziali → **403**, e `location.search` dopo il
boot → **vuoto**.
Dietro c'era però un difetto più grosso e più generale: **la UI si rifiutava di provare**.
`{#if !store.hasToken}` mostrava «No token» ogni volta che il token non era *in memoria* — ma il
token non è l'unica credenziale, c'è il cookie, e su iOS l'app della schermata Home ha proprio
solo quello (memoria separata da Safari). La pagina si caricava — cioè il cookie funzionava — e
la UI si arrendeva sopra un daemon perfettamente raggiungibile. Adesso si prova comunque e ci si
arrende solo dopo un rifiuto **vero**: un colpo a `/api/health` all'avvio, e `refusedAuth` solo
sul 403. Una rete che non risponde non è un rifiuto — quello lo dice già `fatal`, e mandare a
cercare un token quando il daemon è spento è mandare a cercare la cosa sbagliata.
Riprodotto il caso esatto dello screenshot (solo cookie, memoria svuotata): prima «No token»,
adesso la UI parte e carica le chat. E senza **nessuna** credenziale la pagina non arriva
comunque, perché il 403 scatta prima, al confine.

**Il pannellino del contesto, e l'aria attorno alla barra** (26 agosto 2026, chiesto da
telefono). Tre cose in un giro solo. Il pannellino si apriva ancora ancorato al **proprio**
bottone, cioè in un punto diverso dalle tre tendine accanto che erano già state spostate sul
blocco — e largo 220px fissi, che a 320px sfondano. Stessa cura delle altre: `.ctx` a `static`
perché l'ancoraggio salga fino a `.dock`, e larghezza dai due bordi invece che dichiarata.
Misurato: `left`, `right` e `bottom` **identici** a quelli della tendina della modalità.
Dentro, la scomposizione per categoria sparisce sotto soglia: sei o sette voci con numeri
piccoli sono un muro dentro un pannellino che deve dire **una** cosa. Resta il valore
complessivo — percentuale, una barra sola come quelle delle finestre del piano, e i token. Su
schermo largo le categorie **restano**: là lo spazio c'è, e sapere *cosa* riempie il contesto è
la ragione per cui erano state messe (sono quelle vere di Claude Code). Verificato che a 1400px
ci siano ancora tutte e sette.
E l'aria ai lati: in un'app della schermata Home non c'è la cornice del browser attorno, e i
chip finivano incollati al vetro. Padding a 16px sotto soglia, ma scritto
`max(16px, env(safe-area-inset-*))`: `env()` è quanto iOS chiede di stare lontani da notch e
angoli, e `max()` fa sì che in una scheda normale — dove quegli inset sono zero — resti comunque
il margine nostro. Sul fondo `padding-bottom: env(safe-area-inset-bottom)` sul `.dock`, perché
la barra del gesto «home» si mangia l'ultimo mezzo centimetro e senza quello il blocco ci
finisce sotto. In Safari l'inset è zero e non cambia niente.

**Il prompt appiccicato lasciava passare il contenuto sopra di sé** (26 agosto 2026,
segnalato con uno screenshot: «il contenitore deve finire al prompt, non oltre»). Causa: il
padding dello scroller. Un contenitore con `overflow` taglia i figli al proprio bordo, ma
**l'area del padding sta dentro quel bordo** — il contenuto che scorre ci passa attraverso e si
vede. Con `.conv{padding:12px}` e `top:0`, il prompt si agganciava 12px più in basso, e in
quella striscia continuava a sfilare il contenuto: sopra il titolo, che è esattamente ciò che
non deve succedere. Corretto spostando i 12px dal padding del contenitore al **margine del primo
figlio**: così il prompt si aggancia a filo del bordo che taglia, e sopra di lui non c'è più
niente da vedere **per costruzione**, non per un offset azzeccato. Misurato: fascia scoperta da
8.8px a **0**, e `elementFromPoint` lungo tutta la striscia non trova più niente.
Nello stesso giro il prompt ha preso `border-radius: 8px 8px 0 0`. Finché sta in cima al proprio
turno non serviva — a smussarlo era il taglio del contenitore — ma **appiccicato sta in mezzo al
turno**, dove non c'è nessun angolo da ereditare, e si leggeva come una fascia piena che sfonda
i lati invece che come la cima di una scheda. Gli 8px sono i 9 del turno meno il suo bordo di 1,
così a riposo le due curve coincidono al pixel invece di somigliarsi. Solo in alto: sotto c'è il
contenuto del turno, e arrotondare lì aprirebbe due spicchi di fondo in mezzo a una cosa
continua. Verificato che l'aria a riposo resti quella di prima (16.2px da telefono con lo zoom,
12 su desktop, uguale in cima e ai lati).

**Il prompt intero si può rileggere** (26 agosto 2026, chiesto da telefono: «vedo il prompt
interrotto ma senza bottone per vederlo esteso»). La riga lo tronca coi puntini, e va bene —
serve a riconoscere il turno, non a rileggerlo — ma senza una via per aprirlo quel testo
diventava **irraggiungibile**, e su un turno vecchio è spesso l'unica cosa che dice di cosa si
stava parlando. Ora c'è un `…` accanto, che apre il prompt per intero in un riquadro.
Il pezzo strutturale: `.th` **era** il bottone, e un bottone dentro un bottone non è HTML
valido. È diventato il contenitore — quello che si appiccica in cima — con dentro due fratelli,
`.thmain` (apre e chiude, com'era) e `.thmore`. È la stessa forma di `.oprow`, dove la riga del
tool e la lente per il file sono già fratelli. Il testo sta in un `pre`: un prompt ha a capo e
rientri, e riflowarlo come un paragrafo cambierebbe la cosa che si è aperto il pannello per
rileggere.
Sono due intenzioni diverse di proposito: «fammi vedere cosa avevo chiesto» non è «aprimi le
diciotto operazioni che ne sono seguite».
Nello stesso giro, da telefono sparisce il **conteggio dei blocchi** accanto al tempo: quanto è
durato un turno dice se è andato liscio, quanti blocchi ha prodotto lo si scopre aprendolo — e
lì lo spazio serve al prompt. Su desktop resta.
Verificato dopo la ristrutturazione che lo **sticky regga ancora** (era il rischio vero del
cambio): agganciato a 390 e 1400px, fascia scoperta sopra **0**, `maiSopraLHeader`, e il nuovo
bottone premibile con `elementFromPoint` anche mentre il prompt è appeso.

**Dalla riga dell'elenco sparisce «da quanto»** (26 agosto 2026, chiesto dall'utente: «sono
informazioni e calcolo inutile»). La riga diceva `23:13 · working · 2m`; ora si ferma a
`23:13 · working`. Il pezzo che valeva la pena togliere non era il testo ma quello che stava
dietro: un `setInterval` da **un secondo** con `now` in `$state`, esistito solo per far
avanzare quella stringa — e siccome `now` è letto dentro il `{#each}` delle righe, ogni tick
invalidava l'elenco intero, anche a schermo fermo e con tutte le chat che dormono. Il commento
accanto lo giustificava («una decina di righe non costa niente»), e non era sbagliato: era il
**valore** dall'altra parte della bilancia a non reggere, non il costo. Via anche
`.sit .el{opacity:.85}` in `app.css`, rimasta senza padrone (l'altra `.el`, quella di `.doing`,
è di un'altra cosa e resta).
Non toccato di proposito: il campo `since` **resta** e continua a ordinare le righe dentro il
gruppo — è la ragione per cui non si ordina per `lastTs`, ed è ancora valida. Smettere di
mostrarlo non è smettere di usarlo. Verificato nella UI vera, non a occhio: screenshot sul
daemon di produzione dopo `ui:build`.

**Si cita un file con `@`** (26 agosto 2026, chiesto dall'utente: «poter citare i file presenti
all'interno del progetto con @, come il menu degli slash command»). Si preme `@`, compare lo
stesso menu dei comandi, e scrivendo si filtra.

La cosa che ha deciso tutto il resto è stata **non scriverla**. `file_suggestions` esiste già
nel canale di controllo del CLI — «the same fuzzy-matched results the TUI shows», dai tipi
ufficiali — quindi la ricerca è quella del terminale, `.gitignore` compreso, e non una nostra
imitazione che divergerebbe al primo aggiornamento (la regola di ADR-009 applicata a un caso
nuovo). Il pezzo scomodo, detto in chiaro nel codice: l'SDK **dichiara** la richiesta nei tipi
ma non la espone come metodo del `Query`, a differenza di `getContextUsage()`. Si passa dal
`request()` generico, che nel `.d.ts` non c'è — quindi la stessa cautela di `refreshQuota()`:
si guarda se il metodo c'è invece di fidarsi del tipo, e una versione che lo togliesse non è un
guasto (il menu non si apre, la casella resta una casella).

Due fatti misurati prima di scrivere una riga, entrambi a **costo zero di quota** (sono domande
sul filesystem, non turni). Il primo: `@` non è decorazione — il CLI **espande** la citazione da
sé anche via stream-json, verificato nascondendo una parola in un file e chiedendola con
`@file`; è tornata nella risposta **senza** che l'agent aprisse un tool per leggerlo. Citare tre
file costa quindi tre letture in meno, ed è il motivo per cui si inserisce `@percorso` e non il
percorso nudo. Il secondo: per i primi **~1,5s** dopo l'apertura di una chat il CLI sta ancora
costruendo il suo indice e risponde «nessun file» a qualunque ricerca — mentre la query vuota
funziona subito, perché quella è una lettura della cartella e non una ricerca.
Su quel secondo fatto ho scritto la cura ovvia — un riscaldamento all'avvio — e poi l'ho
**tolta**, perché l'A/B diceva che non serviva: 1531/1565ms senza contro 2738/1563ms con.
L'indice se lo costruisce da sé e non si lascia anticipare. A coprire la finestra fredda resta
un solo ritentativo dalla UI, che è il posto dove si sa che l'utente sta ancora digitando.
Vale la pena ricordare anche una misura **buttata**: il primo A/B dava 3513 contro 1785 e
sembrava confermare il riscaldamento, ma l'orologio di WSL era saltato durante la prova
(`sessione aperta a +-86ms`, un tempo negativo). Rifatta con `performance.now()`, il risultato
si è rovesciato.

Tre difetti trovati **guidando la UI vera**, nessuno dei quali si vedeva leggendo il codice.
Scegliendo un file il menu **si riapriva da solo**: quando la citazione finisce l'effetto
svuotava l'elenco ma non invalidava le risposte già in volo, e quella partita un istante prima
tornava buona un attimo dopo (`giro++` anche sul ramo che chiude). La riga scelta con le frecce
**usciva dal riquadro**: misurato, nona freccia a 783px con il riquadro che finisce a 742 —
e non era un difetto del menu nuovo, ce l'aveva **anche quello dei comandi**, che ne mostra
fino a 40 e ne fa vedere sette. Corretto per entrambi con `scrollIntoView({block:'nearest'})`.
E una cartella **vuota** il CLI non la suggerisce affatto: l'ha scoperto una prova rossa, non
un ragionamento.
Verificato dal vivo su una sessione vera a 1400 e 390px: filtro che stringe mentre si scrive
(11 righe → 1), Invio che cita, cartella che scende dentro senza chiudere, Esc, citazione in
mezzo a una frase col cursore che torna al punto giusto, e un indirizzo email che **non** apre
niente. `npm run daemon` passa a **30**.

**Le descrizioni dei comandi si accendono da un interruttore** (27 agosto 2026, chiesto
dall'utente dopo aver notato che sparivano). Impostazioni → **Agent** → «Command
descriptions», accesa di default. La sezione è nuova, la settima: sta accanto a Permissions
perché sono le due che cambiano cosa fa l'agent, ma risponde a un'altra domanda — quella dice
*di cosa mi fido*, questa *come lavora*.

Il punto che decide tutto: **non c'è un'opzione dell'SDK da accendere**. Quel campo lo scrive il
modello, quindi l'unico modo di chiederglielo è dirglielo dove lo rilegge sempre — cioè nel
`CLAUDE.md` **globale dell'agent**, `<CLAUDE_CONFIG_DIR>/CLAUDE.md`. Da qui la conseguenza che
sta scritta nel pannello invece che scoperta dopo: la regola vale **anche fuori da STARK**, nel
terminale. È anche l'unica cosa in STARK che scrive in un file **dell'utente** fuori da
`~/.stark`, e per questo `memoria.ts` ha una regola sola: non riscrivere mai quel file, toccare
solo il blocco fra i due delimitatori. Spegnendo si toglie *esattamente* quello; se il file
resta vuoto sparisce (vuoto vuol dire che non c'è niente da perdere, quindi non serve sapere
chi l'aveva creato), se conteneva altro l'altro resta identico. Otto verifiche nuove provano
proprio questo — testo dell'utente prima **e dopo** il blocco, riaccensioni ripetute che non
accumulano copie, e un blocco lasciato a metà che non fa cancellare il resto.
Si riallinea anche **all'avvio del daemon**, non solo al salvataggio: fra un'accensione e
l'altra quel file può essere stato cambiato a mano, e senza quel giro la spunta direbbe una
cosa e il file un'altra.

Nello stesso giro, un difetto **che c'era già da giorni** e che si è visto solo aggiungendo la
voce nuova: nel pannello delle impostazioni la posizione scelta di un interruttore a due vie era
**invisibile**. `.seg button{background:none;color:inherit}` in `Settings.svelte` è scoped,
quindi più specifico di `.seg button.on` in `app.css`, e se lo mangiava: restava solo il
grassetto, che a 10px non è una differenza. Valeva anche per i permessi, cioè per l'unica
tabella di quel pannello che cambia cosa fa l'agent. Misurato invece che guardato —
`rgba(0,0,0,0)` su entrambi i bottoni, in entrambe le sezioni — ed è la stessa malattia già
documentata per il menu dei comandi in `Dock.svelte`. Dopo: `rgb(233,237,254)` sulla voce
scelta, in tutte e due.
Provato dal vivo premendo l'interruttore nella UI vera: «off» ha tolto il file dal profilo
reale, «on» l'ha rimesso. `npm run check` passa a **97**.
Nello stesso giro `configDirOf()` in `profiles.ts`: la catena
`configDir ?? CLAUDE_CONFIG_DIR ?? ~/.claude` era scritta due volte, e la terza copia (la
memoria globale) l'ha resa una funzione — stessa ragione di `core/platform.ts`.

**Le due schermate che chiudono l'MVP** (27 agosto 2026, dopo aver riletto insieme all'utente
cosa mancasse davvero). Erano le due sole in cui STARK **taceva su un fatto**, ed entrambe
riguardano qualcosa che si ferma senza che nessuno l'abbia chiesto.

**Quota esaurita.** Una banda sopra l'elenco: quante chat sono ferme e fino a quando. Sta lì e
non dentro una chat perché la quota è del **piano** — quando finisce si fermano tutte insieme, e
scoprirlo entrando in una per volta non è una risposta. Tre scelte non ovvie: **niente conto
alla rovescia**, solo l'ora esatta (la durata avrebbe richiesto l'orologio al secondo appena
tolto dall'elenco, e fra le due è l'orario a decidere); **una sveglia sola** all'istante del
reset invece di un intervallo, perché le chat ferme non ricevono più eventi e senza quella la
banda resterebbe per ore dopo che il limite è ripartito; e si riparte dal reset **più lontano**,
non dal più vicino — uscire dalla finestra da 5 ore mentre la settimanale è ancora chiusa vuol
dire ricascarci un istante dopo. La regola sta in `core/quota.ts` e non nel componente perché il
caso al bordo (un limite già scaduto, letto da un journal vecchio) si sbaglia **leggendo**, non
guardando: nove verifiche, e non serve mettere in scena una quota finita in un browser.

**Azione fermata dal classificatore.** La riga lo diceva già bene (`Blocked · stopped for
safety`, non un errore rosso), ma finiva lì: un blocco **non è** una richiesta di permesso,
quindi non sale nessuna card e non c'è niente da premere. Ora, aprendola, si legge cosa fare.
Il lavoro vero è stato **scoprire cosa fa il CLI**, che è la domanda che ha posto l'utente
(«claude come si comporta in quel caso?») e che ha ribaltato la mia proposta:

- l'SDK **dichiara** un hook `PermissionDenied` la cui risposta è esattamente
  `{ retry?: boolean }` — «consenti e riprova» già pronto. **Provato: non scatta.** Due rifiuti
  veri su CLI 2.1.241, hook registrato in tre modi nella stessa esecuzione (senza `matcher`,
  `'*'`, `'Write'`): zero. Chiude una domanda che `docs/event-model.md` teneva aperta, e va
  riprovata a ogni salto di versione.
- il CLI, quando blocca, dice **al modello**: prova un'altra strada, il sola-lettura passa
  comunque, torna dopo. All'utente non offre nessun bypass per azione — e **ignora apposta** le
  voci di `permissions.allow` che aggirerebbero il classificatore (letto nel binario). Non è una
  dimenticanza: è una difesa.
- quindi STARK ripete all'utente le stesse tre vie (il modello le legge, lui no) e offre
  l'unica leva vera, **cambiare modalità**. Un «consenti questa e riprova» sarebbe stato STARK
  che fa *di più* del CLI proprio su una difesa: il Principio 5 dice che non dobbiamo poter
  **meno**, non che dobbiamo scavalcare.

Due trappole di metodo, registrate perché hanno bruciato tre tentativi: un blocco del
classificatore **non si provoca a comando** — chiedere `curl … | bash` non ci arriva nemmeno,
si rifiuta prima il modello; e in `dontAsk` `ls` passa lo stesso perché è pre-approvato, serve
una scrittura. Per provare il *meccanismo* di un rifiuto serve `dontAsk` + `Write`.
Verificato a schermo su un journal costruito apposta: gruppo di operazioni → riga bloccata →
nota con le tre vie. La spiegazione c'è sempre, il bottone solo a chat viva — cambiare modalità
è un comando a un processo, e su una chat che dorme non c'è nessuno a riceverlo.

**Il daemon moriva chiudendo il terminale, nonostante `detached`** (27 agosto 2026, segnalato
dall'utente: «ho avviato stark da terminale, l'ho chiuso, e dopo qualche minuto la sessione si è
interrotta»). Il vecchio commento prometteva la cosa sbagliata: `detached:true` chiama `setsid()`,
che stacca dal **terminale** — e il SIGHUP infatti non arriva — ma systemd non traccia i processi
per sessione, li traccia per **cgroup**, e un figlio eredita quello del padre. Un terminale vive
dentro `session-N.scope`; alla chiusura logind ferma quello scope, e fermare uno scope vuol dire
uccidere **tutto ciò che sta nel suo cgroup**, session leader o no.
Riprodotto e misurato, non dedotto: daemon avviato dentro uno scope → cgroup
`system.slice/….scope`, scope fermato → **morto**, porta chiusa. La fuga manuale non è
praticabile: su WSL il cgroup radice è in **sola lettura**, quindi il processo non può
spostarcisi da solo.
Fix: `stark up` e `stark start` avviano il daemon come **servizio transiente** con
`systemd-run` — nasce in `system.slice`, cioè fuori da qualunque sessione. Stesso A/B: scope
fermato → **sopravvissuto**. È il meccanismo che systemd offre apposta, quindi si usa quello
invece di inventarne uno. `--collect` perché un'unità fermata non resti a bloccare il proprio
nome, e il nome porta un'impronta di `STARK_HOME` perché due daemon su case diverse devono
convivere (come già fa `process.title`). Il log resta `daemon.log` e non il journal
(`StandardOutput=append:`), perché `stark status` manda a leggere lì.
L'ambiente va passato a mano (`--setenv`): un servizio transiente parte **pulito**, e senza
`HOME` il registro cercherebbe i journal altrove, senza `CLAUDE_CONFIG_DIR` i figli non
troverebbero le sessioni da riprendere. Se systemd non c'è o la chiamata fallisce si ripiega su
`spawn(detached)`, che è ciò che c'era prima: su una macchina senza systemd non esiste nessuno
scope da cui scappare, quindi lì era già giusto. Verificato anche il giro completo: `stark stop`
ferma l'unità, `--collect` la rimuove, e un riavvio subito dopo riparte.

**Le due misure mai fatte, fatte** (27 agosto 2026, chieste dall'utente: «voglio lo stesso costo
che avrei usando la CLI»).

**La differenza vera non era il classificatore: era la modalità.** Misurato a costo zero (solo
handshake): `claude` senza `--permission-mode` parte in **`default`**, STARK chiedeva **`auto`**.
Era l'unica differenza strutturale fra i due, ed era **cablata** — nessun modo di toccarla.
Adesso è un'impostazione (`Settings.defaultMode`, Permissions → «New chats start in…»), con
`auto` ancora come default perché ADR-008 non viene rovesciata qui: quella decisione era
sull'attrito (zero card), non sul costo. Provata da capo a fondo: cambiata, la chat nuova parte
nella modalità scelta, e la scelta sopravvive su disco.

**Il classificatore di `auto` (§16.6).** Nell'usage della sessione **non si vede**: stesso lavoro
in `auto` e in `default` ha dato 190.163 contro 190.086 token, cioè rumore. Sulla quota del
**piano** il primo giro sembrava dire +1% su cinque ore e settimana — ma il controllo **a ordine
invertito** non ha mosso niente, quindi quel +1 era un attraversamento di soglia e non il
classificatore. Conclusione onesta: su 32 chiamate di tool il costo resta **sotto la risoluzione
della misura** (la utilization è un intero, e 4 giri da 190k token hanno spostato la finestra da
5 ore di un solo punto). Non è zero, ma è perso nel rumore della conversazione stessa. Quello che
cambia davvero fra le due modalità non è la bolletta: è **se ti interrompe**.

**Il risveglio (P16).** La paura scritta in ADR-005 — «rilegge tutto il contesto, quindi costa
quota» — è vera sul *cosa*, ma il *quanto* dipende dalla cache dei prompt, e non era mai stato
guardato. Misurato: al risveglio la storia arriva come **`cache_read`**, non come input nuovo —
`input 2` contro `cache-r 20.564` su una conversazione da 20k token. E regge l'attesa: dopo
**420 secondi** di pausa è ancora cache (`cache-r 20.564`), non prezzo pieno. Oltre la TTL della
cache tornerebbe input vero, e quello non è stato misurato — servirebbe un'ora di attesa.
Nota che chiude il cerchio sulla domanda dell'utente: STARK risveglia con `--resume`, che è
**esattamente** ciò che fa `claude --resume` dal terminale. Qualunque sia il numero, è lo stesso
numero del CLI — non c'è un sovrapprezzo di STARK.

Le sonde restano in `spike/`: `modo-default.ts`, `costo-classificatore.ts`, `costo-risveglio.ts`,
`risveglio-freddo.ts`. Vanno rifatte a ogni salto di versione del CLI.

**Il Finder di sistema per "New chat"** (27 agosto 2026, chiesto dall'utente dopo aver
visto lo screenshot del browser manuale: «non è conveniente»). Accanto — non al posto —
del tree che elenca le sottocartelle una alla volta, un bottone apre il selettore
nativo della macchina del daemon: `System.Windows.Forms.FolderBrowserDialog` via
PowerShell su WSL, `choose folder` via `osascript` su macOS, `zenity
--file-selection --directory` su Linux nativo — stessa forma a tre rami di
`reveal.ts`, con la stessa onestà sulla verifica: WSL, macOS e Linux nativo scritti
seguendo lo stesso pattern a tre rami di `reveal.ts`; nessuno dei tre è stato ancora
provato con un click reale su un dialogo nativo — l'implementazione è passata da
subagent, che non possono pilotare un dialogo di sistema. Il click dal vivo resta da
fare dall'utente, su qualunque macchina scelga per primo.
Parte sempre dalla home del processo, mai dalla cartella già scritta nella casella —
scelta esplicita, non un dimenticato: il tree manuale resta la via per navigare da
dove si era, questa è la via per partire da capo col Finder che si conosce già.
`nativeFolderPickerAvailable()` si ricalcola **a ogni richiesta** invece che una sola
volta all'avvio — la stessa lezione già scritta per il rilevamento Tailscale, qui
applicata prima di ripeterla: un `execFile` in più costa pochissimo, una cache
sbagliata per tutta la vita del processo costerebbe un bottone spento senza motivo
dopo aver installato `zenity` a daemon acceso.
Annullare il dialogo, o non avere il comando giusto in `PATH`, tornano identici
(`{ok:false}`, silenzioso): non è un errore da mostrare, è "resta dove eri".
`npm run check` sale a **109** (i tre test di `pickFolderNative` aggiunti in revisione
finale, con un `exec` finto invece di un dialogo vero), `npm run daemon` resta **35**.

**Le chat si affiancano** (27 agosto 2026). N conversazioni aperte insieme nella stessa
pagina, in pannelli ridimensionabili: si trascina una riga dell'elenco sul **bordo** di un
pannello e quello si divide nella direzione del bordo, o sul **centro** e la chat prende il
posto di quella che c'era. Ogni pannello è una conversazione intera — barra, flusso, casella
di scrittura, barra di stato — non una vista in sola lettura.

Tre decisioni che hanno deciso il resto. La prima: **un clic non apre un pannello**. Cliccare
una riga fa quello che ha sempre fatto, cioè sostituire la chat che stai guardando; ad
aggiungere un riquadro è il trascinamento, che è un gesto che si fa apposta. La seconda: **una
chat non può stare in due pannelli** — trascinare una già aperta la *sposta*, non la duplica —
se no ci sarebbero due sottoscrizioni SSE sulla stessa sessione, cioè due copie dello stesso
snapshot che possono divergere. La terza: sotto gli 860px il layout è **ignorato del tutto**,
non rimpicciolito (§8 di `ui-schermate.md`); resta salvato però, quindi tornando su uno schermo
largo i pannelli si ritrovano dov'erano — verificato ridimensionando la finestra avanti e
indietro, non dedotto.

L'albero della disposizione è **puro** (`ui/src/lib/layout.ts`, niente Svelte né DOM):
`splitLeaf`, `closeLeaf`, `replaceLeaf`, `resizeSplit`, `reconcile`. È lì che sta la parte che
si sbaglia davvero — dove finisce una foglia nuova, cosa collassa quando una sparisce — e lì si
prova con `node` puro: `npm run layout:check`, **22** verifiche. Sta in `tools/` e non in
`src/cli/` perché il `tsconfig.json` della radice ha `rootDir: src`, e un file lì che importa da
`ui/` farebbe smettere di compilare `npm run build`.

Nello Store `snap`/`link`/`view` **non sono più campi**: sono accessori sul pannello a fuoco.
Il piano prevedeva di tenerli accanto ai pannelli durante la migrazione; due stati paralleli
però possono divergere, e così invece tutto ciò che parla della «chat aperta» — Dock, Status,
la barra laterale — non ha dovuto imparare niente di nuovo. Il layout vive nel **browser**
(`localStorage['stark.layout']`), come il tema e la dimensione del testo: «tengo tre chat
affiancate su questo schermo» è del dispositivo, non del progetto. Dentro finiscono solo id,
mai snapshot — quelli si rileggono dal daemon, e salvarli vorrebbe dire mostrare al
ricaricamento una conversazione ferma a ieri.

Nessuna **intestazione di pannello** in più, contro il disegno iniziale: titolo e passaggio
conversazione/effetti stanno già nella barra di `Conversation`/`Effects`, e una seconda riga
sopra li avrebbe ripetuti rubando altezza a *ogni* pannello. Il `×` entra in quella barra con
una prop `onClose`, che con un pannello solo non c'è — a una chat a schermo intero non si
aggiunge niente.

**Quattro difetti trovati misurando dal vivo, nessuno visibile leggendo il codice.** Il primo è
il più istruttivo: `class="split {node.dir}"` produce `class="split row"`, e `app.css` ha già
una `.row` globale — la riga di un tool. I pannelli ereditavano il suo `align-items:center` e
restavano alti quanto il contenuto (245px su 900), col suo fondo e il suo bordo. Da lì
`d-row`/`d-col`, e il divisore rinominato `.hdl`. Il secondo: con **una** chat sola `App` non
montava `Workspace`, quindi non esisteva nessuna zona di rilascio — da un pannello non si
sarebbe mai potuti arrivare a due. Il terzo: la persistenza non funzionava **mai**, perché
l'indirizzo veniva onorato prima del layout salvato, e una scheda già aperta ha sempre un
indirizzo `/chat/<id>`; adesso prima si rimettono i pannelli, poi la chat dell'indirizzo va a
fuoco fra loro. Il quarto: `reconcile()` uniformava le proporzioni anche quando non cadeva
nessuna foglia, cioè a ogni avvio — i divisori tornavano in mezzo e il ridimensionamento non si
ricordava; ora si conservano e si rinormalizzano, in `reconcile` e in `closeLeaf`.

Verificato dal vivo con Playwright su un daemon di prova con journal sintetici (costo zero di
quota: tre conversazioni finte, nessun turno vero), a 1400 e 390px, leggendo i rettangoli veri
oltre agli screenshot: split orizzontale (594+594×900), split verticale annidato dentro il
destro (tre pannelli, 890/297/297 dopo il ridimensionamento), divisore trascinato e
**ricaricamento** che restituisce le stesse identiche larghezze, chiusura che collassa il
genitore rimasto con un figlio solo, e a 390px `.split`, `.pane`, `.hdl` e `×` **tutti a zero**
col layout salvato intatto. `npm run check` resta **109**, `npm run layout:check` è nuovo a
**22**, `svelte-check` 0 errori su 107 file.
**Si arriva da fuori casa senza Tailscale** (27 agosto 2026, chiesto dall'utente:
«vorrei collegarmi anche fuori casa senza Tailscale»).

Il perimetro ora si **dichiara**: `STARK_PUBLIC_HOST` si somma a Tailscale invece di
sostituirlo, e senza niente il default resta byte per byte quello di prima. Il dettaglio
e il perché stanno in §Sicurezza; la macchina attorno (tunnel `ssh -R`, Traefik, mTLS, e
le tre trappole che costano di più) in `docs/fuori-casa.md`. `npm run tunnel` misura se
il tunnel strozza il flusso, a costo zero di quota: guarda **quando** arrivano i pezzi,
non quanti, usando i battiti da 15 secondi invece di un prompt — perché un proxy che
bufferizza li consegna tutti, solo tutti insieme alla fine, e contarli non distingue un
flusso vivo da uno morto.

Nello stesso giro `vigila` esce da `push.ts` e diventa `chiamate.ts` con un elenco di
`Canale`: **una** decisione (`callFor`, che sta in `core/` esattamente per questo) e N
canali. Due osservatori indipendenti avrebbero due mappe e due debounce, e basta uno
scarto di 250 ms perché un canale dica «ha finito» e l'altro no. Nell'estrazione è caduto
un bug che c'era già: **un progetto silenziato taceva solo nella UI**, mentre il daemon
mandava il push lo stesso. E `isDir` si è spostata da `server.ts` dentro
`registry.open()`, dove nessun chiamante può saltarla.
`npm run check` **115**, `npm run daemon` **52**.

**Telegram: bocciato e rimosso** (28 agosto 2026, decisione dell'utente). Un bot che
guidava una sessione per intero era stato scritto e provato; è stato **tolto** perché la
feature non ha senso per il prodotto. Via `src/daemon/telegram/`, le rotte
`/api/telegram*`, la sezione nelle impostazioni, il client, `npm run telegram` e le 18
verifiche del testo e della resa. Resta `chiamate.ts` con un canale solo (il Web Push):
l'astrazione `Canale` è nata lì, ma regge da sé — è **una** decisione (`callFor`) e N
canali, e il bug del progetto silenziato che taceva solo nella UI l'ha corretto quella
estrazione, non il bot.

Passo corrente: **le due misure mai fatte** (costo in quota del classificatore, costo del
risveglio di una conversazione lunga), che sono l'ultima cosa fra qui e la Fase 1 dichiarata
chiusa. Poi **l'adapter per OpenCode** (chiesto dall'utente il 27 agosto 2026). Supera
ADR-004, che riservava l'MVP a Claude Code: va scritto un ADR nuovo con la motivazione, non
cambiato quello vecchio. Restano i divieti veri (`deny`), le due misure di quota mai
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
