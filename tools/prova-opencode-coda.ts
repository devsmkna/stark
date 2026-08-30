// Le tre domande del 30 agosto sul secondo adapter, misurate dal vivo in una
// sessione sola (due turni):
//   1. la coda — cosa fa davvero il server quando un prompt arriva mentre un
//      tool gira. La fila FIFO «e' del protocollo» (adapter.ts), ma il traduttore
//      tiene **un turno alla volta**: se il server accoda e STARK no, il secondo
//      prompt apre il turno sotto i piedi del primo.
//   2. file e comandi — che forma hanno `state.input`/`state.output` delle parti
//      tool bash/write/edit sul filo, per tradurle in §9 (`file.edited`,
//      `command.executed`) come fa l'adapter di Claude Code.
//   3. l'import — cosa tornano `session.list` e `session.messages` dell'SDK v2.
//
// Costa due turni brevi su un modello gratuito (il primo gira `sleep 8`).
//   node tools/prova-opencode-coda.ts
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  OpenCodeAdapter, catalogoModelli,
} from '../src/adapters/opencode/adapter.ts'
import { clientPer } from '../src/adapters/opencode/host.ts'
import { applyTo, type SessionSnapshot } from '../src/core/reduce.ts'
import {
  MODEL_VERSION, promptText, type CanonicalEvent, type PermissionMode,
} from '../src/core/events.ts'

const CASA = resolve(tmpdir(), 'stark-oc-prova')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })

// ─── il modello: gratuito se c'e', altrimenti quello che l'utente impone ─────
const catalogo = await catalogoModelli()
const libero = catalogo.find(m =>
  m.cost && m.cost.input === 0 && m.cost.output === 0)
const MODELLO = process.env['STARK_OC_MODELLO'] ?? libero?.id ?? 'opencode/gpt-5-nano'
console.log(`modello: ${MODELLO}${libero?.id === MODELLO ? ' (gratuito)' : ''}`)

let seq = 0
const snap = {
  v: 1, sessionId: 'oc', state: 'starting', tools: [], slashCommands: [],
  models: [], modes: [], options: [], todos: [], mcpServers: [], turns: [], files: [], shell: [],
  pendingPermissions: [], pendingQuestions: [], pendingPlans: [], blocked: [], notices: [],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: { nominalUsd: 0 },
  quotaWindows: [], lastSeq: 0, lastTs: 0, stateSince: 0,
} as SessionSnapshot

const t0 = Date.now()
const cronologia: string[] = []
const grezzi: Array<{ t: number; tipo: string; parte: unknown }> = []
/** L'id di sessione OpenCode, come lo dichiara l'adapter (`session.resumeRef`). */
let sessionOc = ''

const adatta = (s: string | undefined | null): string => {
  const t = s ?? ''
  return t.length > 160 ? `${t.slice(0, 160)}…` : t
}

const adapter = new OpenCodeAdapter(
  { cwd: CASA, model: MODELLO, mode: 'build' as PermissionMode },
  {
  onPayload: p => {
    const e: CanonicalEvent = { v: MODEL_VERSION, seq: ++seq, ts: Date.now(), sessionId: 'oc', payload: p }
    applyTo(snap, e)
    const el = `${String(Date.now() - t0).padStart(6)}ms`
    if (p.k === 'turn.started') cronologia.push(`${el}  aperto  ${p.turnId.slice(0, 8)}  «${adatta(promptText(p.prompt))}»`)
    if (p.k === 'turn.ended') cronologia.push(`${el}  chiuso  ${p.turnId.slice(0, 8)}  ${p.reason}`)
    if (p.k === 'session.state') cronologia.push(`${el}  stato   ${p.state}`)
    if (p.k === 'tool.started') cronologia.push(`${el}  tool    ${p.name}`)
    if (p.k === 'tool.input.ended') cronologia.push(`${el}  input   ${adatta(p.summary ?? JSON.stringify(p.input))}`)
    if (p.k === 'tool.ended') cronologia.push(`${el}  esito   ${p.ok ? 'ok' : adatta(p.error ?? 'no')}`)
    if (p.k === 'session.error') cronologia.push(`${el}  errore  ${adatta(p.message)}`)
    if (p.k === 'session.resumeRef') sessionOc = p.ref
  },
  onRaw: e => {
    const tipo = String(e.type ?? '')
    const d = ((e as { data?: unknown }).data ?? (e as { properties?: unknown }).properties ?? {}) as Record<string, unknown>
    const parte = (d['part'] ?? d) as unknown
    grezzi.push({ t: Date.now() - t0, tipo, parte })
  },
  },
)

// ─── 1+2: un turno lento (bash + write + edit), e un secondo prompt a metà ───
await adapter.start()
const tUno = adapter.prompt(
  'Do exactly these three things, in order, with your tools: ' +
  '1) run the shell command `sleep 8` ' +
  `2) create the file ${CASA}/x.txt with the single line "uno" ` +
  `3) edit that same file replacing "uno" with "due". ` +
  'Then reply with the single word FATTO.',
)
console.log(`\nturno 1: ${tUno.slice(0, 8)}`)
await new Promise(r => setTimeout(r, 5000))
const tDue = adapter.prompt('Reply with only the word SECONDO.')
console.log(`turno 2 (a +5s, mentre sleep 8 dovrebbe girare): ${tDue.slice(0, 8)}`)

const conTermine = (p: Promise<void>, ms: number): Promise<void> =>
  Promise.race([p, new Promise<void>(r => setTimeout(r, ms))])
await conTermine(adapter.settled(), 150_000)
await conTermine(adapter.settled(), 30_000)
// Se il server ha messo in coda il secondo prompt, lo esegue **dopo** l'idle:
// dodici secondi di silenzio in piu' lo lasciano comparire nella cronologia.
await new Promise(r => setTimeout(r, 12_000))

console.log('\n— cronologia canonica —')
console.log(cronologia.join('\n'))

console.log('\n— snapshot —')
console.log(JSON.stringify({
  turni: snap.turns.length,
  turniAperti: snap.turns.filter(t => !t.ended).length,
  files: snap.files.length, shell: snap.shell.length,
  perTurno: snap.turns.map(t => ({
    prompt: adatta(promptText(t.prompt ?? []) ?? ''),
    testo: adatta((t.parts ?? []).map(p => (p.kind === 'text' ? p.text : '')).join('').trim()),
    ended: t.ended ?? false, reason: t.ended?.reason ?? null,
  })),
}))

console.log('\n— 1: il filo fra il secondo prompt e i 5s dopo —')
const da = grezzi.filter(g => g.t >= 5000 && g.t <= 10500)
for (const g of da) console.log(`${String(g.t).padStart(6)}ms  ${g.tipo}`)

console.log('\n— 2: le parti tool, con la loro forma vera —')
const viste = new Set<string>()
for (const g of grezzi) {
  const p = (g.parte ?? {}) as Record<string, unknown>
  if (String(p['type']) !== 'tool') continue
  const nome = String(p['tool'])
  const stato = (p['state'] ?? {}) as Record<string, unknown>
  const chiave = `${nome}:${String(stato['status'])}`
  if (viste.has(chiave)) continue
  viste.add(chiave)
  console.log(`${chiave}`)
  console.log(`  input : ${adatta(JSON.stringify(stato['input'] ?? null))}`)
  console.log(`  output: ${adatta(JSON.stringify(stato['output'] ?? stato['metadata'] ?? null))}`)
}

// ─── 3: elenco e storia, come li vedrebbe l'import ───────────────────────────
console.log('\n— 3: session.list e session.messages —')
const c = await clientPer(CASA)
try {
  const lista = await c.v2.session.list() as unknown as {
    data?: Array<Record<string, unknown>>
  }
  const righe = lista.data ?? []
  console.log(`session.list: ${righe.length} sessioni (di tutte le cartelle)`)
  for (const r of righe.slice(0, 3)) console.log(`  ${adatta(JSON.stringify(r))}`)
  const nostra = righe.find(r => JSON.stringify(r).includes(sessionOc))
  console.log(`la sessione di questa prova e' nell'elenco: ${nostra ? 'si\'' : 'no'}`)

  const messaggi = await c.v2.session.messages({ sessionID: sessionOc } as never) as unknown as {
    data?: Array<Record<string, unknown>>
  }
  const elenco = messaggi.data ?? []
  console.log(`session.messages: ${elenco.length} messaggi`)
  for (const m of elenco) console.log(`  ${adatta(JSON.stringify(m))}`)
} catch (e) {
  console.log(`elenco/storia non disponibili: ${String(e)}`)
}

await adapter.close()
console.log('\nfatto')
process.exit(0)
