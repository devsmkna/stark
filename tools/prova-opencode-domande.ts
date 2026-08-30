// Il giro domanda↔risposta di OpenCode, misurato dal vivo (30 agosto 2026).
//
// Perche' esiste: con il server 1.18.25 il tool `question` registra la domanda nel
// registro **globale** e la rotta session-scoped dell'SDK risponde 404; la risposta
// con `.error` veniva buttata via — STARK diceva `question.replied`, il tool restava
// `running` per sempre. Questa prova verifica che `rispondiDomanda` consegni davvero
// su entrambe le strade: risposta (turno 1) e rifiuto (turno 2), e che il turno si
// chiuda per la via buona in entrambi i casi.
//
// Costa due turni brevi su un modello gratuito.
//   node tools/prova-opencode-domande.ts
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { OpenCodeAdapter, catalogoModelli } from '../src/adapters/opencode/adapter.ts'
import { clientPer } from '../src/adapters/opencode/host.ts'
import { applyTo, type SessionSnapshot } from '../src/core/reduce.ts'
import { MODEL_VERSION, type CanonicalEvent, type PermissionMode } from '../src/core/events.ts'

const CASA = resolve(tmpdir(), 'stark-oc-domande')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })

const catalogo = await catalogoModelli()
const libero = catalogo.find(m => m.cost && m.cost.input === 0 && m.cost.output === 0)
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
const domande: Array<{ t: number; header: string; opzioni: string[] }> = []
let risposte = 0, rifiuti = 0, errori = 0
let sessionOc = ''
/** Il giro della domanda: 1 = risposta, 2 = rifiuto (l'utente chiude la card). */
let giro = 0
/** La misura dei due registri si fa una volta sola, con la prima domanda appesa. */
let misurati = 0

const adapter = new OpenCodeAdapter(
  { cwd: CASA, model: MODELLO, mode: 'build' as PermissionMode },
  {
    onPayload: p => {
      const e: CanonicalEvent = { v: MODEL_VERSION, seq: ++seq, ts: Date.now(), sessionId: 'oc', payload: p }
      applyTo(snap, e)
      const el = `${String(Date.now() - t0).padStart(6)}ms`
      if (p.k === 'turn.started') cronologia.push(`${el}  aperto  ${p.turnId.slice(0, 8)}`)
      if (p.k === 'turn.ended') cronologia.push(`${el}  chiuso  ${p.turnId.slice(0, 8)}  ${p.reason}`)
      if (p.k === 'session.state') cronologia.push(`${el}  stato   ${p.state}`)
      if (p.k === 'tool.started') cronologia.push(`${el}  tool    ${p.name}`)
      if (p.k === 'tool.ended') cronologia.push(`${el}  esito   tool ${p.callId.slice(0, 8)}: ${p.ok ? 'ok' : p.error ?? '?'}`)
      if (p.k === 'question.asked') {
        domande.push({ t: Date.now() - t0, header: p.questions[0]?.header ?? '?', opzioni: p.questions[0]?.options.map(o => o.label) ?? [] })
        cronologia.push(`${el}  domanda ${p.questions[0]?.header}`)
      }
      if (p.k === 'question.replied') { risposte++; cronologia.push(`${el}  risposta data`) }
      if (p.k === 'question.rejected') { rifiuti++; cronologia.push(`${el}  domanda rifiutata`) }
      if (p.k === 'notice' && p.level === 'error') { errori++; cronologia.push(`${el}  ERRORE  ${p.text}`) }
      if (p.k === 'session.error') { errori++; cronologia.push(`${el}  errore  ${p.message.slice(0, 120)}`) }
      if (p.k === 'session.resumeRef') sessionOc = p.ref
    },
    onQuestion: async ({ questions }) => {
      // Al primo giro si misurano i due registri mentre la domanda e' appesa: e'
      // la misura che dice DOVE sta davvero (globale contro session-scoped).
      if (misurati === 0) {
        misurati++
        const c = await clientPer(CASA)
        try {
          const g = await c.question.list({ directory: CASA }) as unknown as { data?: unknown[]; error?: unknown }
          const s = await c.v2.session.question.list({ sessionID: sessionOc } as never) as unknown as { data?: unknown[]; error?: unknown }
          console.log(`registri con la domanda appesa: globale=${(g.data ?? []).length}${g.error ? ' err' : ''}  session-scoped=${(s.data ?? []).length}${s.error ? ' err' : ''}`)
        } catch (e) { console.log(`misura registri fallita: ${String(e)}`) }
      }
      giro++
      if (giro >= 2) { console.log('  -> chiudo la card senza rispondere (rifiuto)'); return null }
      const q = questions[0]
      const prima = q?.options[0]?.label ?? ''
      console.log(`  -> rispondo «${prima}» a «${q?.header}»`)
      return { answers: { [q?.header ?? '']: [prima] } }
    },
  },
)

await adapter.start()
const t1 = adapter.prompt(
  'Use the question tool right now to ask me exactly one question: header "Colore", '
  + 'question "Which color?", two options labeled "Rosso" and "Blu". '
  + 'After I answer, reply with the single word FATTO.',
)
console.log(`turno 1: ${t1.slice(0, 8)}`)
await Promise.race([adapter.settled(), new Promise(r => setTimeout(r, 120_000))])

const t2 = adapter.prompt(
  'Ask me another question now with the question tool: header "Numero", '
  + 'question "Which number?", two options "Uno" and "Due". '
  + 'If I close the question without answering, reply with the single word BASTA.',
)
console.log(`turno 2: ${t2.slice(0, 8)}`)
await Promise.race([adapter.settled(), new Promise(r => setTimeout(r, 120_000))])
await new Promise(r => setTimeout(r, 3000))

console.log('\n— cronologia canonica —')
console.log(cronologia.join('\n'))

const aperti = snap.turns.filter(t => !t.ended).length
const esiti = {
  domande: domande.length, risposte, rifiuti, errori,
  pendingQuestions: snap.pendingQuestions.length,
  turni: snap.turns.length, turniAperti: aperti,
  chiusure: snap.turns.map(t => t.ended ? (t.reason ?? 'senza-motivo') : 'APERTO'),
}
console.log('\n— esiti —')
console.log(JSON.stringify(esiti))

const verde = domande.length === 2 && risposte === 1 && rifiuti === 1
  && errori === 0 && esiti.pendingQuestions === 0 && aperti === 0
  && esiti.chiusure.filter(r => r === 'completed').length === 2
console.log(verde ? '\nVERDE: domanda consegnata e rifiutata, turni chiusi per la via buona' : '\nROSSO: vedi sopra')

await adapter.close()
process.exit(verde ? 0 : 1)
