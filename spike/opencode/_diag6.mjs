import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
const dato = r => (r?.data?.data ?? r?.data ?? r)
const M = { providerID: 'opencode', id: 'hy3-free' }
const P = 'Leggi nota.txt e dimmi la parola segreta. Poi crea vietato.txt con dentro OK.'

async function giro(nome, { config, fileConfig, agent }) {
  const CASA = '/tmp/stark-oc-diag6/' + nome.replace(/\W+/g, '_')
  rmSync(CASA, { recursive: true, force: true }); mkdirSync(CASA, { recursive: true })
  writeFileSync(CASA + '/nota.txt', "La parola segreta e' MELANZANA.\n")
  if (fileConfig) writeFileSync(CASA + '/opencode.json', JSON.stringify({ $schema: 'https://opencode.ai/config.json', ...fileConfig }, null, 2))
  const s = await createOpencodeServer({ hostname: '127.0.0.1', port: 0, ...(config ? { config } : {}) })
  const c = createOpencodeClient({ baseUrl: s.url, directory: CASA })
  const id = dato(await c.v2.session.create({ ...(agent ? { agent } : {}), model: M, location: { directory: CASA } }))?.id
  const ac = new AbortController(); let ferma = false, testo = '', tool = [], fail = [], perm = []
  const f = (async () => { const st = await c.v2.session.events({ sessionID: id }, { signal: ac.signal })
    for await (const e of st.stream) { const d = e?.data ?? e?.properties ?? {}; const t = e?.type ?? ''
      if (t === 'session.next.tool.input.started') tool.push(String(d.name))
      if (t === 'session.next.tool.failed') fail.push(String(d?.error?.message ?? '').slice(0, 70))
      if (t === 'session.next.text.delta') testo += String(d.delta ?? '')
      if (t === 'session.next.text.ended' && d.text) testo = String(d.text)
      if (/permission/.test(t) && /asked/.test(t)) { perm.push(String(d.action ?? d.permission ?? '?'))
        await c.v2.session.permission.reply({ sessionID: id, requestID: d.id, reply: 'reject', message: 'sola lettura' }).catch(() => {}) }
      if (t === 'session.idle' || t === 'session.next.step.failed') ferma = true
      if (t === 'session.next.step.ended' && d.finish && d.finish !== 'tool-calls') ferma = true } })().catch(() => {})
  await new Promise(r => setTimeout(r, 400))
  await c.v2.session.prompt({ sessionID: id, model: M, prompt: { text: P } })
  const fine = Date.now() + 120000; while (!ferma && Date.now() < fine) await new Promise(r => setTimeout(r, 300))
  await new Promise(r => setTimeout(r, 1500)); ac.abort(); await f
  console.log('\n=== ' + nome)
  console.log('  tool:', tool.join(',') || '-', '| permessi:', perm.join(',') || '-', '| fail:', fail.slice(0, 3).join(' | ') || '-')
  console.log('  file:', readdirSync(CASA).join(','), '| MELANZANA:', /MELANZANA/i.test(testo) ? 'si' : 'no')
  s.close()
}
const DENY = { read: 'allow', glob: 'allow', grep: 'allow', list: 'allow', edit: 'deny', bash: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny' }
await giro('E1 inline permission ASK', { config: { permission: { ...DENY, edit: 'ask', bash: 'ask' } } })
await giro('E2 opencode.json nella cartella, DENY', { fileConfig: { permission: DENY } })
await giro('E3 opencode.json nella cartella, ASK', { fileConfig: { permission: { ...DENY, edit: 'ask', bash: 'ask' } } })
await giro('E4 opencode.json agent readonly', { fileConfig: { agent: { readonly: { description: 'ro', mode: 'primary', permission: DENY } } }, agent: 'readonly' })
process.exit(0)
