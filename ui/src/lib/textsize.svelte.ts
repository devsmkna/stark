// La dimensione del testo: del dispositivo, come il tema — vedi theme.svelte.ts.
// Ogni riga in `app.css` è scritta in px fissi, non in rem: farla scalare a mano
// vorrebbe dire riscrivere ~150 dichiarazioni, e un pixel «grande» su una riga e
// dimenticato sull'altra sarebbe peggio di niente. `zoom` sul contenitore risolve
// tutto in un colpo, ridisegna il layout invece di ingrandire un'immagine (a
// differenza di `transform: scale`, che lascerebbe un vuoto attorno), ed è
// supportato da tutti i motori che contano ormai.
//
// Un'unica manopola per tutta l'app, non una per componente: lo zoom è sul
// `documentElement`, quindi vale ovunque allo stesso modo — coerente col
// principio che l'ha introdotta (§Text size in Settings).

const KEY = 'stark.textsize'
export const MIN = 80
export const MAX = 150
export const STEP = 5
const DEFAULT = 100

/** Le vecchie quattro taglie fisse, mappate sul valore numerico che avevano già —
 *  solo per non perdere la scelta di chi l'aveva salvata prima dello slider. */
const LEGACY: Record<string, number> = { sm: 90, md: 100, lg: 115, xl: 130 }

/**
 * Quanto in più sullo schermo stretto, sopra la percentuale scelta. Non è una
 * preferenza a parte: uno che su desktop tiene 90% perché vuole vedere più roba
 * insieme, su un touch resta comunque più piccolo di chi tiene 130% — si somma alla
 * scelta, non la sostituisce. Il numero viene dal provarlo: sotto non cambiava
 * abbastanza da dirsi «adesso si tocca bene», sopra il testo cominciava a andare a
 * capo dove prima non lo faceva.
 */
const STRETTO = 1.35

function clamp(n: number): number {
  const stepped = Math.round(n / STEP) * STEP
  return Math.min(MAX, Math.max(MIN, stepped))
}

export class Sizer {
  scelto = $state<number>(DEFAULT)
  #stretto = false

  constructor() {
    try {
      const v = localStorage.getItem(KEY)
      if (v !== null) {
        const n = v in LEGACY ? (LEGACY[v] ?? DEFAULT) : Number.parseInt(v, 10)
        if (Number.isFinite(n)) this.scelto = clamp(n)
      }
    } catch { /* modalità privata: si resta sul default */ }
    this.#apply()
  }

  set(n: number): void {
    this.scelto = clamp(n)
    try { localStorage.setItem(KEY, String(this.scelto)) } catch { /* vedi sopra */ }
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
    document.documentElement.style.zoom = `${Math.round(this.scelto * (this.#stretto ? STRETTO : 1))}%`
  }
}
