// La famiglia del font: del dispositivo, come il tema e la dimensione. Due variabili
// indipendenti — `--sans` per il testo che si legge, `--mono` per codice e comandi —
// perché sono due scelte diverse: uno vuole leggere in un font e programmare in un
// altro, e finché stavano sulla stessa `scelto` scegliere un "Code font" sovrascriveva
// silenziosamente l'"Interface font" (bug trovato il 3 settembre 2026, mai spedito). I
// due valori storici per ciascuna sono i fallback; dal 2 settembre 2026 l'elenco si
// allarga ai font **installati sulla macchina** (`queryLocalFonts`), e un family
// qualsiasi si applica da sé con il fallback CSS dietro — un font che non c'è più si
// degrada, non rompe.

export type FontFamily = 'default' | 'system' | (string & {})

const KEY = 'stark.fontfamily'
const KEY_CODE = 'stark.codefontfamily'
const STACK: Record<FontFamily, string> = {
  default: '"IBM Plex Sans", system-ui, -apple-system, Segoe UI, sans-serif',
  system: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
}
// Il fallback del monospazio riprende esattamente lo stack statico di `--mono` in
// app.css: «Default» non deve leggersi diverso da quando questa classe non esisteva.
const STACK_CODE: Record<FontFamily, string> = {
  default: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  system: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

export class Fonter {
  scelto = $state<FontFamily>('default')
  codeScelto = $state<FontFamily>('default')

  constructor() {
    // Un family locale non è 'default' né 'system': validarlo contro lo `STACK` fisso
    // lo perderebbe a ogni ricarica (bug trovato insieme al precedente — la spunta
    // c'era ma non lasciava mai passare un nome vero). Basta che sia una stringa non
    // vuota: un font che nel frattempo è sparito dal sistema si degrada da sé, vedi
    // `#applica`.
    try {
      const v = localStorage.getItem(KEY)
      if (v) this.scelto = v
    } catch { /* modalità privata: si resta sul default */ }
    try {
      const v = localStorage.getItem(KEY_CODE)
      if (v) this.codeScelto = v
    } catch { /* vedi sopra */ }
    this.#applica(this.scelto, '--sans', STACK)
    this.#applica(this.codeScelto, '--mono', STACK_CODE)
  }

  set(f: FontFamily): void {
    this.scelto = f
    try { localStorage.setItem(KEY, f) } catch { /* vedi sopra */ }
    this.#applica(f, '--sans', STACK)
  }

  setCode(f: FontFamily): void {
    this.codeScelto = f
    try { localStorage.setItem(KEY_CODE, f) } catch { /* vedi sopra */ }
    this.#applica(f, '--mono', STACK_CODE)
  }

  /** Un family scelto fra i locali vale da solo; i due valori storici prendono il loro
   *  stack. Un family che manca sul dispositivo si degrada da sé: dopo il nome resta
   *  la lista generica, che è il fallback del CSS e non una scelta nostra. */
  #applica(f: FontFamily, variabile: '--sans' | '--mono', stack: Record<FontFamily, string>): void {
    const fallback = variabile === '--sans'
      ? 'system-ui, -apple-system, Segoe UI, sans-serif'
      : 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    const v = stack[f] ?? `'${f.replace(/'/g, "\\'")}', ${fallback}`
    document.documentElement.style.setProperty(variabile, v)
  }
}
