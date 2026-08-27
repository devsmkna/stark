import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
const dato = r => (r?.data?.data ?? r?.data ?? r)
const s = await createOpencodeServer({ hostname: '127.0.0.1', port: 0, config: { agent: { nudo: { description: 'nudo', mode: 'primary' } } } })
const CASA = '/tmp/stark-oc-diag3'
rmSync(CASA, { recursive: true, force: true }); mkdirSync(CASA, { recursive: true })
writeFileSync(CASA + '/nota.txt', "La parola segreta e' MELANZANA.\n")
const c = createOpencodeClient({ baseUrl: s.url, directory: CASA })
const M = { providerID: 'opencode', id: 'hy3-free' }
const ses = dato(await c.v2.session.create({ agent: 'nudo', model: M, location: { directory: CASA } }))
// il flusso GLOBALE, non quello per sessione: se il permesso viaggia altrove si vede qui
const ac = new AbortController(); let ferma = false
const tipi = new Map()
const glob = (async () => {
  const r = await fetch(s.url + '/event', { signal: ac.signal })
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) { const { done, value } = await rd.read(); if (done) break
    buf += dec.decode(value, { stream: true }); let i
    while ((i = buf.indexOf('\n\n')) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2)
      const riga = b.split('\n').find(x => x.startsWith('data: ')); if (!riga) continue
      let e; try { e = JSON.parse(riga.slice(6)) } catch { continue }
      const t = e.type ?? '?'; tipi.set(t, (tipi.get(t) ?? 0) + 1)
      const d = e.data ?? e.properties ?? {}
      if (/permission|denied|reject/i.test(t)) console.log('  ! ', t, JSON.stringify(d).slice(0, 300))
      if (t === 'session.next.tool.failed') console.log('  x  tool.failed', JSON.stringify(d).slice(0, 400))
      if (t === 'session.idle' || t === 'session.next.step.failed') ferma = true
      if (t === 'session.next.step.ended' && d.finish && d.finish !== 'tool-calls') ferma = true } }
})().catch(() => {})
await new Promise(r => setTimeout(r, 400))
await c.v2.session.prompt({ sessionID: ses.id, model: M, prompt: { text: 'Leggi nota.txt e dimmi la parola segreta.' } })
const fine = Date.now() + 90000; while (!ferma && Date.now() < fine) await new Promise(r => setTimeout(r, 300))
await new Promise(r => setTimeout(r, 1500)); ac.abort(); await glob
console.log('\ntipi visti:'); for (const [t, k] of tipi) console.log('  ', String(k).padStart(3), t)
console.log('file:', readdirSync(CASA).join(','))
s.close(); process.exit(0)
