// Il registro delle sessioni: ciclo di vita, journal, e chi sta guardando.
//
// Regola che governa tutto il file: **prima il disco, poi la UI**. Ogni evento passa
// dal journal e solo dopo raggiunge chi è collegato. Se si invertisse, un browser che
// si riaggancia dopo una caduta vedrebbe una storia diversa da quella su disco, e
// l'invariante del §4 smetterebbe di valere senza che nessuno se ne accorga.

import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { backendFor, DEFAULT_AGENT, agentIds, etichettaDi } from '../adapters/index.ts'
import type {
  AgentBackend, AgentSession, ConversationInfo, PermissionAnswer, PlanAnswer, QuestionAnswer,
} from '../core/adapter.ts'
import { activity, type Activity } from '../core/activity.ts'
import { Journal, MemoryJournal, RawLog, type EventSink } from '../core/journal.ts'
import { applyTo, reduce, type SessionSnapshot } from '../core/reduce.ts'
import { promptText } from '../core/events.ts'
import { DA_ESTENSIONE, ESTENSIONE } from '../core/allegati.ts'
import { countSnapshot, MINIMO, searchSnapshot, type SessionMatches } from '../core/search.ts'
import { statsFrom, type Periodo, type Stats } from '../core/stats.ts'
import { askCategories, readSettings, writeSettings, type Settings } from './settings.ts'
import type {
  AgentQuestion, Attachment, CanonicalEvent, Command, Payload, PermissionCategory, PermissionMode,
  PromptPart,
} from '../core/events.ts'

export type OpenSpec = {
  cwd: string
  model?: string
  mode?: PermissionMode
  resume?: { ref: string; fork?: boolean }
  /** Riprendere l'ultima conversazione di `cwd` (`--continue`). Vedi core/adapter.ts. */
  continue?: boolean
  /**
   * Su cosa chiedere conferma: **categorie**, non nomi di tool. Fino ad ADR-012 questo
   * campo era `askTools: string[]` e portava `Bash` e `mcp__*` — vocabolario di Claude
   * Code — fin quassù, con il registro che chiamava `askToolsFor()` per tradurlo. Ora
   * a tradurre è l'adapter, che è l'unico a conoscere quei nomi.
   */
  ask?: PermissionCategory[]
  /**
   * Cosa questa chat **non puo' fare**, categorie canoniche. Passa dritto all'adapter,
   * che le rende impossibili: qui non si interpreta, si inoltra.
   */
  deny?: PermissionCategory[]
  /**
   * Non lasciare niente su disco: le righe restano in memoria e muoiono col daemon.
   *
   * Non e' un ramo che salta il journal — e' lo **stesso** percorso con un deposito
   * diverso (`MemoryJournal`). Vale l'invariante del §4 come per tutte le altre, ed e'
   * cio' che permette alla UI di disegnarla con lo stesso riduttore.
   */
  ephemeral?: boolean
  /** I server MCP da accendere. Omesso: quelli che questa conversazione aveva già. */
  mcp?: string[]
  /**
   * Valori di opzioni extra (reasoning, effort) imposti da chi apre. Omesso: il
   * registro li rilegge dallo snapshot del journal — stessa ragione di `model`.
   */
  extraOptions?: Record<string, string>
  /**
   * Il profilo da usare — per Claude Code una `CLAUDE_CONFIG_DIR` diversa da quella di
   * default del daemon, per un altro agent qualcos'altro. Da qui in su è una stringa
   * **opaca**: si passa, non si interpreta. Omesso: resta quello di default.
   * Ogni sessione spawna il suo processo (ADR-009), quindi due chat con profili diversi
   * non si toccano: non serve che il daemon ne tenga «aperto uno solo».
   */
  profile?: string
  /** Con quale agent. Omesso: quello di default. */
  agent?: string
}

export type SessionRow = {
  id: string
  /** Il primo prompt dell'utente, che è come si riconosce una conversazione. Il titolo
   *  scritto dal modello si somiglia sempre; la prima frase scritta da te no. */
  title: string
  state: string
  /**
   * Chi la guida. Serve a `wake()` lato UI: senza, il risveglio non sa a chi
   * appartiene la chat e riapre col backend di **default** (Claude Code), qualunque
   * fosse l'agent vero — bug segnalato dall'utente il 29 agosto 2026 («reopen di una
   * chat OpenCode risponde sempre 500»). Assente su un journal scritto prima che
   * `session.created` portasse `agent` (§16.10): quelle righe restano senza, che è
   * comunque corretto — a quel tempo Claude Code era l'unico agent.
   */
  agent?: string
  cwd?: string
  model?: string
  turns: number
  lastSeq: number
  lastTs: number
  /**
   * Da quando sta in questo stato. Diverso da `lastTs`, che dice quando ha scritto
   * l'ultima riga: è la differenza fra «lavora da due minuti» e «è ferma da quattro»,
   * e `ui-schermate.md` §1 la mette fra le cose che fanno decidere se entrare.
   */
  since: number
  /**
   * Cosa sta facendo **adesso**. C'è solo se dietro c'è un processo: su una sessione
   * senza, l'ultimo turno del journal è rimasto aperto a metà e ripeterlo direbbe che
   * sta girando qualcosa che non gira — la bugia peggiore, perché è quella su cui si
   * aspetta.
   */
  doing?: Activity
  live: boolean
  /**
   * Il semaforo della quota, **solo quando non è verde**.
   *
   * Sta sulla riga e non solo dentro la chat perché la quota non è della
   * conversazione: è del piano. Quando finisce si fermano tutte le chat di quel
   * profilo insieme, e l'unico posto da cui si può dire *prima* di entrare in una di
   * esse è l'elenco. Assente vuol dire «passa», che è il caso normale: un avviso che
   * c'è sempre non è un avviso.
   */
  quota?: { status: string; kind: string; resetsAt: number; usingOverage: boolean }
}

/** Una conversazione della CLI come la vede la UI, con ciò che il registro sa in più. */
export type ImportableRow = ConversationInfo & {
  /** Quale agent ha quella conversazione: con due backend, la riga lo dice. */
  agent: string
  /** Come si chiama a schermo: la UI non conosce i nomi degli agent (§1). */
  agentLabel: string
  /** È già dentro STARK: importarla di nuovo non aggiungerebbe niente. */
  already: boolean
  /** Scritta da poco: **forse** è aperta in un terminale proprio adesso. */
  recent: boolean
}

type Pending =
  | { kind: 'permission'; resolve: (a: PermissionAnswer) => void }
  | { kind: 'question'; resolve: (a: QuestionAnswer) => void }
  | { kind: 'plan'; resolve: (a: PlanAnswer) => void }

type Live = {
  id: string
  adapter: AgentSession
  journal: EventSink
  /** Non sta su disco: va tenuta fuori da elenco, ricerca e notifiche. */
  ephemeral: boolean
  snapshot: SessionSnapshot
  watchers: Set<(e: CanonicalEvent) => void>
  pending: Map<string, Pending>
}

/** Quanto pesa una conversazione: il journal, il file grezzo e i suoi allegati. */
function peso(id: string): number {
  let n = 0
  for (const f of [`${id}.jsonl`, `${id}.raw.jsonl`]) {
    try { n += statSync(resolve(SESSIONS, f)).size } catch { /* può non esserci */ }
  }
  const dir = resolve(ALLEGATI, id)
  try {
    for (const f of readdirSync(dir)) n += statSync(resolve(dir, f)).size
  } catch { /* nessun allegato */ }
  return n
}

/** §16.3: nell'MVP il prompt è testo semplice, quindi basta concatenare le parti. */
function titleOf(s: SessionSnapshot): string {
  // Un titolo scelto a mano vince sempre: da quel momento STARK smette di riscriverlo.
  if (s.title) return s.title
  const text = promptText(s.turns[0]?.prompt ?? []).trim().replace(/\s+/g, ' ')
  // In inglese perché è testo di interfaccia, non di documentazione: finisce nella
  // barra laterale accanto a «done» e «working».
  if (!text) return `new chat ${s.sessionId.slice(0, 8)}`
  return text.length > 64 ? `${text.slice(0, 63)}…` : text
}

/**
 * Lo stato di una sessione che **non ha un processo dietro**.
 *
 * Un journal che finisce a metà di un turno senza `session.slept` è una sessione che
 * il daemon stava seguendo quando è stato fermato. Ripeterne l'ultimo stato scritto la
 * lascerebbe in *Working* per sempre, e l'interfaccia direbbe che qualcosa sta girando
 * mentre non gira niente — la bugia peggiore, perché è quella su cui si aspetta.
 * Dormiente invece è uno stato vero e va rispettato: è stato scelto.
 */
function settled(state: string): string {
  return state === 'busy' || state === 'starting' || state === 'awaiting' ? 'closed' : state
}

export const STARK_HOME = process.env['STARK_HOME'] ?? resolve(homedir(), '.stark')
const SESSIONS = resolve(STARK_HOME, 'sessioni')
const ALLEGATI = resolve(STARK_HOME, 'allegati')

/** Un allegato già scritto su disco: `data` serve ancora, per mandarlo all'agent. */
export type AllegatoSalvato = {
  ref: string
  mediaType: string
  bytes: number
  name?: string
  data: string
}

/**
 * Quale conversazione del CLI riprendere. È una funzione a parte, ed esportata, perché
 * è l'unico pezzo di `open()` che si può provare **senza** aprire una sessione vera:
 * la regola è una scelta fra due stringhe, e sbagliarla non si vede finché qualcuno non
 * fa un `/clear` prima di uno Sleep (vedi il commento in `open()`).
 *
 * `spec.resume.ref` è l'id STARK, cioè il nome del journal. `resumeRef` è quello che il
 * CLI ha dichiarato per ultimo nel suo `system:init`: coincidono sempre, tranne dopo un
 * reset del contesto. Vince il secondo, quando c'è.
 */
export const refDaRiprendere = (
  resume: { ref: string; fork?: boolean } | undefined,
  resumeRef: string | undefined,
): { ref: string; fork?: boolean } | undefined =>
  resume && !resume.fork && resumeRef ? { ...resume, ref: resumeRef } : resume

/**
 * I valori delle opzioni extra che lo snapshot porta (`reasoning`, `effort`).
 * Solo quelle: un id che il registro non conosce non si inoltra — il campo è
 * della coppia adapter/riduttore, e passare tutto alla cieca sarebbe chiedere a
 * chi spawna di interpretare vocabolario che non è suo.
 */
export const opzioniDaSnapshot = (options: { id: string; value: string }[]):
  Record<string, string> => {
  const out: Record<string, string> = {}
  for (const o of options) {
    if (o.id === 'reasoning' || o.id === 'effort') out[o.id] = o.value
  }
  return out
}

export class Registry {
  private readonly live = new Map<string, Live>()
  /**
   * Chi guarda **l'elenco** invece di una sessione sola. Esistono perché il daemon
   * esponeva un flusso per sessione e nessuno globale, e la barra laterale non aveva
   * altro modo di sapere che *un'altra* chat era cambiata se non richiedere l'elenco
   * ogni tre secondi. Interrogare ripetutamente per sapere se è successo qualcosa è
   * esattamente ciò che SSE esiste per non fare.
   */
  private readonly all = new Set<() => void>()
  /**
   * Quanto si è già letto del journal di ogni conversazione **ferma**, e lo stato a
   * cui si era arrivati. Vedi `leggi()`: è la cache che toglie la rilettura integrale
   * di tutta la storia a ogni aggiornamento dell'elenco.
   */
  private readonly letti = new Map<string, { offset: number; snap: SessionSnapshot }>()
  private readonly defaults: { model: string; mode: PermissionMode; profile?: string }

  constructor(defaults: { model?: string; mode?: PermissionMode; profile?: string } = {}) {
    this.defaults = {
      // `'default'` non è un segnaposto: è un `value` vero nella lista che l'SDK
      // restituisce (`list_models`), e si risolve con la stessa logica di un modello
      // scelto per nome — legato all'account, non a STARK. Prima qui c'era
      // `'claude-sonnet-5'` cablato, e ogni chat nuova apriva su Sonnet anche per un
      // account il cui default nativo (verificato: la stessa CLI, `claude` senza
      // `--model`) è Opus. STARK non deve poter meno del CLI: il CLI lascia decidere
      // all'account quando non gli si dice nulla, quindi anche STARK deve farlo —
      // scegliere un modello fisso al posto dell'utente è la stessa cosa da cui
      // `--strict-mcp-config` era stato scartato per i server MCP.
      model: defaults.model ?? 'default',
      mode: defaults.mode ?? 'auto',
      ...(defaults.profile ? { profile: defaults.profile } : {}),
    }
  }

  // ─── impostazioni ─────────────────────────────────────────────────────────

  /** Le impostazioni di questa macchina. Si rileggono a ogni giro: sono un file, non
   *  uno stato, e chi le cambia può essere un altro browser. */
  settings(): Settings { return readSettings(STARK_HOME) }

  saveSettings(s: Settings): Settings { return writeSettings(STARK_HOME, s) }

  /**
   * Le sottocartelle di un percorso, per scegliere dove aprire una chat senza
   * doverlo ricordare a memoria. Il daemon ha già accesso a tutto il filesystem
   * (gira come root, ADR-002): la scelta non era «può farlo», era «c'era la
   * rotta». Percorso vuoto o illeggibile: si riparte dalla home, non da un errore.
   */
  browse(path?: string): { path: string; parent: string | null; dirs: string[]; error?: string } {
    const chiesto = path && path.trim() ? resolve(path.trim()) : homedir()
    const su = (p: string): string | null => { const d = dirname(p); return d === p ? null : d }
    try {
      const dirs = readdirSync(chiesto, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b))
      return { path: chiesto, parent: su(chiesto), dirs }
    } catch (e) {
      // Un percorso digitato a mano (o una cartella senza permessi) non deve rompere
      // il dialogo: si dice cos'è successo, e si resta dove si era.
      return { path: chiesto, parent: su(chiesto), dirs: [], error: String((e as Error).message ?? e) }
    }
  }

  /**
   * Quanto occupa ogni conversazione, e dove. È la domanda che ci si fa quando il
   * disco si riempie, e la risposta onesta comprende gli allegati: sono parte della
   * conversazione, e cancellandola se ne vanno con lei.
   */
  storage(): {
    home: string
    sessions: { id: string; title: string; cwd?: string; bytes: number }[]
    bytes: number
  } {
    const out: { id: string; title: string; cwd?: string; bytes: number }[] = []
    if (existsSync(SESSIONS)) {
      for (const f of readdirSync(SESSIONS)) {
        if (!f.endsWith('.jsonl') || f.endsWith('.raw.jsonl')) continue
        const id = f.replace(/\.jsonl$/, '')
        const s = this.live.get(id)?.snapshot ?? reduce(Journal.read(resolve(SESSIONS, f)), id)
        out.push({
          id, title: titleOf(s), bytes: peso(id),
          ...(s.cwd ? { cwd: s.cwd } : {}),
        })
      }
    }
    out.sort((a, b) => b.bytes - a.bytes)
    return { home: SESSIONS, sessions: out, bytes: out.reduce((n, x) => n + x.bytes, 0) }
  }

  /**
   * Con quale modalità parte una chat nuova.
   *
   * Tre gradini, e l'ordine conta (ADR-014). Chi apre con una modalità esplicita vince
   * sempre — è il caso delle prove e del risveglio. Poi la scelta dell'utente **per
   * quell'agent**. Poi, solo per l'agent di default, la vecchia preferenza unica, che
   * resta perché buttarla farebbe ripartire da `auto` chi aveva scelto `default` senza
   * dirglielo. E in fondo: **la prima modalità che l'agent dichiara di avere** — non
   * `auto`, che è una parola di Claude Code e su un altro agent non vuol dire niente.
   */
  private async modoDiPartenza(spec: OpenSpec): Promise<PermissionMode> {
    if (spec.mode) return spec.mode
    const agent = spec.agent ?? DEFAULT_AGENT
    const perAgent = this.settings().defaultModes?.[agent]
    if (perAgent) return perAgent
    if (agent === DEFAULT_AGENT && this.settings().defaultMode) return this.settings().defaultMode
    const suoi = await backendFor(agent).modes?.()
    return suoi?.find(m => m.available)?.mode ?? this.defaults.mode
  }

  async open(spec: OpenSpec): Promise<string> {
    // La cartella si controlla **qui**, non solo al confine HTTP.
    //
    // Ci stava già in `server.ts`, sulla rotta `POST /api/sessions`, e lì resta perché
    // è quella che sa rispondere `400` con un motivo leggibile. Ma un secondo chiamante
    // — un bot, una prova, un risveglio automatico — chiamerebbe questo metodo diretto
    // e salterebbe il controllo, riaprendo il bug delle chat fantasma: senza
    // `session.created` il journal resta un file di tre righe che l'elenco mostra come
    // «chat senza cartella / stopped». Un invariante non si difende chiedendo a ogni
    // chiamante di ricordarsene.
    if (!isDir(spec.cwd)) throw new Error(`la cartella non esiste: ${spec.cwd}`)
    // Riprendere una conversazione riusa il suo id, così il journal continua invece di
    // biforcarsi. Un fork invece è una sessione nuova, e deve avere un journal nuovo.
    const id = spec.resume && !spec.resume.fork ? spec.resume.ref : randomUUID()
    if (this.live.has(id)) return id

    // L'unica differenza fra una chat vera e una effimera e' **dove finiscono le
    // righe**. Tutto il resto di questa funzione non sa quale delle due sta aprendo, ed
    // e' voluto: due rami separati diventerebbero due comportamenti diversi al primo
    // caso al bordo che si aggiunge solo a uno dei due.
    const effimera = spec.ephemeral === true
    const journal: EventSink = effimera
      ? new MemoryJournal(id)
      : new Journal(resolve(SESSIONS, `${id}.jsonl`), id)
    // Il raw nativo e' materiale di diagnosi di una conversazione che si potra'
    // riguardare: di una che non esistera' piu' non c'e' niente da diagnosticare, e
    // scriverlo sarebbe l'unica traccia lasciata da una chat che ha promesso di non
    // lasciarne.
    const raw = effimera ? null : new RawLog(resolve(SESSIONS, `${id}.raw.jsonl`))
    const snapshot = effimera ? reduce([], id) : reduce(Journal.read(journal.path), id)
    const pending = new Map<string, Pending>()
    const watchers = new Set<(e: CanonicalEvent) => void>()
    const startFrom = journal.lastSeq

    const entry: Live = { id, adapter: null as never, journal, ephemeral: effimera, snapshot, watchers, pending }

    // Risvegliare deve restituire la chat com'era, strumenti compresi: una sessione
    // che si riaddormenta senza i suoi server MCP si risveglia sembrando rotta, e
    // l'utente non ha modo di collegare la cosa allo Sleep. Lo dice il journal.
    const mcp = spec.mcp ?? snapshot.mcpServers.filter(s => s.enabled).map(s => s.name)
    // Le categorie escono da qui **come categorie**: a farne nomi di tool è l'adapter.
    const ask = spec.ask ?? askCategories(this.settings())
    // Stessa ragione, stesso posto: il modello è quanto di più "com'era" ci sia. Prima
    // di questo il risveglio non lo guardava, e ogni Sleep smontava silenziosamente la
    // scelta di modello per quella chat — una sessione spostata su Opus si svegliava su
    // Sonnet, senza che niente lo dicesse, perché `snapshot.model` è vuoto solo su una
    // chat che non è mai partita: qui sotto è già popolato da `session.created`.
    const model = spec.model ?? snapshot.model ?? this.defaults.model
    // Le scelte nuove (reasoning, effort) tornano com'erano, stessa ragione di
    // `model` e `mcp`: il CLI non le conserva fra un risveglio e l'altro — su
    // Claude Code sono del layer flag, che non si persiste — e a ripristinarle è
    // chi rilegge il journal, cioè qui. Solo se lo snapshot le porta: su un journal
    // scritto prima non c'è niente, e i default valgono.
    const extra = spec.extraOptions ?? opzioniDaSnapshot(snapshot.options)

    // Terzo campo che il risveglio deve restituire com'era, e il più subdolo dei tre:
    // **quale conversazione** riprendere. `spec.resume.ref` fa due mestieri — dà il
    // nome al journal (qui sopra, `id`) e dice al CLI da dove ripartire — e di norma i
    // due coincidono, perché all'apertura STARK passa il proprio id come `sessionId`.
    // Un `/clear` li fa divergere: il CLI **sposta la conversazione su un id nuovo**, e
    // lo dichiara nel `system:init` che segue (→ `session.resumeRef`). Riprendere il
    // vecchio id riapre la conversazione di **prima** del taglio, cioè riporta indietro
    // il contesto che l'utente aveva appena buttato via — misurato su una chat vera:
    // 129.387 token prima del `/clear`, 57.748 dopo, e di nuovo **129.387** al
    // risveglio. Il journal sapeva la risposta e nessuno gliela chiedeva.
    //
    // Solo per un risveglio vero: su un `fork` lo snapshot letto qui sopra è quello del
    // journal **nuovo**, cioè vuoto, e `resumeRef` non c'è — la conversazione da cui si
    // biforca è un'altra domanda, e la si lascia dov'è.
    const resume = refDaRiprendere(spec.resume, snapshot.resumeRef)

    const adapter = backendFor(spec.agent ?? DEFAULT_AGENT).open({
      cwd: spec.cwd,
      model,
      ...(Object.keys(extra).length ? { extraOptions: extra } : {}),
      // La modalità di partenza è un'**impostazione**, non un valore cablato: era
      // l'unica differenza strutturale fra STARK e la CLI nuda (che parte in `default`,
      // misurato) e non c'era modo di toccarla. Chi apre una chat con una modalità
      // esplicita vince comunque — è il caso delle prove, e del risveglio.
      mode: await this.modoDiPartenza(spec),
      // Il profilo è una scelta **per progetto** (§ settings.ts), non del daemon: se
      // questa apertura lo dice, vince lui. Altrimenti resta quello con cui il daemon
      // è partito, come sempre.
      ...((spec.profile ?? this.defaults.profile) ? { profile: spec.profile ?? this.defaults.profile } : {}),
      ...(resume ? { resume }
        : spec.continue ? { continue: true }
        : { sessionId: id }),
      // Chi apre con categorie esplicite sa cosa sta facendo (le prove lo fanno);
      // tutti gli altri prendono la tabella, che è il pannello dei permessi.
      ...(ask.length ? { ask } : {}),
      // I divieti non hanno una tabella e non ereditano niente dalle impostazioni: li
      // chiede chi apre, e sono per **questa** chat. L'unico a chiederli oggi e'
      // l'helper, che non ha dove mostrare una card di permesso.
      ...(spec.deny?.length ? { deny: spec.deny } : {}),
      ...(mcp.length ? { mcp } : {}),
      // Come si chiama, detto da noi. Serve a spegnere la generazione automatica del
      // titolo dell'agent, che e' una chiamata al modello per rispondere a una domanda
      // a cui `titleOf` risponde gia' gratis. Si passa **sempre**, anche il segnaposto
      // di una chat appena nata: il campo conta solo alla nascita — su un risveglio il
      // titolo persistito vince comunque — ed e' esattamente alla nascita che quella
      // chiamata sarebbe partita.
      title: titleOf(snapshot),
      ...(effimera ? { ephemeral: true } : {}),
    }, {
      // Su una effimera non si passa proprio: senza `onRaw` l'adapter non serializza
      // in JSON ogni messaggio nativo per poi buttarlo via.
      ...(raw ? { onRaw: (m: unknown) => raw.write(JSON.stringify(m)) } : {}),
      onPayload: p => {
        const e = journal.append(p)      // prima il disco
        applyTo(snapshot, e)
        for (const w of watchers) w(e)   // poi chi guarda
        this.bump()                      // e infine chi guarda l'elenco
      },
      // Una richiesta resta appesa finché l'utente non risponde, e va bene così: la
      // callback può restare pendente all'infinito. È il motivo per cui la UI deve
      // mostrare `awaiting` in modo inequivocabile — lì non succede più niente.
      onPermission: r => new Promise<PermissionAnswer>(res => {
        pending.set(r.requestId, { kind: 'permission', resolve: res })
      }),
      onQuestion: r => new Promise<QuestionAnswer>(res => {
        pending.set(r.requestId, { kind: 'question', resolve: res })
      }),
      onPlan: r => new Promise<PlanAnswer>(res => {
        pending.set(r.requestId, { kind: 'plan', resolve: res })
      }),
    })
    entry.adapter = adapter
    this.live.set(id, entry)

    try {
      await adapter.start()
      if (spec.resume) {
        const e = journal.append({ k: 'session.woke', resumedFromSeq: startFrom })
        applyTo(snapshot, e)
        for (const w of watchers) w(e)
      }
    } catch (err) {
      this.live.delete(id)
      // Il ciclo dei messaggi può essere già partito, e quando finisce scrive
      // `session.state: closed`. Chiudendo il journal adesso, quella scrittura
      // troverebbe un file chiuso e l'eccezione — che nessuno sta aspettando, perché
      // il ciclo gira per conto suo — porterebbe giù **il daemon intero**: una cartella
      // che non esiste basterebbe a spegnere tutte le altre conversazioni. Prima lo si
      // fa finire, poi si chiude.
      try { await adapter.close() } catch { /* stava già morendo */ }
      journal.close()

      // Un'apertura fallita non deve lasciare una conversazione che non è mai
      // esistita. `session.created` è l'unico evento che porta il `cwd`: se non è mai
      // arrivato, il journal contiene tre righe (`starting`, `error`, `closed`) e
      // nient'altro — nessun prompt, nessuna risposta, nessuna cartella. L'elenco lo
      // mostrava lo stesso, come una chat «no folder / stopped» comparsa dal nulla,
      // che l'utente non poteva collegare a niente di suo.
      //
      // Le due condizioni sono **entrambe** necessarie, e la seconda è quella che
      // evita un disastro: `startFrom === 0` vuol dire che prima di questa apertura il
      // journal era vuoto. Su un **risveglio** fallito l'id è quello della
      // conversazione vera e il file contiene tutta la sua storia: cancellarlo perché
      // la ripresa non è partita distruggerebbe esattamente ciò che si stava cercando
      // di riaprire.
      // Su una effimera non c'e' nessun file da togliere: la memoria se n'e' gia'
      // andata con `journal.close()`, e `journal.path` e' la stringa vuota — passarla
      // a `rmSync` sarebbe una cancellazione su un percorso che non e' un percorso.
      const maiNata = !effimera && startFrom === 0 && !snapshot.cwd
      if (maiNata) {
        // Il motivo non si perde: va nel log del daemon **prima** di togliere il file,
        // che era l'unico posto in cui l'errore restava scritto.
        console.error(`apertura fallita, journal rimosso (${id}): ${String((err as Error)?.message ?? err)}`)
        rmSync(journal.path, { force: true })
        rmSync(resolve(SESSIONS, `${id}.raw.jsonl`), { force: true })
      }

      this.bump()
      throw err
    }
    this.bump()
    return id
  }

  /**
   * Chi guarda l'elenco. Non riceve gli eventi ma un colpetto: «qualcosa è cambiato,
   * richiedi le righe». Mandare le righe da qui vorrebbe dire ricalcolarle una volta
   * per ciascuno, e a ogni delta di testo — il flusso di una sola conversazione ne
   * produce decine al secondo.
   */
  watchAll(onChange: () => void): () => void {
    this.all.add(onChange)
    return () => { this.all.delete(onChange) }
  }

  private bump(): void {
    for (const w of this.all) w()
  }

  /**
   * Lo stato di una conversazione **senza processo**, leggendo del suo journal solo
   * ciò che non era già stato letto.
   *
   * Il journal è append-only (§13), e questa è la prima volta che quella invariante
   * viene usata invece che solo rispettata: se il file è cresciuto di tre righe, lo
   * stato di prima più quelle tre righe **è** lo stato di adesso — `reduce` non è
   * altro che `applyTo` ripetuto su uno snapshot vuoto, quindi continuare da uno
   * snapshot già fatto dà lo stesso identico oggetto.
   *
   * Prima si rileggeva tutto a ogni giro, e «ogni giro» sono fino a quattro volte al
   * secondo mentre una chat streama: misurato, 82 ms per un journal da 12 MB, **per
   * ciascuna** conversazione ferma. Con dieci conversazioni di quella taglia il
   * daemon passava più tempo a rileggere la storia che a servire il presente, e
   * `readFileSync` + `JSON.parse` sono sincroni: a fermarsi era tutto, SSE compreso.
   */
  private leggi(id: string, path: string): SessionSnapshot {
    const prima = this.letti.get(id)
    const { events, offset, from } = Journal.readFrom(path, prima?.offset ?? 0)
    // `from` diverso da dove eravamo rimasti vuol dire che `readFrom` è ripartito da
    // capo: il file si è accorciato, cioè non è più lo stesso file. Continuare uno
    // snapshot vecchio sopra una storia nuova darebbe uno stato che non è mai esistito.
    const snap = prima && from === prima.offset
      ? prima.snap
      : reduce([], id)
    for (const e of events) applyTo(snap, e)
    this.letti.set(id, { offset, snap })
    return snap
  }

  list(): SessionRow[] {
    const rows = new Map<string, SessionRow>()
    if (existsSync(SESSIONS)) {
      const visti = new Set<string>()
      for (const f of readdirSync(SESSIONS)) {
        if (!f.endsWith('.jsonl') || f.endsWith('.raw.jsonl')) continue
        const id = f.replace(/\.jsonl$/, '')
        visti.add(id)
        // La riga di una sessione viva la scrive il processo, qui sotto, e sovrascrive
        // comunque questa. Rileggerne il journal era lavoro buttato — e per giunta
        // proprio quello della chat più grande e più spesso ricalcolata, perché è
        // quella che sta streamando ed è la ragione per cui `list()` viene richiamata.
        if (this.live.has(id)) continue
        const s = this.leggi(id, resolve(SESSIONS, f))
        const state = settled(s.state)
        rows.set(id, {
          id, title: titleOf(s), state, turns: s.turns.length,
          lastSeq: s.lastSeq, lastTs: s.lastTs,
          // Senza questo, `wake()` non sa a chi appartiene la chat e la riapre col
          // backend di default — bug segnalato dall'utente il 29 agosto 2026:
          // «reopen su OpenCode risponde 500». Riprodotto: senza `agent` il registro
          // apriva Claude Code con `--resume ses_...`, e il CLI lo rifiutava perché
          // non è un UUID. Assente su un journal scritto prima che l'evento
          // `session.created` portasse `agent` (§16.10): quelle righe restano
          // «Claude Code», che era l'unico agent quando sono nate.
          ...(s.agent ? { agent: s.agent } : {}),
          // Quando `settled` ha corretto lo stato, `stateSince` conta da quando era
          // diventata `busy`: direbbe «ferma da due minuti» di una che è ferma da ieri.
          // Il momento vero in cui si è fermata è quando il journal ha smesso di crescere.
          since: state === s.state ? s.stateSince : s.lastTs,
          live: false,
          ...(s.cwd ? { cwd: s.cwd } : {}), ...(s.model ? { model: s.model } : {}),
          // Anche sulle righe lette dal journal, non solo su quelle vive: dopo un
          // riavvio del daemon le chat fermate dalla quota sono esattamente quelle
          // che non hanno più un processo, cioè proprio quelle che sparirebbero
          // dall'avviso se lo si legasse alle vive. Che il limite sia nel frattempo
          // ripartito lo decide chi guarda l'orologio, cioè la UI: qui si riporta
          // l'ultima cosa vera che il journal sa.
          ...(s.quota && s.quota.status !== 'allowed' ? { quota: s.quota } : {}),
          ...(s.agent ? { agent: s.agent } : {}),
        })
      }
      // Una conversazione cancellata non deve restare in memoria per sempre: la
      // cache tiene uno snapshot intero per riga, cioè tutta la sua storia.
      for (const id of this.letti.keys()) if (!visti.has(id)) this.letti.delete(id)
    }
    for (const [id, l] of this.live) {
      // L'helper (§17) non compare: non e' un lavoro, e' una domanda al volo. Basta
      // questa riga perche' resti fuori anche dalle **notifiche** e dal bot Telegram,
      // che guardano l'elenco e non le vive — se no il telefono suonerebbe ogni volta
      // che l'helper finisce di rispondere.
      if (l.ephemeral) continue
      const s = l.snapshot
      const doing = activity(s)
      rows.set(id, {
        id, title: titleOf(s), state: s.state,
        turns: s.turns.length,
        lastSeq: s.lastSeq, lastTs: s.lastTs, since: s.stateSince, live: true,
        ...(doing ? { doing } : {}),
        ...(s.quota && s.quota.status !== 'allowed' ? { quota: s.quota } : {}),
        ...(s.cwd ? { cwd: s.cwd } : {}),
        ...(s.model ? { model: s.model } : {}),
        ...(s.agent ? { agent: s.agent } : {}),
      })
    }
    return [...rows.values()]
  }

  /**
   * Cercare in tutte le conversazioni.
   *
   * Non è una rotta che scandisce il disco: passa dagli stessi snapshot che tiene
   * l'elenco (`leggi()`), quindi su una macchina già accesa una ricerca non rilegge
   * **niente**. È anche il motivo per cui trova ciò che la UI mostra e non ciò che sta
   * scritto su disco: una risposta arrivata in trecento `text.delta` nel journal non
   * esiste come frase intera in nessuna riga, e cercarla lì non la troverebbe mai.
   *
   * Due caratteri di soglia: con uno solo il risultato è «tutte», che non è una
   * risposta — e costerebbe un ritaglio per ogni turno di ogni chat per dirlo.
   */
  /**
   * Lo stato di **tutte** le conversazioni, senza rileggere niente di già letto.
   *
   * Sta in un metodo suo perché a chiederlo sono in due — la ricerca e le statistiche
   * — e le tre regole qui sotto vanno decise una volta sola. Con due copie basterebbe
   * che una dimenticasse di saltare gli effimeri perché le due schermate dicessero
   * cose diverse sulla stessa macchina.
   */
  private tuttiGliSnapshot(): Map<string, SessionSnapshot> {
    const snapshots = new Map<string, SessionSnapshot>()
    if (existsSync(SESSIONS)) {
      for (const f of readdirSync(SESSIONS)) {
        if (!f.endsWith('.jsonl') || f.endsWith('.raw.jsonl')) continue
        const id = f.replace(/\.jsonl$/, '')
        if (this.live.has(id)) continue
        snapshots.set(id, this.leggi(id, resolve(SESSIONS, f)))
      }
    }
    // Le vive dopo: il loro snapshot in memoria è più avanti di qualunque cosa il
    // disco possa dire, perché il journal lo scrive lo stesso oggetto.
    for (const [id, l] of this.live) {
      // Fuori anche da qui: un risultato che porta a una conversazione che non esiste
      // piu' e' peggio di nessun risultato — e l'helper non e' li' per essere ritrovato.
      if (l.ephemeral) continue
      snapshots.set(id, l.snapshot)
    }
    return snapshots
  }

  /**
   * Quanto è stato usato STARK. La regola sta in `core/stats.ts`: qui c'è solo da
   * dove arrivano gli snapshot. Nessuna scrittura, nessun evento, niente nel journal
   * — è una lettura, e per questo è retroattiva su tutto lo storico.
   */
  stats(p: Periodo): Stats {
    return statsFrom(this.tuttiGliSnapshot().values(), p)
  }

  search(query: string, limit = 5): SessionMatches[] {
    const q = query.trim()
    if (q.length < MINIMO) return []
    const out: SessionMatches[] = []
    for (const [id, snap] of this.tuttiGliSnapshot()) {
      const matches = searchSnapshot(snap, q, limit)
      if (matches.length === 0) continue
      out.push({
        sessionId: id, title: titleOf(snap), total: countSnapshot(snap, q), matches,
        ...(snap.cwd ? { cwd: snap.cwd } : {}),
      })
    }
    // Per corrispondenza più recente, non per numero: chi cerca sta ritrovando
    // qualcosa, e «quante volte l'ho detto» non aiuta a decidere quale aprire.
    return out.sort((a, b) => (b.matches[0]?.ts ?? 0) - (a.matches[0]?.ts ?? 0))
  }

  // ─── conversazioni nate nel terminale ─────────────────────────────────────

  /**
   * Cosa c'è da importare. `already` e `recent` sono le due cose che l'elenco
   * dell'SDK non sa e che cambiano cosa si fa: la prima evita di reimportare, la
   * seconda è l'avviso sulla presa in carico.
   */
  async importable(): Promise<ImportableRow[]> {
    // Gli agent che sanno elencare conversazioni nate fuori da STARK ormai sono
    // due, e l'elenco è uno: chi importa cerca «quella di ieri», non «quelle di
    // un agent prima e quelle dell'altro poi». Prima del secondo adapter qui
    // c'era un `backendFor()` solo, e non si vedeva che era una scelta.
    const now = Date.now()
    const out: ImportableRow[] = []
    for (const id of agentIds()) {
      const b = backendFor(id)
      // Un agent senza un terminale proprio non ha conversazioni da importare, e non è
      // la stessa cosa che averne zero: la domanda non si pone (§12).
      if (!b.listConversations) continue
      const found = (await b.listConversations(this.defaults.profile)) ?? []
      for (const t of found) {
        out.push({
          ...t,
          agent: b.id,
          agentLabel: etichettaDi(b.id),
          already: existsSync(resolve(SESSIONS, `${t.sessionId}.jsonl`)),
          recent: b.isRecent?.(t, now) ?? false,
        })
      }
    }
    return out.sort((a, b) => b.lastModified - a.lastModified)
  }

  /**
   * Porta dentro una conversazione della CLI, riusandone l'id.
   *
   * L'id è lo stesso di Claude Code di proposito: è anche il manico con cui la si
   * risveglia, quindi importare e poter riprendere sono la stessa cosa fatta una volta.
   * Un journal già presente non si tocca — reimportare sopra raddoppierebbe la storia.
   */
  async importSession(sessionId: string):
    Promise<{ ok: true; id: string; profile?: string } | { ok: false; error: string }> {
    // Quale agent possiede questa conversazione non lo dice l'id: lo si chiede a
    // chi sa cercarlo. Il primo che la trova vince — gli id sono mondi separati
    // (uuid di Claude Code, `ses_…` di OpenCode), quindi non c'è gara vera.
    let chi: {
      b: AgentBackend
      importa: NonNullable<AgentBackend['importConversation']>
      ref: string
      profile?: string
    } | undefined
    for (const id of agentIds()) {
      const b = backendFor(id)
      const importa = b.importConversation
      if (!b.locateConversation || !importa) continue
      const qui = b.locateConversation(sessionId, this.defaults.profile)
      if (qui) { chi = { b, importa, ref: qui.ref, ...(qui.profile ? { profile: qui.profile } : {}) }; break }
    }

    const dest = resolve(SESSIONS, `${sessionId}.jsonl`)
    const journal = new Journal(dest, sessionId)
    if (journal.lastSeq > 0) {
      journal.close()
      return { ok: false, error: 'already imported' }
    }

    if (!chi) {
      // Nessun residuo: il journal appena creato e mai scritto se ne va, se no
      // resterebbe una chat senza `cwd` in mezzo a quelle vere — stessa disciplina
      // di `open()`, e stessa ragione.
      journal.close()
      rmSync(dest, { force: true })
      return { ok: false, error: 'transcript not found on this machine' }
    }

    try {
      const { events } = chi.importa(chi.ref)
      // `session.resumeRef` per primo: senza, il journal saprebbe dire cosa è successo
      // ma non come tornarci, e la conversazione importata resterebbe da guardare e
      // basta. L'ora è quella del primo fatto, non di adesso: una conversazione di due
      // giorni fa mostrata tutta con l'orario corrente è sbagliata in modo silenzioso.
      journal.append({ k: 'session.resumeRef', ref: sessionId }, events[0]?.ts ?? Date.now())
      for (const { payload, ts } of events) journal.append(payload, ts)
    } finally {
      journal.close()
    }
    this.bump()
    return { ok: true, id: sessionId, ...(chi.profile ? { profile: chi.profile } : {}) }
  }

  // ─── allegati ─────────────────────────────────────────────────────────────

  /**
   * Scrive gli allegati su disco e li restituisce col loro riferimento.
   *
   * Il nome del file è lo **sha256 dei byte**: la stessa immagine mandata due volte
   * occupa un posto solo, e il nome non può contenere niente che arrivi da fuori —
   * niente percorsi, niente estensioni scelte da chi carica. La cartella è per
   * sessione, così cancellare una conversazione porta via anche i suoi allegati
   * invece di lasciarli in giro senza che nessuno sappia più di chi erano.
   */
  saveAttachments(id: string, list: Attachment[] = []): AllegatoSalvato[] {
    const out: AllegatoSalvato[] = []
    for (const a of list) {
      const ext = ESTENSIONE[a.mediaType]
      // Un tipo che STARK non sa scrivere su disco non si salva e non si manda. Il
      // filtro vero — cosa accetta *questo modello* — sta prima, nella casella di
      // scrittura, che è l'unico posto che sa quale modello è in uso; questa è la
      // difesa del confine, e vale contro chi la casella non la usa affatto.
      if (!ext) continue
      const bytes = Buffer.from(a.data, 'base64')
      const ref = createHash('sha256').update(bytes).digest('hex')
      const dir = resolve(ALLEGATI, id)
      mkdirSync(dir, { recursive: true })
      const path = resolve(dir, `${ref}.${ext}`)
      if (!existsSync(path)) writeFileSync(path, bytes)
      out.push({
        ref, mediaType: a.mediaType, bytes: bytes.length, data: a.data,
        ...(a.name ? { name: a.name } : {}),
      })
    }
    return out
  }

  /**
   * Un allegato da rileggere. `ref` arriva da un indirizzo, quindi si ricontrolla
   * qui che sia solo esadecimale: un `..` in mezzo trasformerebbe questa funzione in
   * un modo di leggere qualunque file della macchina.
   */
  attachment(id: string, ref: string): { path: string; mediaType: string } | null {
    if (!/^[0-9a-f]{64}$/.test(ref)) return null
    const dir = resolve(ALLEGATI, id)
    if (!existsSync(dir)) return null
    const file = readdirSync(dir).find(f => f.startsWith(`${ref}.`))
    if (!file) return null
    const ext = file.slice(ref.length + 1)
    const mediaType = DA_ESTENSIONE[ext]
    if (!mediaType) return null
    return { path: resolve(dir, file), mediaType }
  }

  /** Rilettura dal journal: è la stessa cosa che fa un risveglio. */
  /** C'e' un processo dietro questa conversazione adesso? Chi vuole farle scrivere
   *  qualcosa deve saperlo prima di chiederglielo: su una dormiente non c'e' nessuno
   *  che ascolti, e il comando andrebbe perso invece di fallire. */
  isLive(id: string): boolean { return this.live.has(id) }

  events(id: string, from = 0): CanonicalEvent[] {
    // Una effimera non ha un file da rileggere: la coda ce l'ha in memoria, e la
    // domanda e' la stessa — «cosa mi sono perso da `from` in poi». Senza questa
    // riga un flusso caduto e riagganciato tornerebbe vuoto, cioe' la conversazione
    // sparirebbe dallo schermo pur essendo ancora viva.
    const l = this.live.get(id)
    if (l?.ephemeral) return (l.journal as MemoryJournal).from(from)
    const path = resolve(SESSIONS, `${id}.jsonl`)
    return Journal.read(path).filter(e => e.seq > from)
  }

  snapshot(id: string): SessionSnapshot | null {
    const l = this.live.get(id)
    if (l) return l.snapshot
    const path = resolve(SESSIONS, `${id}.jsonl`)
    return existsSync(path) ? reduce(Journal.read(path), id) : null
  }

  /**
   * Quali di questi percorsi **esistono davvero**, relativamente alla cartella della chat.
   *
   * Serve a rendere cliccabile un percorso citato nel testo di una risposta, e nasce da
   * una decisione **rovesciata**: il 26 agosto si era scelto di non farlo, e la ragione
   * scritta allora resta giusta — «riconoscere un percorso in Markdown non fidato è un
   * problema diverso, e più fragile». Una regola tipografica infatti non distingue
   * `and/or` da una cartella, e sbaglia anche al contrario: `core/reduce.ts` *sembra* un
   * percorso e non esiste (è `src/core/reduce.ts`), e un bottone «apri» che non apre
   * niente è peggio di nessun bottone.
   *
   * La cura non è una regola migliore: è **non indovinare**. Chi chiama fa una rosa di
   * candidati con una regola grossolana, e a decidere è il disco. Un percorso o c'è o non
   * c'è — smette di essere un giudizio e diventa un fatto, che è la stessa mossa già
   * fatta per `file_suggestions` (a cercare è il CLI, noi mostriamo).
   *
   * Funziona anche su una chat che **dorme**, a differenza di `fileSuggestions`: qui non
   * serve un CLI dietro, serve solo sapere da dove partire, e quello lo dice il journal.
   *
   * Due limiti che non sono prudenza ma misura: al massimo 200 candidati per domanda e
   * 512 caratteri l'uno. Senza, questa diventerebbe «prova mille percorsi in una
   * richiesta», che è un altro attrezzo — e lo diventerebbe in silenzio.
   */
  pathsThatExist(id: string, paths: string[]): string[] {
    const cwd = this.snapshot(id)?.cwd
    if (!cwd) return []
    const out: string[] = []
    for (const p of paths.slice(0, 200)) {
      if (typeof p !== 'string' || !p || p.length > 512) continue
      // `resolve` normalizza anche i `..`: un percorso che esce dalla cartella della
      // chat non viene nascosto — esiste o non esiste come qualunque altro — ma il
      // confronto avviene sul percorso vero, non su quello scritto.
      const assoluto = p.startsWith('/') ? p : resolve(cwd, p)
      try { if (existsSync(assoluto)) out.push(p) } catch { /* non esiste, ed è la risposta */ }
    }
    return out
  }

  /**
   * I file del progetto che somigliano a quello che si sta scrivendo dopo una `@`.
   *
   * Passa dall'adapter perché è il CLI a rispondere, ed è **il CLI a sapere quale
   * cartella è**: il client manda solo l'id della chat e quello che hai digitato, mai
   * un percorso. Non è pignoleria — una rotta che accettasse un percorso dal browser
   * sarebbe «elenca qualunque cartella di questa macchina», che è un primitivo più
   * grosso di quello che serve, e comodo da usare per altro.
   *
   * Una chat che dorme non ha un CLI dietro a cui chiedere: si risponde con l'elenco
   * vuoto, e il menu non si apre. È lo stesso motivo per cui la casella lì non c'è.
   */
  async fileSuggestions(id: string, query: string): Promise<string[]> {
    return (await this.live.get(id)?.adapter.fileSuggestions(query)) ?? []
  }

  /**
   * Chi si collega riceve prima ciò che si è perso, poi il flusso. Il travaso avviene
   * senza cedere il controllo: se si aspettasse qualcosa in mezzo, un evento nuovo
   * potrebbe infilarsi fra la storia e il flusso e arrivare due volte, o mai.
   */
  subscribe(id: string, from: number, send: (e: CanonicalEvent) => void): () => void {
    for (const e of this.events(id, from)) send(e)
    const l = this.live.get(id)
    if (!l) return () => {}
    l.watchers.add(send)
    return () => { l.watchers.delete(send) }
  }

  /**
   * Rinominare non richiede un processo: si rinomina soprattutto una conversazione
   * che si è messa a dormire. Perciò scrive nel journal e basta — che è anche l'unico
   * modo perché il nome sopravviva, visto che per il §4 la UI non può mostrare niente
   * che non nasca da lì.
   */
  rename(id: string, title: string): { ok: true } | { ok: false; error: string } {
    const clean = title.trim().replace(/\s+/g, ' ').slice(0, 120)
    if (!clean) return { ok: false, error: 'empty title' }
    return this.annota(id, { k: 'session.renamed', title: clean })
  }

  /**
   * Scrive un fatto nel journal di una conversazione, viva o dormiente che sia.
   *
   * I due rami non sono un caso speciale: una sessione viva ha il journal **gia' aperto**
   * dal suo processo, e aprirne un secondo sullo stesso file vorrebbe dire due scrittori
   * con due idee del `seq`. Su una dormiente invece non c'e' nessuno, e si apre e si
   * chiude. La riga vale per il §4 come tutte le altre: la si applica allo snapshot e la
   * si manda a chi guarda, invece di aggiornare uno stato di lato che poi diverge.
   *
   * Era il corpo di `rename`, l'unico che ne aveva bisogno. Col passaggio di consegne i
   * chiamanti sono diventati due, e due copie di questo ballo sarebbero due modi di
   * sbagliarlo.
   */
  /**
   * L'utente ha risposto a una richiesta che nessuno può più esaudire.
   *
   * Succede quando il pezzo che l'aveva chiesta è sparito prima di ricevere risposta —
   * un riavvio del daemon a metà attesa, un turno chiuso d'ufficio dal guardiano — e
   * con lui la promessa che *qualcosa* avrebbe risolto quella `Promise` in sospeso.
   * `l.pending` non la conosce più (l'oggetto che la teneva non esiste), ma lo
   * snapshot sì: resta lì finché non arriva un evento che la chiude, per lo stesso §18
   * che tiene il resto della UI onesto. Prima questo caso restituiva solo un errore
   * («unknown request») e la card restava a schermo per sempre, senza nessun modo di
   * togliersela di torno — un permesso a cui non si può più rispondere né rifiutare.
   *
   * Qui si scrive il fatto: non risolve nulla dall'altra parte (non c'è più un'altra
   * parte ad ascoltare), ma libera la UI da una richiesta morta. `rifiuto` perché è il
   * verso sicuro — non si può concedere un permesso che nessuno controllerà mai.
   */
  private scartaOrfano(l: Live, requestId: string, rifiuto: Payload): boolean {
    const orfano = l.snapshot.pendingPermissions.some(x => x.requestId === requestId)
      || l.snapshot.pendingQuestions.some(x => x.requestId === requestId)
      || l.snapshot.pendingPlans.some(x => x.requestId === requestId)
    if (!orfano) return false
    const e = l.journal.append(rifiuto)
    applyTo(l.snapshot, e)
    for (const w of l.watchers) w(e)
    this.bump()
    return true
  }

  annota(id: string, p: Payload): { ok: true } | { ok: false; error: string } {
    const l = this.live.get(id)
    if (l) {
      const e = l.journal.append(p)
      applyTo(l.snapshot, e)
      for (const w of l.watchers) w(e)
    } else {
      const path = resolve(SESSIONS, `${id}.jsonl`)
      if (!existsSync(path)) return { ok: false, error: 'unknown' }
      const j = new Journal(path, id)
      j.append(p)
      j.close()
    }
    this.bump()
    return { ok: true }
  }

  /**
   * Cancellare una conversazione cancella il journal, cioè **tutta** la sua storia:
   * non c'è un cestino, e non è recuperabile. Se sta girando la si chiude prima,
   * altrimenti l'adapter continuerebbe a scrivere su un file che non esiste più.
   */
  /**
   * L'helper: una chat che non lascia niente, e ce n'e' **una sola** (§17).
   *
   * L'helper e' del **daemon**, non del browser: una volta aperto, sopravvive al
   * ricaricamento della pagina. Chi riapre il pannello dopo un reload si riaggancia
   * alla stessa sessione invece di pagare un nuovo handshake (l'«Avvio…») e di
   * lasciare un processo di troppo. E' il motivo per cui il reload non lo chiude:
   * il browser che se ne va non puo' avvisare in modo affidabile, ma non deve —
   * la sessione non e' sua. Muore solo col daemon, o col cestino del pannello
   * (`closeHelper`), ed e' quello il gesto che vuol dire «ho finito».
   *
   * Resta **una sola**: se una c'e' gia' viva, la richiesta di apertura la riusa.
   * Non e' una limitazione ma il modo in cui «chat sempre pronta» diventa un fatto:
   * nessun ciclo di vita da indovinare, nessun orfano che si accumula a ogni reload.
   */
  async openHelper(spec: Omit<OpenSpec, 'ephemeral'>): Promise<string> {
    const vivo = this.helperId && this.live.has(this.helperId)
      ? this.live.get(this.helperId)
      : null
    if (vivo) {
      // Riusala se non si chiede un agent diverso: la scelta del **modello** sullo
      // stesso agent non passa di qui (e' `session.setOption`), quindi il confronto
      // sull'agent basta a decidere se la conversazione puo' continuare.
      const richiesto = spec.agent
      const attuale = vivo.snapshot?.agent
      if (!richiesto || richiesto === attuale) return this.helperId as string
      await this.closeHelper()
    }
    const id = await this.open({ ...spec, ephemeral: true })
    this.helperId = id
    return id
  }

  /** Chiude quello vivo, se c'e'. Idempotente. */
  async closeHelper(): Promise<void> {
    const id = this.helperId
    this.helperId = null
    if (!id || !this.live.has(id)) return
    await this.command(id, { c: 'session.close' })
  }

  /** Qual e' l'helper vivo. `null` se nessuno lo ha ancora aperto. */
  get helper(): string | null {
    return this.helperId && this.live.has(this.helperId) ? this.helperId : null
  }

  private helperId: string | null = null

  async remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const path = resolve(SESSIONS, `${id}.jsonl`)
    const l = this.live.get(id)
    if (l) {
      try { await l.adapter.close() } catch { /* il processo è già andato */ }
      this.retire(id)
    }
    if (!existsSync(path)) return { ok: false, error: 'unknown' }
    rmSync(path, { force: true })
    rmSync(resolve(SESSIONS, `${id}.raw.jsonl`), { force: true })
    // Gli allegati sono parte della conversazione: restare senza di lei non ha senso.
    rmSync(resolve(ALLEGATI, id), { recursive: true, force: true })
    this.bump()
    return { ok: true }
  }

  async command(id: string, cmd: Command): Promise<{ ok: true } | { ok: false; error: string }> {
    // Prima del controllo su «è attiva?»: rinominare una conversazione che dorme è
    // il caso normale, non l'eccezione.
    if (cmd.c === 'session.rename') return this.rename(id, cmd.title)

    // Addormentare una chat **senza processo dietro** — importata dal terminale, o
    // rimasta ferma dopo un riavvio del daemon — è lo stesso sonno con una cosa in
    // meno: non c'è un processo da interrompere né da fermare. Il fatto che resta da
    // scrivere è uno solo, ed è lo stesso che gli adapter scrivono dormendo
    // (`session.slept`): lo stato diventa `sleeping`, la riga esce dal gruppo
    // Waiting, e il risveglio è lo stesso `resume` di sempre.
    if (cmd.c === 'session.sleep' && !this.live.has(id)) return this.dormiFerma(id)

    const l = this.live.get(id)
    if (!l) return { ok: false, error: 'session not active' }
    switch (cmd.c) {
      case 'session.prompt':
        // I byte finiscono su disco **prima** di partire: il journal scriverà il
        // riferimento, e senza il file quel riferimento non varrebbe niente.
        l.adapter.prompt(cmd.text, this.saveAttachments(id, cmd.attachments))
        return { ok: true }
      case 'session.interrupt':
        await l.adapter.interrupt()
        return { ok: true }
      case 'session.dequeue':
        // Togliere una voce dalla fila è un fatto dell'adapter: solo lui sa se quel
        // turno c'era ancora. `false` è un rifiuto detto — il turno era già partito,
        // o non è mai stato quello — non un successo da fingere.
        if (!l.adapter.dequeue(cmd.turnId)) return { ok: false, error: 'turn not in queue' }
        return { ok: true }
      // ADR-014: il verbo generale. Il daemon non sa cosa siano gli `id` — li ha
      // dichiarati l'agent — e li passa senza guardarli. `setModel`/`setMode` restano
      // per le sonde e per il codice interno che sceglie *una modalita'* per nome.
      case 'session.setOption':
        await l.adapter.setOption(cmd.id, cmd.value)
        return { ok: true }
      case 'session.setModel':
        await l.adapter.setModel(cmd.model)
        return { ok: true }
      case 'session.setMode':
        await l.adapter.setMode(cmd.mode)
        return { ok: true }
      case 'session.setMcp':
        await l.adapter.setMcp(cmd.server, cmd.enabled)
        return { ok: true }
      // Rileggere il livello della quota non tocca la conversazione: se il piano non
      // risponde, la risposta resta quella di prima e il pannellino lo dice.
      case 'session.refreshQuota':
        await l.adapter.refreshQuota()
        return { ok: true }
      case 'session.refreshContext':
        await l.adapter.refreshContext()
        return { ok: true }
      case 'session.sleep': {
        // Addormentarsi con un turno in corso perderebbe il lavoro in volo: si
        // interrompe prima, invece di rifiutare e lasciare l'utente senza una via.
        if (l.snapshot.state === 'busy') await l.adapter.interrupt()
        await l.adapter.sleep()
        this.retire(id)
        return { ok: true }
      }
      case 'session.close':
        await l.adapter.close()
        this.retire(id)
        return { ok: true }
      case 'permission.reply': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'permission') {
          const chiusa = this.scartaOrfano(l, cmd.requestId,
            { k: 'permission.replied', requestId: cmd.requestId, decision: 'reject' })
          return chiusa ? { ok: true } : { ok: false, error: 'unknown request' }
        }
        l.pending.delete(cmd.requestId)
        if (cmd.decision === 'reject') {
          p.resolve({ allow: false, reason: 'Negato dall\'utente' })
          return { ok: true }
        }
        // «Consenti sempre» deve consentire davvero anche la prossima volta: senza
        // questo passaggio il pulsante si comporterebbe come «Consenti», e l'evento
        // nel journal direbbe `always` — una bugia scritta su disco.
        //
        // Qui passa **il soggetto** da ricordare e nient'altro. Fino ad ADR-012 questo
        // ramo costruiva un `PermissionUpdate` dell'SDK Anthropic, con dentro
        // `destination: 'localSettings'`: il daemon decideva in quale file di Claude
        // Code finiva la regola (falla n.3). In che forma quella stringa diventi una
        // regola lo sa solo l'adapter.
        const scope = cmd.decision === 'always' ? cmd.scope : undefined
        p.resolve(scope ? { allow: true, remember: scope } : { allow: true })
        return { ok: true }
      }
      case 'question.reply': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'question') {
          const chiusa = this.scartaOrfano(l, cmd.requestId,
            { k: 'question.rejected', requestId: cmd.requestId })
          return chiusa ? { ok: true } : { ok: false, error: 'unknown question' }
        }
        l.pending.delete(cmd.requestId)
        p.resolve({ answers: cmd.answers, ...(cmd.response !== undefined ? { response: cmd.response } : {}) })
        return { ok: true }
      }
      case 'plan.reply': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'plan') {
          const chiusa = this.scartaOrfano(l, cmd.requestId,
            { k: 'plan.replied', requestId: cmd.requestId, decision: 'rejected' })
          return chiusa ? { ok: true } : { ok: false, error: 'unknown plan' }
        }
        l.pending.delete(cmd.requestId)
        p.resolve(cmd.decision === 'approved'
          ? { approved: true, ...(cmd.mode ? { mode: cmd.mode } : {}) }
          : { approved: false, ...(cmd.feedback ? { feedback: cmd.feedback } : {}) })
        return { ok: true }
      }
      case 'question.reject': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'question') {
          const chiusa = this.scartaOrfano(l, cmd.requestId,
            { k: 'question.rejected', requestId: cmd.requestId })
          return chiusa ? { ok: true } : { ok: false, error: 'unknown question' }
        }
        l.pending.delete(cmd.requestId)
        // `null` non è "nessuna risposta": è l'utente che ha chiuso la card, ed è una
        // risposta vera. L'agent la riceve come rifiuto e può cambiare strada.
        p.resolve(null)
        return { ok: true }
      }
      default:
        return { ok: false, error: `unknown command: ${cmd.c}` }
    }
  }

  pendingQuestions(id: string): { requestId: string; questions: AgentQuestion[] }[] {
    return this.live.get(id)?.snapshot.pendingQuestions ?? []
  }

  /**
   * Il sonno di una chat che **non ha un processo**: tutto il fatto è una riga nel
   * journal. Gli adapter, dormendo, scrivono esattamente questo evento — la sola
   * differenza è che loro possono anche fermare un processo, e qui non c'è.
   */
  private dormiFerma(id: string): { ok: true } | { ok: false; error: string } {
    const path = resolve(SESSIONS, `${id}.jsonl`)
    if (!existsSync(path)) return { ok: false, error: 'unknown session' }
    // Già dormiente: un secondo `session.slept` non direbbe nulla di nuovo, e il
    // journal non ha bisogno di due righe per lo stesso fatto.
    if (this.leggi(id, path).state === 'sleeping') return { ok: true }
    const j = new Journal(path, id)
    j.append({ k: 'session.slept' })
    j.close()
    this.bump()
    return { ok: true }
  }

  private retire(id: string): void {
    const l = this.live.get(id)
    if (!l) return
    l.journal.close()
    l.watchers.clear()
    this.live.delete(id)
    this.bump()
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.live.keys()].map(async id => {
      const l = this.live.get(id)
      if (!l) return
      try { await l.adapter.close() } catch { /* il processo è già andato */ }
      this.retire(id)
    }))
  }
}

/** La cartella c'è ed è una cartella. Un percorso che non si può leggere non lo è. */
export function isDir(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}
