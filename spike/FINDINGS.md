# STARK — Risultati dello spike tecnico

Riferimento completo e sempre aggiornato: Notion → STARK → "Spike tecnico — Risultati"
https://app.notion.com/p/3c3fef5cacd9817c8612ea39506f9bf9

## Esito complessivo
Architettura ADR-001 (canale strutturato) **confermata**. Nessun blocco.

## Verdetti
- **P01 processo long-lived multi-turno** → SÌ. Un processo per sessione, stesso session_id, memoria mantenuta.
- **P02 tassonomia eventi** → completa. `tool_use_result.structuredPatch` + `originalFile` ⇒ diff viewer quasi gratis.
- **P03 permessi** → SÌ (via P03-bis). Senza handshake l'agent *nega*; dichiarando un hook PreToolUse
  nell'`initialize` l'agent apre una `control_request{subtype:hook_callback}` con tool_name/tool_input/cwd
  e si risponde con `permissionDecision: allow|deny`. Verificato end-to-end: comando eseguito davvero.
- **P03c canale di controllo** → SCOPERTA CHIAVE. `initialize` / `interrupt` / `set_permission_mode` / `set_model` tutti verificati.
- **P04 bottone Stop** → SÌ. Risposta immediata, `terminal_reason: aborted_streaming`, la sessione sopravvive.
- **P05 ripresa sessioni** → SÌ. `--session-id` + `--resume` da processo nuovo.
- **P06 OpenCode** → SÌ, end-to-end. Trasporto HTTP+SSE, prompt asincrono (ack in 27ms).
  CONCLUSIONE CHIAVE: i due agent convergono sulla stessa FORMA (turno → step → parti con
  started/delta/ended) ma con vocabolari diversi: Claude Code parla in termini di API Anthropic,
  OpenCode in termini di dominio. Il modello canonico va scritto nel vocabolario di DOMINIO e
  l'adapter Claude Code deve tradurre verso l'alto. Progettarlo su un solo agent = astrazione sbagliata.

## Vincoli scoperti
1. Da root, `--dangerously-skip-permissions` è **vietato**. Niente modalità yolo: la gestione permessi è obbligatoria.
2. `--tools ""` NON spegne i tool MCP. Serve `--strict-mcp-config`.
3. Consumo (valori NOMINALI a listino API, NON spesa reale: l'utente è in abbonamento a quota fissa).
   Sonnet "PONG" $0.36 · Haiku senza strict-mcp ~$0.18 · Haiku con strict-mcp $0.036.
   Il dato che conta è il rapporto: la config MCP costa ~5x il contesto per turno → quota bruciata e rate limit prima.
   STARK può distinguere i due casi da `account.subscriptionType` e mostrare quota invece di dollari.
4. Cursor Agent: `Not logged in`, non utilizzabile finché non autenticato.
5. OpenCode `serve`: API OpenAPI completa, 135 tipi di evento, e `/api/pty` ACCANTO all'API strutturata (valida C2).
6. `@zed-industries/claude-code-acp` v0.16.2 esiste → ACP come modello interno è praticabile.

## Da fare
- P08: cursor-agent (bloccato da autenticazione).
- ~~P09: node-pty~~ — NON serve: il pannello terminale è stato collocato dopo l'MVP (decisione utente 2026-08-21).
