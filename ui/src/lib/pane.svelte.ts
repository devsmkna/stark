// Una chat aperta in un pannello: lo snapshot, lo stato del collegamento, e quale delle
// due letture (conversazione o effetti) sta mostrando.
//
// È esattamente ciò che `Store.select()` faceva a mano su campi piatti — `snap`, `link`,
// `view` — cioè per **una sola** chat alla volta. Con più pannelli serve un'istanza per
// chat: la logica non cambia, cambia quante volte esiste.

import { applyTo, type SessionSnapshot } from '$core/reduce.ts'
import type { Api, LinkStatus } from './api.ts'

export type PaneView = 'chat' | 'effects'

export class Pane {
  readonly chatId: string
  snap = $state<SessionSnapshot | null>(null)
  link = $state<LinkStatus>('connecting')
  view = $state<PaneView>('chat')

  #stopStream: (() => void) | null = null

  constructor(chatId: string) {
    this.chatId = chatId
  }

  /** Legge lo snapshot iniziale e si aggancia al flusso. Non lancia: un'apertura
   *  fallita lascia `snap` a `null` e restituisce il motivo, che è lo Store a
   *  mostrare (`refused`) — stessa forma di `select()` prima di questo lavoro. */
  async open(api: Api): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const { snapshot } = await api.snapshot(this.chatId)
      this.snap = snapshot
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    // `from` è letto a ogni tentativo, non fissato adesso: dopo una caduta il punto
    // giusto è avanzato, e ripartire da quello di prima rimanderebbe eventi già visti.
    this.#stopStream = api.stream(
      this.chatId,
      () => this.snap?.lastSeq ?? 0,
      e => { if (this.snap && e.sessionId === this.snap.sessionId) applyTo(this.snap, e) },
      s => { this.link = s },
    )
    return { ok: true }
  }

  /** Ferma il flusso. Idempotente: chiamarla due volte non fa niente la seconda. */
  close(): void {
    this.#stopStream?.()
    this.#stopStream = null
  }
}
