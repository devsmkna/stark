// Il contratto di un adapter: cosa il resto di STARK ha il diritto di chiedere a un
// agent, scritto nel vocabolario di dominio del §1 e in nessun altro.
//
// ─── Perché nasce, e perché nasce tardi ─────────────────────────────────────
//
// Nasce da ADR-012, il cui paletto n.1 dice: «fuori dall'adapter nessun componente sa
// che esiste OpenCode, esattamente come oggi nessuno sa che esiste Claude Code».
// Cercando il contratto da far implementare al secondo adapter si è scoperto che il
// contratto **non esisteva**: c'era solo la classe concreta `ClaudeCodeAdapter`, e a
// importarla direttamente non erano solo le sonde ma `daemon/registry.ts`,
// `daemon/server.ts`, `daemon/memoria.ts`. Il confine del §1 era quindi già violato
// **dalla parte di Claude Code**, prima ancora che il secondo adapter cominciasse.
//
// Le quattro falle trovate, tutte qui sopra il confine e tutte chiuse da questo file:
//
//  1. `askTools: string[]` — nomi di tool di Claude Code (`Bash`, `mcp__*`) nella
//     rotta HTTP del daemon, con il registro che chiamava `askToolsFor()` per
//     tradurre le categorie. `events.ts` diceva già a parole che quella traduzione
//     «è mestiere dell'adapter, l'unico a conoscerli»: qui diventa vero.
//  2. `configDir` — il nome della variabile d'ambiente di Claude Code, viaggiato fino
//     dentro la UI. Qui è `profile`, ed è una stringa **opaca**.
//  3. `remember: PermissionUpdate[]` — un tipo dell'SDK Anthropic *costruito dentro*
//     `registry.ts`, con `destination: 'localSettings'`. Il daemon decideva in che
//     file di Claude Code scrivere una regola.
//  4. `Live.adapter: ClaudeCodeAdapter` — la classe concreta come tipo.
//
// ─── La regola che decide i dubbi ───────────────────────────────────────────
//
// Un metodo sta qui se descrive **un fatto della conversazione**. Se per scriverne la
// firma serve sapere come quell'agent lo realizza, la firma è al livello sbagliato.

import type {
  AgentQuestion, ModeChoice, ModelChoice, Payload, PermissionCategory, PermissionMode,
  SessionOption,
} from './events.ts'

/** Un'immagine pronta da mandare: i byte per l'agent, il riferimento per il journal. */
export type PromptImage = {
  ref: string
  mediaType: string
  bytes: number
  name?: string
  /** base64. Non finisce nel journal: vedi `PromptPart`. */
  data: string
}

// ─── le tre risposte bloccanti ──────────────────────────────────────────────

/**
 * Cosa STARK decide su una richiesta di permesso.
 *
 * `remember` è **il soggetto da ricordare**, non la regola da scrivere: su Claude Code
 * diventerà un nome di tool in `.claude/settings.local.json`, su OpenCode un elemento
 * di `save` mandato con `reply: "always"`. Prima di ADR-012 questo campo era un
 * `PermissionUpdate` dell'SDK Anthropic **costruito dal daemon**, che quindi sapeva
 * in quale file di Claude Code finiva la regola. Sapere *cosa* ricordare è del
 * dominio; sapere *dove scriverlo* è dell'adapter.
 */
export type PermissionAnswer =
  | { allow: true; remember?: string; input?: Record<string, unknown> }
  | { allow: false; reason: string }

/**
 * Cosa STARK decide su un piano.
 *
 * `mode` viaggia con l'approvazione perché nel terminale è un gesto solo: si approva
 * *e* si sceglie come proseguire. Separarli lascerebbe una finestra in cui l'agent è
 * già ripartito con la modalità di prima — cioè `plan`, che non tocca niente.
 */
export type PlanAnswer =
  | { approved: true; mode?: PermissionMode }
  | { approved: false; feedback?: string }

/** Cosa STARK riporta indietro da una domanda dell'agent. */
export type QuestionAnswer =
  | { answers: Record<string, string | string[]>; response?: string }
  | null   // l'utente ha chiuso la card senza rispondere

// ─── aprire una conversazione ───────────────────────────────────────────────

/** Cosa serve per aprire una conversazione. Nessun campo qui nomina un agent. */
export type SessionSpec = {
  cwd: string
  model: string
  mode: PermissionMode
  /** Riprendere una conversazione esistente. `ref` è opaco: lo interpreta l'adapter. */
  resume?: { ref: string; fork?: boolean }
  /** Imporre l'id invece di scoprirlo: così STARK sa come risvegliare già in partenza. */
  sessionId?: string
  /**
   * I server MCP che questa conversazione vuole accesi, per nome. Tutti gli altri
   * vengono spenti prima del primo turno. Omesso vuol dire **nessuno**, che è il
   * default di STARK: gli strumenti esterni si accendono quando servono, non si
   * subiscono perché stanno sulla macchina.
   */
  mcp?: string[]
  /**
   * Su cosa l'utente vuole essere interrogato — **categorie, non nomi di tool**.
   * Sei parole che un utente riconosce guardando cosa sta per succedere; a tradurle
   * nei venti nomi che quell'agent usa è l'adapter, che è l'unico a conoscerli.
   */
  ask?: PermissionCategory[]
  /**
   * Il profilo: dove vivono credenziali e conversazioni di quell'agent. Su Claude Code
   * è una `CLAUDE_CONFIG_DIR`; su un altro agent sarà un'altra cosa — l'indirizzo di
   * un server, un file di configurazione. Qui è una stringa **opaca**, e opaca deve
   * restare: chi la interpreta è l'adapter.
   */
  profile?: string
  /** Quale eseguibile guidare. Si punta altrove dal default solo con una ragione. */
  executable?: string
}

/**
 * Come l'adapter parla al resto del sistema.
 *
 * Le tre callback bloccanti possono restare pendenti **all'infinito**, ed è voluto:
 * una richiesta resta appesa finché l'utente non risponde. È il motivo per cui la UI
 * deve mostrare `awaiting` in modo inequivocabile — lì non succede più niente.
 */
export type AdapterHooks = {
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
  /**
   * Chiamata quando l'agent ha finito di pianificare e chiede di partire.
   *
   * **Non** è un permesso e non deve diventarne una card: un permesso si concede
   * guardando un soggetto, un piano si approva leggendolo. Su Claude Code passa dalla
   * stessa porta dei permessi, ma quello è un dettaglio di quell'agent.
   */
  onPlan?: (r: { requestId: string; plan: string; path?: string }) => Promise<PlanAnswer>
}

/**
 * I due selettori che quasi ogni agent ha, nella forma generale.
 *
 * Vive qui e non in un adapter perche' `'mode'` e `'model'` sono **convenzioni del
 * modello** (le usano l'elenco delle chat e le notifiche per sapere quei due valori
 * senza aprire una conversazione), e perche' due adapter che li costruissero ciascuno
 * per conto proprio finirebbero per chiamarli in due modi diversi a schermo.
 *
 * Non e' un obbligo: un agent che non ha modalita' passa `modes: []` e il selettore non
 * compare. E' la differenza fra «non ce l'ha» e «ce l'ha vuoto».
 */
export function optionsFrom(
  a: { mode?: PermissionMode; modes?: ModeChoice[]; model?: string; models?: ModelChoice[] },
): SessionOption[] {
  const out: SessionOption[] = []
  if (a.modes?.length) {
    out.push({
      id: 'mode', label: 'Permissions', kind: 'mode', value: a.mode ?? '',
      choices: a.modes.map(m => ({
        value: m.mode,
        ...(m.label ? { label: m.label } : {}),
        available: m.available,
        ...(m.reason ? { reason: m.reason } : {}),
        ...(m.note ? { note: m.note } : {}),
      })),
    })
  }
  if (a.models?.length) {
    out.push({
      id: 'model', label: 'Model', kind: 'model', value: a.model ?? '',
      choices: a.models.map(m => ({
        value: m.id,
        ...(m.label ? { label: m.label } : {}),
        available: true,
        // `note` e non `reason`: la scelta si puo' fare, e' un avviso. La differenza
        // conta — su un agent senza classificatore quell'avviso non ha senso e questo
        // campo semplicemente non si popola.
        ...(m.autoMode ? {} : { note: 'No auto mode' }),
      })),
    })
  }
  return out
}

// ─── la conversazione viva ──────────────────────────────────────────────────

/**
 * Una conversazione in corso con un agent. Tutto ciò che il daemon può chiederle.
 *
 * `prompt` torna **subito** l'id del turno che ha aperto e non aspetta la risposta:
 * i prompt fanno la fila (FIFO), e chi manda il secondo mentre il primo lavora deve
 * vedere il proprio turno comparire adesso, non a fine lavoro.
 */
export interface AgentSession {
  start(): Promise<void>
  prompt(text: string, images?: PromptImage[]): string
  interrupt(): Promise<void>
  /**
   * Cambia una delle scelte che l'agent ha dichiarato (ADR-014).
   *
   * E' il verbo generale: `setModel` e `setMode` restano perche' del codice interno li
   * usa per nome — l'approvazione di un piano sceglie **una modalita'**, non «l'opzione
   * con id mode» — ma la UI passa sempre di qui, e un agent che dichiarasse un terzo
   * selettore (il livello di ragionamento, quale agent e' attivo) non richiederebbe
   * una riga di codice nel browser.
   */
  setOption(id: string, value: string): Promise<void>
  setModel(model: string): Promise<void>
  setMode(mode: PermissionMode): Promise<void>
  setMcp(server: string, enabled: boolean): Promise<void>
  /** Rileggi il livello della quota **del piano**: non si deduce dai token spesi. */
  refreshQuota(): Promise<void>
  /** Rileggi quanto è pieno il contesto, chiedendolo invece di ricalcolarlo. */
  refreshContext(): Promise<void>
  /** I file che quell'agent suggerisce per una citazione con `@`. */
  fileSuggestions(query: string): Promise<string[]>
  /** Aspetta che non ci sia più niente in volo. Serve alle prove, non alla UI. */
  settled(): Promise<void>
  sleep(): Promise<void>
  close(): Promise<void>
}

// ─── l'agent nel suo insieme ────────────────────────────────────────────────

/** Una conversazione nata **fuori** da STARK, nel terminale di quell'agent. */
export type ConversationInfo = {
  sessionId: string
  /** Il titolo scritto dal modello, o quello messo a mano. */
  title: string
  /** La prima frase scritta dall'utente. È **questa** che fa dire «ah, è quella». */
  firstPrompt?: string
  cwd?: string
  branch?: string
  lastModified: number
  sizeBytes?: number
  /** Esiste ed è leggibile: senza, l'import non ha da dove partire. */
  path?: string
}

export type ImportedEvent = { payload: Payload; ts: number }

export type ImportStats = {
  righe: number
  saltate: Record<string, number>
  turni: number
  parti: number
  cwd?: string
  model?: string
}

/**
 * L'esito di una richiesta che tocca un file **dell'utente**, fuori da `~/.stark`.
 * Si dice sempre dove si e' scritto e se si e' cambiato qualcosa: e' roba sua, non
 * nostra, e una modifica silenziosa a casa d'altri non e' accettabile.
 */
export type MemoryOutcome = {
  path: string
  presente: boolean
  cambiato: boolean
  /** Perche' non si e' potuto fare (permessi, disco pieno): detto, non ingoiato. */
  error?: string
}

/**
 * L'agent nel suo insieme: aprire una conversazione, e le cose che si sanno di lui
 * senza averne una aperta.
 *
 * I tre metodi dopo `open` sono **opzionali**, e opzionale non vuol dire «facoltativo
 * per pigrizia»: vuol dire che quell'agent quel fatto non ce l'ha. Un agent senza un
 * terminale proprio non ha conversazioni da importare, e fingere che ne abbia zero
 * sarebbe diverso dal dire che la domanda non si pone. È la stessa distinzione di
 * `Capabilities` (§12), applicata all'agent invece che alla sessione.
 */
export interface AgentBackend {
  /** Il nome che finisce in `session.created.agent`. */
  readonly id: string
  open(spec: SessionSpec, hooks: AdapterHooks): AgentSession
  /**
   * C'e', su questa macchina?
   *
   * Non e' una capacita' della sessione ma dell'**installazione**: Claude Code arriva
   * con l'SDK, OpenCode e' un binario che puo' non esserci. Senza questa domanda la UI
   * offrirebbe una voce che fallisce al clic — e il Principio 5 dice che cio' che non
   * si puo' fare va mostrato **spento con la spiegazione**, non nascosto e nemmeno
   * offerto per finta. Chi non la implementa c'e' sempre.
   */
  available?(): Promise<boolean>
  /**
   * Quali modalita' ha questo agent, **senza aprire una conversazione**.
   *
   * Serve alle impostazioni: «New chats start in…» deve poter offrire le voci giuste
   * prima che esista una sessione. Fino ad ADR-014 quella schermata mostrava `auto` e
   * `default` scritte a mano nel browser — due parole di Claude Code, che su un altro
   * agent non vogliono dire niente.
   *
   * E' una domanda che non deve costare: chi la implementa risponde con cio' che sa a
   * priori, non avviando un processo per riempire una tendina.
   */
  modes?(): Promise<ModeChoice[]>
  /** Le conversazioni nate nel terminale di quell'agent, da poter importare. */
  listConversations?(profile?: string, limit?: number): Promise<ConversationInfo[]>
  /** Da quanto una conversazione dev'essere ferma perché *non* sia in corso altrove. */
  isRecent?(info: ConversationInfo, now?: number): boolean
  importConversation?(path: string): { events: ImportedEvent[]; stats: ImportStats }
  /** Cosa dire nel pannello di diagnostica: versioni, eseguibile, profili. */
  diagnostics?(profile?: string): Promise<unknown>
  /** Prepara in anticipo ciò che la diagnostica costa: si chiama all'avvio. */
  warmDiagnostics?(): void
  /**
   * Chiedi all'agent di scrivere una `description` quando lancia un comando.
   *
   * È una capacità opzionale perché la risposta a «come si ottiene» non è la stessa
   * per due agent, e per Claude Code non è nemmeno un'opzione: quel campo lo scrive il
   * **modello**, quindi l'unico modo di chiederglielo è una regola nel suo `CLAUDE.md`
   * globale. Conseguenza dichiarata nel pannello, non scoperta dopo: vale anche fuori
   * da STARK, nel terminale. Un agent che avesse un interruttore vero lo userebbe, e
   * uno che non ha il concetto semplicemente non implementa questo metodo.
   */
  setCommandDescriptions?(profile: string | undefined, on: boolean): MemoryOutcome
}
