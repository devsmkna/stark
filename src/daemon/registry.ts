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
import { ClaudeCodeAdapter, type PermissionAnswer, type QuestionAnswer } from '../adapters/claude-code/adapter.ts'
import { isRecent, listTranscripts, type TranscriptInfo } from '../adapters/claude-code/catalogue.ts'
import { importTranscript } from '../adapters/claude-code/import.ts'
import { askToolsFor } from '../adapters/claude-code/permissions.ts'
import { activity, type Activity } from '../core/activity.ts'
import { Journal, RawLog } from '../core/journal.ts'
import { applyTo, reduce, type SessionSnapshot } from '../core/reduce.ts'
import { promptText } from '../core/events.ts'
import { askCategories, readSettings, writeSettings, type Settings } from './settings.ts'
import type { AgentQuestion, Attachment, CanonicalEvent, Command, PermissionMode, PromptPart } from '../core/events.ts'

export type OpenSpec = {
  cwd: string
  model?: string
  mode?: PermissionMode
  resume?: { ref: string; fork?: boolean }
  askTools?: string[]
  /** I server MCP da accendere. Omesso: quelli che questa conversazione aveva già. */
  mcp?: string[]
  /**
   * Il profilo Claude da usare — una `CLAUDE_CONFIG_DIR` diversa da quella di default
   * del daemon. Omesso: resta quella di default. Ogni sessione spawna il suo processo
   * (ADR-009), quindi due chat con profili diversi non si toccano: non serve che il
   * daemon ne tenga «aperto uno solo», serve solo passare il valore giusto qui.
   */
  configDir?: string
}

export type SessionRow = {
  id: string
  /** Il primo prompt dell'utente, che è come si riconosce una conversazione. Il titolo
   *  scritto dal modello si somiglia sempre; la prima frase scritta da te no. */
  title: string
  state: string
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
export type ImportableRow = TranscriptInfo & {
  /** È già dentro STARK: importarla di nuovo non aggiungerebbe niente. */
  already: boolean
  /** Scritta da poco: **forse** è aperta in un terminale proprio adesso. */
  recent: boolean
}

type Pending =
  | { kind: 'permission'; resolve: (a: PermissionAnswer) => void }
  | { kind: 'question'; resolve: (a: QuestionAnswer) => void }

type Live = {
  id: string
  adapter: ClaudeCodeAdapter
  journal: Journal
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

/** I quattro tipi che il modello accetta, e le estensioni con cui li scriviamo. */
const TIPI: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
}
/** Il contrario, per rispondere con l'intestazione giusta quando li si rilegge. */
const DA_ESTENSIONE: Record<string, string> = Object.fromEntries(
  Object.entries(TIPI).map(([mime, ext]) => [ext, mime]),
)

/** Un'immagine già scritta su disco: `data` serve ancora, per mandarla all'agent. */
export type ImmagineSalvata = {
  ref: string
  mediaType: string
  bytes: number
  name?: string
  data: string
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
  private readonly defaults: { model: string; mode: PermissionMode; configDir?: string }

  constructor(defaults: { model?: string; mode?: PermissionMode; configDir?: string } = {}) {
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
      ...(defaults.configDir ? { configDir: defaults.configDir } : {}),
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

  async open(spec: OpenSpec): Promise<string> {
    // Riprendere una conversazione riusa il suo id, così il journal continua invece di
    // biforcarsi. Un fork invece è una sessione nuova, e deve avere un journal nuovo.
    const id = spec.resume && !spec.resume.fork ? spec.resume.ref : randomUUID()
    if (this.live.has(id)) return id

    const journal = new Journal(resolve(SESSIONS, `${id}.jsonl`), id)
    const raw = new RawLog(resolve(SESSIONS, `${id}.raw.jsonl`))
    const snapshot = reduce(Journal.read(journal.path), id)
    const pending = new Map<string, Pending>()
    const watchers = new Set<(e: CanonicalEvent) => void>()
    const startFrom = journal.lastSeq

    const entry: Live = { id, adapter: null as never, journal, snapshot, watchers, pending }

    // Risvegliare deve restituire la chat com'era, strumenti compresi: una sessione
    // che si riaddormenta senza i suoi server MCP si risveglia sembrando rotta, e
    // l'utente non ha modo di collegare la cosa allo Sleep. Lo dice il journal.
    const mcp = spec.mcp ?? snapshot.mcpServers.filter(s => s.enabled).map(s => s.name)
    const ask = spec.askTools ?? askToolsFor(askCategories(this.settings()))
    // Stessa ragione, stesso posto: il modello è quanto di più "com'era" ci sia. Prima
    // di questo il risveglio non lo guardava, e ogni Sleep smontava silenziosamente la
    // scelta di modello per quella chat — una sessione spostata su Opus si svegliava su
    // Sonnet, senza che niente lo dicesse, perché `snapshot.model` è vuoto solo su una
    // chat che non è mai partita: qui sotto è già popolato da `session.created`.
    const model = spec.model ?? snapshot.model ?? this.defaults.model

    const adapter = new ClaudeCodeAdapter({
      cwd: spec.cwd,
      model,
      // La modalità di partenza è un'**impostazione**, non un valore cablato: era
      // l'unica differenza strutturale fra STARK e la CLI nuda (che parte in `default`,
      // misurato) e non c'era modo di toccarla. Chi apre una chat con una modalità
      // esplicita vince comunque — è il caso delle prove, e del risveglio.
      mode: spec.mode ?? this.settings().defaultMode ?? this.defaults.mode,
      // Il profilo è una scelta **per progetto** (§ settings.ts), non del daemon: se
      // questa apertura lo dice, vince lui. Altrimenti resta quello con cui il daemon
      // è partito, come sempre.
      ...((spec.configDir ?? this.defaults.configDir) ? { configDir: spec.configDir ?? this.defaults.configDir } : {}),
      ...(spec.resume ? { resume: spec.resume } : { sessionId: id }),
      // Le categorie su cui l'utente vuole essere interrogato diventano matcher per
      // l'hook. Chi apre con `askTools` espliciti sa cosa sta facendo (le prove lo
      // fanno); tutti gli altri prendono la tabella, che è il pannello dei permessi.
      ...(ask.length ? { askTools: ask } : {}),
      ...(mcp.length ? { mcp } : {}),
      onRaw: m => raw.write(JSON.stringify(m)),
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
      const maiNata = startFrom === 0 && !snapshot.cwd
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

  list(): SessionRow[] {
    const rows = new Map<string, SessionRow>()
    if (existsSync(SESSIONS)) {
      for (const f of readdirSync(SESSIONS)) {
        if (!f.endsWith('.jsonl') || f.endsWith('.raw.jsonl')) continue
        const id = f.replace(/\.jsonl$/, '')
        const s = reduce(Journal.read(resolve(SESSIONS, f)), id)
        const state = settled(s.state)
        rows.set(id, {
          id, title: titleOf(s), state, turns: s.turns.length,
          lastSeq: s.lastSeq, lastTs: s.lastTs,
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
        })
      }
    }
    for (const [id, l] of this.live) {
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
      })
    }
    return [...rows.values()]
  }

  // ─── conversazioni nate nel terminale ─────────────────────────────────────

  /**
   * Cosa c'è da importare. `already` e `recent` sono le due cose che l'elenco
   * dell'SDK non sa e che cambiano cosa si fa: la prima evita di reimportare, la
   * seconda è l'avviso sulla presa in carico.
   */
  async importable(): Promise<ImportableRow[]> {
    const found = await listTranscripts(this.defaults.configDir)
    const now = Date.now()
    return found.map(t => ({
      ...t,
      already: existsSync(resolve(SESSIONS, `${t.sessionId}.jsonl`)),
      recent: isRecent(t, now),
    }))
  }

  /**
   * Porta dentro una conversazione della CLI, riusandone l'id.
   *
   * L'id è lo stesso di Claude Code di proposito: è anche il manico con cui la si
   * risveglia, quindi importare e poter riprendere sono la stessa cosa fatta una volta.
   * Un journal già presente non si tocca — reimportare sopra raddoppierebbe la storia.
   */
  async importSession(sessionId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const found = (await listTranscripts(this.defaults.configDir))
      .find(t => t.sessionId === sessionId)
    if (!found?.path) return { ok: false, error: 'trascritto non trovato su questa macchina' }

    const dest = resolve(SESSIONS, `${sessionId}.jsonl`)
    const journal = new Journal(dest, sessionId)
    if (journal.lastSeq > 0) {
      journal.close()
      return { ok: false, error: 'già importata' }
    }
    try {
      const { events } = importTranscript(found.path)
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
    return { ok: true, id: sessionId }
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
  saveAttachments(id: string, list: Attachment[] = []): ImmagineSalvata[] {
    const out: ImmagineSalvata[] = []
    for (const a of list) {
      const ext = TIPI[a.mediaType]
      if (!ext) continue   // un tipo che il modello non accetta non si salva e non si manda
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
  events(id: string, from = 0): CanonicalEvent[] {
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
    if (!clean) return { ok: false, error: 'titolo vuoto' }
    const l = this.live.get(id)
    if (l) {
      const e = l.journal.append({ k: 'session.renamed', title: clean })
      applyTo(l.snapshot, e)
      for (const w of l.watchers) w(e)
    } else {
      const path = resolve(SESSIONS, `${id}.jsonl`)
      if (!existsSync(path)) return { ok: false, error: 'sconosciuta' }
      const j = new Journal(path, id)
      j.append({ k: 'session.renamed', title: clean })
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
  async remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const path = resolve(SESSIONS, `${id}.jsonl`)
    const l = this.live.get(id)
    if (l) {
      try { await l.adapter.close() } catch { /* il processo è già andato */ }
      this.retire(id)
    }
    if (!existsSync(path)) return { ok: false, error: 'sconosciuta' }
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

    const l = this.live.get(id)
    if (!l) return { ok: false, error: 'sessione non attiva' }
    switch (cmd.c) {
      case 'session.prompt':
        // I byte finiscono su disco **prima** di partire: il journal scriverà il
        // riferimento, e senza il file quel riferimento non varrebbe niente.
        l.adapter.prompt(cmd.text, this.saveAttachments(id, cmd.attachments))
        return { ok: true }
      case 'session.interrupt':
        await l.adapter.interrupt()
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
        if (p?.kind !== 'permission') return { ok: false, error: 'richiesta sconosciuta' }
        l.pending.delete(cmd.requestId)
        if (cmd.decision === 'reject') {
          p.resolve({ allow: false, reason: 'Negato dall\'utente' })
          return { ok: true }
        }
        // «Consenti sempre» deve consentire davvero anche la prossima volta, e la
        // regola la scrive l'SDK in .claude/settings.local.json (ADR-009). Senza
        // questo passaggio il pulsante si comporterebbe come «Consenti», e l'evento
        // nel journal direbbe `always`: una bugia scritta su disco.
        const scope = cmd.decision === 'always' ? cmd.scope : undefined
        p.resolve(scope
          ? {
              allow: true,
              remember: [{
                type: 'addRules',
                rules: [{ toolName: scope }],
                behavior: 'allow',
                destination: 'localSettings',
              }],
            }
          : { allow: true })
        return { ok: true }
      }
      case 'question.reply': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'question') return { ok: false, error: 'domanda sconosciuta' }
        l.pending.delete(cmd.requestId)
        p.resolve({ answers: cmd.answers, ...(cmd.response !== undefined ? { response: cmd.response } : {}) })
        return { ok: true }
      }
      case 'question.reject': {
        const p = l.pending.get(cmd.requestId)
        if (p?.kind !== 'question') return { ok: false, error: 'domanda sconosciuta' }
        l.pending.delete(cmd.requestId)
        // `null` non è "nessuna risposta": è l'utente che ha chiuso la card, ed è una
        // risposta vera. L'agent la riceve come rifiuto e può cambiare strada.
        p.resolve(null)
        return { ok: true }
      }
      default:
        return { ok: false, error: `comando non gestito: ${cmd.c}` }
    }
  }

  pendingQuestions(id: string): { requestId: string; questions: AgentQuestion[] }[] {
    return this.live.get(id)?.snapshot.pendingQuestions ?? []
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
