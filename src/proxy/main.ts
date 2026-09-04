// L'ingresso del proxy come processo: `npm run proxy`, o `node src/proxy/main.ts`.
//
// Separato da `server.ts` perché il server è una funzione che anche le prove avviano
// (con casa e porta loro), mentre QUESTO file è il processo che un giorno `stark start`
// terrà in piedi accanto al daemon (D19). Finché quell'aggancio non c'è, si avvia a
// mano — ed è voluto: l'ombra si accende su una macchina alla volta, guardandola.

import { avviaProxy, PORTA_PROXY } from './server.ts'

const p = await avviaProxy()
console.log(`[ombra] proxy su http://127.0.0.1:${p.porta} (default ${PORTA_PROXY})`)
console.log('[ombra] modalità: osservazione — inoltra identico, registra cosa avrebbe trovato')
console.log('[ombra] controllo: POST /control/sessioni {id, upstream} con Bearer <token del daemon>')

const spegni = (): void => { p.close(); process.exit(0) }
process.on('SIGINT', spegni)
process.on('SIGTERM', spegni)
