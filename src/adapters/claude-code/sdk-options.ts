// Come STARK configura l'Agent SDK. Vedi ADR-009.
//
// Questo file esiste per una ragione sola: tenere in un posto unico le scelte di
// lancio che hanno una motivazione, così che nessuna di esse possa essere cambiata
// per sbaglio credendola un dettaglio. Ce ne sono tre, e tutte e tre hanno un modo
// silenzioso di fallire.

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { Capabilities, PermissionMode, SlashCommand } from '../../core/events.ts'

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
    // Obbligatorio. Senza, la sessione eredita tutti i server MCP globali della
    // macchina: canale di uscita dati non presidiato e circa 5x di contesto per turno,
    // cioè quota bruciata prima. È la stessa ragione di sempre, con un altro nome.
    strictMcpConfig: true,
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

export function slashCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return []
  return raw.map(c => typeof c === 'string'
    ? { name: c }
    : { name: String(c?.['name'] ?? '?'), ...(c?.['description'] ? { description: String(c['description']) } : {}) })
}
