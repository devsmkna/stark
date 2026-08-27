// I lavori che continuano da soli, guardati nella UI vera. Costo zero di quota.
//
// Non è una messinscena: prende una **cattura nativa vera** (il `.raw.jsonl` che
// l'adapter scrive accanto al journal, §13), la ripassa dal Translator e ne fa un
// journal canonico nuovo. È lo stesso percorso di una sessione dal vivo meno il
// processo — e serve proprio a questo: un comando lanciato in background si prova
// solo aspettando che finisca, e qui è già finito, registrato, con il suo esito.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Translator } from '../src/adapters/claude-code/translate.ts'
import { Journal } from '../src/core/journal.ts'
import { EMPTY_USAGE, type Payload } from '../src/core/events.ts'
import type { NativeEvent } from '../src/adapters/claude-code/raw.ts'

const CASA = resolve(tmpdir(), 'stark-task-ui')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })

// La cattura con più lavori in background dentro.
const VERE = resolve(process.env['STARK_SORGENTE'] ?? resolve(homedir(), '.stark'), 'sessioni')
let scelta = ''
let quanti = 0
if (existsSync(VERE)) {
  for (const f of readdirSync(VERE)) {
    if (!f.endsWith('.raw.jsonl')) continue
    const n = readFileSync(resolve(VERE, f), 'utf8').split('\n')
      .filter(l => l.includes('"task_started"')).length
    if (n > quanti) { quanti = n; scelta = resolve(VERE, f) }
  }
}
if (!scelta) { console.log('nessuna cattura con lavori dentro'); process.exit(1) }
console.log(`cattura: ${scelta}\n  lavori dentro: ${quanti}`)

const id = randomUUID()
const journal = new Journal(resolve(CASA, 'sessioni', `${id}.jsonl`), id)
const tr = new Translator()
const turnId = 't1'
journal.append({
  k: 'session.created', agent: 'claude-code', cwd: '/riletto-da-una-cattura',
  model: 'claude-opus-5', tools: [], commands: [],
})
journal.append({
  k: 'turn.started', turnId,
  prompt: [{ type: 'text', text: 'Rilettura di una cattura vera: i lavori in background' }],
})
tr.beginTurn(turnId)

let payloads = 0
let turno = 1
const conteggio: Record<string, number> = {}
for (const riga of readFileSync(scelta, 'utf8').split('\n')) {
  if (!riga.trim()) continue
  let nativo: NativeEvent
  try { nativo = JSON.parse(riga) as NativeEvent } catch { continue }
  for (const p of tr.handle(nativo)) {
    // I turni si ricostruiscono dove la cattura li chiude davvero (`result`), invece
    // di ficcare tutto in uno solo. Non è pignoleria: un turno unico da trentamila
    // eventi la UI non lo disegna — provato, resta bianca — e sarebbe un difetto della
    // prova, non di STARK: nella vita vera quegli eventi stanno su quaranta turni.
    if (p.k === 'turn.started') continue
    conteggio[p.k] = (conteggio[p.k] ?? 0) + 1
    journal.append(p as Payload)
    payloads++
    if (p.k === 'turn.ended') {
      turno++
      const nuovo = `t${turno}`
      journal.append({
        k: 'turn.started', turnId: nuovo,
        prompt: [{ type: 'text', text: `(turno ${turno} della cattura)` }],
      })
      tr.beginTurn(nuovo)
    }
  }
}
journal.append({
  k: 'turn.ended', turnId: `t${turno}`, reason: 'completed',
  usage: EMPTY_USAGE, cost: { nominalUsd: 0 },
})
console.log(`  turni ricostruiti: ${turno}`)
journal.close()
console.log(`  eventi canonici: ${payloads}`)
console.log(`  di cui task.started ${conteggio['task.started'] ?? 0}`
  + ` · task.ended ${conteggio['task.ended'] ?? 0}`)

process.env['STARK_HOME'] = CASA
const { startDaemon } = await import('../src/daemon/server.ts')
const daemon = await startDaemon({ port: 0, token: 'task'.padEnd(64, '0') })
const { url, token } = daemon

// Quanti lavori sono davvero finiti attaccati alla loro riga: è la domanda vera, e la
// risposta viene dallo snapshot ricostruito, non dal conteggio degli eventi.
type Snap = { snapshot: { turns: { parts: { kind: string; name?: string
  task?: { kind: string; background: boolean; status?: string; summary?: string } }[] }[] } }
const snap = (await (await fetch(`${url}/api/sessions/${id}`,
  { headers: { authorization: `Bearer ${token}` } })).json() as Snap).snapshot
const conTask = snap.turns.flatMap(t => t.parts)
  .filter(p => p.kind === 'tool' && p.task) as { name?: string
    task: { kind: string; background: boolean; status?: string; summary?: string } }[]
console.log(`\nrighe con un lavoro attaccato: ${conTask.length}`)
console.log(`  in background : ${conTask.filter(p => p.task.background).length}`)
console.log(`  sub-agent     : ${conTask.filter(p => p.task.kind === 'agent').length}`)
console.log(`  con esito     : ${conTask.filter(p => p.task.status).length}`)
console.log(`  falliti       : ${conTask.filter(p => p.task.status === 'failed').length}`)
console.log(`  con resoconto : ${conTask.filter(p => p.task.summary).length}`)
const esempio = conTask.find(p => p.task.summary && p.task.background)
if (esempio) {
  console.log(`\n  esempio: ${esempio.name} · ${esempio.task.status}`)
  console.log(`    ${esempio.task.summary?.slice(0, 160)}`)
}

console.log(`\n  DA FOTOGRAFARE: ${url}/chat/${id}?token=${token}`)
const attesa = Number(process.env['STARK_ATTESA'] ?? 120)
console.log(`  (resto in piedi ${attesa}s)`)
await new Promise(r => setTimeout(r, attesa * 1000))
await daemon.stop()
process.exit(0)
