// La lettura: larghezza della conversazione e riduzione delle animazioni. Del
// dispositivo, come il tema e la dimensione — due browser sullo stesso computer
// possono volerle diverse, e nessuna delle due cambia cosa fa l'agent.
//
// La larghezza non è un numero libero ma tre scelte (720 / 900 / tutta), perché è
// ciò che una misura di riga può dire a parole: una casella numerica qui avrebbe
// voluto dire tararla a mano. Il valore si applica come variabile CSS sul root:
// `--conv-max` la leggono la conversazione e il composer, e un solo posto lo decide.

const KEY_LARGHEZZA = 'stark.lettura.larghezza'
const KEY_ANIM = 'stark.lettura.animazioni'

export type Larghezza = 'stretta' | 'larga' | 'tutta'

/** Il tetto in px per ogni voce. `none` è «tutta»: è la stringa che il CSS capisce,
 *  e la conversione sta qui e non in ogni componente che legge la variabile. */
const MAX: Record<Larghezza, string> = {
  stretta: '720px',
  larga: '900px',
  tutta: 'none',
}

export class Lettura {
  larghezza = $state<Larghezza>('stretta')
  riduciAnimazioni = $state(false)

  constructor() {
    try {
      const l = localStorage.getItem(KEY_LARGHEZZA)
      if (l === 'stretta' || l === 'larga' || l === 'tutta') this.larghezza = l
      this.riduciAnimazioni = localStorage.getItem(KEY_ANIM) === 'on'
    } catch { /* modalità privata: si restano i default */ }
    this.#apply()
  }

  setLarghezza(l: Larghezza): void {
    this.larghezza = l
    try { localStorage.setItem(KEY_LARGHEZZA, l) } catch { /* vedi sopra */ }
    this.#apply()
  }

  setRiduciAnimazioni(on: boolean): void {
    this.riduciAnimazioni = on
    try { localStorage.setItem(KEY_ANIM, on ? 'on' : 'off') } catch { /* vedi sopra */ }
    this.#apply()
  }

  #apply(): void {
    document.documentElement.style.setProperty('--conv-max', MAX[this.larghezza])
    // L'attributo e non una classe: lo selezionano le regole globali con lo stesso
    // selettore di `prefers-reduced-motion`, e vale su tutto il documento con una
    // regola sola — invece di ripeterlo in ogni componente che ha una transizione.
    if (this.riduciAnimazioni) document.documentElement.setAttribute('data-reduce-motion', '')
    else document.documentElement.removeAttribute('data-reduce-motion')
  }
}
