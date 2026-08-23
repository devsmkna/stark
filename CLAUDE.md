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

- **Punto della situazione — LEGGI QUESTO PER PRIMO** — https://app.notion.com/p/3c3fef5cacd9817ea071eb098c381dc6
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
- **Riferimento tecnico — Claude Code come piattaforma** — https://app.notion.com/p/3c5fef5cacd981f1b556fbe1e2b7bd0e
  Cosa è documentato ufficialmente e cosa no, con le versioni verificate. **Da leggere prima di
  toccare l'adapter**: dice quali pezzi sono garantiti e quali possono cambiare senza preavviso.
- **Spike tecnico — Risultati** — https://app.notion.com/p/3c3fef5cacd9817c8612ea39506f9bf9
- **Architettura del core** — https://app.notion.com/p/3c3fef5cacd981ea8b9ee41142c7aa3e
- **Roadmap** — https://app.notion.com/p/3c3fef5cacd981b7a796df6f09a16f2d
- **Domande aperte** — https://app.notion.com/p/3c3fef5cacd981f688d2c486c3119b04

Ogni decisione strutturale va registrata come **ADR con la motivazione**, così che se in futuro
la si rimette in discussione si sappia su quali premesse era stata presa.

## Stato attuale

Spike concluso. Specifica del modello di eventi scritta (`docs/event-model.md`).
**Fetta verticale implementata e funzionante**: sessione Claude Code reale → eventi canonici →
journal JSONL → Sleep → stato ricostruito dal journal, identico a quello dal vivo.
Non esiste ancora nessuna UI, né il daemon vero (una sessione sola, niente HTTP).

Come si esegue: `README.md`. Node **≥ 22.18** (i `.ts` girano diretti, senza build).
`npm run check` prova tutta la catena a costo zero di quota; `npm run slice` apre una
sessione vera.

Passo corrente: **decidere il prossimo pezzo** fra daemon multi-sessione, risveglio con
`--resume`, e layout della UI.

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
  **Conseguenza: ADR-007 va corretto su Notion, il prerequisito Node passa da ≥20 a ≥22.18.**
- pannello terminale per sessione: **dopo** l'MVP

Ancora aperte: layout della UI, accesso (solo localhost o anche LAN con auth), uso da mobile,
il nome STARK per il branding (vincolo: "Claude Code" non è utilizzabile per il branding di un
prodotto; "STARK, Powered by Claude" sì).

**Principio permanente, dato dall'utente il 23 agosto 2026:** se esiste qualcosa di **ufficiale e
già pronto**, si preferisce sempre — così si scala e ci si adatta aggiornandosi, invece di
riparare qualcosa costruito in casa. A dover essere motivato è il *non* usarlo.

## Versioni su cui stiamo costruendo (verificate il 23 agosto 2026)

Claude Code CLI **2.1.241** · `@anthropic-ai/claude-agent-sdk` **0.3.241** · Node 24.13.1.
Il patch dell'SDK insegue quello del CLI (0.3.**241** ↔ 2.1.**241**): vanno aggiornati insieme.
Per capire cosa una versione supporta **non si confrontano stringhe**: `system/init` porta un array
`capabilities` con i nomi dei comportamenti di protocollo, ed è documentato usare quello.

## Vincoli dell'ambiente da tenere presenti

- Si opera come **root**: `--dangerously-skip-permissions` è vietato per policy.
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
  Node: 24.13.1 su `/mnt/m/devs-development/stark/stark`, ancora 18.x su `/root/DevsMachna/stark`.
  ADR-007 rende ≥20 un prerequisito: va aggiornato lì prima di implementare.
- Il repo vive su un mount DrvFs (`/mnt/…`): `git status` segnala come modificati file il cui
  contenuto è identico a HEAD. È una limitazione dello stat cache di git su quel filesystem,
  non una modifica reale — verificare sempre con `git diff` prima di crederci.

## Sicurezza (requisito, non accorgimento)

STARK esegue comandi arbitrari **come root**. Quindi: ascolto su localhost per default,
autenticazione obbligatoria per qualunque esposizione oltre localhost, apertura sulla LAN
sempre come scelta esplicita dell'utente e mai come default.
