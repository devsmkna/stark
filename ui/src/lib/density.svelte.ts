// La modalità compatta: stessa forma del tema (theme.svelte.ts), stessa ragione —
// è del dispositivo. «Compact» stringe header, barra e righe della sidebar per chi
// tiene più finestre di STARK aperte insieme; vedi
// docs/superpowers/specs/2026-09-03-no-noise-mode-design.md.

const KEY = 'stark.density'

export class Densifier {
  compact = $state<boolean>(false)

  constructor() {
    try {
      this.compact = localStorage.getItem(KEY) === 'compact'
    } catch { /* modalità privata: si resta su «non compatto» */ }
    this.#apply()
  }

  set(v: boolean): void {
    this.compact = v
    try {
      if (v) localStorage.setItem(KEY, 'compact')
      else localStorage.removeItem(KEY)
    } catch { /* vedi sopra */ }
    this.#apply()
  }

  toggle(): void {
    this.set(!this.compact)
  }

  #apply(): void {
    const root = document.documentElement
    if (this.compact) root.setAttribute('data-density', 'compact')
    else root.removeAttribute('data-density')
  }
}
