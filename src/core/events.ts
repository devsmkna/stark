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

/**
 * Un modello fra cui la sessione puo scegliere. `id` e cio che si rimanda indietro
 * con `session.setModel`, `resolved` il modello vero a cui un alias punta.
 *
 * Sta nel vocabolario canonico e non in una lista dentro la UI per la ragione del §1:
 * i nomi dei modelli sono vocabolario dell'agent, e la UI non deve conoscerli. Lo
 * stesso vale per `autoMode`, che dipende dal modello e non dall'agent: senza, la UI
 * dovrebbe sapere da se che Haiku non regge auto mode, cioe indovinare.
 */
export type ModelChoice = {
  id: string
  label?: string
  resolved?: string
  autoMode: boolean
}

/**
 * Una modalita dei permessi, e se questa sessione puo davvero usarla.
 *
 * `available: false` non e un motivo per nascondere la voce: il Principio 5 vuole che
 * si veda spenta CON la spiegazione. La spiegazione la scrive l'adapter, che e l'unico
 * che sa chi rifiuta e perche.
 */
export type ModeChoice = {
  mode: PermissionMode
  available: boolean
  reason?: string
}

/**
 * Un server MCP visto da una sessione, e cosa STARK ne ha deciso.
 *
 * Due campi e non uno perche dicono due cose diverse: `enabled` e la scelta di STARK
 * per questa chat, `status` e cosa risponde l'agent. Un server acceso puo essere
 * `needs-auth` o `failed`, e schiacciare le due cose in una sola nasconderebbe
 * esattamente il caso in cui l'utente si chiede perche non funziona.
 *
 * `status` e vocabolario dell'adapter solo all'apparenza: sono i cinque stati che il
 * protocollo dichiara, e la UI li mostra senza interpretarli.
 */
export type McpServer = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  /** L'ha acceso STARK per questa conversazione. Di partenza sono tutti spenti. */
  enabled: boolean
  /** Perche non va, quando `status` e `failed`. */
  error?: string
}

/**
 * Una domanda dell'agent, nella forma documentata di `AskUserQuestion`.
 * Da 1 a 4 domande per richiesta, da 2 a 4 opzioni ciascuna, `header` max 12 caratteri.
 */
export type AgentQuestion = {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string; preview?: string }[]
}

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
      capabilities: Capabilities; tools: string[]; commands: SlashCommand[]
      // Cosa si puo scegliere dalla barra di stato, senza che la UI debba saperlo.
      models?: ModelChoice[]; modes?: ModeChoice[]
      // I comportamenti di protocollo che questa versione implementa. È documentato
      // usare questi nomi per la feature detection invece di confrontare versioni.
      protocolCapabilities?: string[] }
  | { k: 'session.state'; state: SessionState; reason?: string }
  | { k: 'session.model'; model: string }
  | { k: 'session.mode'; mode: PermissionMode }
  // La lista dei tool non è nota alla nascita della sessione: arriva col primo turno.
  // Vedi la correzione al §14 in fondo a docs/event-model.md.
  | { k: 'session.tools'; tools: string[] }
  // Quali server MCP questa conversazione ha davanti, e quali sono accesi. Nel journal
  // perche il §4 vuole che la UI non mostri niente che non nasca da li, e perche il
  // risveglio deve poter riaccendere quello che avevi acceso: senza, una chat che
  // dorme si sveglia senza i suoi strumenti e sembra rotta.
  | { k: 'session.mcp'; servers: McpServer[] }
  // Il manico con cui questa sessione si riapre. Sta nel journal perche senza, il
  // journal non basta a risvegliare: saprebbe dire cosa e successo ma non come tornarci.
  | { k: 'session.resumeRef'; ref: string }
  /** Il titolo scelto dall'utente. Da qui in poi STARK non lo riscrive piu da solo. */
  | { k: 'session.renamed'; title: string }
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
  // `summary` e "su cosa" il tool ha lavorato, gia pronto: il comando, il percorso,
  // l'indirizzo. Lo scrive l'adapter perche estrarlo da `input` vuol dire conoscere la
  // forma di un agent, ed e esattamente cio che il §1 vieta fuori di li.
  | { k: 'tool.input.ended'; callId: string; input: unknown; summary?: string }
  | { k: 'tool.ended'; callId: string; ok: boolean; output?: unknown; error?: string }

  // §8 richieste bloccanti — nel caso normale NON esistono affatto (ADR-008)
  | { k: 'permission.asked'; requestId: string; action: string; resources: string[]
      savable: string[]; source: { callId?: string } }
  | { k: 'permission.replied'; requestId: string
      decision: 'once' | 'always' | 'reject'; scope?: string; message?: string }
  // §16.1 risolto: le domande arrivano come una normale richiesta di permesso sul tool
  // `AskUserQuestion`. Non sono un canale a parte, ma restano un evento a parte: per
  // l'utente "scegli fra queste opzioni" e "posso eseguire questo comando?" sono due
  // cose diverse, e una UI che le mostrasse uguali mentirebbe.
  | { k: 'question.asked'; requestId: string; questions: AgentQuestion[] }
  | { k: 'question.replied'; requestId: string
      answers: Record<string, string | string[]>; response?: string }
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
  | { c: 'session.setMcp'; server: string; enabled: boolean }
  | { c: 'permissions.setRules'; rules: PermissionRules }
  | { c: 'session.rename'; title: string }
  | { c: 'session.sleep' }
  | { c: 'session.wake' }
  | { c: 'session.close' }
  | { c: 'permission.reply'; requestId: string
      decision: 'once' | 'always' | 'reject'; scope?: string }
  | { c: 'question.reply'; requestId: string
      answers: Record<string, string | string[]>; response?: string }
  | { c: 'question.reject'; requestId: string }

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
