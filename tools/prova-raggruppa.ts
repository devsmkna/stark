// Prova a occhio dei due modi di raggruppare l'elenco (28 agosto 2026): per stato e per
// progetto. Journal finti, casa in /tmp, porta effimera — non tocca né le conversazioni
// vere né il daemon acceso, e **non costa quota**: nessun processo viene aperto, perché
// l'elenco si disegna dai journal e non da chi è vivo.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-prova-raggruppa')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(resolve(CASA, 'sessioni'), { recursive: true })
process.env['STARK_HOME'] = CASA

const CAPS = {
  interrupt: true, switchModel: true, switchMode: true, autoMode: true,
  permissionAlways: true, questions: true, revert: false, toolProgress: false,
  fileBrowser: false, pty: false,
}

// Tre progetti con iniziali fuori ordine di proposito: «alfabetico» si vede solo se
// l'ordine in cui nascono non è già quello giusto.
const CHAT: [string, string, string][] = [
  ['zenith',  'il bot telegram non risponde', 'awaiting'],
  ['stark',   'ridisegno del box domande',    'busy'],
  ['acme',    'migrazione php 5.6',           'sleeping'],
  ['stark',   'la sidebar si raggruppa',      'awaiting'],
  ['zenith',  'traefik e i certificati',      'idle'],
  ['acme',    'fatture, ultimo giro',         'busy'],
  ['stark',   'quota e finestre',             'sleeping'],
  ['acme',    'import da csv',                'idle'],
]

CHAT.forEach(([progetto, titolo, stato], i) => {
  const id = `${String(i + 1).repeat(8)}-1111-4111-8111-111111111111`
  const righe: string[] = []
  let seq = 0
  const t0 = Date.now() - (CHAT.length - i) * 600_000
  const ev = (payload: unknown): void => {
    seq += 1
    righe.push(JSON.stringify({ v: 1, seq, ts: t0 + seq * 1000, sessionId: id, payload }))
  }
  ev({ k: 'session.state', state: 'starting' })
  ev({ k: 'session.created', agent: 'claude-code', cwd: `/root/lavoro/${progetto}`,
    model: 'claude-opus-5[1m]', capabilities: CAPS, tools: [], commands: [] })
  ev({ k: 'session.renamed', title: titolo })
  ev({ k: 'turn.started', turnId: 't1', prompt: [{ type: 'text', text: titolo }] })
  ev({ k: 'text.started', partId: 'p1' })
  ev({ k: 'text.ended', partId: 'p1', text: 'una risposta qualunque, serve solo a esserci' })
  ev({ k: 'turn.ended', turnId: 't1', reason: 'completed' })
  ev({ k: 'session.state', state: stato })
  writeFileSync(resolve(CASA, 'sessioni', `${id}.jsonl`), righe.join('\n') + '\n')
})

const { startDaemon } = await import('../src/daemon/server.ts')
const daemon = await startDaemon({ port: 0, token: 'prova'.padEnd(64, '0') })
console.log(`${daemon.url}/?token=${daemon.token}`)
