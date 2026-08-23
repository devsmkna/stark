// Fetta verticale: spawn -> eventi canonici -> journal -> Sleep -> replay.
//
// Non è una demo. È il banco di prova dell'invariante del §4: lo stato che la UI
// mostrerebbe dal vivo e lo stato ricostruito rileggendo il journal devono essere lo
// STESSO oggetto. Se divergono, il Sleep di ADR-005 non è implementabile e va saputo
// adesso, non quando ci sarà una UI addosso.

import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClaudeCodeAdapter } from '../adapters/claude-code/adapter.ts'
import { Journal, RawLog } from '../core/journal.ts'
import { applyTo, reduce, type SessionSnapshot } from '../core/reduce.ts'
import type { CanonicalEvent, PermissionMode } from '../core/events.ts'

const MODEL = process.env['STARK_MODEL'] ?? 'claude-sonnet-5'
const MODE = (process.env['STARK_MODE'] ?? 'auto') as PermissionMode
// I matcher sono il pannello dei permessi (§8). Vuoto = zero card = default ADR-008.
const ASK = (process.env['STARK_ASK'] ?? '').split(',').map(s => s.trim()).filter(Boolean)

const ROOT = resolve(import.meta.dirname, '../..')
const SANDBOX = resolve(ROOT, 'spike/sandbox/vslice')
const sessionId = randomUUID()

const PROMPT = process.env['STARK_PROMPT'] ?? [
  'Nella cartella corrente fai esattamente questo, in ordine:',
  "1) crea il file hello.txt con dentro la parola ciao;",
  "2) modifica hello.txt sostituendo ciao con 'ciao mondo';",
  '3) esegui il comando ls -la e dimmi quanti file vedi.',
  'Sii conciso.',
].join(' ')

rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })

const journal = new Journal(resolve(SANDBOX, `${sessionId}.jsonl`), sessionId)
const raw = new RawLog(resolve(SANDBOX, `${sessionId}.raw.jsonl`))

// Lo stato "dal vivo": è quello che avrebbe la UI collegata in questo momento.
const live: SessionSnapshot = reduce([], sessionId)
let turnEnded: (() => void) | null = null
const turnDone = new Promise<void>(res => { turnEnded = res })

const adapter = new ClaudeCodeAdapter({
  cwd: SANDBOX,
  model: MODEL,
  mode: MODE,
  askMatchers: ASK,
  onRaw: line => raw.write(line),
  onPermission: async ({ toolName }) => {
    // Qui, in STARK vero, si consulta la tabella dei toggle e solo ciò che non è già
    // consentito diventa una card. Nella fetta verticale si consente e si annota.
    console.log(`  [permesso] ${toolName} -> allow (nessuna tabella regole nella fetta)`)
    return 'allow'
  },
  onPayload: p => {
    const e = journal.append(p)   // prima il disco, poi la UI: il journal è la verità
    applyTo(live, e)
    trace(e)
    if (p.k === 'turn.ended') turnEnded?.()
  },
})

function trace(e: CanonicalEvent): void {
  const p = e.payload
  const detail =
    p.k === 'text.delta' || p.k === 'reasoning.delta' || p.k === 'tool.input.delta' ? '…' :
    p.k === 'tool.started' ? p.name :
    p.k === 'tool.ended' ? (p.ok ? 'ok' : 'KO') :
    p.k === 'session.state' ? p.state :
    p.k === 'file.edited' ? `${p.path} ${p.created ? '(creato)' : `(${p.hunks.length} hunk)`}` :
    p.k === 'command.executed' ? p.command.slice(0, 60) :
    p.k === 'action.blocked' ? `${p.by}: ${p.reason.slice(0, 60)}` :
    p.k === 'quota.updated' ? `${p.kind} ${p.status}` :
    p.k === 'notice' ? `${p.level}: ${p.text.slice(0, 90)}` :
    p.k === 'session.created' ? `${p.model} · ${p.tools.length} tool` :
    p.k === 'turn.ended' ? p.reason : ''
  // I delta sono rumore a schermo ma nel journal ci vanno tutti: la UI li ricostruisce.
  if (p.k.endsWith('.delta')) { process.stdout.write('.'); return }
  console.log(`\n#${String(e.seq).padStart(4)} ${p.k}${detail ? ' — ' + detail : ''}`)
}

const t0 = Date.now()
console.log(`STARK — fetta verticale\nmodello ${MODEL} · modalità ${MODE} · matcher [${ASK.join(',') || 'nessuno'}]`)
console.log(`sandbox ${SANDBOX}\n`)

await adapter.start()
adapter.prompt(PROMPT)
await turnDone

// ADR-005: Sleep = terminare il processo. Il journal resta, la RAM si libera.
await adapter.sleep()
journal.close()

// ─── la verifica ────────────────────────────────────────────────────────────

const replayed = reduce(Journal.read(journal.path), sessionId)

// `session.slept` arriva dopo la chiusura del journal, quindi lo stato differisce per
// costruzione: si confronta il resto. È l'unico scarto ammesso, ed è dichiarato.
const norm = (s: SessionSnapshot): string =>
  JSON.stringify({ ...s, state: 'x', stateReason: undefined, lastSeq: 0 })

const identical = norm(live) === norm(replayed)

console.log('\n\n──── esito ────')
console.log(`durata            ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`eventi nel journal ${replayed.lastSeq}`)
console.log(`turni              ${replayed.turns.length}, parti ${replayed.turns.reduce((n, t) => n + t.parts.length, 0)}`)
console.log(`file toccati       ${replayed.files.map(f => `${f.path}${f.created ? ' (creato)' : ''}`).join(', ') || '—'}`)
console.log(`comandi eseguiti   ${replayed.shell.length}`)
console.log(`bloccati           ${replayed.blocked.length}`)
console.log(`permessi chiesti   ${replayed.pendingPermissions.length} pendenti`)
console.log(`quota              ${replayed.quota ? `${replayed.quota.kind} ${replayed.quota.status}, reset ${new Date(replayed.quota.resetsAt * 1000).toLocaleTimeString('it-IT')}` : '—'}`)
console.log(`costo nominale     $${replayed.cost.nominalUsd.toFixed(4)} (listino API, NON spesa: quota fissa)`)
console.log(`capability autoMode ${replayed.capabilities?.autoMode}`)
for (const n of replayed.notices) console.log(`avviso [${n.level}] ${n.text}`)

console.log(`\nINVARIANTE §4: stato dal vivo === stato rifatto dal journal -> ${identical ? 'OK' : 'ROTTA'}`)
if (!identical) {
  console.log('\nlive     :', norm(live).slice(0, 1200))
  console.log('\nreplayed :', norm(replayed).slice(0, 1200))
  process.exitCode = 1
}
