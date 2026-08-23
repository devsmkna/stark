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
  type PermissionMode, type PromptPart, type SessionState, type SlashCommand, type Usage,
} from './events.ts'

export type TextPartView = { kind: 'text'; partId: string; text: string; open: boolean }
export type ReasoningPartView = {
  kind: 'reasoning'; partId: string; text: string; estimatedTokens?: number; open: boolean
}
export type ToolPartView = {
  kind: 'tool'; callId: string; name: string; inputRaw: string; input?: unknown
  done: boolean; ok?: boolean; error?: string; blocked?: 'classifier' | 'denyRule'
}
export type PartView = TextPartView | ReasoningPartView | ToolPartView

export type TurnView = {
  turnId: string
  prompt: PromptPart[]
  parts: PartView[]
  steps: number
  ended: boolean
  reason?: 'completed' | 'aborted' | 'error'
  usage?: Usage
  cost?: Cost
}

export type FileEditView = {
  path: string; created: boolean; hunks: Hunk[]; callId?: string
}
export type CommandRunView = {
  command: string; exitCode?: number; interrupted: boolean
  stdoutBytes: number; stderrBytes: number; callId?: string
}
export type PendingPermissionView = {
  requestId: string; action: string; resources: string[]; savable: string[]; callId?: string
}
export type QuotaView = {
  status: string; kind: string; resetsAt: number; usingOverage: boolean
}
export type NoticeView = { level: 'info' | 'warn' | 'error'; text: string }
export type BlockedView = { by: 'classifier' | 'denyRule'; callId?: string; reason: string }

export type SessionSnapshot = {
  v: number
  sessionId: string
  agent?: string
  cwd?: string
  model?: string
  mode?: PermissionMode
  state: SessionState
  stateReason?: string
  capabilities?: Capabilities
  tools: string[]
  slashCommands: SlashCommand[]
  turns: TurnView[]
  files: FileEditView[]
  shell: CommandRunView[]
  pendingPermissions: PendingPermissionView[]
  blocked: BlockedView[]
  notices: NoticeView[]
  usage: Usage
  cost: Cost
  quota?: QuotaView
  lastSeq: number
  resumeRef?: string
  error?: string
}

function emptySnapshot(sessionId: string): SessionSnapshot {
  return {
    v: 1, sessionId, state: 'starting', tools: [], slashCommands: [],
    turns: [], files: [], shell: [], pendingPermissions: [], blocked: [], notices: [],
    usage: { ...EMPTY_USAGE }, cost: { nominalUsd: 0 }, lastSeq: 0,
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
  if (!s.sessionId) s.sessionId = e.sessionId
  const p = e.payload
  const turn = (): TurnView | undefined => s.turns[s.turns.length - 1]

  switch (p.k) {
    case 'session.created':
      s.agent = p.agent; s.cwd = p.cwd; s.model = p.model
      s.capabilities = p.capabilities; s.tools = p.tools; s.slashCommands = p.commands
      break
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
      s.turns.push({ turnId: p.turnId, prompt: p.prompt, parts: [], steps: 0, ended: false })
      break
    case 'turn.ended': {
      const t = s.turns.find(x => x.turnId === p.turnId)
      if (t) { t.ended = true; t.reason = p.reason; t.usage = p.usage; t.cost = p.cost }
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
      })
      break
    case 'tool.input.delta': {
      const part = findTool(s, p.callId); if (part) part.inputRaw += p.delta; break
    }
    case 'tool.input.ended': {
      const part = findTool(s, p.callId); if (part) part.input = p.input; break
    }
    case 'tool.ended': {
      const part = findTool(s, p.callId)
      if (part) {
        part.done = true; part.ok = p.ok
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
    case 'permission.replied':
      s.pendingPermissions = s.pendingPermissions.filter(x => x.requestId !== p.requestId)
      if (s.pendingPermissions.length === 0 && s.state === 'awaiting') s.state = 'busy'
      break
    case 'question.asked':
      s.state = 'awaiting'; break
    case 'question.replied':
    case 'question.rejected':
      if (s.state === 'awaiting') s.state = 'busy'
      break

    case 'file.edited':
      s.files.push({
        path: p.path, created: p.created, hunks: p.hunks,
        ...(p.callId !== undefined ? { callId: p.callId } : {}),
      })
      break
    case 'command.executed':
      s.shell.push({
        command: p.command, interrupted: p.interrupted,
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
        by: p.by, reason: p.reason,
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
