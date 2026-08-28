// La ricerca, guardata nella UI vera. Costo zero: nessun turno, solo journal esistenti.
//
// I journal si **copiano** in una casa di /tmp invece di puntare il daemon su quella
// vera. Non è scrupolo: su questa macchina il daemon di produzione ha sessioni vive
// dentro di sé, e farne partire un secondo sulla stessa casa vorrebbe dire due
// processi che scrivono gli stessi file.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'

const CASA = resolve(tmpdir(), 'stark-ricerca-ui')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })

const VERA = resolve(process.env['STARK_SORGENTE'] ?? resolve(homedir(), '.stark'), 'sessioni')
let copiati = 0
if (existsSync(VERA)) {
  for (const f of readdirSync(VERA)) {
    // Solo i journal: il file grezzo pesa il doppio e la ricerca non lo guarda.
    if (!f.endsWith('.jsonl') || f.endsWith('.raw.jsonl')) continue
    copyFileSync(resolve(VERA, f), resolve(CASA, 'sessioni', f))
    copiati++
  }
}
console.log(`${copiati} journal copiati in ${CASA}`)

process.env['STARK_HOME'] = CASA
const { startDaemon } = await import('../src/daemon/server.ts')
const daemon = await startDaemon({ port: 0, token: 'cerca'.padEnd(64, '0') })
const { url, token } = daemon
const auth = { authorization: `Bearer ${token}` }

const q = process.argv[2] ?? 'daemon'
type R = { results: { sessionId: string; title: string; total: number
  matches: { kind: string; snippet: string; at: number; len: number; turn: number }[] }[] }

// Quanto ci mette: la prima volta legge i journal, dalla seconda gli snapshot sono
// già in memoria per l'elenco. È la stessa cache che ha tolto la rilettura integrale.
const t0 = performance.now()
const r1 = await (await fetch(`${url}/api/search?q=${encodeURIComponent(q)}`, { headers: auth })).json() as R
const fredda = performance.now() - t0
const t1 = performance.now()
await fetch(`${url}/api/search?q=${encodeURIComponent(q)}`, { headers: auth })
const calda = performance.now() - t1

console.log(`\ncercando «${q}»: ${r1.results.length} conversazioni`)
console.log(`  prima richiesta: ${fredda.toFixed(0)} ms · seconda: ${calda.toFixed(1)} ms\n`)
for (const s of r1.results.slice(0, 3)) {
  console.log(`  ${s.title.slice(0, 60)}  (${s.total} volte)`)
  for (const m of s.matches.slice(0, 3)) {
    const evidenziato = m.snippet.slice(0, m.at) + '[' + m.snippet.slice(m.at, m.at + m.len) + ']'
      + m.snippet.slice(m.at + m.len)
    console.log(`    turno ${m.turn} · ${m.kind}: ${evidenziato}`)
  }
}
console.log(`\n  DA FOTOGRAFARE: ${url}/?token=${token}`)
const attesa = Number(process.env['STARK_ATTESA'] ?? 60)
console.log(`  (resto in piedi ${attesa}s)`)
await new Promise(r => setTimeout(r, attesa * 1000))
await daemon.stop()
process.exit(0)
