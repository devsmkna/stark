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

Come si esegue: `README.md`. Node **≥ 22.18** (i `.ts` del daemon girano diretti, senza build;
la UI invece si compila, vedi ADR-010). `npm run check` prova tutta la catena a costo zero di
quota — 34 verifiche; `npm run ui:build` poi `npm run stark` aprono STARK nel browser;
`npm run slice` apre una sessione vera.

Per **guardare** la UI invece di descriverla:
`node tools/shot.mjs <url> <fuori.png> [selettore ...]` la fotografa senza spendere quota, e i
selettori si premono in fila per arrivare alle schermate che stanno a due passi. Un journal da
dare in pasto al daemon lo produce `npm run check`; e aprire una sessione con
`POST /api/sessions` **non costa quota** (è solo l'handshake), che è come si guardano gli stati
che hanno bisogno di un processo vero. Vedi `docs/ui-implementazione.md` §1.

Passo corrente: **le impostazioni**, che richiedono lavoro sul daemon prima
(`permissions.setRules` non è gestito; profili, colori e diagnostica non esistono).

Cosa manca nella UI, oltre alle impostazioni: nessun **instradamento**, quindi un ricaricamento
perde la chat scelta; i **server MCP per chat** non si scelgono, perché il daemon non li
elenca; e delle notifiche mancano le due parti che vivono nelle impostazioni — **scegliere il
suono** di ciascun evento e **silenziare un progetto** intero.

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
- `--tools ""` NON spegne i tool MCP: serve `--strict-mcp-config`. Senza, ogni sessione eredita
  tutti i server MCP globali della macchina (rischio di fuga dati e ~5x di contesto per turno).
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
