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
import {
  EMPTY_USAGE,
  type AgentQuestion, type McpServer, type Payload, type PermissionMode, type PromptPart,
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
import { quotaWindows } from './quota.ts'
import { resourcesOf } from './summary.ts'
import { Translator } from './translate.ts'

/**
 * Un prompt che ha già il suo turno aperto e aspetta il proprio giro. `annunciato`
 * distingue quelli mandati prima che la sessione fosse nata: il loro `turn.started`
 * non è ancora potuto uscire.
 */
type InCoda = { turnId: string; parts: PromptPart[]; msg: SDKUserMessage; annunciato: boolean }

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
    // Non si aspetta: è una domanda al piano (o all'SDK), non alla conversazione, e
    // la chat deve poter partire anche se quella risposta tarda o non arriva mai.
    void this.refreshQuota()
    void this.refreshContext()
  }

  // ─── quanto ne resta ──────────────────────────────────────────────────────

  /** L'ultima fotografia scritta, per non riscrivere nel journal la stessa riga. */
  private ultimaQuota = ''

  /**
   * Chiede al piano quanto è pieno il serbatoio e lo scrive nel journal.
   *
   * Gira in tre momenti, e ognuno ha la sua ragione: all'**avvio**, perché una chat
   * appena risvegliata deve dire numeri di adesso e non quelli di quando si è
   * addormentata; a **fine turno**, perché è il momento in cui quei numeri si sono
   * appena mossi; e **quando l'utente guarda il pannellino**, perché è l'unico istante
   * in cui la freschezza serve davvero — nel frattempo la quota la consumano anche le
   * altre chat e l'altra macchina, e nessuno ce lo verrebbe a dire.
   *
   * Non costa quota: è una domanda sul consumo, non un turno di modello.
   */
  async refreshQuota(): Promise<void> {
    const q = this.q as unknown as Record<string, unknown> | null
    const metodo = q?.['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']
    // Il nome dice che può sparire, quindi si guarda se c'è invece di fidarsi del tipo.
    // Una versione che non ce l'ha non è un guasto: il pannellino dirà che non lo sa.
    if (typeof metodo !== 'function') return
    let windows
    try {
      windows = quotaWindows(await (metodo as () => Promise<unknown>).call(q))
    } catch {
      return
    }
    if (windows.length === 0) return
    const firma = JSON.stringify(windows)
    if (firma === this.ultimaQuota) return
    this.ultimaQuota = firma
    this.emit({ k: 'quota.windows', windows })
  }

  // ─── quanto è pieno il contesto ──────────────────────────────────────────

  /** L'ultima fotografia scritta, per non riscrivere nel journal la stessa riga. */
  private ultimoContesto = ''

  /**
   * Chiede a Claude Code quanto è pieno il contesto — la stessa domanda a cui
   * risponde `/context` nel terminale — e lo scrive nel journal. Stessi tre momenti
   * di `refreshQuota`, per la stessa ragione: avvio, fine turno, pannellino aperto.
   *
   * A differenza della quota, `getContextUsage()` è un metodo pubblico e stabile
   * dell'SDK — non serve la riflessione che protegge `refreshQuota` da un nome che
   * l'SDK stesso dichiara instabile.
   */
  async refreshContext(): Promise<void> {
    if (!this.q) return
    let ctx
    try {
      ctx = await this.q.getContextUsage()
    } catch {
      return
    }
    // `maxTokens` è già la finestra pratica (con la riserva di auto-compattazione
    // già tolta), e `percentage` è già calcolata da chi la manda: STARK la riporta,
    // non la ricalcola — è esattamente il bug che questa domanda doveva chiudere.
    const usage = {
      totalTokens: ctx.totalTokens,
      maxTokens: ctx.maxTokens,
      percentage: ctx.percentage,
      categories: ctx.categories.map(c => ({ name: c.name, tokens: c.tokens })),
    }
    const firma = JSON.stringify(usage)
    if (firma === this.ultimoContesto) return
    this.ultimoContesto = firma
    this.emit({ k: 'context.usage', usage })
  }

  // ─── i file del progetto, per le citazioni con `@` ────────────────────────

  /**
   * I file che somigliano a quello che stai scrivendo dopo una `@`.
   *
   * Non è una ricerca nostra: è `file_suggestions` del canale di controllo, cioè
   * **la stessa** che il terminale mostra («the same fuzzy-matched results the TUI
   * shows», dai tipi ufficiali dell'SDK). Rifarla in casa avrebbe voluto dire
   * decidere da soli cosa ignorare (`.git`, `node_modules`, `.gitignore`, i file
   * binari) e divergere dal CLI al primo aggiornamento — vedi ADR-009: l'SDK
   * sostituisce il trasporto, non la traduzione, e questa è trasporto.
   *
   * Il pezzo scomodo, e va detto in chiaro: l'SDK dichiara la richiesta nei tipi
   * (`SDKControlFileSuggestionsRequest`) ma **non** la espone come metodo del `Query`,
   * come fa invece per `getContextUsage()`. Si passa quindi dal `request()` generico,
   * che nel `.d.ts` non c'è. Perciò la stessa cautela di `refreshQuota()`: si guarda
   * se il metodo c'è invece di fidarsi del tipo, e una versione che lo togliesse non
   * è un guasto — il menu semplicemente non si apre, e la casella resta una casella.
   *
   * Verificato dal vivo prima di scriverlo (26 agosto 2026, costo zero di quota:
   * è una domanda sul filesystem, non un turno): risponde in **2-3ms** a regime,
   * torna anche le cartelle (col `/` finale) e con query vuota le voci della radice.
   *
   * Il fatto scomodo, misurato e non aggirato: per i primi **~1,5s** dopo l'apertura
   * di una chat il CLI sta ancora costruendo il suo indice e risponde «nessun file» a
   * qualunque ricerca — mentre la query vuota funziona subito, perché quella è una
   * lettura della cartella e non una ricerca. Un riscaldamento all'avvio sembrava la
   * cura ovvia ed è stato scritto, misurato e **tolto**: A/B su due giri per parte,
   * 1531/1565ms senza contro 2738/1563ms con, cioè nessun guadagno. L'indice se lo
   * costruisce da sé e non si lascia anticipare. A coprire quella finestra è quindi
   * l'unica cosa che funziona davvero, cioè ritentare una volta: sta nella UI, che è
   * il posto dove si sa che l'utente sta ancora digitando.
   */
  async fileSuggestions(query: string): Promise<string[]> {
    const q = this.q as unknown as Record<string, unknown> | null
    const request = q?.['request']
    if (typeof request !== 'function') return []
    try {
      const r = await (request as (x: unknown) => Promise<unknown>).call(q, {
        subtype: 'file_suggestions', query,
      }) as { response?: { suggestions?: { path?: unknown }[] } }
      return (r?.response?.suggestions ?? [])
        .map(s => s?.path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
    } catch {
      // Una domanda sui file non deve poter rompere la chat: senza risposta il menu
      // non si apre, che è esattamente ciò che succede quando non c'è niente da dire.
      return []
    }
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
    const parts: PromptPart[] = [
      ...immagini.map(i => ({
        type: 'image' as const, ref: i.ref, mediaType: i.mediaType, bytes: i.bytes,
        ...(i.name ? { name: i.name } : {}),
      })),
      { type: 'text' as const, text },
    ]

    const turnId = randomUUID()
    const msg = this.userMessage(text, immagini)

    // C'è già qualcosa in volo? Allora questo prompt **apre un turno suo e aspetta**:
    // non si piega dentro quello in corso e non parte adesso. È una coda FIFO, e le
    // due metà della frase contano tutte e due.
    //
    // «Apre un turno suo» perché è ciò che l'utente ha fatto: due richieste separate
    // sono due richieste, e nella conversazione devono restare due blocchi. La UI lo
    // sa già disegnare — un turno aperto che non è il primo aperto si mostra come
    // «queued, waiting its turn» (vedi `turnStatus` in ui/src/lib/view.ts).
    //
    // «E aspetta» perché è l'unico modo di essere sicuri che resti un turno suo: un
    // messaggio consegnato mentre l'agent lavora finisce nella coda del CLI, che
    // dequeue **a lotti** e li fonde in un turno solo ("coalesced into one turn",
    // parole dei tipi dell'SDK). Tenendolo qui, all'agent arriva un messaggio alla
    // volta e a sessione ferma: il caso normale, quello che già funziona. La fila è
    // **nostra**, e questo è anche ciò che rende annullabile ciò che c'è dentro —
    // `interrupt()` dell'SDK, in questa versione, non prende argomenti e non può
    // cancellare la coda del CLI.
    if (this.inVolo()) {
      // Prima che la sessione sia nata non si può emettere niente: `session.created`
      // non è ancora uscito. Lo annuncia `announce()`, in ordine, subito dopo.
      this.coda.push({ turnId, parts, msg, annunciato: this.created })
      if (this.created) this.emit({ k: 'turn.started', turnId, prompt: parts })
      return turnId
    }

    this.tr.beginTurn(turnId)
    if (this.created) this.emit({ k: 'turn.started', turnId, prompt: parts })
    else this.pendingTurn = { turnId, parts }
    this.input.push(msg)
    return turnId
  }

  // ─── la fila ──────────────────────────────────────────────────────────────

  /** I prompt che hanno già un turno aperto e aspettano il loro giro. In ordine. */
  private coda: InCoda[] = []

  /** C'è un turno in corso, o uno che sta per partire, o altri già in fila? */
  private inVolo(): boolean {
    return this.pendingTurn !== null || this.tr.openTurnId !== undefined || this.coda.length > 0
  }

  /**
   * Il turno in corso è finito: parte il primo della fila.
   *
   * Si consegna **uno alla volta**: è la regola che tiene un turno di STARK uguale a
   * un turno dell'agent. Consegnarne due insieme li farebbe fondere, e il secondo
   * turno resterebbe aperto per sempre senza ricevere un solo evento — il fantasma di
   * cui parlava il commento sbagliato che stava qui.
   */
  private next(): void {
    const p = this.coda.shift()
    if (!p) return
    this.tr.beginTurn(p.turnId)
    this.input.push(p.msg)
  }

  /**
   * Svuota la fila dichiarando finiti i turni che non gireranno.
   *
   * Serve perché un turno aperto che non riceverà mai eventi è la cosa peggiore che si
   * possa lasciare in un journal: alla rilettura la conversazione mostrerebbe per
   * sempre un «queued, waiting its turn» che non aspetta più niente (§4). Meglio dire
   * che è stato interrotto, che è la verità.
   */
  private svuota(): void {
    const persi = this.coda
    this.coda = []
    for (const p of persi) {
      this.emit({
        k: 'turn.ended', turnId: p.turnId, reason: 'aborted',
        usage: { ...EMPTY_USAGE }, cost: { nominalUsd: 0 },
      })
    }
  }

  private userMessage(text: string, immagini: PromptImage[]): SDKUserMessage {
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
    return msg
  }

  /** Aspetta la fine del turno in corso — **non** dello svuotamento della fila: chi
   *  chiama sa quanti prompt ha mandato, e aspettarne uno alla volta è ciò che serve
   *  a chi guida la sessione da uno script. */
  async settled(): Promise<void> {
    await new Promise<void>(res => { this.turnEnd = res })
  }

  /**
   * Stop vuol dire stop, **anche per la fila**.
   *
   * Non è ovvio e la scelta è questa: chi preme il quadrato rosso vuole che la
   * macchina si fermi, non che parta il prossimo della fila mezzo secondo dopo. Con
   * l'altra scelta, tre prompt in coda vorrebbero quattro Stop — e ogni Stop mancato
   * fa partire lavoro che nessuno voleva più. È anche la lettura che ne dà l'SDK, che
   * chiama «Stop-means-stop-everything client» proprio il pulsante Stop di una UI
   * remota. Si svuota **prima** di interrompere, così il turno che sta morendo non
   * trova nessuno da far partire quando si chiude.
   */
  async interrupt(): Promise<void> {
    // Solo se c'è davvero un turno da fermare: altrimenti la bandierina resterebbe su
    // e il prossimo errore vero verrebbe raccontato come «l'ha fermato l'utente».
    this.fermato = this.tr.openTurnId !== undefined
    this.svuota()
    await this.q?.interrupt()
  }

  /**
   * L'utente ha premuto Stop, e il turno che sta per chiudersi è quello.
   *
   * Serve perché il turno interrotto torna indietro come `is_error`, che STARK
   * tradurrebbe in `error` — e la conversazione mostrerebbe un «Turn error» rosso
   * dove la verità è «l'hai fermato tu». Dal messaggio non si distingue: l'unico che
   * lo sa è chi ha ricevuto il comando, cioè noi.
   */
  private fermato = false
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
    // Anche qui prima: chiudere lo stdin fa annullare al CLI il turno in corso, e i
    // turni in fila non partiranno mai. Lasciarli aperti nel journal li farebbe
    // riapparire «in attesa» a ogni risveglio, per sempre.
    this.svuota()
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
    // Chi è arrivato mentre la sessione nasceva ha già il suo turno e il suo posto in
    // fila: quello che gli mancava era solo il momento buono per dirlo.
    for (const p of this.coda) {
      if (p.annunciato) continue
      p.annunciato = true
      this.emit({ k: 'turn.started', turnId: p.turnId, prompt: p.parts })
    }
  }

  private async consume(q: Query): Promise<void> {
    try {
      for await (const m of q) {
        this.opts.onRaw?.(m)
        this.watchCommands(m as Record<string, unknown>)
        let finito = false
        for (const grezzo of this.tr.handle(m as Record<string, unknown>)) {
          const p = grezzo.k === 'turn.ended' && this.fermato
            ? { ...grezzo, reason: 'aborted' as const }
            : grezzo
          // Fra un turno e il successivo la conversazione **non è ferma**. L'`idle`
          // che chiude il turno durerebbe un decimo di secondo, ma non è un dettaglio
          // grafico: è lo stato su cui suona la notifica «ha finito», e suonerebbe
          // mentre invece c'è ancora la fila da fare.
          if (p.k === 'session.state' && p.state === 'idle' && this.coda.length > 0) continue
          this.emit(p)
          if (p.k === 'turn.ended') {
            finito = true
            this.fermato = false
            this.turnEnd?.(); this.turnEnd = null
            // Dopo, non prima: il turno che si è appena chiuso ha consumato quota e
            // contesto, e chiederlo adesso è l'unico modo perché i numeri comprendano
            // anche lui.
            void this.refreshQuota()
            void this.refreshContext()
          }
        }
        // Fuori dal giro degli eventi, non dentro: `turn.ended` arriva insieme
        // all'`usage` e allo stato, e il turno dopo va aperto quando quel messaggio è
        // stato raccontato tutto.
        if (finito) this.next()
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

