import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
const dato = r => (r?.data?.data ?? r?.data ?? r)
const s = await createOpencodeServer({ hostname: '127.0.0.1', port: 0, config: { agent: { nudo: { description: 'nudo', mode: 'primary' } } } })
const CASA = '/tmp/stark-oc-diag4'
rmSync(CASA, { recursive: true, force: true }); mkdirSync(CASA, { recursive: true })
writeFileSync(CASA + '/nota.txt', "La parola segreta e' MELANZANA.\n")
const c = createOpencodeClient({ baseUrl: s.url, directory: CASA })
const M = { providerID: 'opencode', id: 'hy3-free' }
const ses = dato(await c.v2.session.create({ agent: 'nudo', model: M, location: { directory: CASA } }))
const ac = new AbortController(); let ferma = false
const tipi = new Map()
const f = (async () => { const st = await c.v2.session.events({ sessionID: ses.id }, { signal: ac.signal })
  for await (const e of st.stream) { const d = e?.data ?? e?.properties ?? {}; const t = e?.type ?? '?'
    tipi.set(t, (tipi.get(t) ?? 0) + 1)
    if (/permission|denied/i.test(t)) console.log('  !', t, JSON.stringify(d).slice(0, 400))
    if (t === 'session.next.tool.failed') console.log('  x tool.failed:', JSON.stringify(d).slice(0, 600))
    if (t === 'session.idle' || t === 'session.next.step.failed') ferma = true
    if (t === 'session.next.step.ended' && d.finish && d.finish !== 'tool-calls') ferma = true } })().catch(e => console.log('flusso:', e.message))
await new Promise(r => setTimeout(r, 400))
await c.v2.session.prompt({ sessionID: ses.id, model: M, prompt: { text: 'Leggi nota.txt e dimmi la parola segreta.' } })
const fine = Date.now() + 90000; while (!ferma && Date.now() < fine) await new Promise(r => setTimeout(r, 300))
await new Promise(r => setTimeout(r, 1500)); ac.abort(); await f
console.log('\ntipi:'); for (const [t, k] of tipi) console.log('  ', String(k).padStart(3), t)
s.close(); process.exit(0)
