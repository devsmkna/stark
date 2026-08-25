// La dimensione del testo: del dispositivo, come il tema — vedi theme.svelte.ts.
// Ogni riga in `app.css` è scritta in px fissi, non in rem: farla scalare a mano
// vorrebbe dire riscrivere ~150 dichiarazioni, e un pixel «grande» su una riga e
// dimenticato sull'altra sarebbe peggio di niente. `zoom` sul contenitore risolve
// tutto in un colpo, ridisegna il layout invece di ingrandire un'immagine (a
// differenza di `transform: scale`, che lascerebbe un vuoto attorno), ed è
// supportato da tutti i motori che contano ormai.

export type TextSize = 'sm' | 'md' | 'lg' | 'xl'

const KEY = 'stark.textsize'
const ZOOM: Record<TextSize, string> = { sm: '90%', md: '100%', lg: '115%', xl: '130%' }

export class Sizer {
  scelto = $state<TextSize>('md')

  constructor() {
    try {
      const v = localStorage.getItem(KEY)
      if (v === 'sm' || v === 'md' || v === 'lg' || v === 'xl') this.scelto = v
    } catch { /* modalità privata: si resta su «md» */ }
    this.#apply()
  }

  set(t: TextSize): void {
    this.scelto = t
    try { localStorage.setItem(KEY, t) } catch { /* vedi sopra */ }
    this.#apply()
  }

  #apply(): void {
    document.documentElement.style.zoom = ZOOM[this.scelto]
  }
}
