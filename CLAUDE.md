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
quota — 213 verifiche; `npm run ui:build` poi `npm run stark` aprono STARK nel browser;
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
Che `/clear` azzeri **davvero** non è stato dedotto dal nome: è stato misurato con tre prompt
veri (una parola nascosta → `/clear` → «che parola?» → «NONLOSO»). La sonda di allora non è
stata tenuta nel repo — quello che ne è rimasto è il comportamento, in
`src/adapters/claude-code/translate.ts` e in `docs/event-model.md`; la sonda che c'è,
`spike/risveglio-dopo-clear.ts`, prova l'altra metà, cioè che il taglio sopravviva allo Sleep. Da lì sono usciti
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
**Correzione del 27 agosto, sera** (`docs/costo-token.md`): la misura era giusta e la conclusione
no. La doc ufficiale ha una tabella di *chi* parte in quale modalità, e le righe sono due:
`claude -p` **e l'Agent SDK** partono in `default`, ma **un piano Pro/Max/Team in un terminale**
parte in **`auto`**. Cioè il termine di paragone vero — `claude` interattivo, che è quello che
usa l'utente — era già in `auto`, e STARK non stava aggiungendo nessun classificatore.
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

**Quattro cose per l'MVP, e una di esse era la domanda sbagliata** (27 agosto 2026, chieste
dall'utente dopo aver domandato «cosa manca per considerare completo l'MVP?»). Erano: la
**cache dell'elenco**, la **checklist dei todo**, il **plan mode**, la **ricerca**. La seconda
si è rivelata inesistente, e al suo posto ne è emersa una più grossa.

**L'elenco rileggeva ogni journal da capo, fino a quattro volte al secondo.** `registry.list()`
faceva `reduce(Journal.read(...))` su **ogni** file a ogni colpetto SSE. Misurato sul journal
vero da 12 MB (25.143 eventi): **82 ms per una sola conversazione**, 619 ms con dieci — di
event loop **bloccato**, perché `readFileSync` e `JSON.parse` sono sincroni: a fermarsi era
tutto, SSE compreso. La correzione non è una cache qualunque: è la prima volta che
l'append-only del §13 viene **usato** invece che solo rispettato. `Journal.readFrom(path,
offset)` legge solo la coda, e `reduce` non è altro che `applyTo` ripetuto — quindi lo stato di
prima più le righe nuove *è* lo stato di adesso. Da 619 ms a **0,13 ms** a riposo, 0,31 ms con
una riga nuova. Nello stesso giro: il journal di una sessione **viva** non si rilegge affatto,
perché la sua riga la scrive il processo e la sovrascriveva comunque — era lavoro buttato, e per
giunta proprio sulla chat più grande e più spesso ricalcolata. Due dettagli che non si
indovinano e che le prove tengono fermi: l'offset avanza solo oltre le righe **complete** (una
`writeSync` in corso può lasciare l'ultima a metà), e un file più **corto** dell'offset non è la
coda dello stesso file — è un altro file, e si rilegge da capo.

**`TodoWrite` non esiste.** Era la mia seconda proposta, e la premessa era sbagliata: la
checklist che si ricorda dalla TUI **non è fra i 32 tool** che il CLI 2.1.241 dichiara nel suo
`system:init` (verificato leggendo la cattura nativa di una sessione vera, non i tipi né la
memoria). È esattamente la regola «non dedurre, verificare» applicata a me stessa: avevo
descritto come «il pezzo più visibile della TUI che manca a STARK» una cosa che non c'è più.
Scritto in `docs/event-model.md` §16.10 perché sembra il contrario, e chi verrà dopo rischia di
rimetterlo.

**Al suo posto: i lavori che continuano da soli.** Cercando cosa il CLI usa *oggi* al posto dei
todo, sono saltati fuori due messaggi che STARK buttava via — `system:task_started` e
`system:task_notification`. Non è un dettaglio: un comando lanciato **in background** risponde
subito «Async agent launched successfully», quindi il suo `tool.ended` arriva positivo una riga
dopo e la conversazione lo mostrava **finito**. Misurato su un journal reale: `tool_result` alla
riga 53, esito vero alla riga **810**, cioè in un altro turno. Su una sola conversazione vera:
**316 lavori, 15 in background, 5 sub-agent e 10 falliti** — quei dieci fallimenti non erano
visibili da nessuna parte. Due eventi canonici nuovi (`task.started`/`task.ended`, §7) che si
attaccano alla **riga del tool che li ha lanciati**, non a una riga nuova: un lavoro in
background non è un secondo fatto, è ciò che si scopre dopo su un fatto già mostrato. Il
collegamento fra le due metà è il `taskId` e non il `callId`, che nella notifica non c'è —
e comunque la riga sta in un turno che non è più quello aperto. Verificato **sui dati veri**:
`spike/task-ui.ts` ripassa una cattura nativa dal traduttore e apre la UI su quel journal —
312 righe con il loro lavoro attaccato, e a schermo la riga di una sonda uccisa che adesso dice
`failed` col motivo, dove prima c'era un ✓ verde.

**Il piano si può leggere** (era la terza). `plan` era una delle modalità offerte dalla barra,
ma `ExitPlanMode` non compariva in `src/` né in `ui/src/`. Verificato dal vivo
(`spike/piano-todo-subagent.ts`): arriva come richiesta di permesso, con `{plan, planFilePath}`
— e siccome `plan` non è fra i campi in cui `summarize()` cerca il soggetto di un'azione, quella
card **non mostrava niente**. Si approvava un piano che non si poteva leggere. Ora è il terzo
stato bloccante del blocco in basso, accanto ai permessi e alle domande, con un corpo che scorre
e il markdown reso; e due eventi canonici propri (`plan.proposed`/`plan.replied`), per la stessa
ragione per cui le domande non sono permessi: un permesso si concede riconoscendo un soggetto,
un piano si approva **leggendolo**. Le due approvazioni sono due bottoni distinti — «accept
edits» e «ask me first» — perché nel terminale sono due voci, e `mode` viaggia **con**
l'approvazione (`updatedPermissions: [{type:'setMode'}]`, che funziona: misurato), se no
resterebbe una finestra in cui l'agent è ripartito ma la modalità è ancora `plan`.

Quella prova dal vivo ha trovato un bug che nessuna prova offline avrebbe visto: **STARK
conosceva solo le modalità che imponeva lui**. Il CLI passava davvero ad `acceptEdits` — lo
dichiarava nel suo `system:status` — e la barra di stato continuava a dire `plan`. Vale anche
per `EnterPlanMode`, che è un **tool dell'agent**: l'agent può cambiare modalità da sé. Ora il
traduttore emette `session.mode` ogni volta che un messaggio nativo ne dichiara una diversa
dall'ultima nota.

**E si cerca** (la quarta). Una casella sopra l'elenco, e i risultati che prendono il posto
dell'albero: cercare non è un posto dove andare, è un modo di guardare l'elenco. Due ricerche
tenute separate perché sono due domande diverse — **Titles** (filtro locale: i titoli sono già
tutti nel browser) e **Inside conversations** (il daemon, che ha i journal). La cosa che decide
tutto il resto: si cerca negli **snapshot**, non nei file. Quindi trova ciò che la UI mostra —
una risposta arrivata in trecento `text.delta` non esiste come frase intera in nessuna riga del
journal, e cercarla riga per riga non la troverebbe mai — e non rilegge niente, perché quegli
snapshot sono gli stessi della cache di cui sopra. Su dati veri: **16 ms** la prima richiesta,
**2,9 ms** la seconda. Premere un risultato apre la conversazione **su quel turno**, che si apre
da sé, si porta in vista e lampeggia; se stava sopra un `/clear`, si apre anche il capitolo che
lo conteneva.
Tre difetti trovati **guidando la UI vera**, nessuno visibile leggendo il codice o dalle prove
offline: una chiave duplicata in un `{#each}` (`each_key_duplicate`) che lasciava la barra su
«Searching…» per sempre — due corrispondenze possono cadere allo stesso punto dello stesso
turno; un tetto di cinque risultati che ne lasciava passare **48**, perché il limite si
controllava solo a fine turno e un turno solo ne conteneva decine; e il salto al turno trovato
che finiva **fuori vista**, perché l'auto-scroll rileggeva `stick` fuori dal frame e non dentro,
quindi vinceva la corsa e riportava in fondo (misurato: turno a −684px, scroll incollato al
massimo; dopo: turno a +45px). Il terzo si è corretto **chiudendo la corsa** — rileggere `stick`
dentro il `requestAnimationFrame` — invece di inseguirla con un ritardo.

Nello stesso giro è caduta un'ipotesi che sembrava un difetto: un «testo fantasma» dietro il
bottone «Keep planning» nella prima fotografia. Misurati i rettangoli veri: `sovrapposti: false`,
tutti e tre premibili con `elementFromPoint`. Era un fotogramma dell'animazione del blocco che
si espande. Senza la misura si sarebbe «corretto» un bug inesistente.

`npm run check` passa a **143**, `npm run daemon` a **34**. Sonde nuove in `spike/`:
`piano-todo-subagent.ts` (costa quota), `piano-ui.ts` (costa un turno), `ricerca-ui.ts` e
`task-ui.ts` (costo zero: rileggono journal e catture già esistenti).

**I capitoli chiusi da un `/clear` stanno sopra il bordo** (27 agosto 2026, chiesto
dall'utente con uno screenshot: «ha troppo spacing, e li voglio come WhatsApp o
Telegram»). Due cose. Lo spacing: fra due tagli di fila restava 14+8+14 = **36px**,
perché in un flex i margini **non collassano** — ora fra due righe consecutive c'è il solo
`gap` di `.conv` (**8px**, 11 da telefono con lo zoom), e servono due regole
(`.cleared + .cleared` e `.cleared:has(+ .cleared)`), non una: azzerare solo il
margine sopra ne lascia comunque 18.
La seconda è l'impianto: il capitolo vivo è alto **almeno quanto lo scroller**
(`.chapter.live { min-height: 100% }`), e siccome la conversazione parte già in fondo, il
primo turno della conversazione nuova cade **esattamente** sul bordo superiore e tutto ciò
che lo precede resta più in alto — si risale a prenderlo, e per tornare c'è la freccia che
c'era già. `flex-grow` **non** funziona ed è il pezzo che non si indovina: crescere
distribuisce lo spazio *avanzato*, quindi il capitolo si sarebbe fermato a riempire la
vista senza mai sfondarla — niente spazio da scorrere, e le righe sarebbero rimaste
visibili lo stesso. Il `100%` invece è alto quanto il **content box**, che esclude i 12px
di padding in basso: è quello che fa cadere l'inizio sul bordo al pixel invece che dodici
sopra. Subito dopo un `/clear` il capitolo vivo non esiste ancora e va creato vuoto, se no
le righe resterebbero in mezzo a una schermata deserta; e una schermata **completamente**
vuota si legge come un guasto, quindi lì (e solo lì) c'è una riga che dice dov'è finito il
resto. Misurato su Chrome e su **WebKit** (via l'HTTPS di Tailscale, perché su `http://`
semplice WebKit non carica STARK — vedi più sopra): 0 righe visibili aperta la chat, tutte
risalendo. `tools/prova-clear.ts` genera i journal per i casi che non capitano a comando.

**E un `/clear` non sopravviveva allo Sleep** (27 agosto 2026, trovato rispondendo a «il
comportamento è come ce lo aspettiamo?» dopo che l'utente aveva risvegliato la chat).
`spec.resume.ref` faceva **due mestieri**: dare il nome al journal e dire al CLI quale
conversazione riprendere. Di norma coincidono — all'apertura STARK passa il proprio id
come `sessionId` — ma un `/clear` li fa divergere, perché il CLI **sposta la conversazione
su un id nuovo**, che dichiara nel `system:init` successivo (→ `session.resumeRef`, già
nel journal e mai letto da `open()`). Risultato: il risveglio riapriva la conversazione di
**prima** del taglio. Misurato sulla chat vera dell'utente: **129.387** token prima del
`/clear`, **57.748** dopo, e di nuovo **129.387** al risveglio. Fix: `refDaRiprendere()`,
tre righe, `snapshot.resumeRef ?? spec.resume.ref` per i risvegli veri (un `fork` resta
dov'è: lì lo snapshot è quello del journal nuovo, cioè vuoto). Provato con l'A/B che
chiude il cerchio (`spike/risveglio-dopo-clear.ts`, costa quattro turni corti): parola
nascosta prima del taglio, `/clear`, Sleep, risveglio → col ref dal journal l'agent
risponde **NONLOSO**, col ref vecchio risponde **MELANZANA**. Stessa conversazione, stessa
macchina, minuti di distanza: cambia solo quale ref si passa. Vale la pena sapere perché
non era mai emerso: `npm run resume` usava già `first.resumeRef`, cioè la cosa giusta — a
sbagliare era la sola via che usa l'utente, quella della UI. `npm run daemon` passa a
**38**: le quattro nuove tengono ferma la regola senza aprire una sessione, perché è una
scelta fra due stringhe.

**Il vocabolario canonico è stato messo sotto carico vero, e il confine del §1 è
diventato codice** (27 agosto 2026, ADR-012). Due giri nella stessa sessione.

**P21 — la prova di carico.** La §15 della specifica era stata scritta a tavolino sui 94
schemi `Event*` di OpenCode; questa è la parte scritta dopo averci fatto passare dei
dati: server 1.17.20 su una cartella di prova, un turno che legge un file, ne scrive uno
e lancia un comando. Il modello **tiene dove è stato disegnato su OpenCode** — `text.*`,
`reasoning.*`, `step.*`, `permission.*` corrispondono nome per nome, e non è fortuna: è
§14 che li aveva presi da lì — e **si piega dove è stato disegnato su Claude Code**.
Le cose che valgono: `file.edited` e `session.diff` **non arrivano** (una `write` che ha
creato davvero il file non ne ha prodotto nessuno dei due, in nessun giro: l'effetto sta
dentro `tool.success.structured`, **senza hunks**, e il diff su OpenCode si *chiede*) —
quindi la schermata Effetti, che poggia sugli hunks che Claude Code regala, su OpenCode
richiede che sia l'adapter a costruirli; `session.idle` **non si è mai visto** su quattro
giri, compreso quello finito bene, quindi «il turno è finito» lì è una *deduzione* del
client e non un fatto annunciato; e `todo.updated` **esiste**, il che corregge la
conclusione presa il giorno prima — «`TodoWrite` non esiste» è vero *di Claude Code
2.1.241*, ma da lì avevo concluso troppo. La domanda giusta non era «il tool esiste?» ma
«**il fatto** esiste?». È la prima cosa che la prova ha trovato *mancante* nel modello, ed
è mancante per il motivo che ADR-012 prevedeva: il modello ha seguito un agent solo.
Un dettaglio che è costato un giro intero: lo spec dichiara il carico utile sotto
`properties`, **il filo manda `data`** — il permesso *era* arrivato e la sonda non lo
riconosceva. Detto in chiaro anche cosa non si è potuto misurare: la chiave OpenCode Zen
di questa macchina può usare **un solo modello** (il catalogo ne elenca 29 a chiunque,
gli altri danno 401) e quello si rompe spesso a metà turno, quindi `question.v2.asked`,
il revert, la compattazione e il cambio di agent restano visti solo nello spec.

**Il confine del §1, da parola a codice.** Cercando il contratto da far implementare al
secondo adapter si è scoperto che **non esisteva**: c'era la sola classe concreta, e a
importarla non erano le sonde ma `daemon/registry.ts`, `server.ts`, `memoria.ts`. Il
paletto n.1 dell'ADR era già violato **dalla parte di Claude Code**. Quattro falle, tutte
con lo stesso modo di fallire — **in silenzio**: `askTools: string[]` portava `Bash` e
`mcp__*` fino alla rotta HTTP (ora `ask: PermissionCategory[]`, e a tradurre è l'adapter,
come `events.ts` diceva già a parole); `configDir` era il nome della variabile d'ambiente
di Claude Code ed era arrivato **fin dentro la UI** (ora `profile`, stringa opaca);
`PermissionAnswer.remember` era un `PermissionUpdate` **dell'SDK Anthropic costruito
dentro `registry.ts`**, `destination: 'localSettings'` compreso — il daemon decideva in
quale file di Claude Code finiva la regola (ora è una stringa: *il soggetto*); e
`Live.adapter` era la classe concreta come tipo (ora `AgentSession`).
`memoria.ts` è passato sotto il confine come capacità **opzionale**
`setCommandDescriptions`, perché «scrivi una `description`» è del dominio ma «scrivila
nel `CLAUDE.md` globale» è la risposta di *quell'* agent. `src/adapters/index.ts` è ora
l'unico file che nomina un agent specifico.
Verificato **dal vivo**, non per esito HTTP: aperta una sessione con un `profile` che
punta a una cartella nuova, il processo figlio ci ha creato dentro `sessions/`,
`projects/` e `.claude.json`. Se il rinomino si fosse perso per strada quelle cartelle
sarebbero nate nel profilo vero — è la sola prova che distingue «il campo arriva» da «il
campo esiste». `npm run check` passa a **149**, `npm run daemon` resta a 38.
Scritto anche cosa resta **fuori** dal confine e si sceglie di lasciarcelo: le sonde che
aprono sessioni vere importano ancora la classe, e la UI spiega cos'è un profilo
nominando `CLAUDE_CONFIG_DIR` — testo corretto oggi, falso il giorno in cui la stessa
schermata dovrà descrivere il profilo di un altro agent.

**La prova di carico allargata, e il disegno dell'adapter** (27 agosto 2026, chiesto
dall'utente: «leggiti la documentazione ufficiale, sperimenta, e quando hai dati veri valuta come
costruire l'adapter»). Tre sonde nuove, due correzioni a me stessa, due ADR.

**L'SDK ufficiale esisteva e la P21 aveva sbagliato strada.** `@opencode-ai/sdk`, versionato
**appaiato al CLI** (1.17.20 ↔ 1.17.20) come `@anthropic-ai/claude-agent-sdk` ↔ Claude Code, ed
espone `createOpencodeServer()` — sa avviare il processo da sé, l'analogo di `query()`. Ora è una
dipendenza dichiarata (**ADR-013**), con i costi scritti e non nascosti: la superficie giusta per
una GUI è `/v2`, **ufficiale ma non documentata** (188 rotte pubblicate, un terzo documentate,
zero della famiglia `/api/*`), e il repo dichiara che quel pacchetto sarà sostituito da
`sdk-next`.

**ACP valutato a fondo e scartato come modello canonico.** 39 agent lo parlano, OpenCode
nativamente. Ma l'adapter ACP **ufficiale** di Claude ha dovuto aggiungere **sei estensioni
proprietarie** per esprimerlo, e ACP dichiara la quota del piano **fuori scope** per iscritto.
L'elenco di ciò che gli manca — quota, categorie del contesto, compattazione, `/clear`, fila
FIFO, classificatore, revert, sotto-agent annidati, MCP a caldo, ricerca file — è, una per una,
la lista delle cose aggiunte a STARK dopo aver misurato che il CLI le faceva e la GUI no. Cioè il
Principio 5 in forma di elenco. Resta ottimo come **terzo adapter** futuro, dietro lo stesso
contratto.

**Due correzioni a quello che avevo scritto poche ore prima.** (1) Su OpenCode **gli hunks ci
sono**: `FileDiff.patch` è in formato git e `step.ended` porta `snapshot` e `files[]` — cambia la
*porta* (si chiedono invece di arrivare), non la fattibilità. (2) «I tipi non sono i fatti»,
**terza volta in un giorno**: l'SDK di Claude Code dichiara `TodoWriteInput` e una famiglia
`TaskCreate/TaskUpdate/TaskList`, il che sembrava smentire §16.10 — ma la lista **runtime** di una
sessione vera (60 tool) ha `Task`/`TaskOutput`/`TaskStop` e **non** ha `TodoWrite` né i
`TaskCreate`. §16.10 regge, e ci si aggiunge la regola che l'ha salvata: **la fonte di verità è
l'handshake, non lo schema**. Stessa forma dell'hook `PermissionDenied` (dichiarato, mai
chiamato) e di `session.wait` di OpenCode (nei tipi, «not available yet» dal server).

**Il contratto del §1 regge senza modifiche**, ed è il primo risultato vero del secondo adapter:
il backend di OpenCode tiene **un server condiviso** con N sessioni dentro, quello di Claude Code
**spawna un processo per sessione**, e chi sta sopra non vede la differenza. Ne segue però che la
premessa di ADR-005 «risvegliare costa quota» è vera **di Claude Code**, non del dominio: su
OpenCode non c'è nessun contesto da rileggere.

**Dove si piega, e cosa si è deciso** (§14-bis di `docs/event-model.md`): `PermissionMode` è
vocabolario di Claude Code **dentro il modello** — OpenCode non ha modalità, ha **agenti** con
modello e permessi propri — e diventa **«opzioni di sessione» dichiarate dall'agent**
(**ADR-014**; ci sono arrivati anche gli altri: ACP ha deprecato `session/set_mode` per
`set_config_option`, e STARK era già a metà strada con `ModelChoice[]`/`ModeChoice[]`). Entrano
tre fatti nuovi dietro `Capabilities` — **`todo`**, **`session.retried`** e **`revert`**, l'ultimo
scelto dall'utente sapendo che è il più caro dei tre perché non è un evento ma una schermata da
disegnare. E nascono tre capacità nuove, che sono i punti in cui i due agent **non** si
somigliano: `planQuota` (su OpenCode non c'è un piano, c'è una chiave), `mcpPerSession` (là
`mcp.connect` prende `{name, directory}`, non un `sessionID` — l'unica funzione con cui STARK
aveva raggiunto il CLI, alla lettera non esprimibile) e `turnEnd` (`session.idle` non si è mai
visto in otto giri e `session.wait` non è implementato: la fine del turno si **deduce**).

**Quello che NON si è potuto misurare, scritto invece che dedotto.** La chiave OpenCode Zen di
questa macchina regge **un solo modello**, e quello si rompe a metà turno: la P23 è fallita su
tre scene su quattro. Restano non visti dal vivo `todo.updated`, `question.v2.*`, il sotto-agent
e un `file.edited` da un edit vero. Sono nello spec e nei tipi — cioè esattamente il genere di
certezza che le due correzioni qui sopra insegnano a non prendere per buona.

**Il secondo adapter esiste, e ADR-014 è fatta** (27 agosto 2026, sera). Il giorno più lungo
del progetto, e vale la pena leggerlo in ordine perché ogni passo è nato da quello prima.

**L'adapter OpenCode gira** (`npm run opencode`, 16/16 dal vivo). Il contratto del §1, scritto
la mattina guardando **un solo** agent, **non è stato toccato**: il daemon apre una chat
passando `agent: 'opencode'` e non sa nient'altro. Sotto, `host.ts` tiene **un server condiviso**
con N conversazioni mentre Claude Code **spawna un processo per conversazione**, e chi chiude
una sessione non sa quale delle due cose ha fatto. Era la domanda per cui ADR-012 esiste, e la
risposta è sì. Ne segue però che la premessa di ADR-005 — «risvegliare costa quota» — è vera
**di Claude Code**, non del dominio.
Il secondo adapter fa in un punto **meno** lavoro del primo: la fila FIFO dei prompt è nel
protocollo (`delivery: 'queue'`) e «consenti sempre» è una parola (`reply: 'always'`).

**Tre difetti che solo un secondo agent poteva far emergere**, tutti visti guardando: il menu
dei modelli **non aveva un tetto** (`max-height` esisteva solo nella media query del telefono —
con gli 8 modelli di Claude Code non si notava, con i **61** di OpenCode le voci in fondo
finivano sopra il bordo e non si potevano premere); la barra mostrava `auto`, **una modalità che
l'adapter aveva appena dichiarato inesistente**; e `'default'` è vocabolario di Claude Code —
là è un alias vero, su OpenCode non vuol dire niente, e una chat nata così restava sul default
del server, che qui è `big-pickle`, **morto a monte**: una chat nata rotta senza via d'uscita.

**«Consenti sempre» non consentiva niente** — bug vecchio quanto i toggle dei permessi, trovato
verificando che il secondo adapter non avesse rotto il primo, e **verificato con `git show` che
non fosse mio**. Quattro giri misurati con un `Write` (non un `echo`: i comandi innocui sono
pre-approvati e non chiedono niente — ci sono cascata una volta): l'hook `PreToolUse`
**scavalca `canUseTool`**, e il suo tipo di ritorno non ha alcun campo per ricordare qualcosa;
l'hook `PermissionRequest`, che nei tipi sarebbe la porta giusta, **non scatta mai**. Ma l'hook
è la strada che STARK usa sempre (in `auto` il classificatore risolve prima), quindi ogni volta
che una categoria era su «chiedi» il bottone si comportava come «Consenti» **e il journal
scriveva `always`**: la bugia su disco che il commento nel codice prometteva di evitare.
Il Principio 5 dice che STARK non deve poter meno del CLI, e nella TUI il «sempre» funziona:
quindi non si toglie il bottone, **si scrive la regola** (`adapters/claude-code/regole.ts`), col
formato misurato — non inventato — e la condotta di `memoria.ts`: è un file **dell'utente**, non
si riscrive, e un JSON illeggibile si rifiuta invece di sovrascriverlo.

**ADR-014: la modalità esce dal modello.** `PermissionMode` era l'enumerazione delle sei
modalità di Claude Code **dentro `core/events.ts`** — la quinta falla del confine, e l'unica che
stava nel modello e non nel daemon. Ora è una stringa aperta e chi la può usare lo **dichiara
l'agent**: `SessionOption`, l'evento `session.option`, il comando `session.setOption`. La barra
di stato è un ciclo su ciò che le arriva, disposto per `kind` — che è presentazione, non un
elenco di parole da conoscere. Misurato guidando la UI: **OpenCode** mostra `build` · `MCP none`
· `opencode/big-pickle` con le **sue** descrizioni; **Claude Code** mostra `auto` · `MCP none` ·
`claude-opus-5[1m]` con le sei e `bypassPermissions` spenta con la ragione vera.
Tre cose imparate facendola: i **journal già scritti** si disegnano con lo stesso codice dei
nuovi (se `options` è vuoto la UI chiama la **stessa** `optionsFrom` degli adapter — un solo
percorso, non due che divergono); **`note` non è `reason`** (uno è un avviso su una scelta che
si può fare, l'altro dice perché una voce è spenta — ed è la distinzione che ha tolto «no auto
mode» da tutti e 61 i modelli di OpenCode); e **le descrizioni le scrive l'agent**, perché
guardando la barra si è visto che su OpenCode la voce `plan` mostrava la frase di *Claude Code*,
capitata lì per omonimia: vera per caso, falsa nei fatti.

**Regressione su Claude Code: intatta**, provata su sessioni vere e non per esito HTTP —
`npm run slice` (invariante §4 OK), `slice` con `STARK_ASK=shell,edit` (le categorie diventano
davvero `Bash`, `Write`, `Edit`), `queue` 6/6, `resume` 4/4, e la UI guidata fino alla risposta.

**Una nota di metodo che si è ripetuta cinque volte in un giorno**: una prova che guarda il
posto sbagliato **non fallisce — mente, o scade**. `blocks` invece di `parts`; il chip del
modello; il testo del menu (mostra l'etichetta, non l'id); `pending` invece di
`pendingPermissions`; e un `echo` pre-approvato che dava «il meccanismo non scatta» quando era
solo silenzio. Leggere il nome vero costa dieci secondi; indovinarlo costa un giro.

`npm run check` 143 → **171**, `npm run daemon` 38, `npm run opencode` **16** — numeri
**del ramo del secondo adapter, prima del merge**; i totali di oggi stanno più in basso.

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
col layout salvato intatto. `npm run check` resta **109** (ramo del layout, prima del merge),
`npm run layout:check` è nuovo a **22**, `svelte-check` 0 errori su 107 file.

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

**Dove siamo davvero, dopo il merge del 27 agosto** (`f0cb303`: il ramo del secondo adapter,
quello del layout multi-pannello e quello dell'accesso da fuori casa, uniti insieme).
Qui c'era scritto «passo corrente: le due misure mai fatte, poi l'adapter per OpenCode».
**Sono fatte entrambe**, e lo dice questo stesso file poche righe più su: il merge ne aveva
lasciate **due copie**, ciascuna ferma al proprio ramo, e ognuna mandava a rifare lavoro
finito. Cade con loro anche il «va scritto un ADR nuovo»: ADR-012, 013 e 014 esistono.

I numeri delle suite scritti nelle sezioni qui sopra sono **per ramo, prima del merge**.
Dopo il merge, misurati il 27 agosto: `npm run check` **211**, `npm run layout:check` **22**,
`npm run telegram` **54**, `npm run opencode` **16**, `npm run daemon` **60**.

**Una prova che dipendeva dalla macchina che la esegue** (trovata nello stesso giro,
rilanciando le suite per rimettere in fila i numeri dopo il merge). `npm run daemon` dava
59 su 60, e la rossa era `sub VAPID = il primo host del perimetro`. Non era un guasto del
push: la prova chiamava `perimetro(['stark.esempio.test'])` e si aspettava che `soggetto()`
tornasse quell'host, ma `perimetro()` ci **somma** l'hostname Tailscale della macchina, che
finisce **primo** — misurato, non dedotto: `['deus-stark.tailaa7e75.ts.net',
'stark.esempio.test']`. Quindi verde su una macchina senza Tailscale e rossa su questa, cioè
verde sul portatile e rossa sul fisso. Corretta la **prova**, non `soggetto()`: costruisce
ora un `Perimetro` sintetico invece di chiederlo alla macchina, così misura la regola —
«il `sub` è il primo host ammesso» — e non la configurazione di rete di chi la lancia.
Quale dei due host debba avere la precedenza quando ci sono entrambi resta una domanda
aperta, e adesso è una domanda sul comportamento invece che un rosso da interpretare.

**Il lavoro di un turno sta in un blocco solo** (27 agosto 2026, chiesto dall'utente: «gli
agent passano molto tempo a informare cosa stanno facendo, e solo alla fine fanno un recap —
raggrupperei tutto prima del blocco finale»). Aperto un turno, fra la richiesta e la risposta
c'è una riga sola — `259 operations · 51 notes` — che si apre sull'elenco esatto di prima.
Dentro ci vanno tool, ragionamenti e le **narrazioni di servizio**; fuori restano la risposta
finale, le domande/permessi con la risposta data, il testo che introduce una domanda, la
compattazione, i retry e l'operazione in corso.

Un raggruppamento c'era già, e non serviva quasi a niente: accorpava tool e reasoning
**consecutivi**, e un testo qualunque lo spezzava. La premessa era scritta a mano lì accanto —
«se in mezzo l'agent scrive del testo, quel testo è la prova che si è fermato a dire
qualcosa» — sembrava ovvia, ed è caduta alla prima misura. Sui journal veri di questa
macchina un testo interstiziale ha **mediana 131 caratteri** (710 casi, solo 2 sopra gli 800):
è la didascalia di ciò che sta per fare, non un pensiero che finisce. E siccome l'agent ne
scrive uno ogni tre o quattro tool, spezzare lì voleva dire **non raggruppare mai**: un turno
vero da 418 parti restava **103 blocchi** in colonna. Adesso ne fa **2**, e il turno intero —
53 minuti di lavoro — sta in una schermata. Media su 48 turni veri: da **29,6 a 2,5** blocchi.

Il pezzo che non si indovina è **dove tagliare**, e non è una soglia di lunghezza: è la
posizione. Il testo scritto **subito prima di una domanda** ha mediana **2631** caratteri,
cioè la taglia del recap finale (**2487**), perché è la stessa cosa — l'agent che smette di
raccontare e si rivolge a te. Nasconderlo dentro il gruppo avrebbe lasciato nel flusso una
risposta senza la domanda a cui rispondeva. Sono due specie nette (interstiziali: p90 245
caratteri), e si separano per posizione senza niente da tarare. Il recap si riconosce così:
l'ultimo testo **e** ultima parte del turno — su un turno interrotto quel testo non c'è, e
prendere «il testo più in basso» direbbe che una risposta c'è quando non c'è (la coda è lunga
esattamente 1 in 46 turni su 48, 0 negli altri due: non serve un caso generale).

Deciso con l'utente, non da sola: **il gruppo resta chiuso anche mentre l'agent lavora** («mi
va bene più calmo») — si vede il contatore salire e l'operazione in corso, non il muro che
scorre. E niente conteggio dei falliti nell'intestazione, che avevo proposto e non è stato
voluto. Il conteggio delle note sta nello **stesso** `.k` delle operazioni, non nel `.v`
spento accanto: sono due conti della stessa cosa, e darne uno in tono minore direbbe che vale
meno.

Una conseguenza andava chiusa nello stesso giro: da quando i testi stanno dentro il gruppo, un
risultato di **ricerca** può cadere lì — e portare in vista un turno in cui la frase trovata è
dentro una riga chiusa è di nuovo «non portare in vista niente», la stessa malattia del
capitolo di `/clear` già corretta a suo tempo. Arrivando da una ricerca i gruppi si aprono
tutti: una `Match` porta il `turnId` e non la parte (`core/search.ts`), e dirlo con precisione
vorrebbe dire allargare il contratto della ricerca fin dal daemon.

La regola è uscita dal componente: sta in **`ui/src/lib/gruppi.ts`**, pura, e si prova con
`node` come già fa `layout.ts` per i pannelli — `npm run gruppi:check`, **24** verifiche
(il recap, il turno che finisce su un tool, il testo che introduce una domanda a una e a tre
parti di distanza, il ragionamento vuoto, la chiave del gruppo che non cambia mentre il lavoro
cresce). Una di quelle prove è nata **rossa dicendo la verità**: l'attesa che avevo scritto era
di prima della regola sul testo-che-introduce, e il codice aveva ragione lui.
Verificato **guidando la UI vera** su conversazioni reali, non solo per esito: A/B a 1280×900
sugli stessi turni prima e dopo (418 parti: 103 blocchi/3452px → 2/694px; 48 parti con una
domanda in mezzo: 26/1800 → 6/1219), a 390px che la riga non sfondi, e il salto da un
risultato di ricerca che apre davvero il gruppo (`gruppiAperti: 1, gruppiChiusi: 0`).

**Le sessioni giravano senza il system prompt di Claude Code** (27 agosto 2026, chiesto
dall'utente con priorità massima: «verifica che non stiamo usando più token di quanti ne
useremmo da CLI»). La risposta è no — e il perché è un difetto, non un merito.

Il fatto che regge tutto il resto, verificato leggendo `/proc/<pid>/exe` del processo figlio e
non dedotto: l'SDK **lancia il binario vero**,
`node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude` (`manifest.json`: 2.1.241), con
`--output-format stream-json --verbose --input-format stream-json`. Quindi la composizione del
prompt, i breakpoint di cache, la compattazione e il conteggio dei token li fa **lo stesso
eseguibile** che sta dietro `claude`: STARK non li può sbagliare, può solo passare opzioni
diverse. Tutta la domanda si riduce a `buildOptions`, un file solo.

E lì mancava una riga. **Non passare `systemPrompt` non vuol dire «lascia fare al CLI»**: l'SDK
lo sostituisce con una stringa vuota — `if (s === void 0) p = ""`, letto nel bundle, e la doc lo
dice («the SDK uses a minimal prompt […] This differs from `claude -p`, which uses the full
Claude Code prompt by default»). Misurato con `getContextUsage()`, che è la stessa domanda a cui
risponde `/context`: la categoria «System prompt» valeva **677** token invece di **3.969**. Le
chat di STARK giravano quindi con l'agent **istruito meno** di quello del terminale, e la cosa
non si vedeva perché fallisce nel modo peggiore: non dà errore, risponde peggio. Non era una
scelta — `grep -rn "systemPrompt" src/ docs/` non trovava niente: al tempo di ADR-009 quel
default *era* il prompt di Claude Code, è cambiato nella v0.1.0 dell'SDK, e un'opzione che non
si passa non compare in nessuna diff.
Corretto passando il preset. Da qui in avanti STARK manda **+1.348** token rispetto al CLI
headless nudo, e sono tutti `AskUserQuestion` — cioè spesi per poter *quanto* il terminale, non
di più: senza `canUseTool` le domande dell'agent spariscono del tutto.
Cosa **non** si perdeva, e sembra il contrario: `CLAUDE.md` e le skill c'erano (62.414 e 1.875
token, identici con e senza il preset). Quelli non passano dal system prompt.

Due premesse cadute nello stesso giro. `settingSources`: il cambio della v0.1.0 («nessun setting
dal filesystem») è stato **annullato**, omettere il campo equivale al CLI — misurato, passarlo o
no dà lo stesso identico totale. Quindi «Command descriptions» di `memoria.ts` **è letto davvero**
dalle sessioni STARK, cosa che non era scontata. E la modalità di default: vedi la correzione in
loco più sopra.

**Sulla cache, la parità è per costruzione e la TTL è un'ora.** Il binario tiene una diagnostica
interna delle cause di cache miss (`system prompt changed`, `tools changed (+N/-N tools)`,
`model changed`, `cache_control changed (scope or TTL)`, …), e confrontandola con l'elenco
ufficiale: la riconciliazione MCP a ogni turno **non** invalida niente (tocca solo in caso di
delta, e con i tool *deferred* — attivi, 15.030 token nella loro categoria — connettere o
disconnettere un server «only appends new content»); il chip della modalità è cache-safe per
dichiarazione esplicita; il chip del modello invalida, esattamente come `/model` nel terminale;
e `getContextUsage`/`quota`/`file_suggestions` sono canale di controllo, non chiamate all'API.
La TTL della conversazione principale su abbonamento entro quota è **un'ora**, e gli «Agent SDK
turns» stanno nello stesso secchiello dei turni interattivi — il che chiude la misura lasciata a
metà («regge 420 secondi, oltre non misurato»): 420 era ampiamente dentro, il limite è 3.600.
Ricaduta a favore del layout multi-pannello: la cache è **per macchina e cartella**, quindi N
chat affiancate sullo stesso progetto **condividono** il prefisso invece di moltiplicarlo.

**L'unico punto in cui STARK spende davvero più del terminale è la fila FIFO**: due prompt
mandati mentre l'agent lavora aprono due turni, cioè due richieste e due generazioni di output,
dove il CLI che riceve un lotto li fonde in uno. Non è un difetto da correggere — è la scelta
già registrata più sopra — ma finora non era scritto da nessuna parte che quello è il costo.

**E il titolo non lo genera più l'agent.** STARK non passava `title`, quindi il CLI se lo
inventava con una chiamata al modello per rispondere a una domanda a cui `titleOf` risponde
gratis. Tre fatti misurati prima di toccarlo: le **163** voci `ai-title` di una sessione vera
sono lo *stesso* valore riscritto (una generazione sola, non 163); il titolo **non arriva nel
flusso**, quindi non lo si poteva usare invece di buttarlo; e il campo conta **solo alla
nascita**, perché su un risveglio vince il titolo persistito. Il costo, dichiarato perché è
una scelta: alla nascita STARK il titolo non ce l'ha ancora, quindi passa il proprio
segnaposto — e dal terminale quelle chat si chiamano `new chat <id8>` invece di avere un
riassunto. Deciso dall'utente sul criterio «meno token e costo dell'agent».
La via per riallineare il segnaposto esiste e **non è percorribile**: `renameSession` è
filesystem e non quota, ma risolve la cartella dal `CLAUDE_CONFIG_DIR` **del processo che
chiama** — misurato, non dedotto: con `dir` esplicito e un config dir finto fallisce — e a
chiamare sarebbe il daemon, che ne ha uno solo mentre STARK tiene un profilo per progetto.
Sonda `spike/titolo-non-generato.ts`, **costa un turno corto**: verificato dal vivo passando
dalla via dell'utente, **0** voci `ai-title` e `customTitle` uguale al titolo di STARK.

Il documento è `docs/costo-token.md`, la sonda `spike/costo-vs-cli.ts` (**costo zero di quota**:
handshake più una richiesta di controllo, nessun turno parte mai). Va rifatta a ogni salto di
versione del CLI incluso. Due trappole che ha insegnato: un generatore di prompt **vuoto** chiude
lo stdin e il processo muore prima che si possa chiedere il contesto; e `System tools (deferred)`
**non** entra nel totale (la somma delle altre categorie dà esattamente `totalTokens`).

**Cosa si puo' allegare lo dice il modello, non STARK** (28 agosto 2026, chiesto
dall'utente: «il tasto allega file deve essere disabilitato se il modello non e'
multimodale, e se lo e' usa il parametro che dice quali formati accetta»).

Prima la risposta era una costante di quattro tipi immagine scritta in **due** posti —
`Dock.svelte` e `registry.ts`, con accanto il commento «i quattro tipi che il modello
accetta». Non erano del modello: erano di STARK, e valevano identici per un modello che
legge i PDF e per uno che non guarda niente. Adesso e' `ModelChoice.accepts`, dichiarato
dall'agent modello per modello, e la casella di scrittura **non conosce nessun tipo per
nome** — e' la stessa forma di ADR-014 per le modalita': non un elenco di parole da
sapere, ma un elenco che arriva.

Le due meta' della domanda hanno risposte opposte, ed entrambe sono **misurate**
(`spike/allegati-dichiarati.ts`, costo zero: un handshake e una domanda di configurazione).
**Claude Code non dichiara niente**: `list_models` porta `supportsEffort`,
`supportsAutoMode`, `supportsFastMode` e nient'altro — nessun campo sulla multimodalita',
sui cinque modelli veri dell'account. **OpenCode lo dichiara eccome**:
`capabilities.input.{text,image,audio,video,pdf}` per modello — 151 modelli su questa
macchina, 61 con immagini e 4 con PDF. Da qui la divisione del lavoro: dove il parametro
c'e' si legge, dove non c'e' lo scrive l'adapter e lo dice.

Due trappole che sono costate un giro ciascuna. La prima: **i tipi non sono il filo**, per
l'ennesima volta — `ProviderConfig` promette `attachment` e `modalities` piatti sul
modello, il server manda `capabilities` annidato, e la prima sonda che ha guardato nel
posto sbagliato non e' fallita: ha risposto «zero modelli con allegati», che sembra un
fatto. La seconda: **`attachment: true` non vuol dire «accetta immagini»** — otto modelli
ce l'hanno senza leggere ne' immagini ne' PDF (voce e video di nvidia), e dedurre le
immagini da quel flag avrebbe riacceso la graffetta esattamente dove il modello aveva
appena detto di no.

Cosa offre Claude Code, e perche' e' piu' delle quattro immagini di prima: un blocco
`document` passa dal CLI e arriva al modello, sia in base64 con un PDF sia come testo
semplice — provato dal vivo (`spike/allegato-pdf.ts`, un turno corto per caso: la parola
nascosta nel PDF e' tornata indietro). Quindi PDF, TXT, Markdown e CSV, oltre alle
immagini. `text/markdown` e `text/csv` non sono media type che l'API accetta in un
`document` (quello vuole `text/plain` e basta): la distinzione e' fra cosa l'utente puo'
scegliere e cosa parte, e la seconda meta' la fa l'adapter. Rifiutare un `.csv` sarebbe
rifiutare un file che il modello legge, per una ragione che riguarda noi.
E cade con questo una frase che era in `docs/event-model.md` dal principio: «un file di
testo non e' un allegato, si nomina per percorso». Vera per un file **del progetto**, che
infatti si cita con `@`; falsa per un file che arriva da fuori, perche' dal telefono un
percorso da nominare non c'e'.

Quello che **non** si offre, detto invece che scoperto dopo: audio e video. OpenCode li
dichiara e la sua `FilePart` porterebbe qualunque MIME, ma STARK non li sa ne' scrivere su
disco (`ESTENSIONE` in `core/allegati.ts`) ne' mostrare in conversazione — sarebbe un
bottone che accetta un file e poi lo perde.

Tre conseguenze strutturali. `PromptPart` ha un caso `file` accanto a `image`, e sono due
apposta: la differenza e' di chi disegna — un'immagine si mostra, un file si nomina, e
fonderli avrebbe messo un `<img>` su un PDF, cioe' l'icona di immagine rotta su un allegato
arrivato benissimo. `PromptImage` del contratto §1 e' diventato `PromptFile`. E il filtro
per tipo nella casella **non e' la difesa**: quella resta la tabella del registro, che
scrive su disco solo cio' che sa nominare — il filtro dice cosa ha senso offrire, il
cancello dice cosa entra.
Un dettaglio che si scopre solo provandolo: `File.type` dal browser e' spesso **vuoto** su
`.md` e `.csv`, perche' dipende dal database MIME del sistema. Fidarsi solo di quello
rifiutava un file che il modello legge, con un messaggio che diceva «e' un », cioe' che non
diceva niente: `tipoDi()` guarda l'estensione come secondo parere.

Verificato **guidando la UI vera** su sessioni vere (costo: un turno corto in tutto),
non per esito HTTP: su Claude Code la graffetta e' accesa e dice cosa prende (`Attach a
file — PNG, JPEG, GIF, WebP, PDF, TXT, Markdown, CSV`), un `.zip` viene rifiutato **con il
motivo** invece di sparire, un PDF e un `.md` si accodano come schede col nome; su una chat
OpenCode aperta su un modello di solo testo la graffetta e' **spenta** (opacita' .45,
`disabled`) e dice perche' — e forzando comunque un file dall'input nascosto (che e' cio'
che fanno il trascinamento e l'incolla) viene rifiutato, non accodato in silenzio. Il pezzo
che mostra tutto il senso della cosa: **cambiando modello a caldo** sulla stessa chat
(`nemotron-nano-12b-v2-vl`, che dichiara `image` ma non `pdf`) la graffetta si riaccende e
l'elenco si stringe alle sole immagini, col PDF rifiutato. Giro completo dalla via
dell'utente: PDF allegato nella UI, mandato, letto dall'agent — e nel flusso la scheda col
nome e il peso, che si apre.
`npm run check` cresce di **14** verifiche.

**Si installa con un comando, e gira anche su Windows nativo** (28 agosto 2026, chiesto
dall'utente: «se oggi volessi far installare STARK a un collega cosa devo fare?»).
`curl -fsSL …/install.sh | sh` su Linux, WSL2 e macOS; `irm …/install.ps1 | iex` su
Windows. Poi `stark`, e basta.

**La domanda che ha deciso tutto è stata quella dell'utente su `sudo`**: «se non è sudo,
può lanciare il claude installato da un utente sudo? quell'istanza ha i permessi di
sudo?». La risposta separa due cose che sembrano una sola, ed è stata **verificata, non
dedotta**: il `claude` bundled è `-rwxr-xr-x root root` e **non ha il bit setuid**
(`find -perm /6000` non trova niente), e in `src/` non c'è una riga che cambi utente
(`sudo`, `setuid`, `uid:` → zero). Quindi `sudo` serve **solo a scrivere il file** del
lanciatore e non lascia dietro nessun privilegio: a decidere cosa l'agent può fare è
**chi digita `stark`**, sempre, perché il daemon fa `spawn` del CLI e quello eredita uid
e gid. Il requisito dell'utente — «gli stessi permessi che avrebbe da terminale» — è
soddisfatto *per costruzione*, non da una regola da mantenere.
Da lì la scelta di installare **per utente** (`~/.local/bin`, `~/.local/share/stark`), e
i due argomenti che la reggono sono a favore, non un ripiego: `/usr/local/bin/stark` è
condiviso ma i due percorsi assoluti che contiene no — un altro utente lo troverebbe nel
`PATH` e prenderebbe un errore di permessi sul repo; e inviterebbe a lanciarlo con
`sudo`, che non è «lo stesso STARK con più poteri» ma **un altro STARK**, perché
`~/.claude` e `~/.stark` seguono l'utente e cambierebbero login, journal, token e
impostazioni tutti insieme. `--system` resta, spento e con la ragione scritta.

**Il bug che quella scelta ha scoperto, e che c'era già**: `avviaConSystemd()` chiamava
`systemd-run` **di sistema**, che vuole root. Per un utente normale falliva e si
ripiegava su `spawn(detached)` — cioè esattamente il caso documentato come rotto il 27
agosto, con logind che ferma lo scope del terminale e porta via tutto il cgroup. La
protezione scritta quel giorno valeva quindi **solo per chi gira da root**, e per tutti
gli altri il bug era ancora lì, silenzioso. Ora da utente si usa `systemd-run --user`,
verificato dal vivo sul manager utente di questa macchina (unità `active`, `--setenv`
propagato, `--property=StandardOutput=append:` che scrive davvero). Il limite è scritto
invece di essere scoperto: senza `loginctl enable-linger` il manager utente muore
all'**ultimo logout** — chiudere una finestra di terminale va bene, disconnettersi
dall'ultima sessione SSH no.

**Windows nativo, non WSL** (scelta dell'utente, contro la mia raccomandazione). Il
pezzo che lo rendeva possibile andava verificato per primo: l'Agent SDK **pubblica**
`claude-agent-sdk-win32-x64` e `win32-arm64` fra le sue `optionalDependencies`, quindi
lassù c'è un `claude` vero da lanciare. Senza quello non ci sarebbe stato niente da
portare. Il porting tocca cinque punti, e sono tutti dichiarati sul posto:
`core/platform.ts` prende una costante `WIN` accanto a `WSL` — sono **mutuamente
esclusive**, e la differenza non è «c'è Windows» ma **come lo si raggiunge**: da WSL per
interop (`cmd.exe`, `wslpath`, percorsi da tradurre), da `win32` diretto. `reveal.ts`,
`launch.ts` e `native-browse.ts` prendono ciascuno un ramo `win32` che è il proprio ramo
WSL meno la traduzione dei percorsi — e in `native-browse.ts` il PowerShell del dialogo
è diventato una funzione sola (`scriptDialogo`), perché due copie divergono alla prima
correzione fatta su una. `commandExists` passa a `where`: `which` lassù non esiste, e
chiederlo comunque non darebbe «comando assente» ma un errore su `which` stesso — la
risposta giusta per il motivo sbagliato, che regge finché qualcuno non installa Git for
Windows e si porta dietro un `which` che risponde di tutt'altro `PATH`.

**Le tre cose di Windows che non si indovinano**, e che hanno prodotto codice nuovo:
1. **`process.kill(pid, 'SIGTERM')` non consegna un segnale.** Node lo traduce in
   `TerminateProcess`, che è la `kill -9` di lassù: nessun handler gira, i journal
   restano aperti a metà turno e i processi degli agent restano **orfani**, perché su
   Windows i figli non muoiono col padre. Da qui `POST /api/shutdown`, che risponde 200
   e poi fa `process.emit('SIGTERM')` — cioè fa girare **lo stesso** handler registrato
   in `stark.ts`, invece di una seconda procedura di chiusura che un giorno divergerebbe.
   Su POSIX il segnale funziona ed è la via provata, quindi lì `stark stop` non passa di
   qui. Verificato dal vivo su Linux (la rotta è cross-platform anche se la usa solo
   Windows): 200, «chiusura…» nel log, pid file rimosso, porta chiusa, unità raccolta —
   e **403 su tutte e quattro** le difese (niente token, token sbagliato, `Origin`
   estraneo, `Host` estraneo), col daemon vivo dopo ognuna.
2. **`detached: true` lassù non è `setsid()`** ma il flag `DETACHED_PROCESS`: il figlio
   non eredita la console, quindi non riceve il `CTRL_CLOSE_EVENT` che il sistema manda
   a chi è attaccato a una finestra che si chiude. È la stessa garanzia del ramo systemd,
   ottenuta dal meccanismo che offre Windows. Con `windowsHide`, se no resterebbe lì una
   finestra di console vuota.
3. **`npm` è `npm.cmd`**, e dal 2024 Node **rifiuta** di eseguire un `.cmd` senza
   `shell: true` (CVE-2024-27980).

**Il difetto più istruttivo è saltato fuori solo dall'installazione vera**, non dal
codice: `stark update` chiamava `npm` **dal `PATH`**, mentre il lanciatore pinna il Node
con un percorso assoluto. Su una macchina in cui il `PATH` porta un Node vecchio — che è
esattamente la condizione del collega, ed è questa macchina: `/usr/bin/node` è un
**Node 12** — moriva su «npm install è fallito» senza nominare il colpevole. Servono
**tutte e due** le metà, e la seconda si dimentica: il percorso assoluto a `npm`, e la
sua cartella in testa al `PATH` del figlio, perché npm è uno script che a sua volta
invoca `node`. Trovato eseguendo l'installer per davvero, non leggendolo.

**La regola del verbo di default è uscita dal lanciatore ed è entrata nel CLI.** Stava
scritta in `sh` (`case "${1-}" in ""|-*) set -- up "$@"`), e su Windows sarebbe servita
una seconda volta in `cmd`, dove «il primo argomento è un'opzione, non un verbo» costa
sei righe di `findstr`. Ora il lanciatore dichiara `STARK_DEFAULT_VERB=up` e la regola
sta in tre righe di TypeScript, in un posto solo. `npm run stark` resta su `run`.

**Cosa è stato provato dal vivo, e cosa no.** Provato: il giro completo dell'installer in
una `HOME` isolata e con `PATH=/usr/bin:/bin` — così è scattato anche il ramo «Node
troppo vecchio», che ha scaricato la 24.13.1 dentro la cartella di STARK; poi clone,
`npm install`, `ui:build`, lanciatore generato col Node **suo**, daemon acceso staccato,
UI servita **200**, `status`, `stop`, e un `stark update` che prende un commit nuovo,
ricompila, riscrive il lanciatore e riavvia il daemon conservando il token. Provata anche
l'idempotenza del blocco nel `.bashrc` (due installazioni, **un** blocco), con la stessa
condotta di `memoria.ts`: è un file dell'utente, non si riscrive, si aggiunge in fondo un
blocco riconoscibile. La sintassi di `install.ps1` è validata dal parser di un
**PowerShell 5.1 vero** (raggiunto per percorso assoluto: su questa macchina l'interop
WSL c'è ma `powershell.exe` non è nel `PATH`), e la manipolazione del `PATH` utente è
stata eseguita in sola lettura sul registro vero — 10 voci, che è il motivo per cui si
usa `[Environment]::SetEnvironmentVariable` e **mai `setx`**, che tronca a 1024 caratteri
e cancellerebbe in silenzio metà del `PATH` di chi ce l'ha lungo.
**Non** provato, e va detto: i rami `win32` di `reveal`, `launch` e `native-browse`, e
`install.ps1` eseguito per intero — non c'è una macchina Windows nativa qui, e il codice
lo dice riga per riga invece di lasciarlo dedurre. Non provato nemmeno `systemd-run
--user` da un utente **non** root con una sessione logind vera: è stato verificato il
meccanismo, non quel caso.

Le suite del ramo, prima del merge: `npm run check` **243**, `npm run daemon` **91**,
`npm run layout:check` 22, `npm run gruppi:check` 24, `typecheck` pulito. **Dopo il merge**
con `origin/main` (scorciatoie, Palette, riavvio dal pannello, Usage): `check` **269**,
`daemon` **103**, typecheck pulito.
Le due rotte che escono dallo stesso merge non si pestano i piedi ed è bene sapere perché:
`/api/restart` accende un ricambio e **poi** muore, `/api/shutdown` muore e basta — la
prima è «prendi l'aggiornamento senza tornare al terminale», la seconda è la sola via con
cui `stark stop` può chiudere con garbo su Windows.

**Il menu del tasto destro cadeva lontano dalla riga premuta** (28 agosto 2026, segnalato
con uno screenshot: «troppo spostato rispetto all'elemento su cui ho premuto»). Non era un
offset da correggere a occhio: era una **conversione mancante**. `Sizer` applica uno `zoom`
al `documentElement`, e lo zoom ridisegna il layout — quindi un `left` scritto su un figlio
del root vale `zoom` pixel veri, mentre `clientX`/`clientY` di un evento del puntatore sono
già pixel veri della finestra. Scriverli tali e quali moltiplicava la distanza dall'angolo
per il fattore di zoom, e `position:fixed` non salva: il suo blocco contenitore è la
finestra **misurata nelle unità del root**. Misurato in Chromium prima di scrivere una riga:
clic a (189, 290) → elemento disegnato a (255, 391), cioè esattamente ×1,35. Sul desktop non
si vedeva perché lì lo zoom è 1: il difetto compare sotto gli 860px, dove il fattore ×1,35
degli schermi stretti si somma alla preferenza di dimensione testo.
Fix: `ui/src/lib/zoom.ts`, che **misura** il fattore invece di ricalcolarlo dal `Sizer` —
due sorgenti di verità sullo stesso numero divergerebbero al primo fattore nuovo, e il
`Sizer` moltiplica già la scelta dell'utente per la soglia stretta.
`getComputedStyle(root).zoom` è la fonte (verificato esatto a 80/100/135/150/202%), col
rapporto fra rettangolo e `offsetWidth` come rete di sicurezza per un motore che non la
esponga — quello arrotonda (1,3493 invece di 1,35), quindi è il secondo e non il primo. Un
motore che non conosce `zoom` non lo applica nemmeno: lì 1 è la risposta giusta.
Nello stesso giro il menu smette di sfondare il bordo: aperto in fondo all'elenco le ultime
voci finivano fuori schermo e non si potevano premere. Il ritocco usa il rettangolo vero
dell'elemento (già in pixel veri, quindi il confronto con la finestra è diretto) e la
divisione arriva **una volta sola** alla fine; la prima posizione disegnata è già quella
giusta rispetto al cursore, così non c'è un fotogramma in cui il menu compare nell'angolo
sbagliato.
Verificato **A/B nella UI vera** su un daemon di prova con journal finti (costo zero di
quota), non a occhio: stesso clic a 390px, scarto **(5,3 · 79,4)** prima contro **(0 · 0)**
dopo; a 1400px **(0 · 0)** in entrambi i casi, cioè il desktop non è cambiato. Controllato
anche che lo strato che chiude il menu (`.catch`, `fixed; inset:0`) copra ancora tutta la
finestra sotto zoom — `inset:0` è ancorato ai due bordi, quindi non risente della stessa
malattia: 390×844 pieni, e un clic nell'angolo in basso a destra chiude.
**Un'altra misura sfalsata dalla stessa causa, non corretta qui**: il trascinamento che
allarga l'helper (`Helper.svelte:135`) somma un delta di `clientX` — pixel veri — a una
larghezza in unità del root, quindi sotto zoom la colonna segue il dito più veloce del dito.
Stessa cura, `zoomRoot()`, quando si toccherà quel punto.

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
