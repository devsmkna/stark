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
import type { SessionSpec } from '../../core/adapter.ts'

/**
 * Le opzioni di lancio **sono** il contratto del §1: `SessionSpec`, senza aggiunte.
 * Prima di ADR-012 questo tipo esisteva a parte e parlava di `configDir`,
 * `pathToExecutable` e `askTools` — cioe' del vocabolario di Claude Code — e quei
 * nomi risalivano fino alla rotta HTTP del daemon e alla UI. Qui restano solo come
 * **traduzione**, dentro `buildOptions`, che e' il posto giusto: e' l'unica funzione
 * il cui mestiere e' proprio dire come STARK configura questo agent.
 */
export type LaunchOptions = SessionSpec

/**
 * Le sei modalità **di Claude Code**, e la funzione che ci riporta dentro.
 *
 * Dopo ADR-014 `PermissionMode` è una stringa aperta nel modello canonico: sono gli
 * agent a dichiarare come si chiamano le proprie modalità. Qui si torna all'enumerazione
 * dell'SDK, ed è giusto che la conversione stia in questo file — è l'unico il cui
 * mestiere è dire come STARK configura *questo* agent.
 *
 * Una modalità che non è delle sei non si passa: passarla darebbe un errore dell'SDK a
 * runtime su un valore che noi sapevamo già essere sbagliato.
 */
export const MODI_CLAUDE = [
  'default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions',
] as const
export type ModoClaude = typeof MODI_CLAUDE[number]

export function modoDiClaude(m: string | undefined): ModoClaude | undefined {
  return MODI_CLAUDE.includes(m as ModoClaude) ? (m as ModoClaude) : undefined
}

export function buildOptions(o: LaunchOptions): Options {
  const opts: Options = {
    cwd: o.cwd,
    model: o.model,
    permissionMode: modoDiClaude(o.mode),
    // Il system prompt di Claude Code, chiesto per nome — e la ragione per cui questa
    // riga non e' un dettaglio e' che **non passarla non vuol dire «lascia fare al CLI»**.
    //
    // L'SDK, quando `systemPrompt` e' assente, non si tira indietro: lo sostituisce con
    // una stringa vuota. La riga esatta nel bundle (`sdk.mjs`, funzione `xP`) e'
    // `if (s === void 0) p = ""`, e la doc lo dice nei termini che contano: «the SDK uses
    // a minimal prompt that covers tool calling but omits Claude Code's coding guidelines,
    // response style, and project context. This differs from `claude -p`, which uses the
    // full Claude Code prompt by default».
    //
    // Misurato prima di correggerlo, non dedotto (`spike/costo-vs-cli.ts`, costo zero di
    // quota): senza questa riga la categoria «System prompt» di `getContextUsage()` vale
    // **677** token invece di **3.969**. Cioe' le sessioni di STARK giravano con l'agent
    // istruito meno di quello del terminale — Principio 5 al contrario, e nessuno se ne
    // accorgeva perche' fallisce nel modo peggiore: non da' errore, risponde peggio.
    //
    // Cosa NON si perdeva, e va detto perche' sembra il contrario: `CLAUDE.md` e le skill
    // restano (62.414 e 1.875 token, identici con e senza). Quelli non passano dal system
    // prompt — la doc: «the SDK reads it and injects its content into the conversation as
    // project context, not into the system prompt».
    //
    // `excludeDynamicSections` si lascia spento di proposito: serve a una flotta di
    // macchine diverse che vuole far combaciare il prefisso di cache fra utenti, al prezzo
    // di spostare cartella di lavoro e stato git in un messaggio utente, dove pesano meno
    // sul comportamento. STARK gira su una macchina sola: pagherebbe il prezzo senza
    // incassare il vantaggio.
    systemPrompt: { type: 'preset', preset: 'claude_code' },
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
  // Dire come si chiama la conversazione spegne la generazione automatica del titolo
  // («When provided, the session uses this title instead of auto-generating one from the
  // first user message»), che e' una chiamata al modello per una cosa che STARK sa gia'.
  // Su un risveglio non serve e non fa niente: il titolo persistito della sessione vince
  // comunque, lo dice l'SDK — quindi il campo conta solo alla nascita, che e' l'unico
  // momento in cui quella chiamata sarebbe partita.
  if (o.title) opts.title = o.title
  if (o.resume) {
    // `resume` per primo: chi sa già quale conversazione vuole vince su chi chiede
    // «l'ultima», e i due sono incompatibili per l'SDK.
    opts.resume = o.resume.ref
    if (o.resume.fork) opts.forkSession = true
  } else if (o.continue) {
    // Niente `sessionId` accanto: l'SDK li dichiara incompatibili, e passarli insieme
    // fa fallire l'avvio invece di ignorarne uno.
    opts.continue = true
  } else if (o.sessionId) {
    opts.sessionId = o.sessionId
  }
  // Il `profile` del contratto e' una stringa opaca: **qui** diventa
  // `CLAUDE_CONFIG_DIR`. Chi la usa ha le proprie conversazioni fuori da `~/.claude`,
  // e un processo che non se la vede passare guarda nella cartella sbagliata: non
  // trova nulla da riprendere e forse nemmeno il login. Fallisce con l'aria di essere
  // rotto senza motivo, quindi vale la pena che sia scritto dove si traduce.
  if (o.profile) opts.env = { ...process.env, CLAUDE_CONFIG_DIR: o.profile }
  // Il default e' l'eseguibile che l'SDK porta con se', appaiato alla sua versione.
  if (o.executable) opts.pathToClaudeCodeExecutable = o.executable
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

/**
 * La finestra di contesto del modello, in token — verificata (skill `claude-api`,
 * letta il 25 agosto 2026), non indovinata: Sonnet 5, Opus 5 e il resto della
 * famiglia 4.6+ portano 1M come default, non come opzione beta; Haiku e i modelli
 * più vecchi restano a 200K. Un alias può arrivare con una data appesa
 * (`-20260101`): la si toglie prima del confronto, altrimenti un modello di punta
 * sembrerebbe uno sconosciuto e si sottostimerebbe lo spazio vero.
 *
 * Bug trovato il 26 agosto 2026, verificato sull'handshake vero: `resolvedModel`
 * per Opus arriva come `claude-opus-5[1m]`, **con** le parentesi — non tutti i
 * modelli le tolgono (Fable, nello stesso handshake, arriva già pulito). Senza
 * togliere anche quelle, `base` restava `claude-opus-5[1m]`, non combaciava con
 * nulla nell'elenco, e la finestra ripiegava sui 200K sbagliati: un contesto vero
 * al 21% del milione appariva 105%, tagliato a **100%** — che è esattamente il
 * bug segnalato, non un'ipotesi sulla cache (verificato: `getContextUsage()`
 * dell'SDK e la somma `input+output+cache*` di STARK davano numeri quasi
 * identici sulla stessa sessione; il denominatore sbagliato era l'unico salto).
 * `[1m]` è anche un segnale positivo a sé: un domani modello ancora non elencato
 * ma marcato così è comunque un milione, non serve aspettare di aggiungerlo qui.
 */
const CONTESTO_1M = [
  'claude-fable-5', 'claude-mythos-5', 'claude-opus-5', 'claude-opus-4-8',
  'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6',
]
export function contextWindowFor(model: string): number {
  if (/\[1m\]/i.test(model)) return 1_000_000
  const base = model.replace(/-\d{8}$/, '').replace(/\[[^\]]*\]$/, '')
  return CONTESTO_1M.some(m => base === m || base.startsWith(`${m}-`)) ? 1_000_000 : 200_000
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
    // I ritentativi li fa l'SDK sotto e non affiorano: non e' un buco, e' un fatto che
    // questo agent non racconta. Misurato: nessun messaggio nativo li dichiara.
    retries: false,
    // Verificato due volte il 27 agosto sulla lista **runtime** dei tool di una
    // sessione vera (60 tool): c'e' `Task`/`TaskOutput`/`TaskStop`, non `TodoWrite`
    // ne' i `TaskCreate`. I tipi dell'SDK li dichiarano lo stesso — §16.10.
    todos: false,
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
const SENZA_AUTO = 'No auto mode — this chat would fall back and ask for everything'

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
      const auto = modelSupportsAutoMode(resolved ?? id)
      out.push({
        id, autoMode: auto,
        contextWindow: contextWindowFor(resolved ?? id),
        // L'avviso lo scrive **questo** agent, e solo qui ha senso: su Claude Code
        // alcuni modelli reggono auto mode e altri no, quindi l'assenza distingue. Su
        // un agent senza classificatore non distinguerebbe niente — vedi `optionsFrom`.
        ...(auto ? {} : { note: SENZA_AUTO }),
        ...(label ? { label } : {}), ...(resolved ? { resolved } : {}),
      })
    }
  }
  // Il modello con cui la sessione sta girando dev'esserci sempre, anche se
  // l'handshake non lo elenca: una tendina che non contiene il valore corrente
  // sembrerebbe dire che è stato scelto qualcosa di impossibile.
  if (!out.some(m => m.id === current || m.resolved === current)) {
    out.unshift({
      id: current, autoMode: modelSupportsAutoMode(current),
      contextWindow: contextWindowFor(current),
      ...(modelSupportsAutoMode(current) ? {} : { note: SENZA_AUTO }),
    })
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
/**
 * Cosa fa ciascuna modalita', **detto da qui**.
 *
 * Queste frasi stavano nella UI (`view.ts`, `MODE_BLURB`), ed era il posto sbagliato:
 * descrivono il comportamento di *questo* agent, e la prova di carico l'ha mostrato in
 * modo lampante — su OpenCode la voce `plan` mostrava «Plans first, touches nothing»,
 * cioe' la frase di Claude Code capitata li' per omonimia. Vera per caso, falsa nei
 * fatti. Dopo ADR-014 chi descrive una modalita' e' chi ce l'ha.
 */
const COSA_FA: Record<string, string> = {
  auto: 'A classifier checks every action. No cards.',
  default: 'Asks before everything',
  acceptEdits: 'File edits go through, the rest asks',
  plan: 'Plans first, touches nothing',
  dontAsk: 'Never asks. The classifier still checks.',
  bypassPermissions: 'No checks at all',
}

export function modeChoices(): ModeChoice[] {
  const root = typeof process.getuid === 'function' && process.getuid() === 0
  const ALL: PermissionMode[] = ['auto', ...MODI_CLAUDE.filter(m => m !== 'auto')]
  return ALL.map(mode => ({
    mode,
    ...(COSA_FA[mode] ? { note: COSA_FA[mode] } : {}),
    // `bypassPermissions` da root lo rifiuta **il CLI**, non STARK: la voce resta in
    // elenco spenta con la ragione, che e' la differenza fra un limite e un default.
    ...(mode === 'bypassPermissions' && root
      ? {
          available: false,
          reason: 'Refused by the CLI itself when it runs with root privileges — '
            + 'not a STARK restriction.',
        }
      : { available: true }),
  }))
}

export function slashCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return []
  return raw.map(c => {
    if (typeof c === 'string') return { name: c }
    const hint = c?.['argumentHint']
    const alias = c?.['aliases']
    return {
      name: String(c?.['name'] ?? '?'),
      ...(c?.['description'] ? { description: String(c['description']) } : {}),
      // Stringa vuota vuol dire «nessun argomento», e portarsela dietro come campo
      // presente costringerebbe la UI a distinguere '' da assente per non stampare
      // uno spazio dopo il nome.
      ...(typeof hint === 'string' && hint ? { argumentHint: hint } : {}),
      ...(Array.isArray(alias) && alias.length ? { aliases: alias.map(String) } : {}),
    }
  })
}
