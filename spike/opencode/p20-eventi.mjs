// Prova di carico del vocabolario canonico (ADR-012): quali eventi produce OpenCode
// per una conversazione, e come si mappano su `docs/event-model.md`.
//
// Non e' «supportare OpenCode»: e' scoprire dove il modello canonico e' scritto nel
// vocabolario di Claude Code invece che in quello di dominio.
const BASE = process.argv[2] ?? 'http://127.0.0.1:4096'
// `ModelRef` vuole `id`, non `modelID`. Con la chiave sbagliata il server **non
// protesta**: ignora il campo e usa il proprio default. E' il genere di errore che si
// paga tre volte prima di trovarlo, quindi sta scritto qui.
const MODEL = { providerID: 'opencode', id: process.argv[3] ?? 'nemotron-3-ultra-free' }

const j = async (p, init) => {
  const r = await fetch(BASE + p, init)
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { _raw: t, _status: r.status } }
}

// Il modello va messo **sulla sessione**: passato solo nel prompt il server lo ignora
// e usa il proprio default (misurato: chiedendo `nemotron` rispondeva
// «Model x-preview-f-free is not supported», cioe' big-pickle, che e' giu' a monte).
const ses = (await j('/api/session', { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: MODEL }) })).data
console.log('sessione', ses.id)

// Il flusso globale, non quello per sessione: la sonda P06 si bloccava proprio li'.
const ac = new AbortController()
const visti = new Map()
const ordine = []
const stream = (async () => {
  const r = await fetch(`${BASE}/api/event`, { signal: ac.signal })
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    const { done, value } = await rd.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const blocco = buf.slice(0, i); buf = buf.slice(i + 2)
      const riga = blocco.split('\n').find(x => x.startsWith('data: '))
      if (!riga) continue
      let e; try { e = JSON.parse(riga.slice(6)) } catch { continue }
      const t = e.type ?? '?'
      if (!visti.has(t)) { visti.set(t, e); ordine.push(t) }
      visti.set(t + '#count', (visti.get(t + '#count') ?? 0) + 1)
    }
  }
})().catch(() => {})

await new Promise(r => setTimeout(r, 700))
await j(`/api/session/${ses.id}/prompt`, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: MODEL, prompt: { text: 'Di\' soltanto: pronto' } }) })

await new Promise(r => setTimeout(r, 25000))
ac.abort(); await stream

console.log(`\ntipi di evento visti: ${ordine.length}\n`)
for (const t of ordine) {
  const e = visti.get(t)
  const campi = Object.keys(e.properties ?? e).filter(k => k !== 'type').join(', ')
  console.log(`  ${String(visti.get(t + '#count')).padStart(3)}x  ${t.padEnd(26)} ${campi.slice(0, 70)}`)
}
process.exit(0)
