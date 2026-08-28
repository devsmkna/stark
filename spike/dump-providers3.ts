import { tmpdir } from 'node:os'
import { clientPer, lascia } from '../src/adapters/opencode/host.ts'
const c = await clientPer(tmpdir()) as never as { config: { providers(): Promise<unknown> } }
const r = await c.config.providers()
const v = ((r as Record<string, unknown>)['data'] ?? r) as {
  providers?: Array<{ id?: string; models?: Record<string, Record<string, unknown>> }>
}
const tutti = (v.providers ?? []).flatMap(p => Object.entries(p.models ?? {})
  .map(([mid, m]) => ({ id: `${p.id}/${mid}`, cap: m['capabilities'] as Record<string, unknown> })))
const inp = (x: typeof tutti[number], k: string) =>
  Boolean((x.cap?.['input'] as Record<string, boolean> | undefined)?.[k])
console.log('totali', tutti.length,
  '· senza capabilities', tutti.filter(x => !x.cap).length,
  '· attachment', tutti.filter(x => x.cap?.['attachment'] === true).length,
  '· image', tutti.filter(x => inp(x, 'image')).length,
  '· pdf', tutti.filter(x => inp(x, 'pdf')).length,
  '· audio', tutti.filter(x => inp(x, 'audio')).length,
  '· video', tutti.filter(x => inp(x, 'video')).length)
console.log('attachment=true ma image=false:',
  tutti.filter(x => x.cap?.['attachment'] === true && !inp(x, 'image')).map(x => x.id).slice(0, 5))
console.log('image=true ma attachment=false:',
  tutti.filter(x => !x.cap?.['attachment'] && inp(x, 'image')).map(x => x.id).slice(0, 5))
console.log('esempi image:', tutti.filter(x => inp(x, 'image')).map(x => x.id).slice(0, 5))
lascia(); process.exit(0)
