// Lo stato dell'applicazione.
//
// Una scelta che vale la pena spiegare: la UI non tiene un proprio modello. Tiene lo
// `SessionSnapshot` di `core/reduce.ts` e ci applica sopra gli eventi con lo stesso
// `applyTo` che usa il daemon. Così l'invariante del §4 — dal vivo uguale a rilettura —
// non è qualcosa che la UI deve ricordarsi di rispettare: è l'unica cosa che sa fare.

import { applyTo, type SessionSnapshot } from '$core/reduce.ts'
import { Api, bootToken, type LinkStatus, type SessionRow } from './api.ts'

export class Store {
  readonly api = new Api(bootToken())

  rows = $state<SessionRow[]>([])
  selected = $state<string | null>(null)
  snap = $state<SessionSnapshot | null>(null)
  link = $state<LinkStatus>('connecting')
  fatal = $state<string | null>(null)
  loaded = $state(false)

  #stopStream: (() => void) | null = null
  #poll: ReturnType<typeof setInterval> | null = null

  get hasToken(): boolean { return this.api.hasToken }

  async start(): Promise<void> {
    await this.refresh()
    this.loaded = true
    // Il daemon espone un flusso per sessione, non uno globale: per sapere che *un'altra*
    // chat è cambiata non c'è altro modo che richiedere l'elenco. Funziona, ma è la cosa
    // che manca perché la barra laterale sia davvero dal vivo — vedi le note in fondo a
    // docs/event-model.md §18.
    this.#poll = setInterval(() => { void this.refresh() }, 3000)
  }

  async refresh(): Promise<void> {
    try {
      const { sessions } = await this.api.sessions()
      this.rows = sessions
      this.fatal = null
    } catch (e) {
      this.fatal = (e as Error).message
    }
  }

  async select(id: string): Promise<void> {
    if (this.selected === id) return
    this.#stopStream?.()
    this.selected = id
    this.snap = null
    try {
      const { snapshot } = await this.api.snapshot(id)
      this.snap = snapshot
    } catch (e) {
      this.fatal = (e as Error).message
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

  dispose(): void {
    this.#stopStream?.()
    if (this.#poll) clearInterval(this.#poll)
  }
}
