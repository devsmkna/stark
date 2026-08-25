// Lo stato dell'applicazione.
//
// Una scelta che vale la pena spiegare: la UI non tiene un proprio modello. Tiene lo
// `SessionSnapshot` di `core/reduce.ts` e ci applica sopra gli eventi con lo stesso
// `applyTo` che usa il daemon. Così l'invariante del §4 — dal vivo uguale a rilettura —
// non è qualcosa che la UI deve ricordarsi di rispettare: è l'unica cosa che sa fare.
//
// La seconda regola, che vale da qui in giù: **i comandi partono solo da questo file**.
// Un componente che facesse una POST per conto suo dovrebbe anche decidere cosa fare
// del risultato, e §18 dice che del risultato non c'è niente da fare — ciò che accade
// torna dal flusso. Concentrarli qui rende quella regola visibile invece che sperata.

import { applyTo, type SessionSnapshot } from '$core/reduce.ts'
import type { Attachment, Command, PermissionMode } from '$core/events.ts'
import {
  Api, bootToken,
  type ImportableRow, type LinkStatus, type SessionRow, type Settings,
} from './api.ts'
import { Notifier, type Call } from './notify.svelte.ts'
import { fromPath, go } from './route.ts'
import { Themer } from './theme.svelte.ts'
import { Sizer } from './textsize.svelte.ts'
import { Fonter } from './fontfamily.svelte.ts'
import { activityText, project } from './view.ts'

/** Gli stati in cui una chat *stava lavorando*: solo da lì ha senso dire «ha finito». */
const WORKING = new Set(['busy', 'starting', 'awaiting'])

/**
 * Quale delle tre chiamate merita un passaggio di stato. Fermarsi da sola e fermarsi
 * perché gliel'hai detto tu portano allo stesso stato, e non si distinguono da qui:
 * a non gridarti in faccia mentre sei sulla chat ci pensa il filtro in `#ring`.
 */
function callFor(was: string, now: string): Call | null {
  if (now === 'awaiting') return 'needsYou'
  if (!WORKING.has(was)) return null
  // Aprire una chat la porta da `starting` a `idle` senza che nessuno abbia fatto
  // niente: chiamarti «ha finito» per una conversazione appena nata sarebbe la prima
  // notifica falsa, e una notifica falsa insegna a spegnerle tutte.
  if (now === 'idle') return was === 'starting' ? null : 'done'
  if (now === 'closed' || now === 'error') return 'stopped'
  return null
}

const HEAD: Record<Call, string> = {
  needsYou: 'Needs you', done: 'Done', stopped: 'Stopped',
}

/** Cosa occupa l'area grande: la conversazione, o gli effetti al suo posto. */
export type View = 'chat' | 'effects'

/** Il riquadro sopra l'app, quando ce n'è uno. L'app resta visibile dietro: creare
 *  una chat non è cambiare posto, è aggiungere una riga a un elenco che stai già
 *  guardando. */
export type Dialog =
  | { kind: 'new' }
  | { kind: 'delete'; row: SessionRow }
  | { kind: 'settings' }
  | null

/**
 * Le due porte per aggiungere un lavoro all'elenco: cominciarne uno nuovo, o portare
 * dentro una conversazione nata nel terminale. Stanno nello stesso riquadro, dietro a
 * due linguette, perché il `+` vuol dire «aggiungi una riga» in entrambi i casi — e
 * perché la seconda porta va **vista** per essere usata: chi non sa che esiste non la
 * cerca in una tendina.
 */
export type NewTab = 'new' | 'import'

/** Il menu del tasto destro su una riga dell'elenco. */
export type ContextMenu = { id: string; x: number; y: number } | null

export class Store {
  readonly api = new Api(bootToken())
  /** Come vieni chiamato quando guardi altrove. Vedi `notify.svelte.ts`. */
  readonly calls = new Notifier()
  /** Il tema, che è del dispositivo e non della macchina. Vedi `theme.svelte.ts`. */
  readonly theme = new Themer()
  /** La dimensione del testo, stesso motivo del tema. Vedi `textsize.svelte.ts`. */
  readonly textSize = new Sizer()
  /** La famiglia del font, stesso motivo. Vedi `fontfamily.svelte.ts`. */
  readonly font = new Fonter()

  /**
   * Le impostazioni della macchina. `null` finché non sono arrivate: prima di allora
   * non si sa niente, e inventare un default lato UI vorrebbe dire mostrare per un
   * istante una tabella dei permessi che non è quella vera.
   */
  settings = $state<Settings | null>(null)

  rows = $state<SessionRow[]>([])
  selected = $state<string | null>(null)
  snap = $state<SessionSnapshot | null>(null)
  link = $state<LinkStatus>('connecting')
  /** Il collegamento all'elenco, che è un flusso diverso da quello della chat aperta. */
  listLink = $state<LinkStatus>('connecting')
  fatal = $state<string | null>(null)
  loaded = $state(false)

  view = $state<View>('chat')

  /**
   * Gli effetti sono un **posto**, non un interruttore: stanno nell'indirizzo, e ci si
   * torna indietro col tasto del browser esattamente come con la freccia dentro l'app.
   * Due schermate, due voci nella storia — è la cosa che chi preme «indietro» si aspetta.
   */
  show(view: View): void {
    this.view = view
    go(this.selected, view)
  }
  dialog = $state<Dialog>(null)
  menu = $state<ContextMenu>(null)
  /** L'id della riga il cui titolo è diventato scrivibile. Rinominare non apre niente. */
  renaming = $state<string | null>(null)
  /** L'ultimo comando rifiutato. Non è un guasto: è il daemon che spiega perché no. */
  refused = $state<string | null>(null)
  /** Una riga sta partendo o si sta risvegliando: il pulsante non va premuto due volte. */
  working = $state(false)
  /**
   * Lo schermo è troppo stretto per l'affiancato. Sta qui e non dentro il componente
   * del confronto perché è una proprietà della finestra, non di un diff: due blocchi
   * aperti insieme installerebbero due ascoltatori che dicono la stessa cosa.
   */
  narrow = $state(false)

  tab = $state<NewTab>('new')
  importable = $state<ImportableRow[] | null>(null)
  importing = $state<string | null>(null)

  #stopStream: (() => void) | null = null
  #stopList: (() => void) | null = null
  /** Lo stato di ogni riga com'era l'ultima volta: è da qui che si vede il passaggio. */
  #was = new Map<string, string>()
  /** Il primo elenco è arrivato: da lì in poi l'indirizzo si può onorare. */
  #partita = false
  /** L'indietro del browser: si apre ciò che dice l'indirizzo, senza riscriverlo. */
  #popstate = (): void => { void this.#apriDaIndirizzo() }
  /** Il primo elenco non chiama nessuno: sono le chat che c'erano già, non novità. */
  #greeted = false

  get hasToken(): boolean { return this.api.hasToken }

  /** La riga dell'elenco che corrisponde alla chat aperta. */
  get row(): SessionRow | undefined {
    return this.rows.find(r => r.id === this.selected)
  }

  /**
   * Se dietro la chat aperta c'è un processo.
   *
   * Non è deducibile dallo snapshot, ed è la differenza che conta di più per chi
   * guarda: dopo un riavvio del daemon ogni conversazione è ferma su disco, e una
   * casella di scrittura che accettasse un messaggio lo perderebbe senza dirlo.
   */
  get live(): boolean { return this.row?.live ?? false }

  async start(): Promise<void> {
    // Il tasto «indietro» del browser deve tornare alla chat di prima, non uscire
    // dall'app: è l'unico gesto di navigazione che qui non abbiamo inventato noi.
    addEventListener('popstate', this.#popstate)
    // Servono subito: da qui nascono i colori dei progetti e il silenzio per progetto,
    // che si vedono nella barra laterale prima ancora che si apra una chat.
    void this.loadSettings()
    this.#stopList = this.api.sessionsStream(
      rows => {
        this.#ring(rows)
        this.rows = rows
        this.loaded = true
        this.fatal = null
        // Il primo elenco è anche il momento in cui si può aprire ciò che dice
        // l'indirizzo: prima non si saprebbe nemmeno se quella chat esiste.
        if (!this.#partita) { this.#partita = true; void this.#apriDaIndirizzo() }
      },
      s => {
        this.listLink = s
        // Un elenco che non arriva è l'unico guasto che vale la pena gridare: senza
        // di quello non c'è niente da guardare.
        if (s === 'lost') this.fatal = 'the daemon is not answering'
        else if (s === 'live') this.fatal = null
      },
    )
  }

  /**
   * Chi ti chiama, e perché.
   *
   * Si guarda **l'elenco**, non la chat aperta: il senso di tutto questo è sapere di
   * una conversazione che non stai guardando. Il flusso globale (`GET /api/stream`)
   * porta tutte le righe, quindi il dato c'è già e non costa niente in più.
   */
  #ring(rows: SessionRow[]): void {
    const was = this.#was
    this.#was = new Map(rows.map(r => [r.id, r.state]))
    if (!this.#greeted) { this.#greeted = true; return }
    for (const r of rows) {
      const before = was.get(r.id)
      if (before === undefined || before === r.state) continue
      const kind = callFor(before, r.state)
      if (!kind) continue
      // Se stai guardando proprio quella chat, il blocco in basso e il pallino l'hanno
      // già detto: chiamarti sarebbe gridare a qualcuno che è nella stanza.
      if (this.calls.zittoQui && this.selected === r.id && document.visibilityState === 'visible') continue
      // Un progetto silenziato tace tutto: serve quando ne ha uno lungo che non vuoi
      // sentire, e due corti che invece sì.
      if (this.project(r.cwd).muted) continue
      this.calls.call(kind, {
        title: `${HEAD[kind]} · ${project(r.cwd)}`,
        // Il titolo dice *quale* lavoro, l'operazione dice *cosa* voleva fare: senza la
        // seconda riga «Needs you» costringe comunque ad aprire per sapere cosa vuole.
        body: r.doing ? `${r.title}\n${activityText(r.doing)}` : r.title,
        tag: r.id,
        onClick: () => { void this.select(r.id) },
      })
    }
  }

  /**
   * Apre ciò che dice l'indirizzo. Non lo riscrive: è già quello giusto, e riscriverlo
   * dentro un `popstate` aggiungerebbe una voce alla storia mentre la si sta
   * ripercorrendo — cioè il tasto «indietro» smetterebbe di andare indietro.
   */
  async #apriDaIndirizzo(): Promise<void> {
    const r = fromPath()
    if (!r) {
      this.#stopStream?.()
      this.#stopStream = null
      this.selected = null
      this.snap = null
      return
    }
    if (!this.rows.some(x => x.id === r.id)) {
      // Un indirizzo che punta a una chat cancellata, o di un'altra macchina. Si dice,
      // e si resta all'elenco: meglio di una schermata che gira a vuoto.
      this.refused = 'that chat is not here anymore'
      go(null, 'chat', true)
      return
    }
    if (this.selected !== r.id) await this.select(r.id, { indirizzo: false })
    this.view = r.view
  }

  /** Apre una chat. `indirizzo: false` quando è l'indirizzo ad aver aperto lei. */
  async loadSettings(): Promise<void> {
    try {
      const { settings } = await this.api.settings()
      this.settings = settings
    } catch { /* il daemon dirà di suo che non risponde */ }
  }

  /**
   * Salva e **riprende ciò che è stato scritto davvero**: il daemon butta via quello
   * che non riconosce, e mostrare quello che speravi di aver impostato invece di quello
   * che è impostato è il modo in cui un pannello di opzioni comincia a mentire.
   */
  async saveSettings(next: Settings): Promise<void> {
    const prima = this.settings
    this.settings = next          // subito, perché un interruttore deve muoversi quando lo tocchi
    try {
      const { settings } = await this.api.saveSettings(next)
      this.settings = settings
    } catch (e) {
      this.settings = prima
      this.refused = (e as Error).message
    }
  }

  /** Il colore, il silenzio e il profilo Claude di un progetto, per cartella. */
  project(cwd: string | undefined): { colour?: number; muted?: boolean; profile?: string } {
    return (cwd ? this.settings?.projects[cwd] : undefined) ?? {}
  }

  async setProject(cwd: string, patch: { colour?: number; muted?: boolean; profile?: string }): Promise<void> {
    const s = this.settings
    if (!s) return
    await this.saveSettings({
      ...s,
      projects: { ...s.projects, [cwd]: { ...s.projects[cwd], ...patch } },
    })
  }

  async select(id: string, opts: { indirizzo?: boolean } = {}): Promise<void> {
    if (opts.indirizzo !== false) go(id, 'chat')
    if (this.selected === id) return
    this.#stopStream?.()
    this.selected = id
    this.snap = null
    this.view = 'chat'
    this.refused = null
    try {
      const { snapshot } = await this.api.snapshot(id)
      this.snap = snapshot
    } catch (e) {
      this.refused = (e as Error).message
      return
    }
    // `from` è letto a ogni tentativo, non fissato adesso: dopo una caduta il punto
    // giusto è avanzato, e ripartire da quello di prima rimanderebbe eventi già visti.
    this.#stopStream = this.api.stream(
      id,
      () => this.snap?.lastSeq ?? 0,
      e => { if (this.snap && e.sessionId === this.snap.sessionId) applyTo(this.snap, e) },
      s => { this.link = s },
    )
  }

  // ─── comandi ──────────────────────────────────────────────────────────────

  /**
   * §18: dopo un comando non si aggiorna niente a mano. Il turno nuovo arriva come
   * `turn.started` dal flusso e `applyTo` lo mette dov'è giusto. Se si toccasse lo
   * snapshot da qui, quell'effetto esisterebbe in un posto che il journal non conosce.
   */
  async send(cmd: Command, id = this.selected): Promise<boolean> {
    if (!id) return false
    this.refused = null
    const esito = await this.api.command(id, cmd)
    if (!esito.ok) this.refused = esito.error ?? 'refused'
    return esito.ok
  }

  /**
   * Un prompt può portarsi dietro delle immagini. Il testo vuoto va bene **se** c'è un
   * allegato: «guarda questo» spesso non ha bisogno di parole.
   */
  prompt(text: string, attachments: Attachment[] = []): Promise<boolean> {
    const clean = text.trim()
    if (!clean && attachments.length === 0) return Promise.resolve(false)
    return this.send({
      c: 'session.prompt', text: clean,
      ...(attachments.length ? { attachments } : {}),
    })
  }

  stop(): Promise<boolean> { return this.send({ c: 'session.interrupt' }) }
  sleep(id = this.selected): Promise<boolean> { return this.send({ c: 'session.sleep' }, id) }
  setMode(mode: PermissionMode): Promise<boolean> { return this.send({ c: 'session.setMode', mode }) }
  /** Accende o spegne un server MCP per questa chat. L'esito torna dal flusso (§18). */
  setMcp(server: string, enabled: boolean): Promise<boolean> {
    return this.send({ c: 'session.setMcp', server, enabled })
  }
  setModel(model: string): Promise<boolean> { return this.send({ c: 'session.setModel', model }) }

  async rename(id: string, title: string): Promise<void> {
    this.renaming = null
    if (title.trim()) await this.send({ c: 'session.rename', title }, id)
  }

  /**
   * L'elenco di cosa c'è da importare. Si richiede aprendo la linguetta e non
   * all'avvio: legge dei file da disco, e chi non importa mai non deve pagarlo.
   */
  async loadImportable(): Promise<void> {
    this.importable = null
    try {
      const { sessions } = await this.api.importable()
      this.importable = sessions
    } catch (e) {
      this.importable = []
      this.refused = (e as Error).message
    }
  }

  /** Porta dentro una conversazione della CLI e ci entra. */
  async importChat(sessionId: string): Promise<void> {
    this.importing = sessionId
    this.refused = null
    try {
      const esito = await this.api.doImport(sessionId)
      if (!esito.ok || !esito.id) { this.refused = esito.error ?? 'refused'; return }
      this.dialog = null
      await this.select(esito.id)
    } finally {
      this.importing = null
    }
  }

  /**
   * Apre una conversazione nuova e ci entra: creare una chat è aggiungere una riga.
   *
   * `profile` arriva da NewChat solo quando la macchina ha più di un `CLAUDE_CONFIG_DIR`
   * e la cartella è nuova per STARK (docs/ui-schermate.md §Projects): lo si salva subito
   * come fatto del progetto, così la prossima chat sulla stessa cartella lo eredita senza
   * chiederlo di nuovo — «il profilo è deciso» vuol dire deciso da qui in poi.
   */
  async newChat(cwd: string, opts: { model?: string; profile?: string } = {}): Promise<void> {
    this.working = true
    this.refused = null
    try {
      // `opts.profile` arriva solo dalla prima chat di un progetto (NewChat lo chiede
      // solo allora). Da quella successiva in poi non c'è più nulla da chiedere: il
      // profilo è già un fatto del progetto, e va riletto da qui — esattamente come fa
      // `wake()` — altrimenti la seconda chat parte senza `CLAUDE_CONFIG_DIR` e sembra
      // rotta senza motivo apparente (MCP e modelli del profilo giusto assenti).
      const profile = opts.profile ?? this.project(cwd).profile
      const { id } = await this.api.open({
        cwd,
        ...(opts.model ? { model: opts.model } : {}),
        ...(profile ? { configDir: profile } : {}),
      })
      if (opts.profile && this.project(cwd).profile !== opts.profile) {
        void this.setProject(cwd, { profile: opts.profile })
      }
      this.dialog = null
      await this.select(id)
    } catch (e) {
      this.refused = (e as Error).message
    } finally {
      this.working = false
    }
  }

  /**
   * Risvegliare NON è un comando: `POST /command` su una sessione senza processo
   * risponde «sessione non attiva». Si riapre con `resume`, che riusa l'id e fa
   * **continuare** il journal invece di biforcarlo.
   */
  async wake(row: SessionRow): Promise<void> {
    if (!row.cwd) { this.refused = 'this chat has no folder to reopen'; return }
    this.working = true
    this.refused = null
    try {
      // Il profilo è un fatto del progetto, non della singola apertura: risvegliare
      // con quello sbagliato è esattamente il modo in cui questa cosa si rompe senza
      // motivo apparente (nessuna conversazione da riprendere, forse nemmeno il login).
      const profile = this.project(row.cwd).profile
      await this.api.open({
        cwd: row.cwd, resume: { ref: row.id }, ...(profile ? { configDir: profile } : {}),
      })
      this.dialog = null
      // La chat era già aperta: si rilegge lo snapshot e si riaggancia il flusso.
      const id = row.id
      this.selected = null
      await this.select(id)
    } catch (e) {
      this.refused = (e as Error).message
    } finally {
      this.working = false
    }
  }

  async remove(id: string): Promise<void> {
    const esito = await this.api.remove(id)
    if (!esito.ok) { this.refused = esito.error ?? 'refused'; return }
    if (this.selected === id) {
      this.#stopStream?.()
      this.#stopStream = null
      this.selected = null
      this.snap = null
      // L'indirizzo puntava a una chat che non c'è più: lasciarcelo vorrebbe dire che
      // il prossimo ricaricamento apre un vicolo cieco.
      go(null, 'chat')
    }
  }

  dispose(): void {
    removeEventListener('popstate', this.#popstate)
    this.#stopStream?.()
    this.#stopList?.()
  }
}
