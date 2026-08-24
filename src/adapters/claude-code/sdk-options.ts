// Come STARK configura l'Agent SDK. Vedi ADR-009.
//
// Questo file esiste per una ragione sola: tenere in un posto unico le scelte di
// lancio che hanno una motivazione, così che nessuna di esse possa essere cambiata
// per sbaglio credendola un dettaglio. Ce ne sono tre, e tutte e tre hanno un modo
// silenzioso di fallire.

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type {
  Capabilities, ModeChoice, ModelChoice, PermissionMode, SlashCommand,
} from '../../core/events.ts'

export type LaunchOptions = {
  cwd: string
  model: string
  /** Default STARK: 'auto' (ADR-008). */
  mode: PermissionMode
  /** Riprendere una conversazione esistente. `ref` è l'id di sessione di Claude Code. */
  resume?: { ref: string; fork?: boolean }
  /** Imporre l'id invece di scoprirlo: così STARK sa come risvegliare già in partenza. */
  sessionId?: string
  /**
   * Dove vivono sessioni e credenziali. Chi usa `CLAUDE_CONFIG_DIR` ha le proprie
   * conversazioni fuori da `~/.claude`, e un processo che non se lo vede passare
   * guarda nella cartella sbagliata: non trova nulla da riprendere e forse nemmeno il
   * login. Fallisce con l'aria di essere rotto senza motivo.
   */
  configDir?: string
  /**
   * Quale eseguibile guidare. Il default è quello che l'SDK porta con sé, appaiato
   * alla sua versione. Si punta altrove solo con una ragione.
   */
  pathToExecutable?: string
  /** I nomi di tool per cui l'utente vuole essere interrogato. */
  askTools?: string[]
}

export function buildOptions(o: LaunchOptions): Options {
  const opts: Options = {
    cwd: o.cwd,
    model: o.model,
    permissionMode: o.mode,
    // `false`, e la ragione è cambiata nel tempo: vale la pena scriverla intera.
    //
    // Era `true` perché senza, la sessione eredita tutti i server MCP della macchina:
    // canale di uscita dati non presidiato e circa 5x di contesto per turno. Ma `true`
    // rende quei server **irraggiungibili**, e non c'è modo di riaccenderne uno: STARK
    // finiva per poter meno del CLI, che è la cosa che non deve mai succedere.
    //
    // La protezione ora è in un altro punto ed è più precisa: l'adapter, appena la
    // sessione è in piedi e **prima di qualunque turno**, spegne con `toggleMcpServer`
    // tutti i server che la chat non ha scelto. Il default resta quindi «nessuno», ma
    // adesso è una scelta che si può cambiare invece di un muro.
    //
    // Verificato prima di scriverlo, non dedotto: spenti prima del primo turno, i loro
    // tool non compaiono nella lista del turno (0 su 29), e lo spegnimento **non**
    // tocca la configurazione su disco — vale per la sessione, non per la macchina.
    strictMcpConfig: false,
    includePartialMessages: true,
    // Le domande dell'agent esistono solo se qualcuno sa rispondere: il tool compare
    // nell'elenco perché passiamo questa callback (ADR-009). Toglierla non la rende
    // "meno interattiva": fa sparire `AskUserQuestion` del tutto.
    // La callback vera viene innestata dall'adapter.
    canUseTool: async (_n, input) => ({ behavior: 'allow', updatedInput: input }),
  }
  if (o.resume) {
    opts.resume = o.resume.ref
    if (o.resume.fork) opts.forkSession = true
  } else if (o.sessionId) {
    opts.sessionId = o.sessionId
  }
  if (o.configDir) opts.env = { ...process.env, CLAUDE_CONFIG_DIR: o.configDir }
  if (o.pathToExecutable) opts.pathToClaudeCodeExecutable = o.pathToExecutable
  return opts
}

/**
 * Auto mode richiede Opus 4.6+, Sonnet 4.6+ o Fable 5. Haiku non è supportato su
 * nessun provider: la sessione ripartirebbe in Manual e tornerebbe a chiedere tutto.
 * Lista di negativi verificati, non di positivi indovinati; la conferma vera arriva
 * dal `current_permission_mode` che l'handshake riporta indietro.
 */
export function modelSupportsAutoMode(model: string): boolean {
  return !/haiku/i.test(model)
}

export function capabilitiesFor(model: string): Capabilities {
  return {
    interrupt: true,
    switchModel: true,
    switchMode: true,
    autoMode: modelSupportsAutoMode(model),
    // Non più emulato da STARK: `context.suggestions` porta regole già pronte e
    // rimandarne una indietro le scrive in .claude/settings.local.json (ADR-009).
    permissionAlways: true,
    questions: true,
    revert: false,       // c'è `enableFileCheckpointing`, non ancora usato
    toolProgress: false,
    fileBrowser: false,
    pty: false,          // Roadmap, Fase 2
  }
}

export function resolveModel(models: unknown, requested: string): string {
  if (!Array.isArray(models)) return requested
  for (const m of models) {
    if (m?.['value'] === requested && typeof m['resolvedModel'] === 'string') return m['resolvedModel']
  }
  return requested
}

/**
 * I modelli fra cui questa sessione può scegliere, come li dichiara l'handshake.
 *
 * `autoMode` viaggia con ciascuno perché è una proprietà del modello: senza, la barra
 * di stato dovrebbe sapere da sé che Haiku non lo regge — cioè conoscere i modelli di
 * un agent, che è ciò che il §1 vieta fuori di qui. La UI ne fa un avviso: la voce
 * resta scegliibile, perché il CLI la accetta (Principio 5), ma dice cosa succede.
 */
export function modelChoices(raw: unknown, current: string): ModelChoice[] {
  const out: ModelChoice[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const m of raw) {
      const id = String(m?.['value'] ?? '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      const resolved = typeof m?.['resolvedModel'] === 'string' ? m['resolvedModel'] : undefined
      const label = typeof m?.['displayName'] === 'string' ? m['displayName'] : undefined
      out.push({
        id, autoMode: modelSupportsAutoMode(resolved ?? id),
        ...(label ? { label } : {}), ...(resolved ? { resolved } : {}),
      })
    }
  }
  // Il modello con cui la sessione sta girando dev'esserci sempre, anche se
  // l'handshake non lo elenca: una tendina che non contiene il valore corrente
  // sembrerebbe dire che è stato scelto qualcosa di impossibile.
  if (!out.some(m => m.id === current || m.resolved === current)) {
    out.unshift({ id: current, autoMode: modelSupportsAutoMode(current) })
  }
  return out
}

/**
 * Tutte e sei le modalità, con scritto quali non si possono usare **e perché**.
 *
 * Non cinque: `bypassPermissions` resta in elenco, spenta. Non è una prudenza di STARK,
 * è il CLI che la rifiuta a chi gira come root — e Principio 5 dice che una voce che il
 * CLI non accetta si mostra disabilitata con la spiegazione, mai nascosta. Nasconderla
 * farebbe sembrare STARK meno capace del terminale.
 */
export function modeChoices(): ModeChoice[] {
  const root = typeof process.getuid === 'function' && process.getuid() === 0
  const ALL: PermissionMode[] = [
    'auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions',
  ]
  return ALL.map(mode => mode === 'bypassPermissions' && root
    ? {
        mode, available: false,
        reason: 'Refused by the CLI itself when it runs with root privileges — '
          + 'not a STARK restriction.',
      }
    : { mode, available: true })
}

export function slashCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return []
  return raw.map(c => typeof c === 'string'
    ? { name: c }
    : { name: String(c?.['name'] ?? '?'), ...(c?.['description'] ? { description: String(c['description']) } : {}) })
}
