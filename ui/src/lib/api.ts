// Il client del daemon.
//
// Perché non `EventSource`, che sarebbe la scelta ovvia per SSE: non sa mandare
// intestazioni, quindi il token finirebbe nella query string — e `security.ts` lo
// sconsiglia da sé, perché le query string finiscono nei log e nella cronologia.
// STARK esegue comandi come root: non è il posto dove risparmiare trenta righe.
// In cambio, parsando il flusso a mano controlliamo anche la riconnessione, che
// `EventSource` farebbe con `Last-Event-ID` mentre il daemon legge `?from=`.

import type { Activity } from '$core/activity.ts'
import type { CanonicalEvent, Command, ModelChoice } from '$core/events.ts'
import type { SessionSnapshot } from '$core/reduce.ts'
import type { Match, SessionMatches } from '$core/search.ts'
import type { Periodo, Stats } from '$core/stats.ts'

export type { Match, SessionMatches }

export type SessionRow = {
  id: string
  title: string
  state: string
  cwd?: string
  model?: string
  turns: number
  lastSeq: number
  lastTs: number
  /** Da quando sta in questo stato — non da quando ha scritto l'ultima riga. */
  since: number
  /** Cosa sta facendo adesso. C'è solo sulle righe vive: vedi il daemon. */
  doing?: Activity
  live: boolean
  /** Il semaforo della quota, solo quando non è verde. Sta sulla riga perché la quota
   *  è del piano, non della chat: quando finisce le ferma tutte insieme. */
  quota?: { status: string; kind: string; resetsAt: number; usingOverage: boolean }
}

/** Le sottocartelle di un percorso, per il dialogo «apri path» di New chat. */
/** Un passo della guida «collega il telefono». `fatto` è misurato dal daemon, mai
 *  dedotto dal passo precedente — vedi `daemon/tailscale.ts`. */
export type PassoTelefono = {
  id: 'installato' | 'collegato' | 'https' | 'pubblicato' | 'telefono'
  fatto: boolean
  dettaglio?: string
  azione?: 'collega' | 'pubblica'
}

export type StatoTelefono = {
  tailscale: { passi: PassoTelefono[]; pronto: boolean; url?: string; host?: string }
  codice: { scade: number } | null
  devices: { id: string; nome: string; da: number; visto: number }[]
  /** L'id del dispositivo da cui stai guardando, se ne sei uno. */
  questo?: string | null
  /** Stai usando il **token della macchina**, che non appartiene a nessun telefono e
   *  non si può revocare. È il caso di chi entrava col vecchio segnalibro `?token=…`. */
  conTokenMacchina?: boolean
}

/** Il ramo della cartella di una chat. `repo:false` vale anche quando `git` non è
 *  installato: da fuori è lo stesso fatto, cioè non c'è un ramo da mostrare. */
export type GitInfo = { repo: boolean; branch?: string; detached?: boolean }

export type BrowseResult = { path: string; parent: string | null; dirs: string[]; error?: string }

/** L'esito del Finder di sistema: `ok:false` copre sia l'annullo sia un errore — la
 *  UI li tratta identici (silenzioso), quindi non c'è bisogno di distinguerli qui. */
export type NativePickResult = { ok: true; path: string } | { ok: false }

export type OpenSpec = {
  cwd: string
  model?: string
  mode?: string
  resume?: { ref: string; fork?: boolean }
  /** `--continue`: riprende l'ultima conversazione di quella cartella. */
  continue?: boolean
  /**
   * Quale profilo usare. Stringa **opaca**: la UI la porta e non la interpreta, e dopo
   * ADR-012 non si chiama più `configDir` — quello era il nome della variabile
   * d'ambiente di Claude Code, arrivato fin quassù attraverso il confine del §1.
   */
  profile?: string
  /** Con quale agent. Omesso: quello di default del daemon. */
  agent?: string
}

/** Una conversazione nata nel terminale, come la elenca il daemon. */
export type ImportableRow = {
  sessionId: string
  title: string
  firstPrompt?: string
  cwd?: string
  branch?: string
  lastModified: number
  sizeBytes?: number
  path?: string
  already: boolean
  recent: boolean
}

/** Le impostazioni della macchina. Il tema e i suoni no: quelli sono del browser. */
export type Settings = {
  permissions: Record<string, 'allow' | 'ask'>
  projects: Record<string, { colour?: number; muted?: boolean; profile?: string }>
  /** Se l'agent deve scrivere **perché** lancia un comando. Vive nel `CLAUDE.md`
   *  globale dell'agent, quindi vale anche fuori da STARK. */
  toolDescriptions: boolean
  /** In quale modalità permessi partono le chat nuove. La CLI nuda parte in `default`;
   *  STARK propone `auto` (ADR-008), ma la scelta è tua. */
  /** La preferenza unica, per l'agent di default. Resta per i file già scritti. */
  defaultMode: string
  /** La modalità di partenza **per agent** (ADR-014): le voci non sono universali. */
  defaultModes?: Record<string, string>
  /** Le scorciatoie da tastiera, per id di azione. Il valore dice `mod`, non `cmd`:
   *  a risolverlo in ⌘ o Ctrl è il dispositivo (`lib/shortcuts.ts`). */
  shortcuts?: Record<string, string>
}

/** Cos'è successo al file di memoria dell'agent all'ultimo salvataggio. */
export type Memoria = { path: string; presente: boolean; cambiato: boolean; error?: string }

export type Storage = {
  home: string
  sessions: { id: string; title: string; cwd?: string; bytes: number }[]
  bytes: number
}

/** Un task di una lista di `.stark/todo.json`. */
export type TodoTask = {
  id: string
  text: string
  state: 'todo' | 'doing' | 'done' | 'blocked'
  note?: string
}

export type TodoList = {
  id: string
  title: string
  created?: number
  status: 'active' | 'paused' | 'done' | 'abandoned'
  tasks: TodoTask[]
}

/**
 * Le liste del **progetto**, non della chat: il file sta accanto al codice, quindi due
 * conversazioni sulla stessa cartella vedono la stessa lista.
 *
 * `assente` distingue «non c'è ancora nessun file» da «c'è ed è vuoto»: la prima è la
 * condizione normale di un progetto nuovo e va detta in un altro modo.
 */
export type Todos = {
  cwd: string
  lists: TodoList[]
  scartate: number
  motivo?: string
  assente: boolean
}

/** Le liste di un progetto, quando se ne guarda più d'uno insieme. */
export type TodoProject = Todos

/** Tutti i progetti conosciuti che hanno qualcosa da mostrare. */
export type AllTodos = { projects: TodoProject[] }

/** Un agent della macchina e i suoi modelli, come li elenca il selettore dell'helper. */
export type AgentModels = {
  id: string
  label: string
  /** Guidabile adesso. `false` non vuol dire nascosto: vuol dire mostrato con `reason`. */
  available: boolean
  /** Perche' non si puo' usare. Presente solo quando `available` e' `false`. */
  reason?: string
  /** Un avviso che vale per **tutto** l'agent — «qui la sola lettura non e'
   *  garantita» — e che quindi si dice una volta sull'intestazione del gruppo, non
   *  su ognuno dei suoi 61 modelli. */
  note?: string
  models: ModelChoice[]
}

export type SystemInfo = {
  url: string
  port: number
  home: string
  listening: string
  agent: {
    node: string; sdk?: string; cli?: string; executable?: string; bundled: boolean
    configDir: string
    profiles: { name: string; path: string; conversations: number; mcpServers: number; current: boolean }[]
  }
  /**
   * Gli agent che questa macchina sa guidare, chi c'è davvero installato, e **quali
   * modalità ha ciascuno** — che le impostazioni devono poter offrire prima che esista
   * una conversazione (ADR-014).
   */
  agents?: {
    id: string; available: boolean
    modes: { mode: string; label?: string; available: boolean; reason?: string; note?: string }[]
  }[]
  /** Chi può parlare col daemon oltre a questa macchina. `open: false` è il default:
   *  aprire il perimetro si fa sulla macchina (`STARK_PUBLIC_HOST`, o Tailscale), e ha
   *  effetto al riavvio del daemon — quindi non è un interruttore che sta qui. */
  perimeter: { open: boolean; hosts: { host: string; source: 'tailscale' | 'env' }[] }
  /** Il Finder nativo è disponibile su QUESTA esecuzione del daemon, ricalcolato a
   *  ogni richiesta — non è una proprietà stabile della macchina. */
  nativeFolderPicker: boolean
}

export type LinkStatus = 'connecting' | 'live' | 'lost'

/** Cosa risponde un comando. §18: solo «accettato», mai il proprio effetto. */
export type Ack = { ok: boolean; error?: string }

/**
 * Il token arriva una volta sola, nell'indirizzo che il daemon stampa all'avvio: il
 * browser non può mettere intestazioni sulla prima richiesta di una pagina. Appena
 * letto lo togliamo dalla barra degli indirizzi, così non finisce nei preferiti né
 * in una schermata condivisa. Da lì in poi viaggia solo in `Authorization`.
 */
export function bootToken(): string {
  const url = new URL(location.href)
  const fromUrl = url.searchParams.get('token')
  if (fromUrl) {
    ricorda(fromUrl)
    url.searchParams.delete('token')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
    return fromUrl
  }
  // Prima la scheda, poi il dispositivo. L'ordine non conta per il valore — è lo stesso
  // token — ma dice qual è il caso normale e quale il ripiego.
  return sessionStorage.getItem('stark.token') ?? localStorage.getItem('stark.token') ?? ''
}

/**
 * Il token si ricorda in **due** posti, e il secondo esiste per l'app della schermata
 * Home.
 *
 * `sessionStorage` da solo bastava finché STARK era una scheda: la si tiene aperta, e
 * finita quella è finita la sessione. Un'app aggiunta alla schermata Home su iOS invece
 * viene chiusa e riaperta di continuo dal sistema, e a ogni riapertura `sessionStorage`
 * è vuoto: l'app ripartiva senza credenziale e non si collegava.
 *
 * Non è un peggioramento per la sicurezza: `sessionStorage` e `localStorage` sono
 * ugualmente leggibili dal JavaScript di questa pagina — cambia solo **quanto durano**,
 * non chi li vede. La difesa contro il testo non fidato che l'agent riporta resta
 * quella di sempre, cioè DOMPurify prima di `{@html}`.
 */
function ricorda(t: string): void {
  try { sessionStorage.setItem('stark.token', t) } catch { /* modalità privata */ }
  try { localStorage.setItem('stark.token', t) } catch { /* idem */ }
}

/** Cosa risponde `GET /api/update`. Lo stesso oggetto di `daemon/aggiornamenti.ts`:
 *  se cambia lì va cambiato qui, ed è il motivo per cui i nomi sono identici. */
export type StatoAggiornamento = {
  installata: string
  ultima: string | null
  tag: string | null
  disponibile: boolean
  errore?: string
}

export class Api {
  constructor(private readonly token: string) {}

  get hasToken(): boolean { return this.token.length > 0 }

  /** Il token in chiaro, per la pagina System: serve a copiarlo per un altro browser. */
  get tokenValue(): string { return this.token }

  private get auth(): Record<string, string> {
    // Senza token **non si manda l'intestazione**, invece di mandarla vuota. Il daemon
    // legge la credenziale in tre modi, in ordine: `Authorization`, poi il cookie, poi
    // l'indirizzo — ma solo se il primo non c'è. Un `Bearer ` vuoto viene preso per
    // buono come tentativo, fallisce, e **impedisce di guardare il cookie**: cioè una
    // pagina che avrebbe potuto autenticarsi da sola si becca un 403.
    return this.token ? { authorization: `Bearer ${this.token}` } : {}
  }

  /** Le stesse intestazioni, per chi parla col daemon senza passare da qui — il push,
   *  che ha un ciclo suo (Service Worker, permesso del browser, iscrizione). */
  get authHeaders(): Record<string, string> { return this.auth }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: { ...this.auth, ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`${res.status} su ${path}`)
    return await res.json() as T
  }

  sessions(): Promise<{ sessions: SessionRow[] }> {
    return this.json('/api/sessions')
  }

  settings(): Promise<{ settings: Settings; memoria?: Memoria }> { return this.json('/api/settings') }

  saveSettings(s: Settings): Promise<{ settings: Settings; memoria?: Memoria }> {
    return this.json('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(s),
    })
  }

  storage(): Promise<Storage> { return this.json('/api/storage') }
  browse(path?: string): Promise<BrowseResult> {
    return this.json(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`)
  }
  system(): Promise<SystemInfo> { return this.json('/api/system') }

  /**
   * Tutti i modelli guidabili su questa macchina, per agent (§17).
   *
   * Costa un handshake per agent **la prima volta** e poi e' in cache nel daemon: chi
   * apre il menu due volte non lo paga due volte. Si chiede quindi all'apertura del
   * selettore e non all'avvio della UI, che di questa risposta non ha bisogno.
   */
  /**
   * Passa il lavoro a un altro agent.
   *
   * Non usa `json()` perche' il 409 **non e' un errore**: e' la domanda «questa chat
   * dorme, come vuoi il briefing?». `json()` lo trasformerebbe in un'eccezione con
   * scritto «409 su /api/handoff», e chi chiama dovrebbe leggere un numero dentro un
   * messaggio per capire che deve chiedere una cosa all'utente.
   */
  async handoff(id: string, agent: string, model: string, via?: 'agent' | 'journal'): Promise<
    | { ok: true; id: string; file: string }
    | { ok: false; serveScelta: true; state: string }
    | { ok: false; error: string }
  > {
    const res = await fetch('/api/handoff', {
      method: 'POST',
      headers: { ...this.auth, 'content-type': 'application/json' },
      body: JSON.stringify({ id, agent, model, ...(via ? { via } : {}) }),
    })
    const b = await res.json().catch(() => ({})) as Record<string, unknown>
    if (res.status === 201) return { ok: true, id: String(b['id']), file: String(b['file']) }
    if (res.status === 409) return { ok: false, serveScelta: true, state: String(b['state'] ?? '') }
    return { ok: false, error: String(b['error'] ?? `${res.status} su /api/handoff`) }
  }

  async models(): Promise<AgentModels[]> {
    return (await this.json<{ agents: AgentModels[] }>('/api/models')).agents
  }

  /** Apre l'helper. Ne esiste **uno solo**: questa chiamata chiude quello di prima,
   *  ed e' anche il modo in cui «muore col ricaricamento della pagina» diventa un
   *  fatto invece di una speranza appesa a `beforeunload`. */
  openHelper(pick: { agent?: string; model?: string } = {}): Promise<{ id: string }> {
    return this.json('/api/helper', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pick),
    })
  }

  /**
   * Riavvia il daemon. La risposta arriva **prima** che si spenga: dopo, il flusso
   * cade e la pagina si ricollega da sé, come dopo un riavvio da terminale.
   */
  restart(rebuildUi = true): Promise<{ ok: boolean; pid?: number }> {
    return this.json('/api/restart', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rebuildUi }),
    })
  }

  // ── aggiornamenti ────────────────────────────────────────────────────────
  /** Cosa sa il daemon sulle versioni. Il controllo l'ha fatto lui all'accensione:
   *  questa è una lettura, non una domanda al remoto. */
  update(): Promise<StatoAggiornamento> { return this.json('/api/update') }
  /** Aggiorna e riavvia. La risposta arriva **prima** che il daemon muoia, quindi un
   *  200 vuol dire «è partito», non «è finito»: a dire che è finito è il ritorno del
   *  daemon, che la UI aspetta come già fa per il riavvio. */
  runUpdate(): Promise<{ ok: boolean; tag?: string }> {
    return this.json('/api/update', { method: 'POST' })
  }

  closeHelper(): Promise<{ ok: boolean }> {
    return this.json('/api/helper', { method: 'DELETE' })
  }

  /** Apre il Finder di sistema sulla macchina del daemon. Annullo o fallimento
   *  tornano `{ok:false}`: non è un'eccezione, la UI resta ferma senza avvisi. */
  browseNative(): Promise<NativePickResult> {
    return this.json('/api/browse-native', { method: 'POST' })
  }

  // ── collegare un telefono ───────────────────────────────────────────────
  phone(): Promise<StatoTelefono> { return this.json('/api/phone') }
  phoneCode(): Promise<{ codice: string; scade: number }> {
    return this.json('/api/phone/code', { method: 'POST' })
  }
  phoneCancel(): Promise<Ack> { return this.json('/api/phone/code', { method: 'DELETE' }) }
  phoneRevoke(id: string): Promise<Ack> {
    return this.json(`/api/phone/device?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
  /** Lancia `tailscale up`. Non aspetta il login: torna l'indirizzo da aprire. */
  tailscaleUp(): Promise<{ ok: boolean; url?: string; error?: string }> {
    return this.json('/api/phone/tailscale-up', { method: 'POST' })
  }
  tailscalePublish(): Promise<Ack> { return this.json('/api/phone/publish', { method: 'POST' }) }

  /** Su quale ramo sta `cwd`. Un fallimento non è niente da mostrare — vuol dire che
   *  un ramo non c'è — quindi non alza: la barra di stato non deve avere un modo di
   *  rompersi per una cartella qualunque. */
  async git(cwd: string): Promise<GitInfo> {
    try { return await this.json<GitInfo>(`/api/git?cwd=${encodeURIComponent(cwd)}`) }
    catch { return { repo: false } }
  }

  /** F3: apre il gestore di file della macchina su `path`. Un rifiuto (file sparito
   *  dal disco, gestore che non parte) è una frase da mostrare, non un'eccezione. */
  async reveal(path: string): Promise<Ack> {
    const res = await fetch('/api/reveal', {
      method: 'POST',
      headers: { ...this.auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    try { return await res.json() as Ack }
    catch { return { ok: false, error: `HTTP ${res.status}` } }
  }

  /** F1: apre `url` con l'app dedicata (`scheme`). Il rifiuto più comune è «l'app
   *  non c'è» — controllato dal daemon **prima** di tentare, non dedotto da un
   *  lancio silenzioso che non dice se ha funzionato. */
  async openApp(url: string, scheme: string): Promise<Ack> {
    const res = await fetch('/api/open-app', {
      method: 'POST',
      headers: { ...this.auth, 'content-type': 'application/json' },
      body: JSON.stringify({ url, scheme }),
    })
    try { return await res.json() as Ack }
    catch { return { ok: false, error: `HTTP ${res.status}` } }
  }

  snapshot(id: string): Promise<{ snapshot: SessionSnapshot }> {
    return this.json(`/api/sessions/${id}`)
  }

  open(spec: OpenSpec): Promise<{ id: string; snapshot: SessionSnapshot }> {
    return this.json('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(spec),
    })
  }

  /**
   * I file del progetto che somigliano a quello che si sta scrivendo dopo una `@`.
   * A rispondere è il CLI (è la stessa ricerca del terminale), quindi il filtro non
   * lo fa il browser: si manda quello che l'utente ha digitato e si mostra ciò che
   * torna. Una risposta che non arriva vale «nessun file», non un errore a schermo:
   * si sta digitando, e un avviso in mezzo a una parola è peggio di un menu che tace.
   */
  async files(id: string, q: string): Promise<string[]> {
    try {
      const r = await this.json<{ files: string[] }>(`/api/sessions/${id}/files?q=${encodeURIComponent(q)}`)
      return r.files
    } catch { return [] }
  }

  /**
   * Cercare in tutte le conversazioni. Come `files()`: una risposta che non arriva
   * vale «niente», non un errore a schermo — si sta ancora digitando, e un avviso in
   * mezzo a una parola è peggio di un elenco che tace.
   */
  async search(q: string): Promise<SessionMatches[]> {
    try {
      const r = await this.json<{ results: SessionMatches[] }>(
        `/api/search?q=${encodeURIComponent(q)}`)
      return r.results
    } catch { return [] }
  }

  /**
   * Quanto è stato usato STARK. A differenza di `search()`, un errore qui **non** si
   * ingoia: la schermata esiste per mostrare dei numeri, e disegnarne zero al posto
   * di un guasto direbbe «non l'hai mai usato».
   */
  async stats(p: Periodo): Promise<Stats> {
    const q = new URLSearchParams()
    if (p.from !== undefined) q.set('from', String(p.from))
    if (p.to !== undefined) q.set('to', String(p.to))
    const r = await this.json<{ stats: Stats }>(`/api/stats?${q}`)
    return r.stats
  }

  importable(): Promise<{ sessions: ImportableRow[] }> {
    return this.json('/api/importable')
  }

  async doImport(sessionId: string): Promise<Ack & { id?: string; profile?: string }> {
    const res = await fetch('/api/importable', {
      method: 'POST',
      headers: { ...this.auth, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    try { return await res.json() as Ack & { id?: string } }
    catch { return { ok: false, error: `HTTP ${res.status}` } }
  }

  /**
   * Un comando rifiutato non è un guasto della rete: il daemon risponde 409 e dice
   * perché — «sessione non attiva», «richiesta sconosciuta». Trattarlo come un errore
   * di trasporto trasformerebbe una frase leggibile in «409 su /api/…».
   */
  async command(id: string, cmd: Command): Promise<Ack> {
    const res = await fetch(`/api/sessions/${id}/command`, {
      method: 'POST',
      headers: { ...this.auth, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    })
    try { return await res.json() as Ack } catch { return { ok: false, error: `HTTP ${res.status}` } }
  }

  async remove(id: string): Promise<Ack> {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: this.auth })
    try { return await res.json() as Ack } catch { return { ok: false, error: `HTTP ${res.status}` } }
  }

  /**
   * Si riaggancia da `from()` in poi. Il daemon manda prima ciò che si è perso e poi
   * il flusso, senza cedere il controllo in mezzo, quindi non c'è un buco fra storia
   * e diretta. `from()` è una funzione e non un numero perché fra un tentativo e il
   * successivo il punto giusto è cambiato: ripartire da quello di partenza rimanderebbe
   * eventi già visti.
   */
  stream(
    id: string,
    from: () => number,
    onEvent: (e: CanonicalEvent) => void,
    onStatus: (s: LinkStatus) => void,
  ): () => void {
    return this.sse(
      () => `/api/sessions/${id}/stream?from=${from()}`,
      data => onEvent(JSON.parse(data) as CanonicalEvent),
      onStatus,
    )
  }

  /**
   * Il flusso dell'**elenco**. Prima c'era una richiesta ogni tre secondi, perché il
   * daemon esponeva un flusso per sessione e non uno globale: la barra laterale non
   * aveva altro modo di sapere che *un'altra* chat era cambiata. Ora lo dice il daemon.
   * Alla connessione manda subito le righe, quindi non serve un caricamento a parte.
   */
  todo(id: string): Promise<Todos> { return this.json(`/api/sessions/${id}/todo`) }

  /**
   * Il flusso dei todo di un progetto. Manda lo stato **intero** a ogni cambio: un file
   * di qualche riga non vale un protocollo di differenze, e mandare tutto rende
   * impossibile restare disallineati dopo una riconnessione.
   */
  todoStream(
    id: string,
    onTodo: (t: Todos) => void,
    onStatus: (s: LinkStatus) => void,
  ): () => void {
    return this.sse(
      () => `/api/sessions/${id}/todostream`,
      data => onTodo(JSON.parse(data) as Todos),
      onStatus,
    )
  }

  /** Le liste di tutti i progetti conosciuti. I percorsi li deriva il daemon. */
  todos(): Promise<AllTodos> { return this.json('/api/todos') }

  /** Lo stesso, in flusso: stato intero a ogni cambio, come quello di un progetto solo. */
  todosStream(
    onTodos: (t: AllTodos) => void,
    onStatus: (s: LinkStatus) => void,
  ): () => void {
    return this.sse(
      () => '/api/todostream',
      data => onTodos(JSON.parse(data) as AllTodos),
      onStatus,
    )
  }

  sessionsStream(
    onRows: (rows: SessionRow[]) => void,
    onStatus: (s: LinkStatus) => void,
  ): () => void {
    return this.sse(
      () => '/api/stream',
      data => onRows((JSON.parse(data) as { sessions: SessionRow[] }).sessions),
      onStatus,
    )
  }

  /** Il meccanismo comune ai due flussi: connessione, lettura, riconnessione. */
  private sse(
    url: () => string,
    onData: (data: string) => void,
    onStatus: (s: LinkStatus) => void,
  ): () => void {
    const ac = new AbortController()
    let stopped = false
    let attempt = 0

    const run = async (): Promise<void> => {
      while (!stopped) {
        onStatus(attempt === 0 ? 'connecting' : 'lost')
        try {
          const res = await fetch(url(), {
            headers: { ...this.auth, accept: 'text/event-stream' },
            signal: ac.signal,
          })
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
          attempt = 0
          onStatus('live')
          await pump(res.body, onData, () => stopped)
        } catch (err) {
          if (stopped || (err as Error).name === 'AbortError') return
        }
        if (stopped) return
        onStatus('lost')
        // Attesa crescente ma con un tetto: il daemon che riparte torna in qualche
        // secondo, e martellarlo nel frattempo non lo fa tornare prima.
        attempt++
        await sleep(Math.min(500 * 2 ** (attempt - 1), 8000))
      }
    }
    void run()

    return () => { stopped = true; ac.abort() }
  }
}

/** Legge il corpo e ricompone i blocchi SSE, che possono arrivare spezzati a metà. */
async function pump(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
  stopped: () => boolean,
): Promise<void> {
  const reader = body.getReader()
  // `stream: true` serve perché un carattere multibyte può cadere a cavallo di due
  // chunk: senza, ogni tanto comparirebbe un carattere rotto e sembrerebbe un bug
  // del modello invece che della lettura.
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done || stopped()) return
    buffer += decoder.decode(value, { stream: true })
    let cut = buffer.indexOf('\n\n')
    while (cut !== -1) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const data = block.split('\n')
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trimStart())
        .join('\n')
      // Le righe che iniziano con `:` sono commenti: il daemon le usa come battito
      // per tenere aperte le connessioni mute. Qui semplicemente non producono dati.
      if (data) {
        try { onData(data) } catch { /* blocco rotto */ }
      }
      cut = buffer.indexOf('\n\n')
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
