// La famiglia del font: del dispositivo, come il tema e la dimensione. `--sans` è
// l'unica variabile che conta per il testo di lettura (il monospazio resta fisso,
// perché codice e comandi devono restare allineati carattere per carattere
// indipendentemente da cosa si sceglie qui). Due voci, non una tendina di
// system-font-stack infinite: quello che serve è «il default» o «quello che il
// sistema operativo usa per tutto il resto», non un catalogo di font.

export type FontFamily = 'default' | 'system'

const KEY = 'stark.fontfamily'
const STACK: Record<FontFamily, string> = {
  default: '"IBM Plex Sans", system-ui, -apple-system, Segoe UI, sans-serif',
  system: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
}

export class Fonter {
  scelto = $state<FontFamily>('default')

  constructor() {
    try {
      const v = localStorage.getItem(KEY)
      if (v === 'default' || v === 'system') this.scelto = v
    } catch { /* modalità privata: si resta sul default */ }
    this.#apply()
  }

  set(f: FontFamily): void {
    this.scelto = f
    try { localStorage.setItem(KEY, f) } catch { /* vedi sopra */ }
    this.#apply()
  }

  #apply(): void {
    document.documentElement.style.setProperty('--sans', STACK[this.scelto])
  }
}
