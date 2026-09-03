// Quando una vista nasce e quando muore.
//
// Sta in un file suo, senza Svelte e senza DOM, per la stessa ragione di `layout.ts`:
// è **la parte che si sbaglia davvero**. Il selettore del pannello destro che conta
// come chat, una vista che nasce mentre stai ancora scegliendo, una che sopravvive con
// un pannello solo — sono tutti errori che si vedono ragionando su un albero, non
// aprendo un browser. Qui si provano con `node` puro (`tools/viste-check.ts`).
//
// L'invariante, in una riga: **più di una chat sullo schermo ⟺ c'è una vista attiva**.

import { leafIds, type LayoutNode } from './layout.ts'

/**
 * Le foglie che sono chat vere, cioè tutte tranne il selettore.
 *
 * Il selettore (`SPLIT_PICK` nello Store) è una foglia dell'albero ma non è una chat:
 * è l'invito a sceglierne una. Contarlo vorrebbe dire far nascere una vista appena si
 * apre il selettore — e cancellarla un secondo dopo, se lo chiudi senza scegliere.
 */
export function foglieVere(tree: LayoutNode | null, selettore: string): string[] {
  return tree ? leafIds(tree).filter(id => id !== selettore) : []
}

/**
 * Cosa fare quando l'albero diventa `next`.
 *
 * · `crea`    — due chat sullo schermo e nessuna vista: la disposizione diventa una cosa
 * · `elimina` — la vista è scesa a una chat (o a zero): non è più una disposizione
 * · `scrivi`  — l'albero cambia dentro il contenitore che c'è già
 */
export type Decisione = 'crea' | 'elimina' | 'scrivi'

export function decisione(vere: number, vistaAttiva: boolean): Decisione {
  if (vere >= 2 && !vistaAttiva) return 'crea'
  if (vere <= 1 && vistaAttiva) return 'elimina'
  return 'scrivi'
}
