// Il client del daemon.
//
// Perché non `EventSource`, che sarebbe la scelta ovvia per SSE: non sa mandare
// intestazioni, quindi il token finirebbe nella query string — e `security.ts` lo
// sconsiglia da sé, perché le query string finiscono nei log e nella cronologia.
// STARK esegue comandi come root: non è il posto dove risparmiare trenta righe.
// In cambio, parsando il flusso a mano controlliamo anche la riconnessione, che
// `EventSource` farebbe con `Last-Event-ID` mentre il daemon legge `?from=`.

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
  live: boolean
}

export type LinkStatus = 'connecting' | 'live' | 'lost'

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
    sessionStorage.setItem('stark.token', fromUrl)
    url.searchParams.delete('token')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
    return fromUrl
  }
  return sessionStorage.getItem('stark.token') ?? ''
}

export class Api {
  constructor(private readonly token: string) {}

  get hasToken(): boolean { return this.token.length > 0 }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`${res.status} su ${path}`)
    return await res.json() as T
  }

  sessions(): Promise<{ sessions: SessionRow[] }> {
    return this.json('/api/sessions')
  }

  snapshot(id: string): Promise<{ snapshot: SessionSnapshot }> {
    return this.json(`/api/sessions/${id}`)
  }

  command(id: string, cmd: Command): Promise<{ ok: boolean; error?: string }> {
    return this.json(`/api/sessions/${id}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    })
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
    const ac = new AbortController()
    let stopped = false
    let attempt = 0

    const run = async (): Promise<void> => {
      while (!stopped) {
        onStatus(attempt === 0 ? 'connecting' : 'lost')
        try {
          const res = await fetch(`/api/sessions/${id}/stream?from=${from()}`, {
            headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream' },
            signal: ac.signal,
          })
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
          attempt = 0
          onStatus('live')
          await pump(res.body, onEvent, () => stopped)
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
  onEvent: (e: CanonicalEvent) => void,
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
        try { onEvent(JSON.parse(data) as CanonicalEvent) } catch { /* blocco rotto */ }
      }
      cut = buffer.indexOf('\n\n')
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
