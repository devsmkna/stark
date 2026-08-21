# STARK

Interfaccia web locale per gestire le sessioni con gli agent AI installati sulla macchina
(Claude Code, OpenCode, Codex, …).

## Principio di prodotto fondante

> STARK non è un terminale nel browser. È una **GUI che sostituisce la TUI**.
> Ogni volta che una scelta tecnica ci costringe a "simulare il terminale", è la scelta sbagliata.

## PRIMA DI LAVORARE: leggi la memoria di progetto

Le decisioni, le motivazioni e la roadmap NON stanno in questo repo: stanno su **Notion**
(workspace Digitizers). Il repo contiene solo il codice.

Pagina radice: https://app.notion.com/p/3c3fef5cacd98116bbedfc31ce29c6f1

**PARTI DA QUI** → **Punto della situazione** — https://app.notion.com/p/3c3fef5cacd9817ea071eb098c381dc6
Dice dove siamo, qual e' la domanda aperta in questo momento e cosa viene subito dopo.
Le conversazioni con l'agent non si sincronizzano fra le macchine: quella pagina e' il ponte,
e va aggiornata a fine sessione prima di cambiare PC.

- **Visione e principi di prodotto** — https://app.notion.com/p/3c3fef5cacd981fa914feb29624de853
- **Registro delle decisioni (ADR)** — https://app.notion.com/p/3c3fef5cacd98121ac5bf2b4a7597121
  - ADR-001 — Canale di comunicazione con gli agent
  - ADR-002 — Piattaforma: web app locale
- **Spike tecnico — Risultati** — https://app.notion.com/p/3c3fef5cacd9817c8612ea39506f9bf9
- **Architettura del core** — https://app.notion.com/p/3c3fef5cacd981ea8b9ee41142c7aa3e
- **Roadmap** — https://app.notion.com/p/3c3fef5cacd981b7a796df6f09a16f2d
- **Domande aperte** — https://app.notion.com/p/3c3fef5cacd981f688d2c486c3119b04

Nota: ADR-003 definisce dove vive cosa. Le specifiche accoppiate al codice (modello di eventi
canonico, contratti degli adapter) NON vanno su Notion ma in `docs/` in questo repo.

Ogni decisione strutturale va registrata come **ADR con la motivazione**, così che se in futuro
la si rimette in discussione si sappia su quali premesse era stata presa.

## Stato attuale

Fase di brainstorming e validazione. **Nessuna implementazione avviata, volutamente.**
Sintesi rapida dello spike: `spike/FINDINGS.md`.

Decisioni già prese:
- canale strutturato JSON verso gli agent, NON un PTY (ADR-001)
- web app locale: daemon + UI nel browser, NON app nativa (ADR-002)
- pannello terminale per sessione: **dopo** l'MVP

## Vincoli dell'ambiente da tenere presenti

- Si opera come **root**: `--dangerously-skip-permissions` è vietato per policy.
  Non esiste una "modalità yolo": la gestione dei permessi è obbligatoria fin dall'MVP.
- `--tools ""` NON spegne i tool MCP: serve `--strict-mcp-config`. Senza, ogni sessione eredita
  tutti i server MCP globali della macchina (rischio di fuga dati e ~5x di contesto per turno).
- L'utente è su **abbonamento a quota fissa**: `total_cost_usd` è un valore nominale, NON una
  spesa reale. La risorsa scarsa è la quota (rate limit), non i dollari.
- Node sulla macchina di sviluppo principale è **18.x**: sotto ai requisiti di molto tooling
  moderno (≥20). Da aggiornare prima di iniziare a implementare.

## Sicurezza (requisito, non accorgimento)

STARK esegue comandi arbitrari **come root**. Quindi: ascolto su localhost per default,
autenticazione obbligatoria per qualunque esposizione oltre localhost, apertura sulla LAN
sempre come scelta esplicita dell'utente e mai come default.
