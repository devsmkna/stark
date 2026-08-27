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
  type ImportableRow, type LinkStatus, type Memoria, type SessionMatches,
  type SessionRow, type Settings,
} from './api.ts'
import { Notifier } from './notify.svelte.ts'
import { CALL_HEAD, callFor, type Call } from '$core/calls.ts'
import { PushPhone } from './push.svelte.ts'
import { fromPath, go } from './route.ts'
import { Themer } from './theme.svelte.ts'
import { Sizer } from './textsize.svelte.ts'
import { Fonter } from './fontfamily.svelte.ts'
import { activityText, project } from './view.ts'

// `callFor` e `CALL_HEAD` stavano qui, e da qui sono passati in `$core/calls.ts`: la
// stessa domanda ora se la pone anche il daemon, per mandare il push al telefono quando
// questa pagina non esiste più. Tenerne due copie avrebbe voluto dire che un giorno il
// telefono suona e il portatile no, e nessuno saprebbe quale dei due ha ragione.

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
  /** Come vieni chiamato quando STARK non è nemmeno aperto: le notifiche le manda il
   *  daemon, non la pagina. Vedi `push.svelte.ts` — è una cosa diversa da `calls`. */
  readonly push = new PushPhone(() => this.api.authHeaders)
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
  /**
   * Cosa si sta cercando. Sta qui e non dentro la barra laterale perché sopravvive al
   * cambio di schermata: su telefono la ricerca è nell'elenco, il risultato apre la
   * conversazione, e tornando indietro la ricerca deve essere ancora lì — se no la
   * seconda cosa da controllare va ridigitata.
   */
  query = $state('')
  /**
   * Il turno da portare in vista quando la conversazione si apre.
   *
   * È uno stato e non un parametro di `select()` perché chi lo consuma è un altro
   * componente, che deve poterlo vedere anche quando la chat era **già** quella
   * aperta — caso in cui `select()` esce subito e non passa di lì.
   */
  mostra = $state<string | null>(null)
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

  /**
   * Il daemon ci ha detto di no per davvero.
   *
   * Non è «non ho un token»: quella è una cosa diversa, e non basta a fermarsi, perché
   * il cookie autentica lo stesso (è il caso dell'app della schermata Home su iOS, che
   * ha una memoria separata da Safari). Si prova, e solo se il primo colpo torna 403 si
   * dice all'utente che gli serve l'indirizzo col token.
   */
  refusedAuth = $state(false)

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
    // Un colpo solo, prima di tutto, per sapere **se siamo autenticati**: il token in
    // memoria non è l'unica credenziale — c'è il cookie, e su iOS l'app della schermata
    // Home ha solo quello. Non si può dedurre dal token mancante, quindi si chiede.
    // `/api/health` è la rotta più economica che esista: risponde `{ok:true}` e basta.
    void fetch('/api/health', { headers: this.api.authHeaders })
      .then(r => { this.refusedAuth = r.status === 403 })
      // Una rete che non risponde non è un rifiuto: quello lo dice `fatal`, e mostrare
      // «No token» a chi ha solo il daemon spento manderebbe a cercare la cosa sbagliata.
      .catch(() => { this.refusedAuth = false })
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
        title: `${CALL_HEAD[kind]} · ${project(r.cwd)}`,
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
      const { settings, memoria } = await this.api.settings()
      this.settings = settings
      if (memoria) this.memoria = memoria
    } catch { /* il daemon dirà di suo che non risponde */ }
  }

  /**
   * Salva e **riprende ciò che è stato scritto davvero**: il daemon butta via quello
   * che non riconosce, e mostrare quello che speravi di aver impostato invece di quello
   * che è impostato è il modo in cui un pannello di opzioni comincia a mentire.
   */
  /** Dove sta il `CLAUDE.md` dell'agent, e se STARK è riuscito a scriverlo. Lo dice il
   *  daemon dopo un salvataggio: quale file sia non è deducibile dal browser. */
  memoria = $state<Memoria | null>(null)

  async saveSettings(next: Settings): Promise<void> {
    const prima = this.settings
    this.settings = next          // subito, perché un interruttore deve muoversi quando lo tocchi
    try {
      const { settings, memoria } = await this.api.saveSettings(next)
      this.settings = settings
      if (memoria) this.memoria = memoria
      // Un file di memoria che non si lascia scrivere non è un salvataggio fallito —
      // le impostazioni sono su disco — ma va detto, se no la spunta resterebbe accesa
      // sopra un file che non è cambiato.
      if (memoria?.error) this.refused = `Settings saved, but ${memoria.path} could not be written: ${memoria.error}`
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

  /**
   * Torna all'elenco da una chat aperta. Serve solo sullo schermo stretto (§8 di
   * `ui-schermate.md`): là la lista e la conversazione si alternano invece di stare
   * affiancate, e questo è il tasto freccia in alto a sinistra che fa l'alternanza
   * inversa rispetto a `select`.
   *
   * Passa dall'indirizzo come ogni altra navigazione, non da `history.back()`: un
   * indirizzo aperto da un link diretto (una notifica, per dirne una — §16 mobile) non
   * ha per forza una voce precedente nella storia a cui tornare, e la freccia deve
   * portare a un posto certo, non a «qualunque cosa ci fosse prima».
   */
  back(): void {
    go(null, 'chat')
    this.#stopStream?.()
    this.#stopStream = null
    this.selected = null
    this.snap = null
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
  /**
   * Cambia una scelta dichiarata dall'agent (ADR-014).
   *
   * La UI non sa cosa siano gli `id`: li ha ricevuti in `session.created` e li rimanda
   * indietro. `setMode`/`setModel` restano perche' del codice li usa per nome — la
   * risposta a un piano sceglie **una modalita'**, non «l'opzione con id mode».
   */
  setOption(id: string, value: string): Promise<boolean> {
    return this.send({ c: 'session.setOption', id, value })
  }

  setMode(mode: PermissionMode): Promise<boolean> { return this.send({ c: 'session.setMode', mode }) }
  /** Accende o spegne un server MCP per questa chat. L'esito torna dal flusso (§18). */
  setMcp(server: string, enabled: boolean): Promise<boolean> {
    return this.send({ c: 'session.setMcp', server, enabled })
  }
  setModel(model: string): Promise<boolean> { return this.send({ c: 'session.setModel', model }) }

  /**
   * Rilegge il livello della quota. Non passa da `send`, di proposito: è una domanda
   * che parte da sola quando si apre il pannellino, e un rifiuto — su una chat che
   * dorme non c'è nessuno a cui chiederlo — non deve accendere la riga rossa che
   * l'utente associa a un comando che *lui* ha dato. Se non risponde, restano i numeri
   * di prima con scritto di quando sono.
   */
  async refreshQuota(): Promise<void> {
    const id = this.selected
    if (!id || !this.live) return
    try { await this.api.command(id, { c: 'session.refreshQuota' }) } catch { /* restano i vecchi */ }
  }

  /** Stessa ragione di `refreshQuota`: la domanda a cui risponde `/context` nel
   *  terminale, fatta quando l'utente guarda il pannellino. */
  async refreshContext(): Promise<void> {
    const id = this.selected
    if (!id || !this.live) return
    try { await this.api.command(id, { c: 'session.refreshContext' }) } catch { /* restano i vecchi */ }
  }

  /**
   * I file del progetto, per le citazioni con `@`. Della chat **selezionata**: `@` è
   * una cosa che si scrive in una casella, e quella casella appartiene a una chat
   * sola — chiedere «i file del progetto» senza dire quale non vorrebbe dire niente.
   */
  async files(q: string): Promise<string[]> {
    const id = this.selected
    if (!id || !this.live) return []
    return this.api.files(id, q)
  }

  /** Cercare in tutte le conversazioni. Chi chiama tiene i risultati: come `files()`,
   *  è una domanda al daemon e non un comando, quindi non c'è niente da ricordare qui. */
  async search(q: string): Promise<SessionMatches[]> {
    return this.api.search(q)
  }

  /**
   * Aprire una conversazione **su un turno preciso**, che è ciò che serve arrivando
   * da un risultato di ricerca: aprirla e basta lascerebbe in fondo, cioè lontano da
   * quello che si era appena trovato.
   *
   * `mostra` si assegna **prima** di `select`, non dopo: se la chat era già quella
   * aperta `select` esce subito, e un'assegnazione dopo non troverebbe più nessuno
   * che la sta aspettando. (Il nome non è `reveal` perché quello è già preso, ed è
   * un'altra cosa: aprire il gestore di file della macchina su un percorso.)
   */
  async apri(id: string, turnId: string): Promise<void> {
    this.mostra = turnId
    await this.select(id)
  }

  /**
   * F3: arriva al file dove sta, invece di lasciarlo un percorso da copiare a mano.
   * Non passa da `send()`: non è un comando su una sessione, è un'azione sulla
   * macchina — vale anche su una chat che dorme, dove non c'è nessun processo a cui
   * chiedere niente.
   */
  async reveal(path: string): Promise<void> {
    this.refused = null
    const esito = await this.api.reveal(path)
    if (!esito.ok) this.refused = esito.error ?? 'could not open the file manager'
  }

  /** F1: apre un link riconosciuto (Notion, …) con la sua app. Anche questo vale
   *  su una chat che dorme: non è un comando sulla sessione, è un'azione sulla
   *  macchina — la stessa ragione per cui `reveal` non passa da `send()`. */
  async openApp(url: string, scheme: string): Promise<void> {
    this.refused = null
    const esito = await this.api.openApp(url, scheme)
    if (!esito.ok) this.refused = esito.error ?? 'could not open the app'
  }

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
  async newChat(cwd: string, opts: { model?: string; profile?: string; agent?: string } = {}): Promise<void> {
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
        ...(profile ? { profile } : {}),
        // L'agent NON si ricorda per progetto come il profilo: due chat sulla stessa
        // cartella con due agent diversi sono una cosa che si vuole (è il modo in cui
        // si confrontano), mentre due profili Claude sulla stessa cartella erano una
        // fonte di confusione. Sono due domande diverse, e si rispondono diversamente.
        ...(opts.agent ? { agent: opts.agent } : {}),
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
        cwd: row.cwd, resume: { ref: row.id }, ...(profile ? { profile } : {}),
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
