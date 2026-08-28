// Cosa dichiara OpenCode sui propri modelli: `attachment` e `modalities` ci sono davvero?
// Costo: zero quota — si accende il server e gli si fa una domanda di configurazione.
import { tmpdir } from 'node:os'
import { clientPer, lascia } from '../src/adapters/opencode/host.ts'
const c = await clientPer(tmpdir())
const r = await (c as never as { config: { providers(): Promise<unknown> } }).config.providers()
const v = ((r as Record<string, unknown>)['data'] ?? r) as {
  providers?: Array<{ id?: string; models?: Record<string, Record<string, unknown>> }>
}
let n = 0
for (const p of v.providers ?? []) {
  for (const [mid, m] of Object.entries(p.models ?? {})) {
    if (n++ < 6) console.log(p.id, mid, JSON.stringify({
      attachment: m['attachment'], modalities: m['modalities'], name: m['name'],
    }))
  }
}
console.log('modelli totali:', n)
const conMod = (v.providers ?? []).flatMap(p => Object.values(p.models ?? {}))
console.log('con modalities:', conMod.filter(m => m['modalities']).length,
  '· con attachment=true:', conMod.filter(m => m['attachment'] === true).length,
  '· con attachment=false:', conMod.filter(m => m['attachment'] === false).length)
console.log('input distinti:', JSON.stringify([...new Set(conMod.flatMap(m =>
  ((m['modalities'] as { input?: string[] })?.input ?? [])))]))
lascia()
process.exit(0)
