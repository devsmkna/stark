// Come si raggruppa l'elenco: **per stato** o **per progetto**.
//
// Sta nel browser e non sulla macchina per la stessa ragione del tema e della
// dimensione del testo (`theme.svelte.ts`, `textsize.svelte.ts`): «su questo schermo
// voglio vedere le chat per progetto» è del dispositivo, non del progetto — sul
// portatile con due colonne e sul fisso con dieci la risposta può benissimo essere
// diversa, e salvarla sul daemon la farebbe cambiare a sorpresa sull'altra macchina.
//
// Il default resta **per stato**, che è com'è sempre stato e resta la domanda che si
// fa più spesso aprendo STARK: *a cosa devo rispondere adesso*. «Per progetto»
// risponde a un'altra — *cosa sta succedendo su questo lavoro* — e vale quando le
// conversazioni aperte sono tante e su cartelle diverse.

const KEY = 'stark.grouping'

export type GroupBy = 'status' | 'project'
const DEFAULT: GroupBy = 'status'

export class Grouper {
  by = $state<GroupBy>(DEFAULT)

  constructor() {
    try {
      const v = localStorage.getItem(KEY)
      if (v === 'status' || v === 'project') this.by = v
    } catch { /* modalità privata: si resta sul default */ }
  }

  set(by: GroupBy): void {
    this.by = by
    try { localStorage.setItem(KEY, by) } catch { /* vedi sopra */ }
  }
}
