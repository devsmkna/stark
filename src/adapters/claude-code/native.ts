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
  /**
   * I dialoghi che STARK sa disegnare. Dichiararli NON e un dettaglio: il CLI tratta
   * l'assenza come "questo client non sa mostrarlo" e ripiega sul comportamento senza
   * dialogo — che per un permesso vuol dire negare, e per una domanda vuol dire che il
   * tool sparisce del tutto dall'elenco. E il motivo per cui in headless sembrava che
   * meta delle funzioni non esistessero.
   */
  dialogKinds?: string[]
  extraArgs?: string[]
}

export const HOOK_CALLBACK_ID = 'stark-pretooluse'

/**
 * I 27 dialoghi che il CLI sa delegare, letti dal registro interno della 2.1.241.
 * Sono l'elenco di cio che una GUI deve saper disegnare per non valere meno della TUI.
 */
export const DIALOG_KINDS = [
  'permission_ask_user_question', 'permission_enter_plan_mode', 'permission_bash',
  'permission_browser', 'permission_file', 'permission_monitor', 'permission_powershell',
  'permission_prompt', 'permission_skill', 'permission_webfetch', 'permission_workflow',
  'auto_mode_flagged_allow', 'auto_mode_setup_review', 'auto_default_nudge',
  'cost_threshold', 'fable_overage_consent_prompt', 'goal_proposal', 'refusal_fallback_prompt',
  'resume_return', 'sandbox_network_access', 'computer_use_approval', 'mcp_url_elicitation',
  'managed_settings_security', 'peer_inbound_approval', 'ide_onboarding',
  'chrome_install_setup', 'chrome_install_upsell',
] as const

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
export function buildInitialize(askMatchers: string[], dialogKinds: string[] = []): NativeEvent {
  const request: NativeEvent = { subtype: 'initialize' }
  if (dialogKinds.length > 0) request['supportedDialogKinds'] = dialogKinds
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
