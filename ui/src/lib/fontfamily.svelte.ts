// La famiglia del font: del dispositivo, come il tema e la dimensione. `--sans` è
// l'unica variabile che conta per il testo di lettura (il monospazio resta fisso,
// perché codice e comandi devono restare allineati carattere per carattere
// indipendentemente da cosa si sceglie qui). I due valori storici sono i fallback;
// dal 2 settembre 2026 l'elenco si allarga ai font **installati sulla macchina**
// (`queryLocalFonts`), e un family qualsiasi si applica da sé con il fallback CSS
// dietro — un font che non c'è più si degrada, non rompe.

export type FontFamily = 'default' | 'system' | (string & {})

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
      if (v && (v === 'default' || v === 'system' || STACK[v] !== undefined)) this.scelto = v
    } catch { /* modalità privata: si resta sul default */ }
    this.#apply()
  }

  set(f: FontFamily): void {
    this.scelto = f
    try { localStorage.setItem(KEY, f) } catch { /* vedi sopra */ }
    this.#apply()
  }

  #apply(): void {
    // Un family scelto fra i locali vale da solo; i due valori storici prendono il
    // loro stack. Un family che manca sul dispositivo si degrada da sé: dopo il nome
    // resta la lista generica, che è il fallback del CSS e non una scelta nostra.
    const v = STACK[this.scelto] ?? `'${this.scelto.replace(/'/g, "\\'")}', system-ui, -apple-system, Segoe UI, sans-serif`
    document.documentElement.style.setProperty('--sans', v)
  }
}
