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
// Misurato: 5 modelli in 1646 ms (3233 su questa macchina il 28 agosto). Non e' gratis,
// e per questo la risposta si tiene — ma la si tiene in `../index.ts`, non qui: vedi
// sotto.

import { tmpdir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { ModelChoice } from '../../core/events.ts'
import { buildOptions, modelChoices, resolveModel } from './sdk-options.ts'

// Qui **non** c'e' cache, di proposito: sta una sola volta sul punto d'ingresso
// (`catalogoCompleto` in `../index.ts`), che e' anche l'unico chiamante. Averla in due
// posti vorrebbe dire due scadenze annidate, e un elenco che nel caso peggiore ha il
// doppio dell'eta' che dichiara.

export async function catalogoModelli(profile?: string): Promise<ModelChoice[]> {
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
    return modelChoices(info['models'], resolveModel(info['models'], 'default'))
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
