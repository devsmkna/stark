// §4, invariante fondamentale: lo stato della UI deve essere ricostruibile INTERAMENTE
// rileggendo il journal dall'inizio.
//
// Questo file è quell'invariante resa verificabile. È una funzione pura da lista di
// eventi a stato: se la UI un domani terrà anche un solo dato che non nasce da qui,
// il Sleep di ADR-005 smette di funzionare e nessuno se ne accorge finché un utente
// non risveglia una sessione e trova metà schermo vuoto.

import {
  EMPTY_USAGE,
  type CanonicalEvent, type Capabilities, type Cost, type Hunk,
  type AgentQuestion, type McpServer, type ModeChoice, type ModelChoice, type PermissionMode,
  type SessionOption, type TodoItem,
  type ContextUsage, type PromptPart, type QuotaWindow, type SessionState, type SlashCommand, type Usage,
} from './events.ts'

export type TextPartView = { kind: 'text'; partId: string; text: string; open: boolean }
export type ReasoningPartView = {
  kind: 'reasoning'; partId: string; text: string; estimatedTokens?: number; open: boolean
}
export type ToolPartView = {
  kind: 'tool'; callId: string; name: string; inputRaw: string; input?: unknown
  /** Su cosa ha lavorato, gia pronto dall'adapter. Vedi `tool.input.ended`. */
  summary?: string
  /** Perche l'agent l'ha lanciato — la sua motivazione, non una dedotta da STARK.
   *  Assente quando l'agent non l'ha scritta (F2, vedi `summary.ts`). */
  intent?: string
  startedAt: number; endedAt?: number
  done: boolean; ok?: boolean; error?: string; blocked?: 'classifier' | 'denyRule'
  /** Cio che il tool ha restituito, per intero. Arriva con `tool.ended`: prima di
   *  quel momento non esiste, e un tool bloccato non ce l'ha mai. */
  output?: string
  /**
   * Il lavoro che questa chiamata ha **avviato** e che è andato avanti per conto suo.
   *
   * Sta dentro la parte del tool e non in un elenco a parte perché è la stessa riga:
   * un comando lanciato in background non è un secondo fatto, è ciò che si scopre
   * dopo su un fatto già mostrato. E soprattutto: senza di questo la riga direbbe
   * `done` — il `tool_result` del lancio arriva **subito** e ha esito positivo —
   * mentre il lavoro sta ancora girando. Vedi `task.started` in `events.ts`.
   */
  task?: {
    taskId: string
    kind: 'command' | 'agent' | 'other'
    description?: string
    background: boolean
    /** Assente finché non si sa: è la differenza fra «sta girando» e «è andata così». */
    status?: 'completed' | 'failed'
    summary?: string
    outputFile?: string
  }
}
/**
 * Una domanda sola dentro una risposta: com'era intitolata, cosa chiedeva, cosa si e
 * risposto. Una richiesta `AskUserQuestion` ne porta da 1 a 4, e sono cose DIVERSE —
 * non pezzi di una frase sola. Appiattirle in una riga separata da `·` faceva perdere
 * l'unica informazione che conta quando si rilegge: quale risposta stava a quale
 * domanda.
 */
export type AnswerItemView = { header: string; asked: string; answer: string }
/**
 * Cosa hai risposto, li dov'e successo.
 *
 * La richiesta non entra nel flusso — si espande il blocco in basso, sempre nello
 * stesso posto. Ma la RISPOSTA si: riaprendo il lavoro due giorni dopo si deve
 * capire cosa si era deciso, e perche l'agent ha fatto in quel modo.
 */
export type AnswerPartView = {
  kind: 'answer'; partId: string; of: 'permission' | 'question' | 'plan'
  /** Cosa era stato chiesto, come lo si era letto nel blocco in basso. */
  asked: string
  /** Cosa si e risposto. */
  answer: string
  /**
   * Le domande una per una, quando ce n'era piu d'una — o anche una sola, purche si
   * sappia com'era formulata. Assente sui permessi, che una domanda sola ce l'hanno
   * per definizione, e assente quando la richiesta non e piu ricostruibile.
   */
  items?: AnswerItemView[]
  /** Una risposta negata non e un fallimento, ma va distinta da una concessa. */
  refused: boolean
  at: number
}
/**
 * Dove il contesto e stato riassunto. Sta **dentro il turno** perche li succede: si e
 * visto dal vivo, il `compact_boundary` arriva dopo l'inizio del turno e prima che
 * finisca. Ed e una cosa da vedere, non da nascondere: sopra quella riga il modello
 * non ha piu i messaggi per intero, ed e la spiegazione di meta delle volte in cui
 * sembra aver dimenticato qualcosa.
 */
export type CompactPartView = {
  kind: 'compact'; partId: string
  before: number; after?: number
  trigger?: 'manual' | 'auto'
  at: number
}
/**
 * Il turno e' stato ritentato. Sta nel flusso e non nell'intestazione perche' e'
 * successo **li'**: e' la spiegazione della pausa che si vede sopra.
 */
export type RetryPartView = {
  kind: 'retry'; partId: string; attempt: number; reason: string; at: number
}
export type PartView =
  TextPartView | ReasoningPartView | ToolPartView | AnswerPartView | CompactPartView
  | RetryPartView

export type TurnView = {
  turnId: string
  prompt: PromptPart[]
  parts: PartView[]
  steps: number
  /** L'orario a sinistra nell'intestazione del turno, e la durata quando e finito.
   *  Come `lastTs`: la UI lo mostra, quindi per il §4 deve nascere dal journal. */
  startedAt: number
  endedAt?: number
  ended: boolean
  reason?: 'completed' | 'aborted' | 'error' | 'interrupted'
  usage?: Usage
  cost?: Cost
  /**
   * Quando, dentro questo turno, il contesto e stato **azzerato** (`/clear`).
   *
   * E un dato del turno e non una parte come la compattazione, perche non e una cosa
   * successa *dentro* il flusso: e un taglio *del* flusso. Tutto quello che sta sopra,
   * questo turno compreso, il modello non ce l'ha piu — quindi la UI lo raccoglie in
   * un blocco solo, chiuso, invece di lasciarlo scorrere come se contasse ancora.
   * L'ora serve alla UI per dire *quando* e successo senza inventarsela.
   */
  clearedAt?: number
}

export type FileEditView = {
  path: string; created: boolean; hunks: Hunk[]; callId?: string
  /** «In ordine di tempo» e una delle due letture degli effetti: senza l'ora non esiste. */
  ts: number
}
export type CommandRunView = {
  command: string; exitCode?: number; interrupted: boolean
  stdoutBytes: number; stderrBytes: number; callId?: string
  ts: number
}
export type PendingPermissionView = {
  requestId: string; action: string; resources: string[]; savable: string[]; callId?: string
}
export type QuotaView = {
  status: string; kind: string; resetsAt: number; usingOverage: boolean
}
export type PendingQuestionView = { requestId: string; questions: AgentQuestion[] }
/**
 * Un piano in attesa di essere approvato.
 *
 * `plan` è markdown, e per intero: è un documento da **leggere**, non un soggetto da
 * riconoscere. È la differenza per cui non è un permesso — e prima di questo tipo
 * finiva in una card generica che di quel testo non mostrava niente, perché `plan`
 * non è fra i campi in cui l'adapter cerca il soggetto di un'azione.
 */
export type PendingPlanView = { requestId: string; plan: string; path?: string }
export type NoticeView = { level: 'info' | 'warn' | 'error'; text: string }
export type BlockedView = {
  by: 'classifier' | 'denyRule'; callId?: string; reason: string; ts: number
}

/**
 * Tiene allineata un'opzione quando arriva una delle **forme vecchie**
 * (`session.mode` / `session.model`).
 *
 * Serve perche' un journal misto esiste davvero: una conversazione aperta prima di
 * ADR-014 e risvegliata dopo ha le due forme nello stesso file. Senza questo, la barra
 * mostrerebbe il valore giusto in un campo e quello vecchio nel selettore, e i due si
 * contraddirebbero a schermo.
 */
function specchia(s: SessionSnapshot, id: string, value: string): void {
  const o = s.options.find(x => x.id === id)
  if (o) o.value = value
}

export type SessionSnapshot = {
  v: number
  sessionId: string
  agent?: string
  cwd?: string
  model?: string
  mode?: PermissionMode
  /** Fra cosa si puo scegliere dalla barra di stato. Vuoto su un journal vecchio: la
   *  UI mostra allora solo il valore corrente, invece di inventarsi un elenco. */
  models: ModelChoice[]
  modes: ModeChoice[]
  /**
   * La checklist dell'agent, se ne tiene una. Vuota vuol dire due cose diverse — «non
   * ce l'ha» e «non ha ancora niente da fare» — e a distinguerle e' `capabilities.todos`.
   */
  todos: TodoItem[]
  /**
   * I selettori che l'agent dichiara, e che la barra di stato disegna **senza
   * conoscerli** (ADR-014). Vuoto su un journal scritto prima: allora valgono `models`
   * e `modes`, che sono gli stessi due casi in forma vecchia.
   */
  options: SessionOption[]
  /** Il titolo scelto a mano. Se manca, lo si ricava dal primo prompt. */
  title?: string
  state: SessionState
  stateReason?: string
  capabilities?: Capabilities
  tools: string[]
  slashCommands: SlashCommand[]
  /**
   * I server MCP di questa conversazione. Vuoto finche l'adapter non li ha guardati,
   * e vuoto per sempre su un journal scritto prima che STARK sapesse chiederglielo:
   * la UI mostra allora il chip spento, che e la verita.
   */
  mcpServers: McpServer[]
  turns: TurnView[]
  files: FileEditView[]
  shell: CommandRunView[]
  pendingPermissions: PendingPermissionView[]
  pendingQuestions: PendingQuestionView[]
  /** I piani in attesa di approvazione. Una lista come le altre due, anche se in
   *  pratica ne arriva uno alla volta: la forma uniforme è ciò che permette al blocco
   *  in basso di trattarli con la stessa regola invece che con un caso speciale. */
  pendingPlans: PendingPlanView[]
  blocked: BlockedView[]
  notices: NoticeView[]
  usage: Usage
  cost: Cost
  quota?: QuotaView
  /**
   * Quanto hai consumato di ciascuna finestra del piano. Vuoto finché nessuno l'ha
   * chiesto, e vuoto per sempre su un journal scritto prima che STARK sapesse
   * chiederlo: la UI dice allora che non lo sa, invece di disegnare una barra a zero.
   */
  quotaWindows: QuotaWindow[]
  /** Quando sono state misurate. Su una chat che dorme è un numero vecchio, e va
   *  detto: senza questo istante il pannellino spaccerebbe per attuale una fotografia
   *  di due ore fa. */
  quotaWindowsAt?: number
  /**
   * Quanto è pieno il contesto, secondo `getContextUsage()` — non un calcolo di
   * STARK. Assente finché nessuno l'ha chiesto: la UI ripiega allora sul vecchio
   * conto approssimato (token di API / finestra indovinata dal nome del modello),
   * che è ciò che c'era prima di sapere fare la domanda giusta.
   */
  contextUsage?: ContextUsage
  /** Quando è stato misurato — stessa ragione di `quotaWindowsAt`. */
  contextUsageAt?: number
  lastSeq: number
  /** Quando è successo l'ultimo evento. La barra laterale mostra l'ora, e per il §4
   *  ogni cosa che la UI mostra deve nascere dal journal e non da altrove. */
  lastTs: number
  /**
   * Da quando sta in questo stato. **Non** è `lastTs`, ed è la differenza che conta:
   * `lastTs` dice quando ha scritto l'ultima riga, questo dice da quanto è fermo lì.
   * Su un lavoro che procede sono la stessa cosa; su uno piantato divergono, ed è
   * esattamente il caso in cui si vuole saperlo (`ui-schermate.md` §1).
   */
  stateSince: number
  resumeRef?: string
  error?: string
}

function emptySnapshot(sessionId: string): SessionSnapshot {
  return {
    v: 1, sessionId, state: 'starting', tools: [], slashCommands: [],
    models: [], modes: [], options: [], todos: [], mcpServers: [],
    turns: [], files: [], shell: [], pendingPermissions: [], pendingQuestions: [], pendingPlans: [],
    blocked: [], notices: [], quotaWindows: [],
    usage: { ...EMPTY_USAGE }, cost: { nominalUsd: 0 }, lastSeq: 0, lastTs: 0,
    stateSince: 0,
  }
}

export function reduce(events: CanonicalEvent[], sessionId = ''): SessionSnapshot {
  const s = emptySnapshot(sessionId || events[0]?.sessionId || '')
  for (const e of events) applyTo(s, e)
  return s
}

/** Applica un evento in place. La UI dal vivo userà questa, il replay userà `reduce`. */
export function applyTo(s: SessionSnapshot, e: CanonicalEvent): SessionSnapshot {
  s.lastSeq = e.seq
  s.lastTs = e.ts
  if (!s.sessionId) s.sessionId = e.sessionId
  // Lo stato cambia da sei posti diversi — `session.state`, i due Sleep, l'errore, e i
  // permessi e le domande che portano ad `awaiting` e ne tornano. Guardarlo prima e
  // dopo è l'unico modo perché `stateSince` non dimentichi uno di quei sei.
  const before = s.state
  const p = e.payload
  /**
   * A quale turno appartiene quello che sta arrivando: il **primo aperto**, non
   * l'ultimo della lista.
   *
   * Erano la stessa cosa finché i turni nascevano uno alla volta. Da quando i prompt
   * fanno la fila (§7) non lo sono più: l'ultimo della lista può essere uno che
   * aspetta il suo giro, e attaccargli le parti del turno che sta *lavorando* gliele
   * ruba. Si vedeva, ed è il motivo per cui questa riga è cambiata: la risposta al
   * primo prompt compariva dentro il secondo, sopra la sua.
   *
   * Il ripiego sull'ultimo resta per ciò che arriva a turno già chiuso: appenderlo
   * all'ultimo è comunque meglio che buttarlo via in silenzio.
   */
  const turn = (): TurnView | undefined =>
    s.turns.find(t => !t.ended) ?? s.turns[s.turns.length - 1]

  switch (p.k) {
    case 'session.created': {
      s.agent = p.agent; s.cwd = p.cwd; s.model = p.model
      s.capabilities = p.capabilities; s.tools = p.tools; s.slashCommands = p.commands
      if (p.models) s.models = p.models
      if (p.modes) s.modes = p.modes
      if (p.options) s.options = p.options
      // `session.created` arriva ogni volta che nasce un processo figlio nuovo per
      // questa sessione — non solo alla prima: anche a ogni risveglio, e a ogni
      // riavvio del daemon che la ospitava. Un processo che *nasce* non puo' avere
      // ereditato un turno davvero in corso — se lo snapshot ne ha uno con `ended:
      // false`, e' per forza un turno che il processo di prima ha lasciato a meta',
      // tipicamente un `kill` del daemon prima che scrivesse il proprio `turn.ended`
      // (misurato dal vivo il 26 agosto: una sessione ripresa con un turno rimasto
      // aperto per sempre, e ogni risposta successiva finita li' dentro invece che
      // nel proprio turno — vedi `turn()` qui sotto). Diverso da un turno ancora
      // aperto quando *parte* un altro turno nella stessa sessione viva: quello e'
      // l'overlap normale della coda (provato in `npm run queue`), e va lasciato
      // stare. Qui invece non c'e' overlap possibile: e' un processo nuovo.
      for (const t of s.turns) if (!t.ended) { t.ended = true; t.reason = 'interrupted'; t.endedAt = e.ts }
      break
    }
    case 'session.renamed': s.title = p.title; break
    case 'session.state':
      s.state = p.state
      if (p.reason !== undefined) s.stateReason = p.reason
      break
    // ADR-014: la via nuova. `mode` e `model` restano come **comodita'** sullo
    // snapshot — l'elenco delle chat e le notifiche li vogliono senza aprire una
    // conversazione — ma non sono piu' due casi speciali del modello: sono due
    // opzioni con un id convenuto.
    case 'session.option': {
      const o = s.options.find(x => x.id === p.id)
      if (o) o.value = p.value
      if (p.id === 'mode') s.mode = p.value
      if (p.id === 'model') s.model = p.value
      break
    }
    // Le due forme vecchie: nessun adapter le emette piu', ma i journal scritti prima
    // ne sono pieni e devono continuare a ricostruirsi identici (§4).
    case 'session.model': s.model = p.model; specchia(s, 'model', p.model); break
    case 'session.tools': s.tools = p.tools; break
    // Si sostituisce, non si fonde: l'evento porta la fotografia intera di com'erano
    // in quel momento. Fondere terrebbe in vita un server sparito dalla macchina.
    case 'session.mcp': s.mcpServers = p.servers; break
    case 'session.commands': s.slashCommands = p.commands; break
    case 'session.resumeRef': s.resumeRef = p.ref; break
    case 'session.mode': s.mode = p.mode; specchia(s, 'mode', p.mode); break
    case 'session.slept': s.state = 'sleeping'; break
    case 'session.woke': s.state = 'idle'; break
    case 'session.error':
      s.error = p.message
      if (p.fatal) s.state = 'error'
      break

    case 'turn.started':
      s.turns.push({
        turnId: p.turnId, prompt: p.prompt, parts: [], steps: 0,
        startedAt: e.ts, ended: false,
      })
      break
    case 'turn.promptAdded': {
      // Si accoda al prompt che c'era, non lo sostituisce: è un secondo «per favore
      // anche» dentro lo stesso turno, non un turno a sé (vedi il commento su
      // `turn.promptAdded` in events.ts).
      const t = s.turns.find(x => x.turnId === p.turnId)
      if (t) t.prompt = [...t.prompt, ...p.prompt]
      break
    }
    case 'turn.ended': {
      const t = s.turns.find(x => x.turnId === p.turnId)
      if (t) {
        t.ended = true; t.reason = p.reason; t.usage = p.usage; t.cost = p.cost
        t.endedAt = e.ts
      }
      break
    }
    case 'step.started': { const t = turn(); if (t) t.steps++; break }
    case 'step.ended': break

    case 'text.started':
      turn()?.parts.push({ kind: 'text', partId: p.partId, text: '', open: true })
      break
    case 'text.delta': {
      const part = findText(s, p.partId); if (part) part.text += p.delta; break
    }
    case 'text.ended': {
      const part = findText(s, p.partId)
      // `text` finale dell'evento e accumulo dei delta devono coincidere: se non
      // coincidono ha vinto l'evento finale, ed è un bug dell'adapter da vedere.
      if (part) { part.text = p.text; part.open = false }
      break
    }

    case 'reasoning.started':
      turn()?.parts.push({ kind: 'reasoning', partId: p.partId, text: '', open: true })
      break
    case 'reasoning.delta': {
      const part = findReasoning(s, p.partId)
      if (part) {
        part.text += p.delta
        if (p.estimatedTokens !== undefined) part.estimatedTokens = p.estimatedTokens
      }
      break
    }
    case 'reasoning.ended': {
      const part = findReasoning(s, p.partId); if (part) part.open = false; break
    }

    case 'tool.started':
      turn()?.parts.push({
        kind: 'tool', callId: p.callId, name: p.name, inputRaw: '', done: false,
        startedAt: e.ts,
      })
      break
    case 'tool.input.delta': {
      const part = findTool(s, p.callId); if (part) part.inputRaw += p.delta; break
    }
    case 'tool.input.ended': {
      const part = findTool(s, p.callId)
      if (part) {
        part.input = p.input
        if (p.summary !== undefined) part.summary = p.summary
        if (p.intent !== undefined) part.intent = p.intent
      }
      break
    }
    case 'tool.ended': {
      const part = findTool(s, p.callId)
      if (part) {
        part.done = true; part.ok = p.ok; part.endedAt = e.ts
        if (p.error !== undefined) part.error = p.error
        if (p.output !== undefined) {
          part.output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output, null, 2)
        }
      }
      break
    }

    case 'task.started': {
      // Senza `callId` non c'è niente a cui attaccarlo. Non si inventa una riga: una
      // riga in più che dice «è partito qualcosa» senza poter dire da dove sarebbe
      // rumore, e il caso non si è mai visto nei journal reali (279 task, tutti con
      // il loro `tool_use_id`).
      if (!p.callId) break
      const part = findTool(s, p.callId)
      if (!part) break
      part.task = {
        taskId: p.taskId, kind: p.kind, background: p.background,
        ...(p.description !== undefined ? { description: p.description } : {}),
      }
      break
    }
    case 'task.ended': {
      // Si cerca per `taskId` e **non** per `callId`, che qui non c'è: l'esito arriva
      // molto dopo, spesso in un altro turno, e l'unica cosa che lega le due metà è
      // l'id del lavoro. Per questo la ricerca risale tutta la conversazione.
      const part = findTask(s, p.taskId)
      if (part?.task) {
        part.task.status = p.status
        if (p.summary !== undefined) part.task.summary = p.summary
        if (p.outputFile !== undefined) part.task.outputFile = p.outputFile
      }
      break
    }

    case 'permission.asked':
      s.pendingPermissions.push({
        requestId: p.requestId, action: p.action, resources: p.resources,
        savable: p.savable, ...(p.source.callId !== undefined ? { callId: p.source.callId } : {}),
      })
      s.state = 'awaiting'
      break
    case 'permission.replied': {
      // Si legge la richiesta PRIMA di toglierla: la risposta da sola direbbe «once»
      // senza dire a cosa, e nel flusso resterebbe un si senza domanda.
      const asked = s.pendingPermissions.find(x => x.requestId === p.requestId)
      s.pendingPermissions = s.pendingPermissions.filter(x => x.requestId !== p.requestId)
      turn()?.parts.push({
        kind: 'answer', partId: p.requestId, of: 'permission',
        asked: asked ? [asked.action, ...asked.resources].join(' · ') : 'permission',
        answer: p.decision === 'reject' ? 'denied'
          : p.decision === 'always' ? 'allowed, and remembered' : 'allowed',
        refused: p.decision === 'reject', at: e.ts,
      })
      if (s.pendingPermissions.length === 0 && s.state === 'awaiting') s.state = 'busy'
      break
    }
    case 'plan.proposed':
      s.pendingPlans.push({
        requestId: p.requestId, plan: p.plan,
        ...(p.path !== undefined ? { path: p.path } : {}),
      })
      s.state = 'awaiting'
      break
    case 'plan.replied': {
      // Come per i permessi: la richiesta si legge PRIMA di toglierla, se no nel
      // flusso resterebbe un «approvato» senza dire cosa.
      const chiesto = s.pendingPlans.find(x => x.requestId === p.requestId)
      s.pendingPlans = s.pendingPlans.filter(x => x.requestId !== p.requestId)
      // Il piano **per intero** resta nel flusso, non un suo riassunto: è il documento
      // su cui l'agent ha lavorato da lì in poi, ed è la cosa che si torna a rileggere
      // due giorni dopo per capire perché ha fatto in quel modo. Riassumerlo qui
      // vorrebbe dire perderlo, perché in nessun altro posto è scritto.
      turn()?.parts.push({
        kind: 'answer', partId: p.requestId, of: 'plan',
        asked: chiesto?.plan ?? 'plan',
        answer: p.decision === 'rejected'
          ? (p.feedback ? `kept planning: ${p.feedback}` : 'kept planning')
          : p.mode ? `approved, continuing in ${p.mode}` : 'approved',
        refused: p.decision === 'rejected', at: e.ts,
      })
      if (s.pendingPlans.length === 0 && s.state === 'awaiting') s.state = 'busy'
      break
    }
    case 'question.asked':
      s.pendingQuestions.push({ requestId: p.requestId, questions: p.questions })
      s.state = 'awaiting'
      break
    case 'question.replied':
    case 'question.rejected': {
      const asked = s.pendingQuestions.find(x => x.requestId === p.requestId)
      s.pendingQuestions = s.pendingQuestions.filter(x => x.requestId !== p.requestId)
      const replied = p.k === 'question.replied'
      // L'ordine viene dalle domande poste, non da `Object.keys(answers)`: e quello
      // in cui sono state lette nello stepper, e rileggerle in un altro ordine due
      // giorni dopo vuol dire rileggere un'altra cosa.
      const items: AnswerItemView[] | undefined = replied && asked
        ? asked.questions.map(q => ({
          header: q.header, asked: q.question, answer: flatten(p.answers[q.question]),
        }))
        : undefined
      turn()?.parts.push({
        kind: 'answer', partId: p.requestId, of: 'question',
        asked: asked?.questions.map(q => q.question).join(' · ') ?? 'question',
        answer: replied
          ? Object.values(p.answers).map(v => Array.isArray(v) ? v.join(', ') : v).join(' · ')
            || (p.response ?? '')
          : 'dismissed without answering',
        ...(items ? { items } : {}),
        refused: !replied, at: e.ts,
      })
      if (s.pendingQuestions.length === 0 && s.pendingPermissions.length === 0
        && s.state === 'awaiting') s.state = 'busy'
      break
    }

    case 'file.edited':
      s.files.push({
        path: p.path, created: p.created, hunks: p.hunks, ts: e.ts,
        ...(p.callId !== undefined ? { callId: p.callId } : {}),
      })
      break
    case 'command.executed':
      s.shell.push({
        command: p.command, interrupted: p.interrupted, ts: e.ts,
        stdoutBytes: p.stdout.length, stderrBytes: p.stderr.length,
        ...(p.exitCode !== undefined ? { exitCode: p.exitCode } : {}),
        ...(p.callId !== undefined ? { callId: p.callId } : {}),
      })
      break

    case 'usage.updated':
      s.usage = p.usage; s.cost = p.cost; break
    case 'quota.updated':
      s.quota = {
        status: p.status, kind: p.kind, resetsAt: p.resetsAt, usingOverage: p.usingOverage,
      }
      break
    case 'quota.windows':
      s.quotaWindows = p.windows; s.quotaWindowsAt = e.ts; break
    case 'context.usage':
      s.contextUsage = p.usage; s.contextUsageAt = e.ts; break
    case 'session.retried': {
      // Senza un turno aperto non c'e' un posto nel flusso: un ritentativo avviene per
      // definizione dentro un turno. Se ne arrivasse uno fuori, si perderebbe qui — e
      // lo dice questo commento, come per la compattazione.
      turn()?.parts.push({
        kind: 'retry', partId: `retry-${e.seq}`,
        attempt: p.attempt, reason: p.reason, at: e.ts,
      })
      break
    }
    // La checklist arriva **intera** ogni volta: si sostituisce, non si fonde. E' la
    // forma in cui la manda l'agent ed e' quella giusta per un journal append-only —
    // chi rilegge non deve applicare patch, gli basta l'ultimo evento.
    case 'todo.updated': s.todos = p.todos; break

    case 'context.compacted': {
      // Senza un turno aperto non c'e un posto nel flusso in cui metterla, e non e mai
      // successo: la compattazione avviene mentre un turno gira. Se un giorno arrivasse
      // prima del primo turno, si perderebbe qui — e lo direbbe questo commento.
      turn()?.parts.push({
        kind: 'compact', partId: `compact-${e.seq}`, before: p.before, at: e.ts,
        ...(p.after !== undefined ? { after: p.after } : {}),
        ...(p.trigger !== undefined ? { trigger: p.trigger } : {}),
      })
      break
    }
    case 'context.cleared': {
      // Sul turno, non fra le sue parti: vedi `clearedAt`. `turn()` qui e il turno del
      // comando stesso — `conversation_reset` arriva mentre quel turno e ancora aperto
      // (verificato: fra il `result` del turno precedente e il `system:init` nuovo).
      const t = turn()
      if (t) t.clearedAt = e.ts
      break
    }
    case 'notice':
      s.notices.push({ level: p.level, text: p.text }); break
    case 'action.blocked': {
      s.blocked.push({
        by: p.by, reason: p.reason, ts: e.ts,
        ...(p.callId !== undefined ? { callId: p.callId } : {}),
      })
      const part = p.callId ? findTool(s, p.callId) : undefined
      if (part) part.blocked = p.by
      break
    }
  }
  if (s.state !== before || s.stateSince === 0) s.stateSince = e.ts
  return s
}

/**
 * Una risposta a scelta multipla e un array; a scelta singola e una stringa. Qui
 * diventa sempre testo, perche a valle c'e una riga da leggere, non un dato da
 * elaborare. Una domanda saltata resta stringa vuota: la UI deve poter distinguere
 * «non risposta» da «risposta vuota», e non inventare un trattino al posto suo.
 */
function flatten(v: string | string[] | undefined): string {
  if (v === undefined) return ''
  return Array.isArray(v) ? v.join(', ') : v
}

function findText(s: SessionSnapshot, partId: string): TextPartView | undefined {
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const parts = s.turns[i]?.parts ?? []
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]
      if (part && part.kind === 'text' && part.partId === partId) return part
    }
  }
  return undefined
}

function findReasoning(s: SessionSnapshot, partId: string): ReasoningPartView | undefined {
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const parts = s.turns[i]?.parts ?? []
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]
      if (part && part.kind === 'reasoning' && part.partId === partId) return part
    }
  }
  return undefined
}

/**
 * La chiamata a cui appartiene un lavoro, cercata per id del lavoro.
 *
 * Serve una funzione a sé, e non basta `findTool`, perché l'esito di un task arriva
 * **senza** `tool_use_id`: il CLI manda solo `task_id`. Le due metà della stessa
 * storia — «è partito» e «è andata così» — possono stare a centinaia di eventi e a
 * più turni di distanza, quindi l'unica cosa che le lega è quell'id.
 */
function findTask(s: SessionSnapshot, taskId: string): ToolPartView | undefined {
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const parts = s.turns[i]?.parts ?? []
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]
      if (part && part.kind === 'tool' && part.task?.taskId === taskId) return part
    }
  }
  return undefined
}

function findTool(s: SessionSnapshot, callId: string): ToolPartView | undefined {
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const parts = s.turns[i]?.parts ?? []
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]
      if (part && part.kind === 'tool' && part.callId === callId) return part
    }
  }
  return undefined
}
