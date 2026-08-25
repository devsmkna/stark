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
  type PromptPart, type SessionState, type SlashCommand, type Usage,
} from './events.ts'

export type TextPartView = { kind: 'text'; partId: string; text: string; open: boolean }
export type ReasoningPartView = {
  kind: 'reasoning'; partId: string; text: string; estimatedTokens?: number; open: boolean
}
export type ToolPartView = {
  kind: 'tool'; callId: string; name: string; inputRaw: string; input?: unknown
  /** Su cosa ha lavorato, gia pronto dall'adapter. Vedi `tool.input.ended`. */
  summary?: string
  startedAt: number; endedAt?: number
  done: boolean; ok?: boolean; error?: string; blocked?: 'classifier' | 'denyRule'
  /** Cio che il tool ha restituito, per intero. Arriva con `tool.ended`: prima di
   *  quel momento non esiste, e un tool bloccato non ce l'ha mai. */
  output?: string
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
  kind: 'answer'; partId: string; of: 'permission' | 'question'
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
export type PartView =
  TextPartView | ReasoningPartView | ToolPartView | AnswerPartView | CompactPartView

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
  reason?: 'completed' | 'aborted' | 'error'
  usage?: Usage
  cost?: Cost
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
export type NoticeView = { level: 'info' | 'warn' | 'error'; text: string }
export type BlockedView = {
  by: 'classifier' | 'denyRule'; callId?: string; reason: string; ts: number
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
  blocked: BlockedView[]
  notices: NoticeView[]
  usage: Usage
  cost: Cost
  quota?: QuotaView
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
    models: [], modes: [], mcpServers: [],
    turns: [], files: [], shell: [], pendingPermissions: [], pendingQuestions: [],
    blocked: [], notices: [],
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
  const turn = (): TurnView | undefined => s.turns[s.turns.length - 1]

  switch (p.k) {
    case 'session.created':
      s.agent = p.agent; s.cwd = p.cwd; s.model = p.model
      s.capabilities = p.capabilities; s.tools = p.tools; s.slashCommands = p.commands
      if (p.models) s.models = p.models
      if (p.modes) s.modes = p.modes
      break
    case 'session.renamed': s.title = p.title; break
    case 'session.state':
      s.state = p.state
      if (p.reason !== undefined) s.stateReason = p.reason
      break
    case 'session.model': s.model = p.model; break
    case 'session.tools': s.tools = p.tools; break
    // Si sostituisce, non si fonde: l'evento porta la fotografia intera di com'erano
    // in quel momento. Fondere terrebbe in vita un server sparito dalla macchina.
    case 'session.mcp': s.mcpServers = p.servers; break
    case 'session.commands': s.slashCommands = p.commands; break
    case 'session.resumeRef': s.resumeRef = p.ref; break
    case 'session.mode': s.mode = p.mode; break
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
