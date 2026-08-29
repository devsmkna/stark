// Dove STARK cerca Tailscale su QUESTA macchina, e chi risponde.
// Costo zero: solo `tailscale status --json`, che è una domanda al demone locale.
import { SO } from '../src/core/platform.ts'
import { vieTailscale, viaAttiva, statoTailscale } from '../src/daemon/tailscale.ts'

console.log(`sistema: ${SO}\n`)
console.log('vie cercate, in ordine:')
for (const v of vieTailscale()) console.log(`   ${v.dove.padEnd(8)} ${v.cmd}${v.pre.length ? ' ' + v.pre.join(' ') : ''}`)

const a = await viaAttiva()
console.log(`\nrisponde: ${a ? `${a.via.cmd} (${a.via.dove})` : 'NESSUNA'}`)
if (a) {
  const self = a.status['Self']
  console.log(`   Self.DNSName: ${self?.DNSName ?? '?'}`)
  console.log(`   BackendState: ${a.status['BackendState'] ?? '?'}`)
}
const st = await statoTailscale(4611)
console.log('\npassi del pannello:')
for (const p of st.passi) console.log(`   ${p.fatto ? '✓' : '·'} ${p.id.padEnd(11)} ${p.dettaglio ?? p.azione ?? ''}`)
console.log(`\npronto: ${st.pronto}  host: ${st.host ?? '—'}`)
process.exit(0)
