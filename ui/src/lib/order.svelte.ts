// L'ordine **manuale** dei progetti nella sidebar.
//
// Sta nel browser e non sulla macchina per la stessa ragione del raggruppamento e del
// collapse (`grouping.svelte.ts`, `collapse.svelte.ts`): «su questo schermo voglio i
// progetti in quest'ordine» è del dispositivo, non del progetto.
//
// Il default è **alfabetico**: chi non riordina mai non deve accorgersi che il comando
// esiste. Dal primo trascinamento l'ordine manuale prende il sopravvento — i progetti
// riordinati stanno in testa nell'ordine scelto, quelli mai toccati (o nuovi) restano
// in coda in ordine alfabetico.

const KEY = 'stark.order'

export class Orderer {
  /** I nomi progetto nell'ordine scelto. Quelli non elencati vanno in coda, alfabetici. */
  order = $state<string[]>([])

  constructor() {
    try {
      const v = localStorage.getItem(KEY)
      if (v) this.order = JSON.parse(v)
    } catch { /* modalità privata: si resta alfabetico */ }
  }

  /** Ordina i nomi: manuali in testa (nell'ordine scelto), poi il resto in alfabetico. */
  sort(names: string[]): string[] {
    const inList = this.order.filter(n => names.includes(n))
    const rest = names.filter(n => !inList.includes(n)).sort((a, b) => a.localeCompare(b))
    return [...inList, ...rest]
  }

  /** Sposta `from` alla posizione di `to` nell'elenco ordinato di `names`. */
  move(names: string[], from: string, to: string): void {
    const current = this.sort(names)
    const fromIdx = current.indexOf(from)
    const toIdx = current.indexOf(to)
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...current]
    const [moved] = next.splice(fromIdx, 1)
    if (moved === undefined) return
    next.splice(toIdx, 0, moved)
    this.order = next
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* vedi sopra */ }
  }
}
