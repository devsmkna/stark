// Riavviare il daemon da dentro il daemon.
//
// Il pezzo che decide tutto: un processo non può riaccendere sé stesso. Serve
// qualcuno che sopravviva alla sua morte, aspetti che sia davvero morto e poi lo
// riaccenda — quindi un figlio **staccato**, che non muore col padre.
//
// Non si reinventa l'avvio: il figlio lancia `stark.ts up`, che è la via già scritta e
// già provata (systemd quando c'è, `spawn(detached)` altrimenti, e l'attesa che la
// porta risponda). Qui si aggiunge solo la parte che `up` non fa: aspettare che il
// vecchio sia morto, e ricompilare la UI.

import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const QUI = dirname(fileURLToPath(import.meta.url))
/** La radice del repo: `src/daemon/` → due su. */
export const RADICE = resolve(QUI, '..', '..')

export type EsitoRiavvio = { ok: true; pid?: number } | { ok: false; error: string }

/**
 * Accende il ricambio e restituisce subito: **non** ferma questo processo.
 *
 * Fermarlo è mestiere di chi chiama, che deve prima rispondere alla richiesta HTTP —
 * se il daemon morisse qui dentro, il browser vedrebbe la connessione cadere senza
 * mai sapere se il riavvio era partito o se era esploso qualcosa.
 */
export function avviaRicambio(
  home: string,
  opts: { rebuildUi?: boolean; log?: string } = {},
): EsitoRiavvio {
  const script = [
    // Aspetta che il vecchio non risponda più. `up` è idempotente e, trovando ancora
    // il vecchio vivo, direbbe «già acceso» e non riaccenderebbe niente: questa attesa
    // è ciò che distingue un riavvio da un no-op.
    `for i in $(seq 1 60); do kill -0 ${process.pid} 2>/dev/null || break; sleep 0.25; done`,
    // La UI è un artefatto locale: dopo un `git pull` che tocca `ui/`, senza questo il
    // browser continuerebbe a ricevere il pacchetto vecchio e il riavvio sembrerebbe
    // non aver fatto niente.
    ...(opts.rebuildUi === false ? [] : [`npm --prefix ${JSON.stringify(RADICE)} run ui:build || true`]),
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(RADICE, 'src/cli/stark.ts'))} up --no-open`,
  ].join('\n')

  try {
    const log = opts.log ? openSync(opts.log, 'a') : 'ignore'
    const figlio = spawn('/bin/sh', ['-c', script], {
      cwd: RADICE,
      detached: true,
      stdio: ['ignore', log as never, log as never],
      // L'ambiente si passa intero: un ricambio che partisse senza `STARK_HOME` o
      // senza `CLAUDE_CONFIG_DIR` guarderebbe le conversazioni sbagliate — è lo stesso
      // motivo per cui `stark.ts` le elenca a mano per systemd.
      env: { ...process.env, STARK_HOME: home },
    })
    figlio.unref()
    return figlio.pid ? { ok: true, pid: figlio.pid } : { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
