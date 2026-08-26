# STARK — Modello di eventi canonico

> **Stato:** bozza 3. Le sezioni 4-14 sono implementate in `src/`, sopra l'**Agent SDK
> ufficiale** (ADR-009). Le correzioni che il codice ha imposto alla bozza 1 sono segnate
> con ⚠️ **corretto dal codice**.
> **Dove vive:** in questo repo e non su Notion, per ADR-003: questa specifica cambia
> insieme al codice, quindi non può stare in una pagina che nessun test può verificare.
> **Vincolata da:** ADR-001 (canale strutturato), ADR-004 (un solo adapter nell'MVP),
> ADR-005 (daemon persistente + Sleep), ADR-008 (permessi basati su auto mode; supera ADR-006),
> ADR-007 (Node + journal JSONL), ADR-009 (l'Agent SDK ufficiale implementa il canale).

## 1. Che problema risolve

STARK è una GUI che sostituisce la TUI, e una GUI ha bisogno di sapere **cosa sta succedendo**,
non di ricevere pixel. Questo documento definisce l'unico vocabolario con cui il resto del
sistema — journal, WebSocket, UI — parla degli agent.

Fuori dall'adapter, **nessun componente deve conoscere l'esistenza di Claude Code**.

### Il criterio che decide ogni dubbio

Il modello è scritto nel **vocabolario di dominio**, non in quello dell'API Anthropic.
Il motivo è la scoperta della sonda P06: Claude Code e OpenCode espongono la stessa forma
concettuale a due livelli di rappresentazione diversi. Claude Code dice `content_block_delta`
con `content_block.type = "thinking"`; OpenCode dice `session.next.reasoning.delta`. La seconda
formulazione è quella giusta per STARK, perché descrive **il fatto** invece che il trasporto.

Regola operativa: se il nome di un evento canonico si può indovinare leggendo la documentazione
Anthropic, probabilmente è al livello sbagliato.

## 2. Su quali dati è costruito

Niente qui è inventato. Le due fonti:

- **Claude Code 2.1.238** — sonda P02 rieseguita il 21 agosto 2026 su questa macchina.
  Eventi osservati in una sessione reale con Write + Edit + Bash: `stream_event` ×72,
  `system:thinking_tokens` ×24, `assistant` ×8, `system:status` ×4, `user` ×3, `system:init` ×1,
  `rate_limit_event` ×1, `result:success` ×1. Sottotipi di `stream_event`: `content_block_delta` ×44,
  `content_block_stop` ×8, `message_start` ×4, `content_block_start/thinking` ×4, `message_delta` ×4,
  `message_stop` ×4, `content_block_start/tool_use` ×3, `content_block_start/text` ×1.
- **Claude Code 2.1.238, modalità permessi** — sonde `p10`–`p14` del 21 agosto 2026, da root e in
  headless: confronto fra `default`, `acceptEdits` e `auto`, con e senza hook, con matcher largo e
  stretto. I numeri stanno in ADR-008 e sono la base del §8.
- **OpenCode 1.17.20** — spec OpenAPI del server (`GET /doc`): 162 path, 472 schemi,
  di cui **94 schemi `Event*`**. Usata come controprova a tavolino, secondo la mitigazione
  concordata in ADR-004. Nessun adapter OpenCode viene scritto.

---

## 3. I concetti

Sei, e sono tutti presenti in entrambi gli agent.

| Concetto | Cos'è |
|---|---|
| **Sessione** | una cartella più un agent più una storia. È l'unità che l'utente vede nella sidebar. |
| **Turno** | dal prompt dell'utente al ritorno del controllo. Un turno contiene N step. |
| **Step** | una singola richiesta al modello dentro un turno. Un turno con tre tool call ha quattro step. |
| **Parte** | un pezzo di output di uno step: testo, ragionamento, chiamata a un tool. Ha un ciclo `started → delta* → ended`. |
| **Richiesta bloccante** | l'agent si ferma e aspetta l'utente: un permesso, una domanda. |
| **Effetto** | qualcosa è cambiato fuori dalla conversazione: un file modificato, un comando eseguito. |

Il ciclo `started → delta* → ended` non è una scelta estetica: è la forma che **entrambi** gli
agent già usano. Claude Code la esprime come `content_block_start` / `content_block_delta` /
`content_block_stop`; OpenCode come `session.next.text.started` / `.delta` / `.ended`.

---

## 4. Involucro comune

```ts
type CanonicalEvent = {
  v: 1                 // versione del modello; cambia solo per rotture incompatibili
  seq: number          // progressivo per sessione, assegnato da STARK, senza buchi
  ts: number           // epoch ms, assegnato da STARK alla normalizzazione
  sessionId: string
  payload: Payload     // uno dei tipi delle sezioni 6-10
}
```

`seq` è assegnato da STARK, non dall'agent. È ciò che rende il journal ricostruibile e permette
alla UI di dire "ho già visto fino a N" quando si riaggancia dopo un Sleep o una chiusura del browser.

**Invariante fondamentale:** lo stato della UI deve essere ricostruibile **interamente** rileggendo
il journal dall'inizio. Nessuna informazione può vivere solo nella RAM del daemon. Senza questa
invariante il Sleep di ADR-005 non è implementabile, perché risvegliare una sessione significa
esattamente ripartire dal journal.

---

## 5. Stati della sessione

```ts
type SessionState =
  | 'starting'    // processo avviato, initialize non ancora ricevuto
  | 'idle'        // pronta, nessun turno in corso
  | 'busy'        // turno in corso
  | 'awaiting'    // ferma su una richiesta bloccante (permesso o domanda)
  | 'sleeping'    // processo terminato di proposito, journal su disco, risvegliabile — ADR-005
  | 'error'
  | 'closed'
```

`awaiting` è distinto da `busy` perché sono due cose opposte per l'utente: in `busy` l'agent sta
lavorando e non c'è niente da fare, in `awaiting` non succede più nulla finché non intervieni.
Un badge che li confondesse mentirebbe, e il Principio 3 lo vieta.

`sleeping` è uno stato di STARK, non dell'agent: nessun evento dell'agent lo produce.

---

## 6. Eventi di sessione

```ts
| { k: 'session.created',  agent: string, cwd: string, model: string,
                           capabilities: Capabilities, tools: string[], commands: SlashCommand[],
                           models?: ModelChoice[], modes?: ModeChoice[] }
| { k: 'session.state',    state: SessionState, reason?: string }
| { k: 'session.model',    model: string }
| { k: 'session.mode',     mode: PermissionMode }
| { k: 'session.tools',    tools: string[] }
| { k: 'session.mcp',      servers: McpServer[] }
| { k: 'session.commands', commands: SlashCommand[] }
| { k: 'session.renamed',  title: string }
| { k: 'session.slept' }
| { k: 'session.woke',     resumedFromSeq: number }
| { k: 'session.error',    message: string, fatal: boolean }
```

`session.created` porta con sé tutto ciò che serve a popolare la UI *prima* del primo prompt.

**`models` e `modes` — aggiunti scrivendo la barra di stato.**

```ts
type ModelChoice = { id: string, label?: string, resolved?: string, autoMode: boolean }
type ModeChoice  = { mode: PermissionMode, available: boolean, reason?: string }
```

**`session.mcp` — aggiunto collegando gli strumenti esterni.**

```ts
type McpServer = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  enabled: boolean      // la scelta di STARK per questa chat
  error?: string
}
```

Due campi e non uno: `enabled` è cosa ha scelto l'utente, `status` è cosa risponde l'agent.
Un server acceso può essere `needs-auth` o `failed`, e schiacciarli in un campo solo
nasconderebbe proprio il caso in cui ci si chiede perché non funziona.

L'evento porta la **fotografia intera**, e chi lo applica sostituisce invece di fondere:
fondere terrebbe in vita un server sparito dalla macchina, in un elenco da cui non si può
toglierlo. Sta nel journal anche perché è da lì che il **risveglio** sa cosa riaccendere —
senza, una chat che dorme si sveglia senza i suoi strumenti e sembra rotta.

**`context.compacted` — corretto guardandone una vera.**

```ts
| { k: 'context.compacted', before: number, after?: number,
                            trigger?: 'manual' | 'auto', ms?: number }
```

`after` era **fisso a zero**, che voleva dire «non lo so» e si leggeva «azzerato». Il protocollo
lo dichiara opzionale, quindi quando non arriva non si inventa. `trigger` distingue due
situazioni diverse per chi legge: *l'hai chiesto tu* e *si era riempito* — la seconda dice
anche che quella conversazione sta diventando cara.

Osservata dal vivo su una sessione reale (`/compact` dopo sei scambi): `trigger: 'manual'`,
`pre_tokens: 34802`, `post_tokens: 743`, `duration_ms: 8754`. E **arriva dentro il turno**,
dopo il suo `system:init` e prima del `result` — per questo nello snapshot è una **parte del
turno** e non un fatto a sé: è lì che è successa, ed è lì che va vista.

**`PromptPart` — §16.3, chiuso collegando gli allegati.**

```ts
type PromptPart =
  | { type: 'text',  text: string }
  | { type: 'image', ref: string, mediaType: string, bytes: number, name?: string }
```

`ref` è lo **sha256 dei byte**, che stanno in un file sotto `~/.stark/allegati/<sessione>/`.
Nel journal ci va il riferimento e non il contenuto, e non è un dettaglio di efficienza: il
journal si **rilegge tutto a ogni risveglio**, e un megabyte a colpo lo renderebbe caro
esattamente dove ADR-005 lo vuole leggero. L'invariante del §4 regge lo stesso — la rilettura
ritrova il riferimento, e il file è lì.

Il comando porta invece i byte, perché è il viaggio dal browser al daemon:

```ts
type Attachment = {
  type: 'image'
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string   // base64
  name?: string
}
```

Verificato prima di scriverlo: il CLI **accetta** un blocco `image` dentro un messaggio utente
in stream-json, e il modello lo vede (ha descritto il logo di STARK). Le immagini vanno **prima**
del testo, come raccomanda la documentazione dell'API: il modello legge la domanda avendo già
davanti ciò a cui si riferisce.

I quattro tipi sono quelli che il modello accetta. Un **file di testo non è un allegato**: si
incolla, o si nomina per percorso — l'agent sa leggerlo da solo, ed è il motivo per cui non
serve spedirglielo.

**`session.commands` — aggiunto collegando i comandi slash.**

```ts
type SlashCommand = {
  name: string
  description?: string
  argumentHint?: string   // "<file>", "[low|medium|high]"
  aliases?: string[]      // /reset e /new portano a /clear
  terminalOnly?: boolean  // la sua UX è legata al terminale
}
```

L'handshake ne porta una versione povera — nome e descrizione — mentre `supportedCommands()`
dell'SDK dà anche `argumentHint` e gli alias. Senza il primo, metà dei comandi sono
indovinelli: `/code-review` non dice da solo che accetta `[low|medium|high]`.

Due cose si sanno solo guardando passare i messaggi, e per questo la lista è un evento a sé
invece di stare tutta in `session.created`:

- **quali sono legati al terminale** lo dice `terminal_slash_commands` in `system:init`, che
  arriva col primo turno e non con l'handshake. Prima di allora non si sa, e marcarli a
  indovinare sarebbe peggio che marcarli tardi. Non si nascondono: il CLI ce li ha, quindi
  si mostrano con l'etichetta (Principio 5), e a spiegare che lì non funzionano è l'agent.
- **la lista cambia in corsa**: l'agent scopre skill nuove lavorando in una sottocartella, e
  `system/commands_changed` porta quella nuova, da **sostituire** com'è.

Mandare `/qualcosa` è un prompt come un altro: verificato che il turno si chiude regolarmente
(`result/success`), sia per un comando che esiste — `/usage` risponde col conteggio vero — sia
per uno che in headless non c'è: `/help` risponde «isn't available in this environment», che è
l'agent a dirlo e non STARK a indovinarlo.

**Come ci arriva l'adapter, e perché non basta guardare una volta.** L'SDK dà `mcpServerStatus()`
e `toggleMcpServer()`: STARK non legge nessun file di configurazione, e non saprebbe farlo —
metà dei server di una macchina sono connettori di claude.ai, che non stanno in nessun file.
Il default di STARK è **tutti spenti**, ottenuto spegnendo per nome invece che con
`--strict-mcp-config`, che li renderebbe irraggiungibili (Principio 5: mai poter meno del CLI).

La riconciliazione gira **prima di ogni turno**, non solo all'avvio: i connettori di claude.ai
compaiono qualche secondo *dopo* che la sessione è nata, quindi spegnerli una volta sola li
lascia accesi. Misurato: **103 tool nel primo turno, 71 dei quali `mcp__`**, cioè esattamente
il costo di contesto che spegnerli doveva evitare. Con la riconciliazione per turno, e un
server solo acceso: 60 tool, 28 `mcp__`, tutti suoi.

Stanno qui e non in un elenco dentro la UI per la ragione del §1. `id` è ciò che si rimanda
indietro con `session.setModel`; `resolved` è il modello vero a cui un alias punta, e serve a
sapere quale voce spuntare quando `session.model` riporta il nome risolto. `autoMode` viaggia
col modello e non con la sessione perché **dipende dal modello**: senza, la UI dovrebbe sapere
da sé che Haiku non regge auto mode.

`modes` esiste per il Principio 5. Le sei modalità sono canoniche e la UI le conosce già; ciò
che non può sapere è **quale non si può usare qui e perché** — `bypassPermissions` è rifiutato
dal CLI a chi gira come root, e quella frase la può scrivere solo l'adapter. La voce si mostra
spenta **con la spiegazione**, mai nascosta.

**`session.renamed`** è il titolo scelto a mano. Esiste perché per il §4 la UI non può mostrare
niente che non nasca dal journal: un titolo tenuto altrove sparirebbe al primo risveglio. Si
scrive anche su una sessione **senza processo dietro** — si rinomina soprattutto ciò che dorme —
quindi non passa dal `POST /command` del §18, che risponderebbe «sessione non attiva».

> ⚠️ **Corretto dal codice.** La bozza 1 lo faceva nascere da `system:init`. Sbagliato:
> `system:init` **non arriva all'handshake, arriva col primo turno**. Aspettarlo prima di
> poter mandare un prompt è un deadlock, misurato. La sessione nasce invece dalla risposta
> alla `control_request{initialize}`, che torna subito e porta `commands` (48 voci con
> descrizione), `models` (la tabella che risolve l'alias `default` nel modello vero),
> `current_permission_mode`, `hooks_applied` e `session_state`.
>
> Due conseguenze di prodotto, entrambe migliori. La prima: si sa **prima del primo prompt**
> se la modalità richiesta è stata accettata e se i toggle su "chiedi" si sono registrati
> davvero — `hooks_applied: false` con dei matcher dichiarati è il caso peggiore possibile,
> l'utente si crede protetto e non lo è. La seconda: l'unica cosa che `system:init` sa e
> l'handshake no è la lista dei tool, ed è per questo che esiste `session.tools`.
>
> La stessa risposta contiene `account` con email, organizzazione e tipo di abbonamento.
> **Non entra nel journal.** È l'invariante 4 del §13 applicata al primo caso reale.

---

## 7. Turni, step e parti

```ts
| { k: 'turn.started',     turnId: string, prompt: PromptPart[] }
| { k: 'turn.promptAdded', turnId: string, prompt: PromptPart[] }
| { k: 'turn.ended',       turnId: string, reason: 'completed'|'aborted'|'error',
                           usage: Usage, cost: Cost }

| { k: 'step.started',  stepId: string }
| { k: 'step.ended',    stepId: string, finish: string, usage: Usage }

| { k: 'text.started',      partId: string }
| { k: 'text.delta',        partId: string, delta: string }
| { k: 'text.ended',        partId: string, text: string }

| { k: 'reasoning.started', partId: string }
| { k: 'reasoning.delta',   partId: string, delta: string, estimatedTokens?: number }
| { k: 'reasoning.ended',   partId: string }

| { k: 'tool.started',      callId: string, name: string }
| { k: 'tool.input.delta',  callId: string, delta: string }
| { k: 'tool.input.ended',  callId: string, input: unknown, summary?: string, intent?: string }
| { k: 'tool.ended',        callId: string, ok: boolean, output?: unknown, error?: string }
```

### L'uscita di un comando locale non passava da qui — e si perdeva

Bug segnalato dall'utente, corretto il **26 agosto 2026**: mandare `/usage` (o `/model`, `/cost`,
…) come prompt chiudeva il turno regolarmente, ma senza un solo blocco dentro. Non
un'interruzione — una risposta vera, arrivata e mai mostrata.

**Cosa succede davvero.** Un comando locale non passa dal modello: il CLI lo esegue da sé, a
costo zero (`usage` tutto a zero, verificato), e restituisce il risultato come un **unico**
messaggio `assistant` completo — nessun `content_block_start`/`_delta`/`_stop` prima, perché non
c'è stato niente da trasmettere in streaming. Si riconosce da `message.model === '<synthetic>'`,
che è l'SDK stesso a scriverci per dire «questo non è passato dal modello».

**Dove si perdeva.** Il traduttore aveva una regola sola per i messaggi `assistant`: ignorarli,
perché una risposta vera arriva già per streaming e ripetere quella consolidata alla fine la
duplicherebbe. Regola giusta per ogni turno normale — e l'unica eccezione, quella sintetica, ci
cadeva dentro allo stesso modo. Il `result` arrivava comunque (`turn.ended` si chiudeva
regolarmente), ma senza che nessun `text.*` fosse mai stato emesso: la UI mostrava il prompt
dell'utente sopra un riquadro vuoto.

**La correzione.** `assistant()` in `translate.ts` distingue il caso: se `model` non è
`'<synthetic>'`, resta ignorato come sempre; se lo è, il testo del contenuto diventa
`text.started` → `text.delta` (il testo intero, in un colpo solo, perché non c'è altro da
accumulare) → `text.ended` — lo stesso ciclo di ogni altra parte di testo, solo senza streaming
reale dietro. Un `partId` proprio (dall'`id` del messaggio sintetico), perché questo messaggio
non ha mai aperto un blocco con `content_block_start` e quindi non c'è un indice da riusare.

### Un prompt mandato mentre l'agent lavora: **fa la fila**

*Corretto il 26 agosto 2026, misurando.* Un turno non finisce quando smette di aspettare —
finisce quando l'agent lo dice (`turn.ended`, dall'evento `result` dell'SDK). La domanda è cosa
succede a un prompt mandato prima di allora, e per un giorno STARK ha risposto male.

**Come rispondeva.** Il prompt veniva *piegato* dentro il turno in corso (`turn.promptAdded`) e
consegnato subito all'agent. La motivazione stava scritta, e veniva dai tipi ufficiali dell'Agent
SDK: un messaggio arrivato a metà viene **"coalesced into one turn"**, e un uuid così **"folded"**
dentro **"never runs as its own turn"**. Sembrava un limite della piattaforma.

**Cos'era davvero.** Quelle parole descrivono cosa fa il CLI con **un lotto di messaggi che gli
arrivano mentre lavora**: li accoda e, quando drena, li fonde in un turno solo. Non dicono che un
secondo prompt *non possa* essere un turno a sé — dicono cosa succede se glieli consegni tutti
insieme. Era di nuovo la trappola del progetto: **un'assenza osservata in una configurazione
presa per un'assenza in generale**.

E costava. Il secondo prompt non apriva un turno, ma il suo lavoro arrivava lo stesso: parti,
tool e risposta finivano appiccicati al turno di prima — che nel frattempo risultava già chiuso —
e il `result` del secondo giro non chiudeva niente, perché per il traduttore non c'era più nessun
turno aperto. Due domande diventavano un blocco solo, illeggibile.

**Come risponde adesso.** La fila è di STARK, non del CLI:

1. `prompt()` con qualcosa in volo → `turn.started` **subito** (è un fatto: l'utente l'ha
   mandato), e il messaggio resta nell'adapter. L'agent non lo vede.
2. Il turno in corso finisce → si consegna il **primo** della fila, **uno solo**. A sessione
   ferma e uno alla volta non c'è nessun lotto da fondere, quindi un turno di STARK resta uguale
   a un turno dell'agent.
3. Finché la fila non è vuota, l'`idle` che chiude un turno **non viene emesso**: durerebbe un
   decimo di secondo, ma è lo stato su cui suona la notifica «ha finito».

Misurato, non dedotto: secondo prompt mandato dopo 4 s su un turno lungo dodici →
`turn.started`(1), `turn.started`(2), … `turn.ended`(1) `completed`, … `turn.ended`(2)
`completed`, `idle`. In ordine, e con l'ordine c'è l'unica garanzia che conta: **FIFO**.

**Stop svuota la fila.** Chi preme il quadrato rosso vuole che la macchina si fermi, non che
parta il prossimo mezzo secondo dopo; tre prompt in coda vorrebbero altrimenti quattro Stop. I
turni che non gireranno vengono chiusi con `reason: 'aborted'` — un turno aperto che non riceverà
mai eventi è la cosa peggiore da lasciare in un journal, perché alla rilettura resta «in attesa»
per sempre (§4). Nella stessa passata: il turno **interrotto dall'utente** torna dall'SDK come
`is_error`, e STARK lo raccontava come `error`; adesso, e solo quando lo Stop è arrivato da noi,
è `aborted`. Dal messaggio non si distingue: l'unico che lo sa è chi ha ricevuto il comando.

`turn.promptAdded` resta nel vocabolario e nel reducer — i journal scritti prima di oggi ne
contengono — ma **non lo produce più nessuno**. Tornerà il giorno in cui STARK offrirà di
*guidare* il turno in corso invece di accodarsi: è un gesto diverso, e va chiesto.

Su `reasoning.delta`: Claude Code emette il testo del ragionamento nei `content_block_delta` dei
blocchi `thinking`, **e in più** un evento `system:thinking_tokens` con `estimated_tokens` ed
`estimated_tokens_delta` (24 occorrenze nella cattura di oggi). Il secondo non aggiunge contenuto,
serve solo a mostrare un indicatore di avanzamento mentre l'agent pensa. Sta come campo
opzionale, non come evento a sé: è un dettaglio di presentazione dello stesso fatto.

`summary` è **su cosa** il tool ha lavorato, già in chiaro: il comando, il percorso, l'indirizzo.
Aggiunto per chiudere un debito, non per comodità. Prima lo ricavava la UI frugando dentro `input`
alla ricerca di `command`, `file_path`, `path`: cioè conoscendo la forma di Claude Code fuori
dall'adapter, che è esattamente ciò che il §1 vieta. La conoscenza non è sparita — non poteva —
ma è tornata dalla parte giusta del confine (`adapters/claude-code/summary.ts`). È opzionale
perché i journal scritti prima non ce l'hanno: là la UI mostra `inputRaw` troncato, che è ciò
che ha, senza interpretarlo.

`intent` è **perché**, non **cosa** — F2 (Notion, aggiunta il 26 agosto 2026). Prima la riga di
un tool mostrava il soggetto nudo: `grep -rn "summary" src/adapters/`, e chi guardava doveva
dedurre da solo cosa si stesse cercando. Non è STARK a scriverla, e non poteva esserlo: un LLM
che spiega ogni comando costerebbe quota su ogni tool di ogni turno, la risorsa scarsa. È testo
che l'agent scrive già da sé — `description` in `BashInput`, dai tipi ufficiali dell'SDK — e
prima veniva buttato via. Verificato su una cattura vera prima di scriverlo (265 chiamate `Bash`
reali nei propri journal, non dedotto dallo schema soltanto): il campo arriva, ma **non sempre**
— dipende dal modello. Con Opus è quasi costante; con Sonnet, su comandi brevi, spesso manca.
`intentOf()` in `summary.ts` non lo genera mai: assente quando l'agent non l'ha scritta, nessuna
riga muta né una spiegazione inventata al suo posto.

La regola è generica, non una lista di tool: qualunque input con un campo `description` proprio
lo mostra, tranne dove `description` è già **il soggetto** (`Task`/`Agent` — mostrarlo due volte
direbbe la stessa cosa) o è dichiaratamente inerte (`Workflow`: «Ignored — set the workflow
description in the script's meta block», dai tipi stessi). Vale quindi anche per un domani
server MCP che scriva il proprio `description`, senza una riga di codice in più.

`tool.input.delta` esiste perché entrambi gli agent trasmettono l'input del tool in streaming
(Claude Code con `input_json_delta`, OpenCode con `session.next.tool.input.delta`). La UI può
ignorarlo e aspettare `tool.input.ended`, ma il modello non deve buttarlo via: è ciò che permette
di mostrare "sta per scrivere in `src/foo.ts`" prima che il file sia scritto.

---

## 8. Richieste bloccanti

```ts
| { k: 'permission.asked',   requestId: string, action: string, resources: string[],
                             savable: string[], source: { callId?: string } }
| { k: 'permission.replied', requestId: string,
                             decision: 'once'|'always'|'reject', scope?: string, message?: string }

| { k: 'question.asked',     requestId: string, questions: AgentQuestion[] }
| { k: 'question.replied',   requestId: string,
                             answers: Record<string, string|string[]>, response?: string }
| { k: 'question.rejected',  requestId: string }

type AgentQuestion = {
  question: string, header: string, multiSelect: boolean,
  options: { label: string, description: string, preview?: string }[]
}
```

Il vocabolario `action` + `resources` + `savable` è preso da OpenCode
(`EventPermissionV2Asked = { id, sessionID, action, resources[], save[], metadata, source }`)
perché è più generale di quello di Claude Code ed è già al livello giusto. Claude Code consegna
`tool_name`, `tool_input` e `cwd` dentro una `control_request{subtype: hook_callback}`: è
l'adapter a tradurli in `action` e `resources`.

Le tre decisioni `once | always | reject` sono Consenti / Consenti sempre / Nega, ed è il corpo
della richiesta `POST /api/session/{id}/permission/{requestID}/reply` di OpenCode.

> ⚠️ **Corretto dal codice.** La bozza 1 diceva che `always` doveva implementarlo STARK, perché
> il protocollo conosce solo `allow` e `deny`. È superato: la callback dei permessi riceve
> `suggestions`, un elenco di regole già pronte, e rimandarne una indietro in
> `updatedPermissions` la scrive in `.claude/settings.local.json`. Le sessioni successive
> smettono di chiedere da sole. Quindi `always` **non è emulato**: è la strada documentata.

### Quando questi eventi esistono, e quando non esistono affatto

Per ADR-008 il caso normale è che **non esistano**. Le sessioni partono in `auto`, STARK non
dichiara alcun hook, e nessuna `permission.asked` viene mai emessa: il classificatore di Claude
Code decide da solo e non interrompe. Misurato: cinque tool call, zero richieste.

`permission.asked` nasce **solo** per i tool che l'utente ha portato su "chiedi" nelle
impostazioni. Ogni voce così configurata aggiunge un `matcher` all'hook `PreToolUse` dichiarato
nell'`initialize`, e solo quei tool tornano indietro a STARK.

Tre vincoli verificati che l'adapter deve rispettare:

1. **Il matcher è per nome di tool, e l'hook scavalca la modalità.** Con `matcher: '*'` STARK si
   riprende ogni decisione e la sessione torna a chiedere tutto, `auto` compreso. Con
   `matcher: 'Bash'`, la `Write` passa in silenzio dal classificatore e solo il `Bash` arriva a
   STARK. Il set dei matcher **è** il pannello dei permessi.
2. **`permissionDecision: 'ask'` non delega al classificatore.** In headless significa "chiedi
   all'utente interattivo": non c'è, e l'azione diventa un errore di tool. Per ogni tool che
   intercetta, STARK **deve** rispondere `allow` o `deny`.
3. **Una regola `permissions.ask` senza hook è una negazione.** Il classificatore la rispetta e
   non la scavalca, ma senza canale per rispondere il comando muore con
   `"Claude requested permissions to use Bash, but you haven't granted it yet."`.

### Granularità più fine del nome del tool

Un toggle come "chiedimi prima di cancellare file" è più stretto di `Bash`. Si realizza senza
alcun supporto dall'agent: STARK riceve **tutti** i `Bash`, valuta la propria tabella di regole
in-process e risponde `allow` in silenzio per ciò che è già consentito, emettendo
`permission.asked` solo per ciò che non lo è. Costa microsecondi e nessun giro dal modello.

`savable` resta nel modello, ma cambia significato rispetto alla prima bozza: non è più uno scope
da indovinare, è **la riga della tabella dei permessi** che il "Consenti sempre" sposterebbe da
"chiedi" a "consenti".

## 9. Effetti collaterali

```ts
type Hunk = { oldStart: number, oldLines: number, newStart: number, newLines: number, lines: string[] }

| { k: 'file.edited',      path: string, hunks: Hunk[], created: boolean,
                          originalFile?: string, callId?: string }
| { k: 'command.executed', command: string, stdout: string, stderr: string,
                           exitCode?: number, interrupted: boolean, callId?: string }
```

`Hunk` è **esattamente** la forma di `tool_use_result.structuredPatch` di Claude Code, verificata
oggi su una Edit reale:

```json
{ "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1,
  "lines": ["-ciao", "\\ No newline at end of file",
            "+ciao mondo", "\\ No newline at end of file"] }
```

È il motivo per cui il diff viewer è quasi gratis: non c'è nessun diff da calcolare.

> ⚠️ **Corretto dal codice.** `created` non c'era nel tipo della bozza 1, ma la trappola qui
> sotto lo esigeva già a parole: senza quel campo la UI non ha modo di distinguere "creato"
> da "modificato" e mostrerebbe un diff di sola aggiunta come se fosse una modifica.

> ⚠️ **Trappola verificata oggi.** Su una `Write` di un file **nuovo**, `structuredPatch` è un
> array **vuoto**: non essendoci un originale, Claude Code non produce hunk. Se l'adapter si
> limitasse a inoltrarlo, la UI mostrerebbe "file modificato" con un diff vuoto proprio nel caso
> più comune. L'adapter **deve** sintetizzare un hunk di sola aggiunta a partire da
> `tool_use_result.content`, e marcare l'evento come creazione.

---

## 10. Meta

```ts
| { k: 'usage.updated', usage: Usage, cost: Cost }
| { k: 'quota.updated', status: string, kind: string, resetsAt: number, usingOverage: boolean }
| { k: 'quota.windows', windows: QuotaWindow[] }
| { k: 'context.usage', usage: ContextUsage }
| { k: 'context.compacted', before: number, after: number }
| { k: 'notice', level: 'info'|'warn'|'error', text: string }
| { k: 'action.blocked', by: 'classifier'|'denyRule', callId?: string, reason: string }
```

`action.blocked` esiste perché un blocco del classificatore **non** arriva come richiesta di
permesso: arriva come errore del tool, con testo
`"Permission for this action was denied by the Claude Code auto mode classifier. Reason: Blocked by classifier."`
L'adapter deve riconoscerlo e non lasciarlo passare per un fallimento qualsiasi, altrimenti la UI
mostra "comando fallito" dove la verità è "bloccato per sicurezza, puoi consentirlo tu". Esiste un
hook `PermissionDenied` dedicato: **non ancora verificato**.

`quota.updated` è l'evento più importante di questa sezione, ed è il motivo per cui non basta
`usage.updated`. L'utente è su abbonamento a quota fissa: `total_cost_usd` è un numero nominale
a listino API, non una spesa. La cattura di oggi conferma che il dato buono arriva da solo:

```json
{ "type": "rate_limit_event",
  "rate_limit_info": { "status": "allowed", "resetsAt": 1787355000,
                       "rateLimitType": "five_hour", "overageStatus": "rejected",
                       "isUsingOverage": false } }
```

Quindi la UI può mostrare **"quota a cinque ore, si riazzera alle HH:MM"** invece di dollari finti.
Questa è la resa concreta di un vincolo che finora era solo una nota su Notion.

`quota.windows` è la seconda metà della stessa domanda, aggiunta il **26 agosto 2026**.
`quota.updated` è un **semaforo**: dice se sei passato e quando si riapre la finestra che ti sta
stretta. Non dice **quanto ne hai consumata**, che è il numero su cui si decide se cominciare
adesso un lavoro lungo — e non lo dice per una ragione strutturale: arriva *quando* qualcosa
cambia, mentre il livello va **chiesto**.

```ts
type QuotaWindow = {
  kind: 'session' | 'weekly'   // canonico: `five_hour`/`seven_day` restano nell'adapter
  scope?: string               // il modello a cui la finestra è ristretta, quando lo è
  used?: number                // 0-100
  resetsAt?: number            // epoch ms
}
```

La sorgente è il metodo `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` dell'SDK —
si chiama davvero così, ed è l'SDK stesso a dire che la forma può cambiare. Vale comunque la
regola del progetto (se una cosa ufficiale c'è, si usa quella): il prezzo dell'instabilità si
paga in **un file solo**, `adapters/claude-code/quota.ts`, che di fronte a una forma sconosciuta
restituisce un elenco vuoto invece di numeri inventati. La cattura vera del 26 agosto 2026 è in
`offline-check.ts`, ed è ciò che renderà visibile il giorno in cui quella forma cambierà.

Cattura, ridotta alle chiavi che contano:

```json
{ "rate_limits_available": true,
  "rate_limits": {
    "five_hour": { "utilization": 6, "resets_at": "2026-08-26T12:30:00.446429+00:00" },
    "seven_day": { "utilization": 3, "resets_at": "2026-09-01T21:00:00.446456+00:00" },
    "model_scoped": [ { "display_name": "Fable", "utilization": 1,
                        "resets_at": "2026-09-01T21:00:00.446826+00:00" } ] } }
```

Tre cose non ovvie, tutte verificate:

- il piano manda anche finestre **in codice** (`nimbus_quill`, `tangelo`) e finestre a `null`.
  Non si traducono: una riga senza nome non è un'informazione.
- `resets_at` è **ISO 8601**, non epoch: diventa ms qui, perché il modello canonico usa i ms
  ovunque e due convenzioni nella stessa UI sono una trappola.
- l'istante del reset **balla di un secondo** fra due letture (il server lo ricalcola). Chi lo
  mostra deve arrotondare al minuto, altrimenti l'orario cambia da solo sotto gli occhi.

Il livello si rilegge in tre momenti — avvio, fine turno, e quando l'utente apre il pannellino —
e nel journal ci finisce **solo se è cambiato**. La quota la consumano anche le altre chat e
l'altra macchina: per questo l'evento porta con sé il suo `ts`, che è ciò che permette di dire
«6% due ore fa» invece di spacciare una fotografia vecchia per il presente.

### `context.usage` — smettere di indovinare quanto è pieno il contesto

Bug trovato e corretto il **26 agosto 2026**, segnalato dall'utente: il pannellino diceva
100% di contesto su una conversazione che, a occhio, non poteva esserci vicina.

**Cosa faceva prima.** STARK non chiedeva mai quanto fosse pieno il contesto: lo *calcolava*,
sommando `input + output + cacheRead + cacheWrite` dell'ultimo turno (`usage.updated`) e
dividendo per una finestra **indovinata dal nome del modello** (`contextWindowFor` in
`sdk-options.ts`, una tabella statica: Sonnet 5/Opus 5/famiglia 4.6+ → 1M, il resto → 200K).

**Dove si rompeva.** L'handshake vero, letto lo stesso giorno, riporta per Opus con
contesto esteso `resolvedModel: "claude-opus-5[1m]"` — **con le parentesi**, non tutti i
modelli le tolgono (Fable, nello stesso handshake, arriva già pulito). Il confronto testuale
di `contextWindowFor` non riconosceva quella stringa, non trovava corrispondenza nella
tabella, e ripiegava sui 200K sbagliati. Un contesto vero al 21% di un milione di token
appariva quindi 105%, tagliato al **100%** mostrato — cinque volte più pieno del vero.
Non era la cache, come si sospettava all'inizio: verificato mettendo a confronto sulla
stessa sessione la somma grezza e la risposta di `getContextUsage()` (sotto), i due numeri
combaciavano quasi esattamente. Il salto era tutto nel denominatore.

**La correzione non è una formula più furba.** È smettere di ricostruire quel numero da soli:
`getContextUsage()` è un metodo **pubblico e stabile** dell'SDK (non porta il suffisso
`EXPERIMENTAL` del metodo della quota) — la stessa domanda a cui risponde `/context` nel
terminale. La risposta porta già `totalTokens`, `maxTokens` e `percentage` calcolati:

```ts
type ContextUsage = {
  totalTokens: number
  maxTokens: number       // già la finestra pratica, riserva di auto-compattazione tolta
  percentage: number      // 0-100, già arrotondata da chi la manda
  categories: { name: string; tokens: number }[]
}
```

`categories` è la stessa scomposizione che l'SDK usa per `/context`: prompt di sistema, tool,
MCP, memoria, skill, messaggi, riserva di auto-compattazione, spazio libero — non più
`input`/`output`/`cache*`, che raccontano una fattura API, non uno spazio occupato. «Free
space» non è un blocco da disegnare: è il resto della barra che gli altri blocchi non
riempiono.

Stessi tre momenti di `quota.windows` — avvio, fine turno, apertura del pannellino
(`session.refreshContext`) — e nel journal solo se è cambiato. Un journal scritto prima di
oggi non ce l'ha: la UI ripiega allora sul vecchio conto approssimato, corretto anche lui (la
stessa svista sul nome del modello valeva pure lì) ma resta un'approssimazione, non la
risposta vera.

---

## 11. Comandi: dalla UI al daemon

```ts
type Command =
  | { c: 'session.open',    agent: string, cwd: string, model?: string, mode?: PermissionMode }
  | { c: 'session.prompt',  text: string, attachments?: Attachment[] }
  | { c: 'session.interrupt' }
  | { c: 'session.refreshQuota' }
  | { c: 'session.refreshContext' }
  | { c: 'session.setModel', model: string }
  | { c: 'session.setMode',  mode: PermissionMode }
  | { c: 'session.setMcp',   server: string, enabled: boolean }
  | { c: 'permissions.setRules', rules: PermissionRules }   // il pannello dei toggle
  | { c: 'session.rename',  title: string }
  | { c: 'session.sleep' }
  | { c: 'session.wake' }
  | { c: 'session.close' }
  | { c: 'permission.reply', requestId: string, decision: 'once'|'always'|'reject', scope?: string }
  | { c: 'question.reply',   requestId: string, answer: string }
```

```ts
type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions'
```

Sono le sei modalità reali di Claude Code. **STARK le espone tutte e sei.**

> ⚠️ **Corretto dal codice.** La bozza 1 diceva che `bypassPermissions` non andava esposto
> affatto, "nemmeno disabilitato, perché si opera come root". Era una restrizione **nostra**,
> aggiunta a un limite che non ci appartiene, e va contro lo scopo del progetto: STARK deve
> poter fare tutto ciò che si fa da CLI, con una interfaccia migliore. Una GUI che vieta ciò che
> il terminale consente è un motivo per non usarla.
>
> Verificato che il limite lo mette **il CLI**, non noi: da root sia
> `--dangerously-skip-permissions` sia `--permission-mode bypassPermissions` falliscono con
> *"cannot be used with root/sudo privileges for security reasons"*. Le altre cinque modalità
> funzionano tutte da root.
>
> Quindi la regola giusta è: STARK mostra la voce e, quando il CLI la rifiuterebbe, **la
> disabilita spiegando perché**. Mai nasconderla, mai lasciarla attiva e rotta in silenzio. È il
> Principio 3 applicato a una funzione che l'utente si aspetta di trovare.

`permissions.setRules` non è un comando verso l'agent: riscrive la tabella dei toggle di STARK e,
come effetto, cambia l'insieme dei `matcher` con cui la sessione successiva dichiara l'hook.

Tutti verificati come realizzabili nello spike: `interrupt`, `set_model` e `set_permission_mode`
sono `control_request` su Claude Code (P03c), il permesso passa dall'hook `PreToolUse` (P03-bis).

`session.sleep` e `session.wake` non hanno controparte nell'agent: sono STARK che termina il
processo e lo rilancia con `--resume`.

> `session.sleep` mentre la sessione è `busy` **deve** essere rifiutato o preceduto da un
> `interrupt`, altrimenti il lavoro in volo si perde. Vedi le conseguenze di ADR-005.

---

## 12. Capability

```ts
type Capabilities = {
  interrupt: boolean          // Claude Code: sì (P04)
  switchModel: boolean        // Claude Code: sì (P03c)
  switchMode: boolean         // Claude Code: sì (P03c)
  autoMode: boolean           // Claude Code: sì, ma NON con tutti i modelli — vedi sotto
  permissionAlways: boolean   // Claude Code: emulato da STARK, vedi §8
  questions: boolean          // Claude Code: da verificare
  revert: boolean             // Claude Code: no
  toolProgress: boolean       // Claude Code: no
  fileBrowser: boolean        // Claude Code: non esposto
  pty: boolean                // fuori dall'MVP (Roadmap, Fase 2)
}
```

Nell'MVP c'è un solo adapter, ma `autoMode` **fa già qualcosa di visibile oggi**, e non è
rimandabile: auto mode richiede Opus 4.6+, Sonnet 4.6+ o Fable 5, e **Haiku non è supportato su
nessun provider**. Se l'utente sceglie un modello che non lo regge, Claude Code riparte in Manual
e ogni azione tornerebbe a chiedere. Quindi `autoMode` non dipende solo dall'agent ma anche dal
**modello selezionato**, e cambia quando l'utente usa il dropdown dei modelli.

Il Principio 3 qui è vincolante: il toggle va disabilitato **con la spiegazione del perché**, mai
lasciato attivo e rotto in silenzio.

Il resto del blocco sta qui perché è il punto in cui il secondo adapter romperà per primo.

---

## 13. Il journal

Un file JSONL per sessione, append-only, un `CanonicalEvent` per riga, in ordine di `seq` (ADR-007).

Invarianti:

1. **Append-only.** Non si riscrive mai una riga. Una correzione è un evento nuovo.
2. **Ricostruibile.** Rileggere il file dall'inizio deve produrre esattamente lo stato che la UI
   mostrava. È il prerequisito del Sleep.
3. **Già normalizzato.** Nel journal non entrano payload nativi dell'agent. Se domani cambia il
   formato di Claude Code, i journal vecchi restano leggibili.
4. **Punto unico di passaggio.** L'anonimizzazione, quando arriverà, si aggancia qui: al confine
   dell'adapter, prima della scrittura (Principio 4).

Il raw nativo, se lo si vuole per debug, va in un file separato e non versionato — mai mescolato
al journal.

---

## 14. Adapter Claude Code: mappatura

| Evento canonico | Sorgente Claude Code |
|---|---|
| `session.created` | risposta a `control_request{initialize}` — **non** `system:init` |
| `session.tools` | `system:init` (arriva col primo turno) |
| `session.mode` + avviso di declassamento | `current_permission_mode` nella risposta all'`initialize` |
| `session.state: busy` | `system:status` con `status: "requesting"` |
| `turn.ended` | `result` — `reason` da `terminal_reason` / `stop_reason` |
| `step.started` / `step.ended` | `stream_event: message_start` / `message_stop` + `message_delta` |
| `text.*` | `content_block_start/text` + `content_block_delta` + `content_block_stop` |
| `reasoning.*` | come sopra su blocchi `thinking`, più `system:thinking_tokens` |
| `tool.started` | `content_block_start/tool_use` |
| `tool.input.delta` | `content_block_delta` con `input_json_delta` |
| `tool.ended` | messaggio `user` con `tool_result` |
| `file.edited` | `tool_use_result.structuredPatch` + `originalFile` (vedi trappola §9) |
| `command.executed` | `tool_use_result` di Bash: `stdout`, `stderr`, `interrupted` |
| `permission.asked` | callback dei permessi, più l'hook `PreToolUse` per i tool su "chiedi" |
| `question.asked` | stessa callback, con `toolName === 'AskUserQuestion'` |
| `action.blocked` | `tool_result` con `is_error` e testo del classificatore di auto mode |
| `usage.updated` | `result.usage` e `result.modelUsage` |
| `quota.updated` | `rate_limit_event` |
| `quota.windows` | `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`, chiesto da STARK |
| `context.usage` | `getContextUsage()`, chiesto da STARK — stabile, non sperimentale |

> ⚠️ **Corretto dal codice.** Le sorgenti qui sopra non si leggono più a mano: le fornisce
> l'Agent SDK (ADR-009), che emette le stesse forme di messaggio. Cambia **chi** trasporta, non
> **cosa** viene tradotto — ed è il punto: senza quel confine il secondo adapter non esiste.

Vincoli di lancio, dallo spike:

- `--strict-mcp-config` è **obbligatorio**. Senza, la sessione eredita tutti i server MCP globali
  della macchina: canale di uscita dati non presidiato e circa 5× di contesto per turno, cioè
  quota bruciata prima. `--tools ""` da solo non basta.
- Da root il CLI rifiuta `--dangerously-skip-permissions` **e** `--permission-mode
  bypassPermissions`, con lo stesso messaggio. Non è una scelta di STARK: è un limite di Claude
  Code, e STARK deve riportarlo, non aggiungerne di propri. `auto` invece funziona da root ed è
  il default (ADR-008).
- I toggle dei permessi **non possono passare dalla callback**: in `auto` mode il classificatore
  risolve prima e la callback non viene mai chiamata (misurato). L'unico punto che gira su **ogni**
  chiamata è l'hook `PreToolUse`, ed è documentato esattamente per questo. Il set dei matcher **è**
  il pannello dei permessi. Nessun matcher è il caso normale.
- Senza hook, un tool coperto da una regola `permissions.ask` viene **negato**, non chiesto.
- `auto` richiede Opus 4.6+, Sonnet 4.6+ o Fable 5. Con Haiku la sessione riparte in Manual: se
  STARK non se ne accorge, l'utente si ritrova a chiedere tutto senza sapere perché.

---

## 15. Controprova OpenCode

Verifica a tavolino contro i 94 schemi `Event*` di OpenCode 1.17.20, come previsto da ADR-004.

| Canonico | OpenCode |
|---|---|
| `text.started/delta/ended` | `session.next.text.started` / `.delta` / `.ended` |
| `reasoning.started/delta/ended` | `session.next.reasoning.started` / `.delta` / `.ended` |
| `tool.started` / `input.delta` / `ended` | `session.next.tool.input.started` / `.delta` / `.called` / `.success` / `.failed` |
| `step.started` / `step.ended` | `session.next.step.started` / `.ended` / `.failed` |
| `turn.ended` | `session.idle` più `session.next.step.ended` |
| `permission.asked` | `permission.v2.asked` |
| `file.edited` | `file.edited`, `session.diff` |
| `command.executed` | `command.executed`, `session.next.shell.started` / `.ended` |
| `session.model` | `session.next.model.switched` |
| `context.compacted` | `session.next.compaction.started` / `.delta` / `.ended` |
| `session.error` | `session.error` |

**Esito: il modello regge.** Non c'è nessun evento OpenCode del gruppo `session.next.*` che non
trovi posto qui, e la corrispondenza è quasi nome per nome — che è il segnale che il livello
scelto è quello giusto.

Tre cose che OpenCode ha e Claude Code no, già coperte da `Capabilities`:
`session.next.tool.progress`, `session.next.revert.staged|committed|cleared`, e le domande
`question.v2.asked`. Nessuna richiede di cambiare la forma del modello: sono eventi in più.

### Una premessa di ADR-006 è risultata sbagliata

ADR-006 dava per scontato che l'allowlist auto-alimentata fosse **specifica di Claude Code** e
che sarebbe stata il primo banco di prova delle capability. Lo spec OpenAPI dice il contrario:

- il corpo della risposta a un permesso è `{ reply: "once" | "always" | "reject", message?: string }`
  — cioè esattamente Consenti / Consenti sempre / Nega;
- esistono `GET /api/permission/saved` e `DELETE /api/permission/saved/{id}`, con
  `PermissionSavedInfo = { id, projectID, action, resource }`.

Quindi non solo OpenCode ha lo stesso modello a tre decisioni: ha già anche il **pannello di
revoca delle regole accumulate** che la Roadmap elencava fra le idee non collocate. La conseguenza
per questa specifica è che `permission.*` appartiene al **modello canonico** e non alle capability,
e che `permissionAlways` resta una capability solo perché su Claude Code il "sempre" lo emula STARK.

**Seguito.** Questa scoperta ha aperto la revisione che ha poi prodotto **ADR-008**, il quale
supera ADR-006 per intero. La convergenza va oltre le tre decisioni: le tredici chiavi di
permesso di OpenCode (`read`, `edit`, `bash`, `webfetch`, `websearch`, `task`, `skill`, `glob`,
`grep`, `lsp`, `question`, `external_directory`, `doom_loop`), ciascuna `allow` / `ask` / `deny`
con mappe a pattern per i comandi, **sono** il pannello dei toggle che il §8 descrive. La
differenza vera fra i due agent non è il modello dei permessi: è che Claude Code ha un
classificatore e OpenCode no. Per OpenCode il default non potrà essere "nessuna card", perché non
c'è nulla che decida al posto dell'utente — ed è quello, non i permessi in sé, il primo punto in
cui `Capabilities` dovrà lavorare davvero.

---

## 16. Cosa resta aperto

1. ~~**Le domande dell'agent su Claude Code.**~~ **Risolto.** Arrivano dalla stessa porta dei
   permessi: la callback viene chiamata con `toolName === 'AskUserQuestion'` e l'input contiene
   `questions[]`. Restano un evento canonico distinto perché per l'utente "scegli fra queste
   opzioni" e "posso eseguire questo comando?" sono due cose diverse, e una UI che le mostrasse
   uguali mentirebbe. Da 1 a 4 domande, da 2 a 4 opzioni, `header` max 12 caratteri.
   `capabilities.questions` è `true`.
2. ~~**Identità stabile delle parti.**~~ **Risolto dal codice.** Il `partId` è
   `${messageId}#${index}`: l'indice si ricicla a ogni messaggio, l'id del messaggio no.
   Verificato che i partId restano distinti attraverso più messaggi dello stesso turno.
3. ~~**Rappresentazione del prompt utente.**~~ **Risolto per le immagini** (vedi `PromptPart`
   nel §6): si incollano e si trascinano, viaggiano come blocchi `image` verso l'agent e come
   riferimento nel journal. Resta fuori il **riferimento a un file per percorso**, che però non
   ha bisogno di un tipo nuovo: l'agent legge un percorso scritto nel testo. Va deciso se serve
   un modo per *scegliere* quel file invece di scriverlo, e quello sì che tocca la UI.
4. **L'hook `PermissionDenied`.** Esiste e servirebbe a intercettare i blocchi del classificatore
   in modo pulito invece di riconoscerli dal testo dell'errore. Mai provato: finché non lo si
   verifica, `action.blocked` si ricava dal `tool_result`.
5. ~~**Quali voci mostra il pannello dei permessi.**~~ **Risolto: sei categorie.** `shell`,
   `edit`, `read`, `net`, `agents`, `external` — nel vocabolario canonico
   (`PermissionCategory`), con la traduzione in nomi di tool confinata nell'adapter
   (`adapters/claude-code/permissions.ts`), che è l'unico a conoscerli. Sono sei perché sono
   sei le cose che un utente riconosce guardando cosa sta per succedere; un elenco di venti
   tool sarebbe più preciso e inservibile. Restano fuori i **divieti**: «vietalo» non è una
   terza posizione dello stesso interruttore ma un altro meccanismo, e STARK non lo implementa
   ancora — nel pannello sta in elenco, spento, con scritto perché.
6. **Costo in quota del classificatore.** Ogni azione ispezionata è una chiamata a un secondo
   modello. Non è stato misurato, e su abbonamento a quota fissa è la risorsa che conta.
7. **Rotazione del journal.** Una sessione lunga produce un file grande. Nessuna decisione presa.
8. ~~**Il risveglio vero.**~~ **Risolto, e misurato (P16).** Rilanciare con `--resume` riaggancia
   il journal esistente e i `seq` **continuano** invece di ripartire da 1 — ripartire produrrebbe
   due eventi con lo stesso numero nello stesso file, e "ho già visto fino a N" smetterebbe di
   voler dire qualcosa. Sono due memorie separate: il journal ripristina la UI, il trascritto
   dell'agent ripristina il contesto del modello. Per questo `--no-session-persistence` è
   incompatibile con lo Sleep. Resta non misurato **quanto costa in quota** risvegliare una
   conversazione lunga: le sonde usano prompt minuscoli.

---

## 17. Cosa è già codice

`src/` implementa le sezioni 4-14 per il solo adapter Claude Code.

| | |
|---|---|
| `src/core/events.ts` | i tipi di questo documento, uno a uno |
| `src/core/journal.ts` | §13, append-only, `seq` senza buchi (scrittura sincrona di proposito) |
| `src/core/reduce.ts` | l'invariante del §4 resa eseguibile: eventi → stato della UI |
| `src/adapters/claude-code/` | l'unico punto che nomina Claude Code; sopra l'Agent SDK (ADR-009) |
| `src/cli/offline-check.ts` | `npm run check` — 78 verifiche su eventi finti, **costo zero di quota** |
| `src/cli/vertical-slice.ts` | `npm run slice` — sessione vera, poi Sleep, poi replay |
| `src/daemon/` | HTTP + SSE su 127.0.0.1, registro delle sessioni, perimetro di sicurezza |
| `ui/` | Vite + Svelte 5 (ADR-010). Non tiene un modello proprio: `SessionSnapshot` più lo stesso `applyTo` |

## 18. Il daemon: come i comandi del §11 viaggiano

I `Command` del §11 non hanno bisogno di un protocollo proprio: vanno in `POST
/api/sessions/:id/command` come corpo JSON, e la risposta dice solo se sono stati accettati.
Ciò che accade dopo torna dal **flusso degli eventi**, non dalla risposta. Non è una
semplificazione: è l'invariante del §4 applicata al trasporto — se un comando rispondesse con
il proprio effetto, quell'effetto esisterebbe in un posto che il journal non conosce.

Il flusso è **SSE**, non WebSocket. Ciò che conta va in una direzione sola, e SSE è uno standard
che sta già in Node e nel browser: nessuna dipendenza. Per giunta è la stessa forma che usa
OpenCode, quindi il secondo adapter troverà la strada fatta.

### Due flussi, non uno

`GET /api/sessions/:id/stream` porta gli **eventi** di una conversazione. `GET /api/stream` porta
le **righe dell'elenco**, e non manda eventi ma un colpetto con la lista intera ogni volta che
cambia, al più una volta ogni 250 ms.

Il secondo è nato per togliere una domanda ripetuta: la barra laterale interrogava
`/api/sessions` ogni tre secondi, perché per sapere che una chat *diversa* da quella aperta era
cambiata non c'era altro modo. Interrogare a ripetizione per sapere se è successo qualcosa è
esattamente ciò che SSE esiste per non fare.

Manda la lista intera e non un delta di proposito: sono poche decine di righe corte, e un
protocollo di differenze sarebbe una seconda copia dello stato da tenere allineata — cioè un
altro posto in cui la UI può divergere dal journal. Il ritardo di 250 ms non è una comodità: un
solo turno produce decine di eventi al secondo, e ogni riga dell'elenco che non è viva si
ricalcola rileggendo il suo journal da disco.

### Le due rotte che non sono comandi

`DELETE /api/sessions/:id` cancella il journal, cioè **tutta** la storia: non c'è cestino. Se la
sessione sta girando la si chiude prima, altrimenti l'adapter continuerebbe a scrivere su un file
che non esiste più.

`session.rename` invece è un comando del §11, ma il registro lo gestisce **prima** del controllo
«è attiva?»: si rinomina soprattutto ciò che dorme, e `POST /command` su una sessione dormiente
risponde «sessione non attiva». Scrive `session.renamed` nel journal e basta.

Chi si collega passa `?from=N` e riceve **prima ciò che si è perso, poi il resto**, in un
travaso che non cede il controllo: se aspettasse qualcosa in mezzo, un evento nuovo potrebbe
infilarsi fra la storia e il flusso e arrivare due volte, o mai. Ogni evento porta `id: <seq>`,
così una connessione caduta riparte dal punto giusto senza rileggere tutto.

Misurato su sessioni reali, dopo il passaggio all'SDK: 122 eventi canonici con `Write`, `Edit` e
quattro comandi, zero richieste di permesso in `auto` mode — cioè ADR-008 che funziona sul codice
e non solo sulla carta. Una domanda a scelta multipla percorsa da capo a fondo
(`question.asked` → risposta → il turno prosegue). Un risveglio con `seq` contigui su un solo
journal e il modello che ricorda ciò che era stato detto prima. In tutti i casi lo stato dal vivo
e quello ricostruito dal journal sono identici.
