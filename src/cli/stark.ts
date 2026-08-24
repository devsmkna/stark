// Avvia il daemon e stampa come raggiungerlo.

import { startDaemon } from '../daemon/server.ts'
import { STARK_HOME } from '../daemon/registry.ts'

const daemon = await startDaemon({
  ...(process.env['STARK_PORT'] ? { port: Number(process.env['STARK_PORT']) } : {}),
  ...(process.env['STARK_MODEL'] ? { model: process.env['STARK_MODEL'] } : {}),
})

console.log(`\n  Apri STARK:  ${daemon.url}/?token=${daemon.token}\n`)
console.log(`Il token sta nell'indirizzo una volta sola: al primo caricamento STARK lo`)
console.log(`sposta in un cookie e lo toglie dalla barra degli indirizzi.`)
console.log(`\njournal in ${STARK_HOME}/sessioni`)
console.log(`\ntoken: ${daemon.token}`)
console.log(`\nEsempio:\n  curl -s ${daemon.url}/api/sessions -H "Authorization: Bearer ${daemon.token}"`)
console.log(`\nIl token cambia a ogni avvio: non è un segreto da conservare, è ciò che`)
console.log(`impedisce a un'altra pagina del browser di parlare con questo processo.`)

const spegni = async (): Promise<void> => {
  console.log('\nchiusura…')
  await daemon.stop()
  process.exit(0)
}
process.on('SIGINT', () => { void spegni() })
process.on('SIGTERM', () => { void spegni() })
