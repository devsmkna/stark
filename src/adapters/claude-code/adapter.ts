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
  type McpServerStatus, type Options, type PermissionResult, type PermissionUpdate,
  type Query, type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentQuestion, McpServer, Payload, PermissionMode, PromptPart,
} from '../../core/events.ts'

/** Un'immagine pronta da mandare: i byte per l'agent, il riferimento per il journal. */
export type PromptImage = {
  ref: string
  mediaType: string
  bytes: number
  name?: string
  /** base64. Non finisce nel journal: vedi `PromptPart`. */
  data: string
}
import {
  buildOptions, capabilitiesFor, modeChoices, modelChoices, modelSupportsAutoMode,
  resolveModel, slashCommands, type LaunchOptions,
} from './sdk-options.ts'
import type { SlashCommand } from '../../core/events.ts'
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
  /**
   * I server MCP che questa conversazione vuole accesi, per nome. Tutti gli altri
   * vengono spenti prima del primo turno. Omesso vuol dire **nessuno**, che è il
   * default di STARK: gli strumenti esterni si accendono quando servono, non si
   * subiscono perché stanno sulla macchina.
   */
  mcp?: string[]
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
  private pendingTurn: { turnId: string; parts: PromptPart[] } | null = null
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
    // Subito, e prima che qualunque prompt possa partire: è questo passaggio a
    // sostituire `strictMcpConfig`, e a farlo dopo sarebbe come non farlo.
    this.volere = new Set(this.opts.mcp ?? [])
    this.input.before(() => this.reconcileMcp())
    await this.reconcileMcp()
    await this.refreshCommands()
  }

  // ─── comandi slash ────────────────────────────────────────────────────────

  /** L'ultima lista scritta nel journal, per non riscriverla identica. */
  private comandi: SlashCommand[] = []
  /** Quali sono legati al terminale. Non arriva dall'handshake ma dal primo turno. */
  private soloTerminale = new Set<string>()

  /**
   * La lista dei comandi, presa dal metodo dell'SDK e non dall'handshake.
   *
   * L'handshake ne porta una versione povera — nome e descrizione — mentre
   * `supportedCommands()` dà anche `argumentHint` e gli alias, e senza il primo metà
   * dei comandi sono indovinelli: `/code-review` non dice da solo che accetta
   * `[low|medium|high]`. Vale la regola del progetto: se esiste il metodo ufficiale,
   * si usa quello.
   */
  private async refreshCommands(): Promise<void> {
    const q = this.q
    if (!q) return
    try {
      const raw = await q.supportedCommands()
      this.comandi = slashCommands(raw)
    } catch { return }
    this.emitCommands()
  }

  private emitCommands(): void {
    const commands = this.comandi.map(c => ({
      ...c,
      ...(this.soloTerminale.has(c.name) ? { terminalOnly: true } : {}),
    }))
    const firma = JSON.stringify(commands)
    if (firma === this.ultimiComandi) return
    this.ultimiComandi = firma
    this.emit({ k: 'session.commands', commands })
  }

  private ultimiComandi = ''

  // ─── server MCP ───────────────────────────────────────────────────────────

  /** Chi la chat vuole acceso. Di partenza nessuno: gli strumenti si scelgono. */
  private volere = new Set<string>()
  /** L'ultima fotografia scritta nel journal, per non riscriverla identica ogni turno. */
  private ultimaMcp = ''

  /** Cambia un server a caldo. Non tocca la macchina: vale per questa conversazione. */
  async setMcp(server: string, enabled: boolean): Promise<void> {
    if (enabled) this.volere.add(server); else this.volere.delete(server)
    await this.reconcileMcp()
  }

  /**
   * Porta i server allo stato che la chat ha scelto, e scrive nel journal com'erano.
   *
   * Gira **prima di ogni turno**, non solo all'avvio, e non è una precauzione: i
   * connettori di claude.ai non ci sono ancora quando la sessione nasce, compaiono
   * qualche secondo dopo. Spegnendoli una volta sola all'avvio, il primo turno se li è
   * ritrovati tutti accesi — misurato: **103 tool, di cui 71 `mcp__`**, cioè il costo
   * di contesto che spegnerli doveva evitare. Il giro costa un messaggio di controllo
   * per turno, che è il prezzo di dire la verità su cosa è acceso.
   *
   * Si spegne **per nome** invece di passare una lista di configurazioni, perché le
   * configurazioni non le abbiamo: l'SDK dà i nomi e lo stato, non da dove vengono. Ed
   * è giusto così — STARK non deve saper leggere i file di Claude Code per offrire
   * quello che Claude Code ha già.
   */
  private async reconcileMcp(): Promise<void> {
    const q = this.q
    if (!q) return
    // Si rilegge finché non c'è più niente da toccare, al massimo tre volte: **durante**
    // una passata possono comparire server che all'inizio non c'erano, ed è appunto
    // quello che fanno i connettori di claude.ai. Chi si ferma alla prima scrive nel
    // journal una fotografia già vecchia, che dice «spento» di un server ancora acceso.
    let visti: McpServerStatus[] = []
    for (let giro = 0; giro < 3; giro++) {
      try {
        visti = await q.mcpServerStatus()
      } catch {
        // Una versione che non risponde non è un guasto della conversazione: la chat
        // funziona lo stesso, e il chip resta vuoto invece di mentire.
        return
      }
      let toccato = false
      for (const s of visti) {
        const acceso = this.volere.has(s.name)
        if (acceso === (s.status !== 'disabled')) continue
        try { await q.toggleMcpServer(s.name, acceso); toccato = true } catch { /* lo dirà lo stato */ }
      }
      if (!toccato) break
    }
    const servers: McpServer[] = visti.map(s => ({
      name: s.name,
      status: s.status,
      enabled: this.volere.has(s.name),
      ...(s.error !== undefined ? { error: s.error } : {}),
    }))
    // Uguale a prima non si riscrive: un evento per turno che dice la stessa cosa
    // gonfierebbe il journal senza aggiungere niente da rileggere.
    const firma = JSON.stringify(servers)
    if (firma === this.ultimaMcp) return
    this.ultimaMcp = firma
    this.emit({ k: 'session.mcp', servers })
  }

  /**
   * Le immagini vanno **prima** del testo, ed è la disposizione che la documentazione
   * dell'API raccomanda: il modello legge la domanda avendo già davanti ciò a cui si
   * riferisce. Nel journal finiscono con lo stesso ordine, ma **senza i byte**: quelli
   * stanno in un file, e qui viaggia il riferimento (vedi `PromptPart`).
   */
  prompt(text: string, immagini: PromptImage[] = []): string {
    const turnId = randomUUID()
    this.tr.beginTurn(turnId)
    const parts: PromptPart[] = [
      ...immagini.map(i => ({
        type: 'image' as const, ref: i.ref, mediaType: i.mediaType, bytes: i.bytes,
        ...(i.name ? { name: i.name } : {}),
      })),
      { type: 'text' as const, text },
    ]
    if (this.created) this.emit({ k: 'turn.started', turnId, prompt: parts })
    else this.pendingTurn = { turnId, parts }
    const msg: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          ...immagini.map(i => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: i.mediaType, data: i.data },
          })),
          { type: 'text' as const, text },
        ],
      },
      parent_tool_use_id: null,
      session_id: '',
    } as SDKUserMessage
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
      this.emit({ k: 'turn.started', turnId: t.turnId, prompt: t.parts })
    }
  }

  private async consume(q: Query): Promise<void> {
    try {
      for await (const m of q) {
        this.opts.onRaw?.(m)
        this.watchCommands(m as Record<string, unknown>)
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
   * Due cose sui comandi si sanno solo guardando passare i messaggi.
   *
   * Quali sono legati al terminale lo dice `system:init`, che arriva col primo turno e
   * non con l'handshake: prima di allora non c'è modo di saperlo, e marcarli a
   * indovinare sarebbe peggio che marcarli tardi. E la lista **cambia in corsa** —
   * l'agent scopre skill nuove lavorando in una sottocartella — con una notifica che
   * dice di rimpiazzarla.
   */
  private watchCommands(m: Record<string, unknown>): void {
    if (m['type'] === 'system' && m['subtype'] === 'init') {
      const solo = m['terminal_slash_commands']
      if (Array.isArray(solo)) {
        this.soloTerminale = new Set(solo.map(String))
        this.emitCommands()
      }
      return
    }
    // `system/commands_changed` porta la lista intera e va **sostituita**, non fusa.
    // Si rilegge invece di fidarsi del payload perché è la stessa lista che
    // `supportedCommands()` restituisce, e passare da lì tiene un solo formato.
    if (m['type'] === 'system' && m['subtype'] === 'commands_changed') {
      void this.refreshCommands()
    }
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
  /**
   * Cosa va fatto **prima** di consegnare un messaggio all'agent. Esiste per una cosa
   * sola: rimettere in riga i server MCP quando ne è comparso uno dopo l'avvio. Sta
   * qui e non in `prompt()` perché lì il messaggio sarebbe già partito — l'unico punto
   * che precede davvero il turno è la consegna.
   */
  private gate: (() => Promise<void>) | null = null

  before(f: () => Promise<void>): void { this.gate = f }

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
      if (next) { await this.run(); yield next; continue }
      if (this.closed) return
      const m = await new Promise<SDKUserMessage | null>(res => { this.waiting = res })
      if (m === null) return
      await this.run()
      yield m
    }
  }

  /** Il passaggio prima della consegna non può far saltare il turno: se fallisce, si
   *  consegna lo stesso. Un messaggio perso sarebbe molto peggio di un server acceso. */
  private async run(): Promise<void> {
    try { await this.gate?.() } catch { /* la chat va avanti */ }
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

