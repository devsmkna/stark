// Prova a occhio dei due fatti nuovi (§10-bis): la checklist e il ritentativo.
//
// Serve un journal finto perche' non si possono produrre a comando: la checklist la
// tiene solo OpenCode e l'unico modello disponibile su questa macchina si rompe a meta'
// turno, e un ritentativo capita quando capita. Costruirli a mano non e' barare — e'
// l'unico modo di **guardare** una schermata che dipende da un evento raro, e il §4 dice
// che lo stato nasce dal journal: se si disegna bene da qui, si disegna bene sempre.
//
// Casa in /tmp e porta effimera: non tocca ne' le conversazioni vere ne' il daemon acceso.
//
//   node tools/prova-todo-retry.ts

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-prova-todo')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA

const id = '77777777-8888-9999-aaaa-bbbbbbbbbbbb'
const righe: string[] = []
let seq = 0
const t0 = Date.now() - 600_000
const ev = (payload: unknown, dt = 0): void => {
  seq += 1
  righe.push(JSON.stringify({ v: 1, seq, ts: t0 + dt, sessionId: id, payload }))
}

// Un agent che **ha** le due cose: e' la differenza fra «non ce l'ha» e «non ha niente
// da fare», e senza `todos: true` il chip non comparirebbe nemmeno con una lista piena.
ev({ k: 'session.state', state: 'starting' })
ev({
  k: 'session.created', agent: 'opencode', cwd: process.cwd(), model: 'opencode/glm-5',
  capabilities: {
    interrupt: true, switchModel: true, switchMode: true, autoMode: false,
    permissionAlways: true, questions: true, revert: true, retries: true, todos: true,
    toolProgress: true, fileBrowser: false, pty: true,
  },
  tools: [], commands: [],
  options: [
    { id: 'mode', label: 'Permissions', kind: 'mode', value: 'build', choices: [
      { value: 'build', available: true, note: 'Tutti i tool, senza restrizioni' },
      { value: 'plan', available: true, note: 'Modifiche e comandi chiedono conferma' },
    ] },
    { id: 'model', label: 'Model', kind: 'model', value: 'opencode/glm-5', choices: [
      { value: 'opencode/glm-5', label: 'GLM-5', available: true },
      { value: 'opencode/kimi-k2.5', label: 'Kimi K2.5', available: true },
    ] },
  ],
})
ev({ k: 'session.state', state: 'idle' })

ev({ k: 'turn.started', turnId: 't1', prompt: [{ type: 'text', text: 'Riordina il progetto in tre passi.' }] }, 1000)
ev({ k: 'session.state', state: 'busy' }, 1000)
ev({ k: 'step.started', stepId: 's1' }, 1200)
ev({ k: 'text.started', partId: 'p1' }, 1400)
ev({ k: 'text.ended', partId: 'p1', text: 'Faccio un piano e lo seguo.' }, 1600)

// La checklist mentre avanza: tre eventi, e ogni volta l'elenco **intero**.
ev({ k: 'todo.updated', todos: [
  { content: 'Leggere i file di configurazione', status: 'in_progress', priority: 'high' },
  { content: 'Spostare i test in una cartella sola', status: 'pending', priority: 'medium' },
  { content: 'Aggiornare il README', status: 'pending', priority: 'low' },
] }, 1800)

// Il ritentativo: e' la spiegazione della pausa che si vede sopra.
ev({ k: 'session.retried', attempt: 1, reason: 'Provider request failed with HTTP 502' }, 4000)
ev({ k: 'session.retried', attempt: 2, reason: 'Provider request failed with HTTP 502' }, 9000)

ev({ k: 'todo.updated', todos: [
  { content: 'Leggere i file di configurazione', status: 'completed', priority: 'high' },
  { content: 'Spostare i test in una cartella sola', status: 'in_progress', priority: 'medium' },
  { content: 'Aggiornare il README', status: 'pending', priority: 'low' },
] }, 12000)

ev({ k: 'text.started', partId: 'p2' }, 13000)
ev({ k: 'text.ended', partId: 'p2', text: 'Primo passo fatto, procedo col secondo.' }, 13200)
ev({ k: 'step.ended', stepId: 's1', finish: 'stop', usage: { input: 4210, output: 96, cacheRead: 0, cacheWrite: 0 } }, 13400)
ev({ k: 'turn.ended', turnId: 't1', reason: 'completed',
  usage: { input: 4210, output: 96, cacheRead: 0, cacheWrite: 0 }, cost: { nominalUsd: 0 } }, 13400)
ev({ k: 'session.state', state: 'idle' }, 13400)

writeFileSync(resolve(CASA, 'sessioni', `${id}.jsonl`), righe.join('\n') + '\n')

const { startDaemon } = await import('../src/daemon/server.ts')
const s = await startDaemon({ port: 0 })
console.log(`\n  ${s.url}/chat/${id}?token=${s.token}\n`)
console.log('  Il chip della checklist sta nella barra in basso; le due righe «Retried»')
console.log('  dentro il turno, aperto. Ctrl-C per chiudere.')
