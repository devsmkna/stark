// Il formato nativo di Claude Code, tipizzato al minimo indispensabile.
//
// Qui si usa `any` di proposito. Questo formato non è nostro, non è versionato e può
// cambiare senza preavviso: descriverlo con tipi stretti darebbe una falsa sicurezza e
// romperebbe la compilazione a ogni aggiornamento del CLI. La sicurezza dei tipi che ci
// interessa sta sull'altro lato dell'adapter, dove i tipi SONO nostri: `Payload`.
// Questo file è l'unico punto del progetto in cui è lecito nominare l'API Anthropic.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Capabilities, SlashCommand } from '../../core/events.ts'

export type NativeEvent = { type?: string; subtype?: string; [k: string]: any }

/** Argomenti di lancio verificati nello spike. Vedi §14 della specifica. */
export type LaunchOptions = {
  cwd: string
  model: string
  /** Default STARK: 'auto' (ADR-008). */
  mode: string
  /**
   * I nomi di tool per cui l'utente ha chiesto di essere interrogato.
   * Vuoto = nessun hook dichiarato = zero card. È il caso normale.
   * Attenzione: '*' qui annulla auto mode (vincolo 1 del §8).
   */
  askMatchers?: string[]
  /**
   * Riprendere una conversazione esistente. `ref` e l'id di sessione di Claude Code.
   *
   * Attenzione: `--no-session-persistence` e incompatibile con tutto questo. Senza
   * trascritto persistito non c'e niente da riprendere, quindi una sessione che STARK
   * vuole poter risvegliare NON puo essere effimera. Il journal di STARK non basta:
   * ricostruisce cosa e successo per la UI, ma il contesto del modello vive nel
   * trascritto dell'agent.
   */
  resume?: { ref: string; fork?: boolean }
  /** Imporre l'id invece di scoprirlo: cosi STARK sa come risvegliare gia in partenza. */
  sessionId?: string
  extraArgs?: string[]
}

export const HOOK_CALLBACK_ID = 'stark-pretooluse'

export function buildArgs(o: LaunchOptions): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', o.model,
    // Obbligatorio: senza, la sessione eredita tutti i server MCP globali della
    // macchina. Canale di uscita dati non presidiato e ~5x di contesto per turno,
    // cioè quota bruciata. `--tools ""` da solo non basta (§14).
    '--strict-mcp-config',
    ...(o.resume ? ['--resume', o.resume.ref] : []),
    ...(o.resume?.fork ? ['--fork-session'] : []),
    ...(o.sessionId && !o.resume ? ['--session-id', o.sessionId] : []),
    '--permission-mode', o.mode,
    '--include-partial-messages',
    ...(o.askMatchers && o.askMatchers.length > 0 ? ['--include-hook-events'] : []),
    ...(o.extraArgs ?? []),
  ]
}

/** L'handshake. L'hook si dichiara SOLO per i tool messi su "chiedi" (§8, vincolo 1). */
export function buildInitialize(askMatchers: string[]): NativeEvent {
  const request: NativeEvent = { subtype: 'initialize' }
  if (askMatchers.length > 0) {
    request['hooks'] = {
      PreToolUse: askMatchers.map(m => ({ matcher: m, hookCallbackIds: [HOOK_CALLBACK_ID] })),
    }
  }
  return { type: 'control_request', request_id: 'stark-init-1', request }
}

/**
 * Auto mode richiede Opus 4.6+, Sonnet 4.6+ o Fable 5. Haiku non è supportato su
 * nessun provider: la sessione ripartirebbe in Manual e tornerebbe a chiedere tutto.
 * Questa è una lista di negativi verificati, non di positivi indovinati; la conferma
 * vera arriva dal `permissionMode` che `system:init` riporta indietro.
 */
export function modelSupportsAutoMode(model: string): boolean {
  return !/haiku/i.test(model)
}

export function capabilitiesFor(model: string): Capabilities {
  return {
    interrupt: true,        // P04
    switchModel: true,      // P03c
    switchMode: true,       // P03c
    autoMode: modelSupportsAutoMode(model),
    permissionAlways: true, // emulato da STARK: il protocollo conosce solo allow/deny
    questions: false,       // §16.1: mai sondato su Claude Code
    revert: false,
    toolProgress: false,
    fileBrowser: false,
    pty: false,             // Roadmap, Fase 2
  }
}

/**
 * L'alias `default` non dice quale modello sta girando davvero, e da quello dipende
 * `capabilities.autoMode`. La risposta all'handshake porta la tabella di risoluzione.
 */
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
