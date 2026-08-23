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

---

## P15 — Le funzioni "assenti in headless" non sono assenti (23 agosto 2026)

Premessa sbagliata da cui ero partito: in headless mancano `AskUserQuestion`,
`ExitPlanMode` e `TodoWrite`, quindi una GUI varrà sempre meno della TUI. È falso, e
lo dice il codice del CLI 2.1.241 letto direttamente dal binario.

### Perché sembravano assenti

`AskUserQuestion.isEnabled()` è:

```js
if (allowedChannels().length > 0 && !isInteractive()) return false
if (!isInteractive() && !permissionPromptToolName()) return false
return true
```

Cioè: in non interattivo il tool esiste **se è configurato un permission-prompt tool**.
Il flag `--permission-prompt-tool <tool>` esiste ma è **nascosto dall'help**.

### Verificato

Con `--permission-prompt-tool mcp__stark__permission`, nella stessa identica sessione
headless in cui prima non c'era, `AskUserQuestion` compare nell'elenco e il modello lo
chiama. L'unico errore residuo è che quel tool MCP non esiste ancora lato nostro:
*"MCP tool mcp__stark__permission (passed via --permission-prompt-tool) not found."*

### I tre pezzi che rendono un client un host di prima classe

1. **`--permission-prompt-tool`** — sblocca i tool che richiedono interazione.
2. **`sdkMcpServers`** nell'`initialize` più i `control_request{subtype:"mcp_message"}`:
   il client serve un server MCP sul canale di controllo. È lì che vive il tool di
   permesso, e le card dei permessi diventano una nostra implementazione.
3. **`supportedDialogKinds`** nell'`initialize`. Dallo schema zod:
   *"The CLI treats ABSENCE as 'cannot display' and fails closed: without the kind
   declared here, a dialog-gated flow degrades to its no-dialog behavior."*

### I 27 dialog kind del registro interno

```
permission_ask_user_question  permission_enter_plan_mode   permission_bash
permission_browser            permission_file              permission_monitor
permission_powershell         permission_prompt            permission_skill
permission_webfetch           permission_workflow          auto_mode_flagged_allow
auto_mode_setup_review        auto_default_nudge           cost_threshold
fable_overage_consent_prompt  goal_proposal                refusal_fallback_prompt
resume_return                 sandbox_network_access       computer_use_approval
mcp_url_elicitation           managed_settings_security    peer_inbound_approval
ide_onboarding                chrome_install_setup         chrome_install_upsell
```

Massimo 32 dichiarabili (`MAX_DECLARED_DIALOG_KINDS`). Protocollo:
`control_request{subtype:"request_user_dialog", dialog_kind, payload, tool_use_id?}`,
risposta `{behavior:"completed"|"cancelled", result?}`.

**Trappola dichiarata nello schema:** a un kind non dichiarato non si deve rispondere.
Una risposta d'errore viene scartata e il dialogo resta appeso; un `cancelled` invece
viene letto come "l'utente ha chiuso la finestra", che è una risposta vera e diversa.

### Conseguenza su ADR-008

`auto_mode_flagged_allow` **è** la card che l'utente vede quando auto mode chiede
conferma su un comando serio. Senza dichiararla il flusso ripiega sul comportamento
senza dialogo, cioè nega. L'`action.blocked` osservato nelle sonde precedenti non era
l'unico comportamento possibile: era il ripiego di un client che non sapeva mostrare
nulla. La scelta di ADR-008 resta giusta, ma la sua descrizione va corretta.

### Il resto del protocollo

Ci sono circa 100 sottotipi di `control_request`. Fra quelli utili a una GUI:
`get_context_usage`, `get_session_cost`, `get_usage`, `list_models`, `get_plan`,
`get_workspace_diff`, `rewind_files`, `file_suggestions`, `background_tasks`,
`rename_session`, `set_cwd`, `memory_recall`, `task_*`, `session_state_changed`.

Non è un canale di output da leggere: è il protocollo con cui il CLI parla ai suoi
host di prima classe (VS Code, Remote Control). STARK deve implementarlo, non aggirarlo.

---

## P16 — Risveglio e presa in carico (23 agosto 2026)

Verifiche fatte sul codice vero, non su sonde usa e getta. Si rieseguono con
`npm run resume` e `npm run takeover`.

### Il risveglio funziona, e sono due memorie separate

Spento il processo e riacceso con `--resume`, il modello **ricorda** ciò che era stato
detto prima. Il punto non è ovvio: il journal di STARK serve alla UI, il trascritto
dell'agent serve al modello. Un risveglio che ne ripristinasse una sola sembrerebbe
funzionare finché l'utente non fa la prima domanda che dipende dal contesto.

Il journal riaperto **continua i `seq`** invece di ripartire da 1. Ripartire produrrebbe
due eventi con lo stesso numero nello stesso file, e "ho già visto fino a N" smetterebbe
di voler dire qualcosa: un browser che si riaggancia salterebbe metà conversazione.

**`--no-session-persistence` è incompatibile con lo Sleep**: senza trascritto non c'è
niente da riprendere. In cambio `--session-id` lascia **imporre** l'id, quindi STARK sa
come risvegliare una sessione già prima di aprirla.

### Due processi sulla stessa sessione: cosa succede davvero

Scenario della "presa in carico": STARK riprende una conversazione che l'utente sta già
usando dalla CLI. Per un momento i processi sono due. Misurato:

| | |
|---|---|
| il secondo eredita il contesto del primo | **sì** |
| il primo si accorge di ciò che fa il secondo | **no**, resta al suo mondo in memoria |
| il trascritto su disco conserva il lavoro di entrambi | **sì** |

**Non si perde e non si corrompe niente.** L'unica regola operativa è non parlare da due
parti insieme: il disco resta coerente, i processi vivi divergono.

### Un timore che si è rivelato infondato

Si era ipotizzato che due **versioni** diverse del CLI sullo stesso trascritto fossero
terreno inesplorato. Falso: il trascritto di quella stessa sessione era stato scritto da
**tre** versioni — 2.1.238 per 453 righe, 2.1.239 per 9, 2.1.241 per 617. Succede ogni
volta che il CLI si aggiorna da solo mentre si lavora.

Il vincolo vero è un altro e non dipende dall'eseguibile: **`CLAUDE_CONFIG_DIR`**. Se non
viene propagato al processo figlio, quello guarda in `~/.claude` invece che dove vivono
davvero le sessioni, non trova nulla da riprendere e forse nemmeno il login — con l'aria
di essere rotto senza motivo.

### Ancora non misurato

**Quanto costa in quota risvegliare una conversazione lunga.** Le sonde usano prompt
minuscoli, quindi non dicono niente su un trascritto reale da diversi MB. Va misurato
prima di presentare lo Sleep come indolore.
