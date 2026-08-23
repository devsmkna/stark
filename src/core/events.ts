// Il vocabolario canonico di STARK. Vedi docs/event-model.md.
//
// Regola non negoziabile (§1 della specifica): fuori dall'adapter nessun componente
// deve conoscere l'esistenza di Claude Code. Qui dentro non entrano nomi dell'API
// Anthropic: si parla di sessioni, turni, parti, permessi ed effetti.

export const MODEL_VERSION = 1 as const

// ─── §5 stati della sessione ────────────────────────────────────────────────

export type SessionState =
  | 'starting'   // processo avviato, initialize non ancora ricevuto
  | 'idle'       // pronta, nessun turno in corso
  | 'busy'       // turno in corso
  | 'awaiting'   // ferma su una richiesta bloccante (permesso o domanda)
  | 'sleeping'   // processo terminato di proposito, journal su disco — ADR-005
  | 'error'
  | 'closed'

// §11: le sei modalità reali di Claude Code. STARK ne espone tre.
export type PermissionMode =
  | 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions'

// ─── tipi di supporto ───────────────────────────────────────────────────────

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * `nominalUsd` si chiama così di proposito. L'utente è su abbonamento a quota
 * fissa: quel numero è un prezzo di listino API, non una spesa. Chiamarlo `usd`
 * inviterebbe la UI a mostrarlo come denaro, che sarebbe una bugia (Principio 3).
 * La risorsa scarsa la racconta `quota.updated`.
 */
export type Cost = { nominalUsd: number }

export type SlashCommand = { name: string; description?: string }

/** §16.3 resta aperto: nell'MVP il prompt è testo semplice. */
export type PromptPart = { type: 'text'; text: string }

export type Attachment = { type: 'file'; path: string }

/** §9: esattamente la forma di `structuredPatch`. Nessun diff da calcolare. */
export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

// ─── §12 capability ─────────────────────────────────────────────────────────

export type Capabilities = {
  interrupt: boolean
  switchModel: boolean
  switchMode: boolean
  /** Dipende dal MODELLO, non solo dall'agent: Haiku non regge auto mode. */
  autoMode: boolean
  permissionAlways: boolean
  questions: boolean
  revert: boolean
  toolProgress: boolean
  fileBrowser: boolean
  pty: boolean
}

// ─── §6-§10 il payload ──────────────────────────────────────────────────────

export type Payload =
  // §6 sessione
  | { k: 'session.created'; agent: string; cwd: string; model: string
      capabilities: Capabilities; tools: string[]; commands: SlashCommand[] }
  | { k: 'session.state'; state: SessionState; reason?: string }
  | { k: 'session.model'; model: string }
  | { k: 'session.mode'; mode: PermissionMode }
  // La lista dei tool non è nota alla nascita della sessione: arriva col primo turno.
  // Vedi la correzione al §14 in fondo a docs/event-model.md.
  | { k: 'session.tools'; tools: string[] }
  // Il manico con cui questa sessione si riapre. Sta nel journal perche senza, il
  // journal non basta a risvegliare: saprebbe dire cosa e successo ma non come tornarci.
  | { k: 'session.resumeRef'; ref: string }
  | { k: 'session.slept' }
  | { k: 'session.woke'; resumedFromSeq: number }
  | { k: 'session.error'; message: string; fatal: boolean }

  // §7 turni, step, parti
  | { k: 'turn.started'; turnId: string; prompt: PromptPart[] }
  | { k: 'turn.ended'; turnId: string; reason: 'completed' | 'aborted' | 'error'
      usage: Usage; cost: Cost }
  | { k: 'step.started'; stepId: string }
  | { k: 'step.ended'; stepId: string; finish: string; usage: Usage }

  | { k: 'text.started'; partId: string }
  | { k: 'text.delta'; partId: string; delta: string }
  | { k: 'text.ended'; partId: string; text: string }

  | { k: 'reasoning.started'; partId: string }
  | { k: 'reasoning.delta'; partId: string; delta: string; estimatedTokens?: number }
  | { k: 'reasoning.ended'; partId: string }

  | { k: 'tool.started'; callId: string; name: string }
  | { k: 'tool.input.delta'; callId: string; delta: string }
  | { k: 'tool.input.ended'; callId: string; input: unknown }
  | { k: 'tool.ended'; callId: string; ok: boolean; output?: unknown; error?: string }

  // §8 richieste bloccanti — nel caso normale NON esistono affatto (ADR-008)
  | { k: 'permission.asked'; requestId: string; action: string; resources: string[]
      savable: string[]; source: { callId?: string } }
  | { k: 'permission.replied'; requestId: string
      decision: 'once' | 'always' | 'reject'; scope?: string; message?: string }
  | { k: 'question.asked'; requestId: string; text: string; options?: string[] }
  | { k: 'question.replied'; requestId: string; answer: string }
  | { k: 'question.rejected'; requestId: string }

  // §9 effetti collaterali
  | { k: 'file.edited'; path: string; hunks: Hunk[]; created: boolean
      originalFile?: string; callId?: string }
  | { k: 'command.executed'; command: string; stdout: string; stderr: string
      exitCode?: number; interrupted: boolean; callId?: string }

  // §10 meta
  | { k: 'usage.updated'; usage: Usage; cost: Cost }
  | { k: 'quota.updated'; status: string; kind: string; resetsAt: number
      usingOverage: boolean }
  | { k: 'context.compacted'; before: number; after: number }
  | { k: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
  | { k: 'action.blocked'; by: 'classifier' | 'denyRule'; callId?: string; reason: string }

export type PayloadKind = Payload['k']

// ─── §4 involucro ───────────────────────────────────────────────────────────

export type CanonicalEvent = {
  v: typeof MODEL_VERSION
  seq: number       // progressivo per sessione, assegnato da STARK, senza buchi
  ts: number        // epoch ms, assegnato da STARK alla normalizzazione
  sessionId: string
  payload: Payload
}

// ─── §11 comandi dalla UI al daemon ─────────────────────────────────────────

export type PermissionRuleDecision = 'allow' | 'ask' | 'deny'
export type PermissionRules = Record<string, PermissionRuleDecision>

export type Command =
  | { c: 'session.open'; agent: string; cwd: string; model?: string; mode?: PermissionMode }
  | { c: 'session.prompt'; text: string; attachments?: Attachment[] }
  | { c: 'session.interrupt' }
  | { c: 'session.setModel'; model: string }
  | { c: 'session.setMode'; mode: PermissionMode }
  | { c: 'permissions.setRules'; rules: PermissionRules }
  | { c: 'session.sleep' }
  | { c: 'session.wake' }
  | { c: 'session.close' }
  | { c: 'permission.reply'; requestId: string
      decision: 'once' | 'always' | 'reject'; scope?: string }
  | { c: 'question.reply'; requestId: string; answer: string }

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
