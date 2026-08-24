// L'adapter: l'unico punto del sistema che parla con Claude Code.
// Sopra di lui esistono solo eventi canonici.
//
// Dalla revisione di ADR-009 il trasporto è l'Agent SDK ufficiale, non più il
// protocollo scritto a mano. Quello che NON cambia è il confine: l'SDK sostituisce
// il trasporto, non la traduzione. Il vocabolario canonico resta nostro, altrimenti
// il secondo adapter non esisterebbe mai.

import { randomUUID } from 'node:crypto'
import {
  query,
  type Options, type PermissionResult, type PermissionUpdate, type Query, type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentQuestion, Payload, PermissionMode } from '../../core/events.ts'
import {
  buildOptions, capabilitiesFor, modeChoices, modelChoices, modelSupportsAutoMode,
  resolveModel, slashCommands, type LaunchOptions,
} from './sdk-options.ts'
import { resourcesOf } from './summary.ts'
import { Translator } from './translate.ts'

/** Cosa STARK decide su una richiesta di permesso. */
export type PermissionAnswer =
  | { allow: true; input?: Record<string, unknown>; remember?: PermissionUpdate[] }
  | { allow: false; reason: string }

/** Cosa STARK riporta indietro da una domanda dell'agent. */
export type QuestionAnswer =
  | { answers: Record<string, string | string[]>; response?: string }
  | null   // l'utente ha chiuso la card senza rispondere

export type AdapterOptions = LaunchOptions & {
  onPayload: (p: Payload) => void
  /** Il messaggio nativo, per il file di debug separato dal journal (§13). */
  onRaw?: (m: unknown) => void
  /**
   * Chiamata solo per ciò che la tabella dei permessi di STARK non consente già.
   * Se manca, tutto ciò che arriva fin qui viene consentito: in `auto` mode è il
   * comportamento giusto, perché il classificatore ha già deciso a monte (ADR-008).
   */
  onPermission?: (r: { requestId: string; toolName: string; input: Record<string, unknown> })
    => Promise<PermissionAnswer>
  /** Chiamata quando l'agent fa una domanda a scelta multipla. */
  onQuestion?: (r: { requestId: string; questions: AgentQuestion[] })
    => Promise<QuestionAnswer>
}

export class ClaudeCodeAdapter {
  private readonly opts: AdapterOptions
  private readonly tr = new Translator()
  private readonly input = new PromptQueue()
  private q: Query | null = null
  private created = false
  private loop: Promise<void> | null = null
  private pendingTurn: { turnId: string; text: string } | null = null
  private turnEnd: (() => void) | null = null

  constructor(opts: AdapterOptions) { this.opts = opts }

  async start(): Promise<void> {
    this.emit({ k: 'session.state', state: 'starting' })
    const options: Options = { ...buildOptions(this.opts), canUseTool: this.canUseTool }
    // I toggle dei permessi NON possono passare da `canUseTool`: in `auto` mode il
    // classificatore risolve prima, e la callback non viene mai chiamata (misurato).
    // L'unico punto che gira su OGNI chiamata è l'hook PreToolUse, ed è documentato
    // esattamente per questo. Il set dei matcher È il pannello dei permessi (ADR-008).
    const ask = this.opts.askTools ?? []
    if (ask.length > 0) {
      options.hooks = {
        PreToolUse: ask.map(tool => ({
          matcher: tool,
          hooks: [async (input: Record<string, unknown>) => {
            const verdict = await this.decide(
              String(input['tool_name'] ?? tool),
              (input['tool_input'] ?? {}) as Record<string, unknown>,
            )
            // `ask` qui non significa "chiedi": in headless non c'è nessuno a cui
            // chiedere e l'azione muore come errore di tool. Si risponde sempre
            // allow o deny, mai altro.
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: verdict.allow ? ('allow' as const) : ('deny' as const),
                permissionDecisionReason: verdict.allow ? 'Consentito da STARK' : verdict.reason,
              },
            }
          }],
        })),
      } as Options['hooks']
    }
    const q = query({ prompt: this.input.stream(), options })
    this.q = q
    this.loop = this.consume(q)

    // La sessione nasce dalla risposta all'handshake, che l'SDK espone come metodo.
    // Non si aspetta `system:init`: quello arriva col primo turno, e aspettarlo prima
    // di poter mandare un prompt è un deadlock (misurato prima di ADR-009).
    const info = (await q.initializationResult()) as Record<string, unknown>
    this.announce(info)
  }

  prompt(text: string): string {
    const turnId = randomUUID()
    this.tr.beginTurn(turnId)
    if (this.created) this.emit({ k: 'turn.started', turnId, prompt: [{ type: 'text', text }] })
    else this.pendingTurn = { turnId, text }
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: '',
    }
    this.input.push(msg)
    return turnId
  }

  /** Aspetta la fine del turno in corso. */
  async settled(): Promise<void> {
    await new Promise<void>(res => { this.turnEnd = res })
  }

  async interrupt(): Promise<void> { await this.q?.interrupt() }
  async setMode(mode: PermissionMode): Promise<void> {
    await this.q?.setPermissionMode(mode)
    this.emit({ k: 'session.mode', mode })
  }
  async setModel(model: string): Promise<void> {
    await this.q?.setModel(model)
    this.emit({ k: 'session.model', model })
  }

  /** ADR-005: lo Sleep è STARK che chiude la sessione. L'agent non sa cosa sia. */
  async sleep(): Promise<void> {
    await this.close()
    this.emit({ k: 'session.slept' })
  }

  async close(): Promise<void> {
    this.input.close()
    await this.loop
  }

  // ─── interno ──────────────────────────────────────────────────────────────

  private emit(p: Payload): void { this.opts.onPayload(p) }

  private announce(info: Record<string, unknown>): void {
    if (this.created) return
    this.created = true
    const model = resolveModel(info['models'], this.opts.model)
    const caps = info['capabilities']
    this.emit({
      k: 'session.created',
      agent: 'claude-code',
      cwd: this.opts.cwd,
      model,
      capabilities: capabilitiesFor(model),
      tools: [],
      commands: slashCommands(info['commands']),
      models: modelChoices(info['models'], model),
      modes: modeChoices(),
      ...(Array.isArray(caps) ? { protocolCapabilities: caps.map(String) } : {}),
    })

    const actual = String(info['current_permission_mode'] ?? this.opts.mode)
    this.emit({ k: 'session.mode', mode: actual as PermissionMode })
    // Se chiediamo `auto` e la sessione parte in Manual, l'utente si ritroverebbe a
    // confermare tutto senza sapere perché. Il Principio 3 impone di dirglielo, e si
    // può dire PRIMA del primo prompt invece che dopo.
    if (actual !== this.opts.mode) {
      this.emit({
        k: 'notice', level: 'warn',
        text: `Modalità richiesta "${this.opts.mode}", la sessione è partita in "${actual}"`
          + (modelSupportsAutoMode(model) ? '.' : `: il modello ${model} non supporta auto mode.`),
      })
    }
    this.emit({ k: 'session.state', state: 'idle' })

    if (this.pendingTurn) {
      const t = this.pendingTurn
      this.pendingTurn = null
      this.emit({ k: 'turn.started', turnId: t.turnId, prompt: [{ type: 'text', text: t.text }] })
    }
  }

  private async consume(q: Query): Promise<void> {
    try {
      for await (const m of q) {
        this.opts.onRaw?.(m)
        for (const p of this.tr.handle(m as Record<string, unknown>)) {
          this.emit(p)
          if (p.k === 'turn.ended') { this.turnEnd?.(); this.turnEnd = null }
        }
      }
    } catch (e) {
      this.emit({ k: 'session.error', message: String((e as Error).message ?? e), fatal: true })
      this.turnEnd?.()
      this.turnEnd = null
    }
    this.emit({ k: 'session.state', state: 'closed' })
  }

  /**
   * Il punto in cui l'utente decide. Riceve sia i permessi sia le domande dell'agent:
   * il protocollo le fa passare dalla stessa porta, ma per chi guarda lo schermo sono
   * due cose diverse, quindi escono come due eventi canonici diversi.
   */
  private canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    const requestId = randomUUID()

    if (toolName === 'AskUserQuestion') {
      const questions = normalizeQuestions(input['questions'])
      this.emit({ k: 'question.asked', requestId, questions })
      this.emit({ k: 'session.state', state: 'awaiting', reason: 'domanda' })
      const answer = this.opts.onQuestion ? await this.opts.onQuestion({ requestId, questions }) : null
      this.emit({ k: 'session.state', state: 'busy' })
      if (!answer) {
        this.emit({ k: 'question.rejected', requestId })
        return { behavior: 'deny', message: 'L\'utente ha chiuso la domanda senza rispondere.' }
      }
      this.emit({
        k: 'question.replied', requestId, answers: answer.answers,
        ...(answer.response !== undefined ? { response: answer.response } : {}),
      })
      // Si rimanda indietro l'array `questions` originale: è richiesto dal tool.
      return {
        behavior: 'allow',
        updatedInput: {
          questions: input['questions'],
          answers: answer.answers,
          ...(answer.response !== undefined ? { response: answer.response } : {}),
        },
      }
    }

    const verdict = await this.decide(toolName, input)
    if (!verdict.allow) return { behavior: 'deny', message: verdict.reason }
    const remember = verdict.remember ?? []
    return {
      behavior: 'allow',
      updatedInput: verdict.input ?? input,
      ...(remember.length > 0 ? { updatedPermissions: remember } : {}),
    }
  }

  /** Il giro completo: card verso l'utente, attesa, evento di risposta. */
  private async decide(
    toolName: string, input: Record<string, unknown>,
  ): Promise<PermissionAnswer> {
    if (!this.opts.onPermission) return { allow: true }
    const requestId = randomUUID()
    this.emit({
      k: 'permission.asked', requestId,
      action: toolName,
      resources: resourcesOf(toolName, input),
      // §8: non è uno scope da indovinare, è la riga della tabella dei permessi che
      // il "Consenti sempre" sposterebbe da "chiedi" a "consenti".
      savable: [toolName],
      source: {},
    })
    this.emit({ k: 'session.state', state: 'awaiting', reason: toolName })
    const verdict = await this.opts.onPermission({ requestId, toolName, input })
    this.emit({ k: 'session.state', state: 'busy' })

    if (!verdict.allow) {
      this.emit({ k: 'permission.replied', requestId, decision: 'reject', message: verdict.reason })
      return verdict
    }
    // "Consenti sempre" non lo emuliamo più: le regole pronte arrivano da `suggestions`
    // e rimandarne una indietro la scrive in .claude/settings.local.json (ADR-009).
    this.emit({
      k: 'permission.replied', requestId,
      decision: (verdict.remember ?? []).length > 0 ? 'always' : 'once',
    })
    return verdict
  }
}

// ─── coda dei prompt ────────────────────────────────────────────────────────

/**
 * L'SDK vuole i prompt come flusso asincrono, perché è così che una sessione resta
 * aperta fra un turno e l'altro. Questa coda trasforma un `push()` normale in quel
 * flusso: chiuderla è ciò che termina la sessione, ed è la strada pulita per lo
 * Sleep — chiudere lo stdin fa annullare al CLI le richieste ancora aperte, mentre
 * ucciderlo lascerebbe il turno a metà.
 */
class PromptQueue {
  private buffer: SDKUserMessage[] = []
  private waiting: ((m: SDKUserMessage | null) => void) | null = null
  private closed = false

  push(m: SDKUserMessage): void {
    if (this.waiting) { const w = this.waiting; this.waiting = null; w(m) }
    else this.buffer.push(m)
  }

  close(): void {
    this.closed = true
    if (this.waiting) { const w = this.waiting; this.waiting = null; w(null) }
  }

  async *stream(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const next = this.buffer.shift()
      if (next) { yield next; continue }
      if (this.closed) return
      const m = await new Promise<SDKUserMessage | null>(res => { this.waiting = res })
      if (m === null) return
      yield m
    }
  }
}

// ─── helper ─────────────────────────────────────────────────────────────────

function normalizeQuestions(raw: unknown): AgentQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw.map(q => ({
    question: String(q?.['question'] ?? ''),
    header: String(q?.['header'] ?? ''),
    multiSelect: q?.['multiSelect'] === true,
    options: Array.isArray(q?.['options']) ? q['options'].map((o: Record<string, unknown>) => ({
      label: String(o?.['label'] ?? ''),
      description: String(o?.['description'] ?? ''),
      ...(typeof o?.['preview'] === 'string' ? { preview: o['preview'] } : {}),
    })) : [],
  }))
}

