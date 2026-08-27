// Il client del daemon.
//
// Perché non `EventSource`, che sarebbe la scelta ovvia per SSE: non sa mandare
// intestazioni, quindi il token finirebbe nella query string — e `security.ts` lo
// sconsiglia da sé, perché le query string finiscono nei log e nella cronologia.
// STARK esegue comandi come root: non è il posto dove risparmiare trenta righe.
// In cambio, parsando il flusso a mano controlliamo anche la riconnessione, che
// `EventSource` farebbe con `Last-Event-ID` mentre il daemon legge `?from=`.

import type { Activity } from '$core/activity.ts'
import type { CanonicalEvent, Command } from '$core/events.ts'
import type { SessionSnapshot } from '$core/reduce.ts'

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
export type BrowseResult = { path: string; parent: string | null; dirs: string[]; error?: string }

/** L'esito del Finder di sistema: `ok:false` copre sia l'annullo sia un errore — la
 *  UI li tratta identici (silenzioso), quindi non c'è bisogno di distinguerli qui. */
export type NativePickResult = { ok: true; path: string } | { ok: false }

export type OpenSpec = {
  cwd: string
  model?: string
  mode?: string
  resume?: { ref: string; fork?: boolean }
  /** Quale profilo Claude (`CLAUDE_CONFIG_DIR`) usare. Omesso: quello di default. */
  configDir?: string
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
  defaultMode: string
}

/** Cos'è successo al file di memoria dell'agent all'ultimo salvataggio. */
export type Memoria = { path: string; presente: boolean; cambiato: boolean; error?: string }

export type Storage = {
  home: string
  sessions: { id: string; title: string; cwd?: string; bytes: number }[]
  bytes: number
}

/** Perché è spento, quando lo è: mai «non funziona» senza il motivo. */
export type BotStato =
  | { fase: 'spento' }
  | { fase: 'in-ascolto' }
  | { fase: 'errore'; motivo: string }

export type TelegramInfo = {
  hasToken: boolean
  username?: string
  stato: BotStato
  chats?: { chatId: number; nome: string; da: number }[]
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

  // ── Telegram ────────────────────────────────────────────────────────────────
  //
  // Il bot token si manda e basta: non torna mai indietro. Chi ce l'ha può mettersi in
  // ascolto al posto di questo STARK e **leggere** tutto quello che manda — non guidare,
  // perché il suo chat_id non è nell'elenco, ma leggere è già la conversazione.
  telegram(): Promise<TelegramInfo> { return this.json('/api/telegram') }
  setTelegramToken(token: string): Promise<{ stato: BotStato; username?: string }> {
    return this.json('/api/telegram', { method: 'PUT', body: JSON.stringify({ token }) })
  }
  forgetTelegram(): Promise<{ ok: boolean }> {
    return this.json('/api/telegram', { method: 'DELETE' })
  }
  pairTelegram(): Promise<{ code: string; scade: number; username?: string }> {
    return this.json('/api/telegram/pair', { method: 'POST' })
  }
  unpairTelegram(chatId: number): Promise<{ ok: boolean }> {
    return this.json(`/api/telegram/chats/${chatId}`, { method: 'DELETE' })
  }
  testTelegram(): Promise<{ ok: boolean; chats: number }> {
    return this.json('/api/telegram/test', { method: 'POST' })
  }

  /** Apre il Finder di sistema sulla macchina del daemon. Annullo o fallimento
   *  tornano `{ok:false}`: non è un'eccezione, la UI resta ferma senza avvisi. */
  browseNative(): Promise<NativePickResult> {
    return this.json('/api/browse-native', { method: 'POST' })
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

  importable(): Promise<{ sessions: ImportableRow[] }> {
    return this.json('/api/importable')
  }

  async doImport(sessionId: string): Promise<Ack & { id?: string; configDir?: string }> {
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
