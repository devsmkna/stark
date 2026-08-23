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
  - ADR-007 — Stack tecnologico e persistenza (Node ≥20 + TS, journal JSONL)
- **Spike tecnico — Risultati** — https://app.notion.com/p/3c3fef5cacd9817c8612ea39506f9bf9
- **Architettura del core** — https://app.notion.com/p/3c3fef5cacd981ea8b9ee41142c7aa3e
- **Roadmap** — https://app.notion.com/p/3c3fef5cacd981b7a796df6f09a16f2d
- **Domande aperte** — https://app.notion.com/p/3c3fef5cacd981f688d2c486c3119b04

Ogni decisione strutturale va registrata come **ADR con la motivazione**, così che se in futuro
la si rimette in discussione si sappia su quali premesse era stata presa.

## Stato attuale

Spike concluso senza blocchi. Perimetro strutturale dell'MVP definito.
**Nessuna implementazione avviata.**
Sintesi rapida dello spike: `spike/FINDINGS.md`.

Passo corrente: **scrivere la specifica del modello di eventi canonico in `docs/`**
(per ADR-003 quella specifica sta nel repo, non su Notion, perché cambia insieme al codice).

Decisioni già prese:
- canale strutturato JSON verso gli agent, NON un PTY (ADR-001)
- web app locale: daemon + UI nel browser, NON app nativa (ADR-002)
- un solo adapter nell'MVP: Claude Code (ADR-004)
- daemon persistente, con Sleep esplicito per sessione; TTL automatico rimandato (ADR-005)
- permessi: sessioni in `auto`, zero card di default; i toggle aggiungono attrito dove serve (ADR-008)
- Node ≥20 + TypeScript, journal JSONL append-only per sessione (ADR-007)
- pannello terminale per sessione: **dopo** l'MVP

Ancora aperte: layout della UI, accesso (solo localhost o anche LAN con auth), uso da mobile,
il nome STARK per il branding.

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
