// Quali progetti sono **chiusi** nell'elenco.
//
// Sta nel browser e non sulla macchina per la stessa ragione del tema: «su questo
// schermo voglio vedere solo questi progetti» è del dispositivo, non del progetto —
// e salvarlo sul daemon lo farebbe cambiare a sorpresa sull'altra macchina.
//
// Il default è **tutto aperto**: chi non tocca mai il comando non deve accorgersi
// che esiste. Un progetto chiuso resta chiuso finché lo riapri, per dispositivo.

const KEY = 'stark.collapsed'

export class Collapser {
  closed = $state<Set<string>>(new Set())

  constructor() {
    try {
      const v = localStorage.getItem(KEY)
      if (v) this.closed = new Set(JSON.parse(v))
    } catch { /* modalità privata: si resta tutto aperto */ }
  }

  /** Apre o chiude un progetto. Ritorna il nuovo stato, così il chiamante può
   *  decidere se il progetto chiuso ha ancora qualcosa da mostrare. */
  toggle(name: string): boolean {
    const next = new Set(this.closed)
    if (next.has(name)) next.delete(name); else next.add(name)
    this.closed = next
    try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch { /* vedi sopra */ }
    return next.has(name)
  }

  isClosed(name: string): boolean {
    return this.closed.has(name)
  }
}
