// Quando una conversazione merita di chiamarti, e come si chiama quella chiamata.
//
// Sta in `core/` per la stessa ragione per cui ci stanno `reduce` e `applyTo`: adesso
// la stessa domanda se la pongono in **due posti**. Il browser, per suonare e mostrare
// la notifica di sistema mentre la pagina è aperta; il daemon, per mandare il push al
// telefono quando la pagina non c'è più — che è l'unico caso in cui il telefono può
// essere avvisato davvero, perché a schermo spento nel browser non gira niente.
//
// Due copie della stessa regola vorrebbe dire che un giorno il telefono suona e il
// portatile no, o viceversa, e nessuno saprebbe quale delle due ha ragione.

/** I tre motivi per cui vale la pena interrompere quello che stai facendo. */
export type Call = 'needsYou' | 'done' | 'stopped'

/** Gli stati in cui una conversazione sta lavorando: da lì «ha finito» ha senso. */
const WORKING = new Set(['busy', 'starting', 'awaiting'])

/**
 * Quale delle tre chiamate merita un passaggio di stato — o nessuna.
 *
 * Fermarsi da sola e fermarsi perché gliel'hai detto tu portano allo stesso stato, e
 * non si distinguono da qui: a non gridarti in faccia mentre sei sulla chat ci pensa
 * chi chiama, che sa cosa stai guardando.
 */
export function callFor(was: string, now: string): Call | null {
  if (now === 'awaiting') return 'needsYou'
  if (!WORKING.has(was)) return null
  // Aprire una chat la porta da `starting` a `idle` senza che nessuno abbia fatto
  // niente: chiamarti «ha finito» per una conversazione appena nata sarebbe la prima
  // notifica falsa, e una notifica falsa insegna a spegnerle tutte.
  if (now === 'idle') return was === 'starting' ? null : 'done'
  if (now === 'closed' || now === 'error') return 'stopped'
  return null
}

/** Come si apre la notifica. Prima parola, quella che si legge senza aprire niente. */
export const CALL_HEAD: Record<Call, string> = {
  needsYou: 'Needs you', done: 'Done', stopped: 'Stopped',
}
