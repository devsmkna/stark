// Il tema: tre stati, non due.
//
// «Sistema» non è l'assenza di una scelta, è una scelta: vuol dire *segui il computer*,
// e su un computer che passa a scuro la sera è quella giusta. Chiaro e scuro invece
// dicono «voglio questo comunque», e devono vincere anche quando il sistema dice altro.
//
// Sta nel browser e non nel daemon perché è del **dispositivo**: il tema del portatile
// al buio non è il tema del fisso in ufficio, e portarselo dietro sarebbe sbagliato.
// Il foglio di stile è già fatto per tutti e tre gli stati (`app.css`, in cima).

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'stark.theme'

export class Themer {
  scelto = $state<Theme>('system')

  constructor() {
    try {
      const v = localStorage.getItem(KEY)
      if (v === 'light' || v === 'dark' || v === 'system') this.scelto = v
    } catch { /* modalità privata: si resta su «sistema» */ }
    this.#apply()
  }

  set(t: Theme): void {
    this.scelto = t
    try { localStorage.setItem(KEY, t) } catch { /* vedi sopra */ }
    this.#apply()
  }

  /** `data-theme` sulla radice; toglierlo è ciò che rimette in gioco il sistema. */
  #apply(): void {
    const root = document.documentElement
    if (this.scelto === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', this.scelto)
  }
}
