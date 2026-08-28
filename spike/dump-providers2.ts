import { tmpdir } from 'node:os'
import { clientPer, lascia } from '../src/adapters/opencode/host.ts'
const c = await clientPer(tmpdir()) as never as {
  config: { providers(): Promise<unknown> }
  v2: { model: { list(): Promise<unknown> } }
}
const r = await c.config.providers()
const v = ((r as Record<string, unknown>)['data'] ?? r) as Record<string, unknown>
console.log('chiavi risposta:', Object.keys(v).join(' '))
const p0 = (v['providers'] as Array<Record<string, unknown>>)[0]!
const [mid, m0] = Object.entries(p0['models'] as Record<string, unknown>)[0]!
console.log('provider', p0['id'], 'modello', mid)
console.log(JSON.stringify(m0, null, 2).slice(0, 1200))
// L'altra porta: il catalogo generale, quello da 7.326 voci.
const l = await c.v2.model.list()
const arr = ((l as Record<string, unknown>)['data'] ?? l) as unknown[]
console.log('v2.model.list:', Array.isArray(arr) ? arr.length : typeof arr)
if (Array.isArray(arr)) console.log(JSON.stringify(arr[0], null, 2).slice(0, 1200))
lascia(); process.exit(0)
