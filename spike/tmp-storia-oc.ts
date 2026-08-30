// Sonda lampo: le rotte della storia di una sessione OpenCode, raw.
import { clientPer } from '../src/adapters/opencode/host.ts'

const c = await clientPer('/tmp/stark-oc-import')
const ses = 'ses_fac2c90f3ffezzMVO21cKO5hFr'
const crudo = (r: unknown): string =>
  JSON.stringify(r, (k, v) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v))

try {
  const m = await c.v2.session.messages({ sessionID: ses } as never)
  console.log('messages RAW (prime 1500):', crudo(m).slice(0, 1500))
} catch (e) { console.log('messages ERRORE:', String(e).slice(0, 300)) }

try {
  const h = await c.v2.session.history({ sessionID: ses } as never)
  console.log('\nhistory RAW (prime 2500):', crudo(h).slice(0, 2500))
  console.log('\nhistory lunghezza:', crudo(h).length)
} catch (e) { console.log('history ERRORE:', String(e).slice(0, 300)) }
process.exit(0)
