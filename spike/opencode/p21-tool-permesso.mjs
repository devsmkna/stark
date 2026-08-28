// P21 — prova di carico del vocabolario canonico (ADR-012), secondo giro.
//
// La P20 ha fatto girare una conversazione di solo testo, e li' il modello canonico
// regge per costruzione: `text.started/delta/ended` e' gia' scritto nel vocabolario di
// dominio. Il punto in cui STARK parla dialetto Claude Code e' un altro — **tool,
// permessi ed effetti su file** — e questa sonda ci porta OpenCode dentro.
//
// Non e' «supportare OpenCode»: e' scoprire dove il modello e' scritto al livello
// sbagliato. Percio' la sonda **non traduce niente**: cattura i payload grezzi su un
// JSONL, cosi' il confronto con `docs/event-model.md` si fa dopo, a costo zero, invece
// di rifare il giro ogni volta che ci si accorge di non aver guardato un campo.
//
// Uso:  node spike/opencode/p21-tool-permesso.mjs [base] [modello] [prompt]
//
// Il prompt e' un parametro perche' i modelli free di Zen si rompono a meta' turno
// («Invalid ... stream event») e piu' e' lungo l'incarico, meno spesso arriva in fondo:
// spezzarlo in scenari corti e' l'unico modo di vedere un turno intero.
// Prerequisito: `opencode serve` acceso su una cartella di prova, NON sul repo — una
// prova automatica non ha il permesso di farsi notare da chi non l'ha lanciata, e qui
// l'agent scrive davvero su disco.

import { writeFileSync, appendFileSync, rmSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4096'
// `ModelRef` vuole `id`, NON `modelID` (imparato dalla P20: con la chiave sbagliata il
// server non protesta, ignora il campo e usa il proprio default).
const MODEL = { providerID: 'opencode', id: process.argv[3] ?? 'nemotron-3-ultra-free' }
const PROMPT = process.argv[4] ?? 'Leggi il file nota.txt. Poi scrivi la parola che hai trovato dentro un file nuovo chiamato trovata.txt. Non chiedermi conferme, fallo.'
const FUORI = process.env.P21_FUORI ?? '/tmp/p21-eventi.jsonl'

const j = async (p, init) => {
  const r = await fetch(BASE + p, init)
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { _raw: t, _status: r.status } }
}
const post = (p, body) => j(p, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

rmSync(FUORI, { force: true })

// Il modello va messo **sulla sessione**: passato solo nel prompt il server lo ignora.
const ses = (await post('/api/session', { model: MODEL })).data
console.log('sessione', ses.id, '\nmodello  ', MODEL.id, '\neventi in', FUORI, '\n')

const ac = new AbortController()
const visti = new Map()
const ordine = []
let permessiChiesti = 0
let ferma = false

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
      appendFileSync(FUORI, JSON.stringify(e) + '\n')
      if (!visti.has(t)) visti.set(t, e), ordine.push(t)
      visti.set(t + '#n', (visti.get(t + '#n') ?? 0) + 1)

      // Il permesso si concede appena arriva. `once` e non `always`: la sonda vuole
      // vedere il MECCANISMO ogni volta, e un «sempre» salvato lo spegnerebbe al
      // secondo giro senza che si capisca perche'.
      // ATTENZIONE: lo spec OpenAPI (`GET /doc`) dichiara il carico utile sotto
      // `properties`; il filo manda `data`. Verificato, non dedotto — la prima
      // versione di questa sonda leggeva `properties` e il permesso, che era
      // arrivato, non veniva mai riconosciuto ne' concesso.
      const per = e.data ?? e.properties ?? {}
      if ((t === 'permission.v2.asked' || t === 'permission.asked') && per.sessionID === ses.id) {
        permessiChiesti++
        console.log(`  permesso #${permessiChiesti}: ${per.action ?? per.permission} ${JSON.stringify(per.resources ?? per.patterns ?? '')}`)
        await post(`/api/session/${ses.id}/permission/${per.id}/reply`, { reply: 'once' })
      }
      // `session.idle` e' la fine del turno secondo OpenCode: aspettare a tempo
      // sarebbe indovinare. Restano due secondi di grazia per gli eventi in coda.
      if (t === 'session.idle' && per.sessionID === ses.id) ferma = true
      // E uno step fallito e' una fine come un'altra: senza questo ramo la sonda
      // restava tre minuti ad aspettare un `idle` che non sarebbe mai arrivato —
      // successo davvero, con l'upstream di Zen a 502.
      if (t === 'session.next.step.failed' && per.sessionID === ses.id) {
        console.log('  step fallito:', JSON.stringify(per.error).slice(0, 200))
        ferma = true
      }
    }
  }
})().catch(() => {})

await new Promise(r => setTimeout(r, 700))

// Un prompt che costringe a: leggere un file (permesso di lettura), scriverne uno
// nuovo (permesso di scrittura + effetto su disco) e lanciare un comando (bash).
// Tre categorie di permesso diverse in un turno solo.
await post(`/api/session/${ses.id}/prompt`, {
  model: MODEL,
  prompt: { text: PROMPT },
})

const scadenza = Date.now() + 180_000
while (!ferma && Date.now() < scadenza) await new Promise(r => setTimeout(r, 500))
await new Promise(r => setTimeout(r, 2000))
ac.abort(); await stream

console.log(`\n${ordine.length} tipi di evento, ${permessiChiesti} permessi chiesti\n`)
for (const t of ordine) {
  const e = visti.get(t)
  const campi = Object.keys(e.data ?? e.properties ?? e).filter(k => k !== 'type').join(', ')
  console.log(`  ${String(visti.get(t + '#n')).padStart(4)}x  ${t.padEnd(34)} ${campi.slice(0, 64)}`)
}
process.exit(0)
