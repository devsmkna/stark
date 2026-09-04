// L'ingresso del proxy come processo staccato: `stark start`/`stark up` lo lanciano
// esattamente come lanciano il daemon (D19: «si risorveglia, come il daemon»), con lo
// stesso meccanismo di sopravvivenza al terminale (`avviaStaccato` in `cli/stark.ts`,
// che rilancia questo file con `spawn(detached)` o `systemd-run` a seconda della
// piattaforma — la stessa macchina, parametrizzata, non una copia).
//
// Questo file fa per il proxy ciò che il ramo `run` di `stark.ts` fa per il daemon:
// rifiuta di partire se un'istanza risulta già viva, scrive il proprio pid appena il
// server ascolta, e lo toglie alla chiusura — pulita (SIGINT/SIGTERM) o richiesta via
// HTTP (`POST /control/spegni`, la via che serve su Windows).

import { STARK_HOME } from '../daemon/registry.ts'
import { clearPid, logPath, pidPath, runningPid, writePid } from '../daemon/identity.ts'
import { avviaProxy, PORTA_PROXY } from './server.ts'

const NOME = 'proxy'

const gia = runningPid(STARK_HOME, NOME)
if (gia !== null) {
  console.error(`[ombra] un proxy risulta già in esecuzione (pid ${gia}, ${pidPath(STARK_HOME, NOME)}).`)
  process.exit(1)
}

const p = await avviaProxy({ home: STARK_HOME })
writePid(STARK_HOME, process.pid, NOME)

console.log(`[ombra] proxy su http://127.0.0.1:${p.porta} (default ${PORTA_PROXY}), pid ${process.pid}`)
console.log(`[ombra] modalità: osservazione — inoltra identico, registra cosa avrebbe trovato`)
console.log(`[ombra] log: ${logPath(STARK_HOME, NOME)}`)

let chiudendo = false
const spegni = (): void => {
  if (chiudendo) return
  chiudendo = true
  p.close()
  clearPid(STARK_HOME, NOME)
  process.exit(0)
}
process.on('SIGINT', spegni)
process.on('SIGTERM', spegni)
