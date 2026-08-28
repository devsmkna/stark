// I modelli che questo account puo' usare, senza aprire una conversazione.
//
// Perche' esiste un file per una cosa sola. L'elenco dei modelli **non e' un fatto che
// si sa a priori**, a differenza delle modalita': dipende dall'account, dal piano e
// dall'organizzazione. L'unico posto che lo dice e' `list_models`, dentro la risposta
// all'handshake — quindi elencarli vuol dire far partire il CLI e fermarlo subito.
//
// Le due cose che rendono la strada praticabile sono state **misurate** e non dedotte
// (`spike/catalogo-modelli.ts`, 5/5):
//
//   - l'handshake non consuma quota: e' la stretta di mano, non un turno;
//   - e **non lascia un trascritto** in `<profilo>/projects/`. Contava: quella cartella
//     e' esattamente cio' che la schermata di import elenca, e una sessione aperta e
//     buttata via avrebbe prodotto una chat fantasma nuova — dalla porta accanto a
//     quella che il 26 agosto era costata mezza giornata.
//
// Misurato: 5 modelli in 1646 ms. Non e' gratis, e per questo si tiene la risposta.

import { tmpdir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ModelChoice } from '../../core/events.ts'
import { buildOptions, modelChoices, resolveModel } from './sdk-options.ts'

/**
 * Per quanto ci si fida di un elenco gia' preso.
 *
 * Cinque minuti e non «per sempre» perche' i modelli **cambiano davvero** mentre STARK
 * e' acceso: un piano che scade, un login diverso, un modello nuovo pubblicato. E non
 * cinque secondi, perche' ogni scadenza costa un processo e un secondo e mezzo.
 */
const VALIDA_MS = 5 * 60 * 1000

let cache: { quando: number; profilo: string; modelli: ModelChoice[] } | null = null

/** Solo per le prove: dimentica cio' che si e' gia' chiesto. */
export function scordaCatalogo(): void { cache = null }

export async function catalogoModelli(profile?: string): Promise<ModelChoice[]> {
  const profilo = profile ?? ''
  if (cache && cache.profilo === profilo && Date.now() - cache.quando < VALIDA_MS) {
    return cache.modelli
  }

  // `tmpdir()` e non una cartella di lavoro vera: qui non si lavora, si fa una domanda.
  // Una cwd di progetto farebbe leggere al CLI la memoria e le impostazioni di quel
  // progetto per rispondere a una cosa che non dipende dal progetto.
  const options = buildOptions({
    cwd: tmpdir(), model: 'default', mode: 'default',
    ...(profile ? { profile } : {}),
  })
  // Un flusso che non manda mai niente: si vuole la stretta di mano, non un turno.
  const muto = (async function* () { await new Promise<void>(() => {}) })()
  const q = query({ prompt: muto, options })
  try {
    const info = (await q.initializationResult()) as Record<string, unknown>
    const modelli = modelChoices(info['models'], resolveModel(info['models'], 'default'))
    cache = { quando: Date.now(), profilo, modelli }
    return modelli
  } catch {
    // Un catalogo che non si riesce a leggere non e' un guasto della chat che lo ha
    // chiesto: chi sta sopra mostrera' l'agent senza modelli, e lo dira'.
    return []
  } finally {
    // `Query` e' un `AsyncGenerator`: `return()` lo chiude e porta giu' il figlio.
    // Senza, resterebbe un processo CLI vivo per ogni apertura del menu.
    await q.return(undefined as never).catch(() => { /* gia' morto */ })
  }
}
