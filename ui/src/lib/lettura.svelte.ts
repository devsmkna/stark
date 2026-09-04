// La lettura: larghezza della conversazione, riduzione delle animazioni, e — dal 3
// settembre 2026 — un secondo zoom, indipendente da quello dell'interfaccia, per il
// testo dentro la conversazione. Tutte e tre del dispositivo, come il tema: due browser
// sullo stesso computer possono volerle diverse, e nessuna cambia cosa fa l'agent.
//
// La larghezza non è un numero libero ma tre scelte (720 / 900 / tutta), perché è
// ciò che una misura di riga può dire a parole: una casella numerica qui avrebbe
// voluto dire tararla a mano. Il valore si applica come variabile CSS sul root:
// `--conv-max` la leggono la conversazione e il composer, e un solo posto lo decide.
//
// Il testo della chat usa lo stesso `zoom` di `textsize.svelte.ts`, non `font-size`:
// stessa ragione, ~150 dichiarazioni in px in app.css. Ma non sul root — sul `.tb` di
// ogni turno (la risposta e i blocchi, non l'intestazione col prompt): quella
// intestazione è misurata da `misuraTh` in Conversation.svelte per appiccicarci sotto
// la pill del gruppo aperto, e zoomare anche lei avrebbe cambiato quella misura senza
// che `thH` se ne accorgesse — un secondo zoom annidato non tocca `getBoundingClientRect`
// allo stesso modo del primo (vedi `zoom.ts`). Tenerlo fuori dall'intestazione è quindi
// una scelta, non una svista: qui **non** scalano i prompt, solo le risposte. La riga
// `top: calc(var(--th-h) / var(--conv-body-zoom))` in app.css è il conto che tiene la
// pill al posto giusto anche a zoom diverso da 1 — vedi il commento lì.

const KEY_LARGHEZZA = 'stark.lettura.larghezza'
const KEY_ANIM = 'stark.lettura.animazioni'
const KEY_ZOOM_CHAT = 'stark.lettura.zoomchat'

export type Larghezza = 'stretta' | 'larga' | 'tutta'

/** Il tetto in px per ogni voce. `none` è «tutta»: è la stringa che il CSS capisce,
 *  e la conversione sta qui e non in ogni componente che legge la variabile. */
const MAX: Record<Larghezza, string> = {
  stretta: '720px',
  larga: '900px',
  tutta: 'none',
}

export const ZOOM_CHAT_MIN = 80
export const ZOOM_CHAT_MAX = 150
export const ZOOM_CHAT_STEP = 5
const ZOOM_CHAT_DEFAULT = 100

function clampZoomChat(n: number): number {
  const stepped = Math.round(n / ZOOM_CHAT_STEP) * ZOOM_CHAT_STEP
  return Math.min(ZOOM_CHAT_MAX, Math.max(ZOOM_CHAT_MIN, stepped))
}

export class Lettura {
  larghezza = $state<Larghezza>('stretta')
  riduciAnimazioni = $state(false)
  zoomChat = $state<number>(ZOOM_CHAT_DEFAULT)

  constructor() {
    try {
      const l = localStorage.getItem(KEY_LARGHEZZA)
      if (l === 'stretta' || l === 'larga' || l === 'tutta') this.larghezza = l
      this.riduciAnimazioni = localStorage.getItem(KEY_ANIM) === 'on'
      const z = localStorage.getItem(KEY_ZOOM_CHAT)
      if (z !== null) {
        const n = Number.parseInt(z, 10)
        if (Number.isFinite(n)) this.zoomChat = clampZoomChat(n)
      }
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

  setZoomChat(n: number): void {
    this.zoomChat = clampZoomChat(n)
    try { localStorage.setItem(KEY_ZOOM_CHAT, String(this.zoomChat)) } catch { /* vedi sopra */ }
    this.#apply()
  }

  #apply(): void {
    document.documentElement.style.setProperty('--conv-max', MAX[this.larghezza])
    // L'attributo e non una classe: lo selezionano le regole globali con lo stesso
    // selettore di `prefers-reduced-motion`, e vale su tutto il documento con una
    // regola sola — invece di ripeterlo in ogni componente che ha una transizione.
    if (this.riduciAnimazioni) document.documentElement.setAttribute('data-reduce-motion', '')
    else document.documentElement.removeAttribute('data-reduce-motion')
    // Fattore puro, non percentuale: `zoom` in CSS accetta un numero unitario, e
    // `calc(var(--th-h) / var(--conv-body-zoom))` in app.css deve poterci dividere —
    // una `calc()` non divide per una percentuale.
    document.documentElement.style.setProperty('--conv-body-zoom', String(this.zoomChat / 100))
  }
}
