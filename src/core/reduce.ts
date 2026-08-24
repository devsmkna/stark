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
  type AgentQuestion, type ModeChoice, type ModelChoice, type PermissionMode,
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
}
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
  /** Una risposta negata non e un fallimento, ma va distinta da una concessa. */
  refused: boolean
  at: number
}
export type PartView = TextPartView | ReasoningPartView | ToolPartView | AnswerPartView

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
  resumeRef?: string
  error?: string
}

function emptySnapshot(sessionId: string): SessionSnapshot {
  return {
    v: 1, sessionId, state: 'starting', tools: [], slashCommands: [],
    models: [], modes: [],
    turns: [], files: [], shell: [], pendingPermissions: [], pendingQuestions: [],
    blocked: [], notices: [],
    usage: { ...EMPTY_USAGE }, cost: { nominalUsd: 0 }, lastSeq: 0, lastTs: 0,
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
      turn()?.parts.push({
        kind: 'answer', partId: p.requestId, of: 'question',
        asked: asked?.questions.map(q => q.question).join(' · ') ?? 'question',
        answer: replied
          ? Object.values(p.answers).map(v => Array.isArray(v) ? v.join(', ') : v).join(' · ')
            || (p.response ?? '')
          : 'dismissed without answering',
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
    case 'context.compacted': break
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
  return s
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
