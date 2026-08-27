// Prova a occhio del comportamento «i tagli stanno sopra il bordo»: un journal finto
// con due `/clear` di fila e pochissimo dopo — il caso dello screenshot, quello in cui
// la conversazione viva da sola non riempie nemmeno mezza schermata. Casa in /tmp e
// porta effimera: non tocca né le conversazioni vere né il daemon acceso.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-prova-clear')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA

const id = '11111111-2222-3333-4444-555555555555'
const righe: string[] = []
let seq = 0
const t0 = Date.now() - 3600_000
const ev = (payload: unknown, dt = 0): void => {
  seq += 1
  righe.push(JSON.stringify({ v: 1, seq, ts: t0 + dt, sessionId: id, payload }))
}
ev({ k: 'session.state', state: 'starting' })
ev({ k: 'session.created', agent: 'claude-code', cwd: process.cwd(), model: 'claude-opus-5[1m]',
  capabilities: { interrupt: true, switchModel: true, switchMode: true, autoMode: true,
    permissionAlways: true, questions: true, revert: false, toolProgress: false,
    fileBrowser: false, pty: false }, tools: [], commands: [] })

let n = 0
const turno = (prompt: string, risposta: string, clear = false): void => {
  const tid = `t${++n}`
  ev({ k: 'turn.started', turnId: tid, prompt: [{ type: 'text', text: prompt }] }, n * 1000)
  ev({ k: 'text.started', partId: `p${n}` }, n * 1000)
  ev({ k: 'text.ended', partId: `p${n}`, text: risposta }, n * 1000)
  if (clear) ev({ k: 'context.cleared', ref: `ref-${n}` }, n * 1000)
  ev({ k: 'turn.ended', turnId: tid, reason: 'completed' }, n * 1000)
}
turno('primo lavoro, quello vecchio', 'fatto il primo')
turno('secondo lavoro', 'fatto il secondo')
turno('/clear', 'contesto azzerato', true)
turno('/clear', 'contesto azzerato di nuovo', true)
turno('la nuova conversazione comincia qui', 'ecco la risposta, corta')
ev({ k: 'session.state', state: 'stopped' })
writeFileSync(resolve(CASA, 'sessioni', `${id}.jsonl`), righe.join('\n') + '\n')

// Seconda sessione: il `/clear` è **l'ultima** cosa successa, quindi il capitolo vivo
// non ha ancora nemmeno un turno. È il caso subito dopo il comando, e senza il capitolo
// vuoto le due righe resterebbero in mezzo a una schermata deserta.
const id2 = '99999999-2222-3333-4444-555555555555'
righe.length = 0; seq = 0; n = 0
ev({ k: 'session.state', state: 'starting' })
ev({ k: 'session.created', agent: 'claude-code', cwd: process.cwd(), model: 'claude-opus-5[1m]',
  capabilities: { interrupt: true, switchModel: true, switchMode: true, autoMode: true,
    permissionAlways: true, questions: true, revert: false, toolProgress: false,
    fileBrowser: false, pty: false }, tools: [], commands: [] })
turno('un lavoro vecchio', 'fatto')
turno('/clear', 'contesto azzerato', true)
ev({ k: 'session.state', state: 'stopped' })
writeFileSync(resolve(CASA, 'sessioni', `${id2}.jsonl`),
  righe.join('\n').replaceAll(id, id2) + '\n')

const { startDaemon } = await import('../src/daemon/server.ts')
const daemon = await startDaemon({ port: 0, token: 'prova'.padEnd(64, '0') })
console.log(`${daemon.url}/chat/${id}?token=${daemon.token}`)
