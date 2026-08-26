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

/**
 * Quanto in più sullo schermo stretto, sopra la percentuale scelta. Non è una
 * preferenza a parte: uno che su desktop tiene `sm` perché vuole vedere più roba
 * insieme, su un touch resta comunque più piccolo di chi tiene `lg` — si somma alla
 * scelta, non la sostituisce. Il numero viene dal provarlo: sotto non cambiava
 * abbastanza da dirsi «adesso si tocca bene», sopra il testo cominciava a andare a
 * capo dove prima non lo faceva.
 */
const STRETTO = 1.35

export class Sizer {
  scelto = $state<TextSize>('md')
  #stretto = false

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

  /**
   * Chiamato da chi già ascolta la stessa soglia per `store.narrow` (App.svelte):
   * due ascoltatori sulla stessa media query direbbero la stessa cosa due volte, e
   * uno dei due prima o poi si scorderebbe di esistere quando cambia la soglia.
   */
  refresh(stretto: boolean): void {
    this.#stretto = stretto
    this.#apply()
  }

  #apply(): void {
    const base = Number.parseFloat(ZOOM[this.scelto])
    document.documentElement.style.zoom = `${Math.round(base * (this.#stretto ? STRETTO : 1))}%`
  }
}
