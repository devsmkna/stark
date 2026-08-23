// L'adapter: l'unico punto del sistema che parla con Claude Code.
// Sopra di lui esistono solo eventi canonici.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Payload, PermissionMode } from '../../core/events.ts'
import { buildArgs, buildInitialize, capabilitiesFor, HOOK_CALLBACK_ID, modelSupportsAutoMode,
  resolveModel, slashCommands, type NativeEvent } from './native.ts'
import { Translator } from './translate.ts'

export type AdapterOptions = {
  cwd: string
  model: string
  mode: PermissionMode
  /** Vuoto = nessun hook = zero card. È il default di ADR-008. */
  askMatchers?: string[]
  resume?: { ref: string; fork?: boolean }
  sessionId?: string
  /** I dialoghi che la UI sa disegnare. Vuoto = il CLI ripiega e li toglie di mezzo. */
  dialogKinds?: string[]
  extraArgs?: string[]
  /**
   * Un dialogo da mostrare. Deve restituire il risultato che quel `kind` si aspetta.
   * Non rispondere lascia il dialogo appeso finche il CLI non lo annulla da solo;
   * rispondere `cancelled` invece vuol dire "l'utente l'ha chiuso", che e una risposta
   * vera e diversa dal silenzio.
   */
  onDialog?: (d: { kind: string; payload: Record<string, unknown>; toolUseId?: string })
    => Promise<{ behavior: 'completed' | 'cancelled'; result?: unknown }>
  onPayload: (p: Payload) => void
  onRaw?: (line: string) => void
  /**
   * Chiamata solo per i tool intercettati. Deve restituire allow o deny: `ask` in
   * headless significa "chiedi all'utente interattivo", che non esiste, e l'azione
   * muore come errore di tool (§8, vincolo 2).
   */
  onPermission?: (req: { requestId: string; toolName: string; input: unknown })
    => Promise<'allow' | 'deny'>
}

export class ClaudeCodeAdapter {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly opts: AdapterOptions
  private readonly tr: Translator
  private buf = ''
  private ready: ((v: void) => void) | null = null
  private failStart: ((e: Error) => void) | null = null
  private exited: ((v: number | null) => void) | null = null

  constructor(opts: AdapterOptions) {
    this.opts = opts
    this.tr = new Translator()
  }

  async start(): Promise<void> {
    const matchers = this.opts.askMatchers ?? []
    const args = buildArgs({
      cwd: this.opts.cwd, model: this.opts.model, mode: this.opts.mode, askMatchers: matchers,
      ...(this.opts.resume ? { resume: this.opts.resume } : {}),
      ...(this.opts.sessionId ? { sessionId: this.opts.sessionId } : {}),
      ...(this.opts.extraArgs ? { extraArgs: this.opts.extraArgs } : {}),
    })
    this.emit({ k: 'session.state', state: 'starting' })
    const child = spawn('claude', args, { cwd: this.opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    child.stdout.on('data', (c: Buffer) => this.onStdout(c))
    child.stderr.on('data', (c: Buffer) => {
      const t = c.toString().trim()
      if (t) this.emit({ k: 'notice', level: 'warn', text: t.slice(0, 500) })
    })
    child.on('close', code => {
      this.emit({ k: 'session.state', state: 'closed', reason: `exit ${code}` })
      this.exited?.(code)
    })
    const created = new Promise<void>((res, rej) => { this.ready = res; this.failStart = rej })
    this.send(buildInitialize(matchers, this.opts.dialogKinds ?? []))
    await created
  }

  prompt(text: string): string {
    const turnId = randomUUID()
    this.tr.beginTurn(turnId)
    this.emit({ k: 'turn.started', turnId, prompt: [{ type: 'text', text }] })
    this.send({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })
    return turnId
  }

  interrupt(): void {
    this.send({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } })
  }

  /** ADR-005: lo Sleep è STARK che termina il processo. L'agent non sa cosa sia. */
  async sleep(): Promise<number | null> {
    const code = new Promise<number | null>(res => { this.exited = res })
    this.child?.stdin.end()
    const exit = await code
    this.emit({ k: 'session.slept' })
    return exit
  }

  async close(): Promise<number | null> {
    const code = new Promise<number | null>(res => { this.exited = res })
    this.child?.stdin.end()
    return code
  }

  // ─── interno ──────────────────────────────────────────────────────────────

  private emit(p: Payload): void { this.opts.onPayload(p) }

  private send(msg: NativeEvent): void {
    this.child?.stdin.write(JSON.stringify(msg) + '\n')
  }

  private onStdout(chunk: Buffer): void {
    this.buf += chunk.toString()
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      if (!line.trim()) continue
      this.opts.onRaw?.(line)
      let e: NativeEvent
      try { e = JSON.parse(line) } catch { continue }
      this.dispatch(e)
    }
  }

  private dispatch(e: NativeEvent): void {
    if (e['type'] === 'control_response') { this.handshake(e); return }
    if (e['type'] === 'control_request') { void this.control(e); return }
    for (const p of this.tr.handle(e)) this.emit(p)
  }

  /**
   * La sessione nasce qui, non da `system:init`: questa risposta arriva subito e
   * `system:init` solo col primo turno.
   *
   * Di tutto ciò che l'agent restituisce, `account` (email, organizzazione, tipo di
   * abbonamento) NON viene copiato da nessuna parte. Il journal è il punto unico da
   * cui passa tutto (§13, invariante 4): ciò che non entra qui non finirà mai in un
   * file, in un backup o in una schermata condivisa.
   */
  private handshake(e: NativeEvent): void {
    if (this.ready === null) return
    const r = e['response'] ?? {}
    if (r['error']) {
      this.emit({ k: 'session.error', message: String(r['error']), fatal: true })
      this.failStart?.(new Error(String(r['error'])))
      this.ready = null
      return
    }
    const info = r['response'] ?? {}
    const model = resolveModel(info['models'], this.opts.model)
    this.emit({
      k: 'session.created',
      agent: 'claude-code',
      cwd: this.opts.cwd,
      model,
      capabilities: capabilitiesFor(model),
      tools: [],
      commands: slashCommands(info['commands']),
    })

    const actual = String(info['current_permission_mode'] ?? this.opts.mode)
    this.emit({ k: 'session.mode', mode: actual as PermissionMode })
    // §14: se chiediamo `auto` e l'agent riparte in Manual, l'utente si ritroverebbe a
    // confermare tutto senza sapere perché. Il Principio 3 impone di dirglielo, e ora
    // si può dire PRIMA del primo prompt invece che dopo.
    if (actual !== this.opts.mode) {
      this.emit({
        k: 'notice', level: 'warn',
        text: `Modalità richiesta "${this.opts.mode}", la sessione è partita in "${actual}"`
          + (modelSupportsAutoMode(model) ? '.' : `: il modello ${model} non supporta auto mode.`),
      })
    }
    // Se i toggle dei permessi non si sono registrati, non chiederanno mai nulla e
    // l'utente crederebbe di avere un attrito che non ha. È il caso peggiore: si
    // sente protetto e non lo è.
    if ((this.opts.askMatchers ?? []).length > 0 && info['hooks_applied'] !== true) {
      this.emit({
        k: 'notice', level: 'error',
        text: 'I permessi su "chiedi" non sono stati registrati dall\'agent: nessuna richiesta arriverà.',
      })
    }

    this.emit({ k: 'session.state', state: 'idle' })
    this.ready()
    this.ready = null
  }

  private async control(e: NativeEvent): Promise<void> {
    const requestId = String(e['request_id'] ?? randomUUID())
    const req = e['request'] ?? {}

    if (req['subtype'] === 'request_user_dialog') {
      const kind = String(req['dialog_kind'] ?? '')
      // Un kind che non abbiamo dichiarato NON va risposto: una risposta d'errore viene
      // scartata e il dialogo resta appeso, mentre un `cancelled` verrebbe letto come
      // "l'utente ha chiuso la finestra". Meglio il silenzio, che il CLI sa gestire.
      if (!(this.opts.dialogKinds ?? []).includes(kind) || !this.opts.onDialog) {
        this.emit({ k: 'notice', level: 'warn', text: `dialogo non gestito: ${kind}` })
        return
      }
      this.emit({ k: 'session.state', state: 'awaiting', reason: kind })
      const esito = await this.opts.onDialog({
        kind,
        payload: (req['payload'] ?? {}) as Record<string, unknown>,
        ...(req['tool_use_id'] ? { toolUseId: String(req['tool_use_id']) } : {}),
      })
      this.reply(requestId, esito)
      this.emit({ k: 'session.state', state: 'busy' })
      return
    }

    if (req['subtype'] !== 'hook_callback' || req['callback_id'] !== HOOK_CALLBACK_ID) {
      this.reply(requestId, { async: false })
      return
    }
    const input = req['input'] ?? {}
    const toolName = String(input['tool_name'] ?? '?')
    const toolInput = input['tool_input'] ?? {}
    const callId = input['tool_use_id'] ? String(input['tool_use_id']) : undefined

    this.emit({
      k: 'permission.asked',
      requestId,
      action: toolName,
      resources: describeResources(toolName, toolInput),
      // §8: non è uno scope da indovinare, è la riga della tabella dei permessi che
      // il "Consenti sempre" sposterebbe da "chiedi" a "consenti".
      savable: [toolName],
      source: callId !== undefined ? { callId } : {},
    })

    const decision = this.opts.onPermission
      ? await this.opts.onPermission({ requestId, toolName, input: toolInput })
      : 'allow'

    this.emit({
      k: 'permission.replied', requestId, decision: decision === 'allow' ? 'once' : 'reject',
    })
    this.reply(requestId, {
      async: false,
      decision: decision === 'allow' ? 'approve' : 'block',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: decision === 'allow' ? 'Consentito da STARK' : 'Negato da STARK',
      },
    })
  }

  private reply(requestId: string, response: unknown): void {
    this.send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  }
}

function describeResources(tool: string, input: unknown): string[] {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'Bash' && typeof i['command'] === 'string') return [i['command']]
  if (typeof i['file_path'] === 'string') return [i['file_path']]
  if (typeof i['path'] === 'string') return [i['path']]
  return []
}
