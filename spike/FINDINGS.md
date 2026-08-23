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

## Riscontri aggiunti il 2026-08-21 (macchina secondaria)

Raccolti mentre si scriveva `docs/event-model.md`. Le `captures/` non sono versionate, quindi
P02 è stata rieseguita qui; per OpenCode è stato usato lo spec OpenAPI invece di una cattura.

- **P02 riprodotta** su Claude Code 2.1.238 / Node 24.13.1: stessa tassonomia dello spike originale.
  Costo nominale $0.031 con Haiku + `--strict-mcp-config`.
- **`structuredPatch` è VUOTO su una `Write` di file nuovo.** Verificato: non esistendo un originale,
  Claude Code non produce hunk. L'adapter deve sintetizzare un hunk di sola aggiunta, altrimenti il
  diff viewer resta bianco proprio nel caso più comune. Su `Edit` il patch c'è ed è completo.
- **`rate_limit_event` è utilizzabile subito** per l'indicatore di quota al posto dei dollari:
  porta `status`, `rateLimitType` (`five_hour`), `resetsAt`, `overageStatus`, `isUsingOverage`.
- **OpenCode 1.17.20 espone lo spec OpenAPI su `GET /doc`**: 162 path, 472 schemi, **94 `Event*`**.
  È una controprova migliore di una singola cattura, e va preferita a rieseguire P06.
- **Smentita una premessa di ADR-006.** OpenCode HA il "Consenti sempre": la reply a un permesso è
  `{ reply: "once" | "always" | "reject" }`, e ci sono `GET /api/permission/saved` e
  `DELETE /api/permission/saved/{id}` con `PermissionSavedInfo { id, projectID, action, resource }`.
  Il modello dei permessi è quindi condiviso, non specifico di Claude Code.
- **`opencode serve` avverte che è non autenticato** se `OPENCODE_SERVER_PASSWORD` non è impostata.
  Nota per il requisito di sicurezza di STARK: stesso problema, stessa risposta obbligata.
- P06 come script **non gira più così com'è**: si blocca sulla `fetch` SSE di
  `/api/session/{id}/event`. La creazione della sessione via `POST /api/session` funziona.

## P10–P14 — modalità permessi di Claude Code (2026-08-21)

Da root, in headless `stream-json`. Colonna che conta: quante card STARK dovrebbe mostrare.

| Configurazione | tool call | card | esito |
|---|---|---|---|
| `default` + hook `*` | 5 | 5 | chiede anche per `cat` e `wc -l` |
| `acceptEdits` + hook `*` | 7 | 6 | chiede anche le Edit che la modalità approverebbe |
| `auto` + hook `*` | 5 | 5 | l'hook scavalca la modalità |
| **`auto`, nessun hook** | 5 | **0** | tutto eseguito, zero attrito |
| `auto` + regola `ask`, no hook | 2 | 0 | la regola diventa negazione secca |
| `auto` + hook che risponde `ask` | 2 | 2 | `ask` non ricade sul classificatore |
| **`auto` + hook `matcher:'Bash'`** | 2 | **1** | Write dal classificatore, Bash a STARK |

- **Le modalità sono SEI**, non quattro: `default` (alias `manual`), `acceptEdits`, `plan`,
  `auto`, `dontAsk`, `bypassPermissions`.
- **`auto` NON è `bypassPermissions`** e da root funziona. È un secondo modello (classificatore)
  che ispeziona ogni azione e blocca `curl | bash`, force push, `git reset --hard`, deploy di
  produzione, distruzione di file preesistenti, `terraform destroy`, esfiltrazione di segreti.
  Scioglie la premessa di ADR-006 → vedi ADR-008.
- **Il matcher dell'hook è per nome di tool** ed è la manopola del prodotto.
- **`permissionDecision: 'ask'` non delega**: in headless diventa errore di tool.
- **`auto` richiede Opus 4.6+, Sonnet 4.6+ o Fable 5. Haiku NON è supportato.** Con un modello non
  supportato la sessione riparte in Manual.
- I blocchi del classificatore arrivano come **errori di tool**, non come richieste di permesso.
  Testo: `Permission for this action was denied by the Claude Code auto mode classifier.`
- Config dell'utente verificata: **nessuna regola `permissions`, `allowedTools`/`deniedTools`
  vuoti su tutti i progetti**, nessun managed settings. La fluidità osservata viene interamente
  dal classificatore, non da allow accumulati.
- Costo nominale complessivo delle sonde: ~$0.65 (auto mode richiede Sonnet 5, non Haiku).
