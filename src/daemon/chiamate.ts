// Quando una chat merita di chiamarti, e su quali canali.
//
// La decisione sta in `core/calls.ts` (`callFor`) perché la prendono in due: il browser,
// per suonare mentre lo guardi, e il daemon, per raggiungerti quando non lo guardi. Qui
// c'è l'altra metà: **chi** osserva, e **a chi** lo dice.
//
// Un osservatore solo, N canali. Due osservatori indipendenti avrebbero due mappe dello
// stato precedente e due debounce: basta un riavvio, o uno scarto di 250 ms, perché un
// canale dica «ha finito» e l'altro no — e a quel punto non si sa quale dei due ha
// ragione. La ragione per cui `callFor` sta in `core/` è esattamente questa, e va
// portata fino in fondo.

import { CALL_HEAD, callFor } from '../core/calls.ts'
import type { PushPayload } from './push.ts'

/** Un posto dove una chiamata può arrivare. Oggi ce n'è uno: il Web Push. */
export type Canale = {
  readonly disponibile: boolean
  manda(p: PushPayload): Promise<void>
}

type Riga = { id: string; title: string; state: string; cwd?: string }
type Impostazioni = { projects: Record<string, { muted?: boolean }> }

/**
 * Guarda l'elenco e chiama quando serve.
 *
 * @param settings letta a ogni giro, non catturata: le impostazioni cambiano a caldo, e
 *   un progetto silenziato mentre il daemon è acceso deve tacere subito.
 */
export function vigila(
  registry: {
    list(): Riga[]
    watchAll(f: () => void): () => void
    settings(): Impostazioni
  },
  canali: Canale[],
): () => void {
  // Lo stato di partenza si prende **prima** di iscriversi, e il primo giro non
  // notifica niente: senza, riavviare il daemon manderebbe una raffica di «ha finito»
  // per conversazioni ferme da ore. Lo stesso motivo per cui la UI ha `#greeted`.
  let prima = new Map(registry.list().map(r => [r.id, r.state]))

  let timer: ReturnType<typeof setTimeout> | null = null
  const guarda = (): void => {
    timer = null
    const righe = registry.list()
    const dopo = new Map(righe.map(r => [r.id, r.state]))
    const progetti = registry.settings().projects
    for (const r of righe) {
      const era = prima.get(r.id)
      if (era === undefined || era === r.state) continue
      const kind = callFor(era, r.state)
      if (!kind) continue
      // Un progetto silenziato tace **su tutti i canali**. Prima questo controllo
      // esisteva solo nella UI (`store.svelte.ts`), quindi la pagina taceva e il daemon
      // mandava il push lo stesso: silenziare un progetto non lo silenziava affatto,
      // spegneva solo l'unica metà che si vedeva.
      if (r.cwd && progetti[r.cwd]?.muted) continue
      const p: PushPayload = {
        kind,
        title: `${CALL_HEAD[kind]} · ${cartella(r.cwd)}`,
        body: r.title,
        sessionId: r.id,
      }
      for (const c of canali) if (c.disponibile) void c.manda(p)
    }
    prima = dopo
  }

  // Stessa attesa del flusso dell'elenco, e per la stessa ragione: un turno solo
  // produce decine di eventi al secondo, e `list()` rilegge i journal da disco.
  return registry.watchAll(() => { if (timer === null) timer = setTimeout(guarda, 250) })
}

/** Il nome del progetto: l'ultimo pezzo del percorso, come nell'elenco della UI. */
function cartella(cwd?: string): string {
  if (!cwd) return 'no folder'
  return cwd.replace(/\/+$/, '').split('/').pop() || cwd
}
