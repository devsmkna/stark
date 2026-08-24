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
import { Api, bootToken, type ImportableRow, type LinkStatus, type SessionRow } from './api.ts'
import { Notifier, type Call } from './notify.svelte.ts'
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
export type Dialog = { kind: 'new' } | { kind: 'delete'; row: SessionRow } | null

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

  rows = $state<SessionRow[]>([])
  selected = $state<string | null>(null)
  snap = $state<SessionSnapshot | null>(null)
  link = $state<LinkStatus>('connecting')
  /** Il collegamento all'elenco, che è un flusso diverso da quello della chat aperta. */
  listLink = $state<LinkStatus>('connecting')
  fatal = $state<string | null>(null)
  loaded = $state(false)

  view = $state<View>('chat')
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
    this.#stopList = this.api.sessionsStream(
      rows => { this.#ring(rows); this.rows = rows; this.loaded = true; this.fatal = null },
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
      if (this.selected === r.id && document.visibilityState === 'visible') continue
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

  async select(id: string): Promise<void> {
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

  /** Apre una conversazione nuova e ci entra: creare una chat è aggiungere una riga. */
  async newChat(cwd: string, model?: string): Promise<void> {
    this.working = true
    this.refused = null
    try {
      const { id } = await this.api.open({ cwd, ...(model ? { model } : {}) })
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
      await this.api.open({ cwd: row.cwd, resume: { ref: row.id } })
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
    }
  }

  dispose(): void {
    this.#stopStream?.()
    this.#stopList?.()
  }
}
