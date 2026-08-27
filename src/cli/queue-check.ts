// Prova della fila (§7 del modello di eventi).
//
// Due prompt mandati a distanza di pochi secondi devono restare DUE turni, in ordine,
// ciascuno con la sua risposta dentro. Sembra ovvio e non lo era: fino al 26 agosto
// 2026 il secondo prompt veniva piegato dentro il turno in corso, e la risposta del
// primo finiva nel blocco del secondo. La motivazione stava scritta e veniva dai tipi
// dell'SDK — un lotto di messaggi consegnati insieme viene "coalesced into one turn" —
// ma descriveva cosa fa il CLI, non un limite del modello: consegnandoli uno alla
// volta e a sessione ferma, ogni prompt e un turno suo.
//
// Sta qui e non in `npm run check` perche questa meta si puo provare solo dal vivo: e
// una questione di TEMPI fra STARK e l'agent, e su eventi finti non esisterebbe. La
// meta che vive nel journal — che i turni restino due e le parti vadano nel turno
// giusto — e invece in `offline-check.ts`, a costo zero.
//
// I prompt sono minuscoli di proposito: la risorsa scarsa e la quota. Il primo turno
// dura perche esegue uno `sleep`, non perche pensa.

import { ClaudeCodeAdapter } from '../adapters/claude-code/adapter.ts'
import { applyTo, type SessionSnapshot } from '../core/reduce.ts'
import { MODEL_VERSION, promptText, type CanonicalEvent, type PermissionMode } from '../core/events.ts'

const MODEL = process.env['STARK_MODEL'] ?? 'claude-sonnet-5'
const MODE = (process.env['STARK_MODE'] ?? 'auto') as PermissionMode

let seq = 0
const snap = {
  v: 1, sessionId: 'coda', state: 'starting', tools: [], slashCommands: [],
  models: [], modes: [], options: [], todos: [], mcpServers: [], turns: [], files: [], shell: [],
  pendingPermissions: [], pendingQuestions: [], pendingPlans: [], blocked: [], notices: [],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: { nominalUsd: 0 },
  quotaWindows: [], lastSeq: 0, lastTs: 0, stateSince: 0,
} as SessionSnapshot

const cronologia: string[] = []
const t0 = Date.now()

const adapter = new ClaudeCodeAdapter({
  cwd: process.cwd(), model: MODEL, mode: MODE,
  onPayload: p => {
    const e: CanonicalEvent = {
      v: MODEL_VERSION, seq: ++seq, ts: Date.now(), sessionId: 'coda', payload: p,
    }
    applyTo(snap, e)
    const el = `${String(Date.now() - t0).padStart(6)}ms`
    if (p.k === 'turn.started') cronologia.push(`${el}  aperto  ${p.turnId.slice(0, 8)}  «${promptText(p.prompt)}»`)
    if (p.k === 'turn.ended') cronologia.push(`${el}  chiuso  ${p.turnId.slice(0, 8)}  ${p.reason}`)
    if (p.k === 'session.state') cronologia.push(`${el}  stato   ${p.state}`)
  },
})

let ok = 0
let ko = 0
function check(cosa: string, esito: boolean, dettaglio = ''): void {
  if (esito) { ok++; console.log(`OK   ${cosa}`) }
  else { ko++; console.log(`FAIL ${cosa}${dettaglio ? ` — ${dettaglio}` : ''}`) }
}

await adapter.start()
adapter.prompt('Esegui esattamente `sleep 12` con Bash, poi rispondi solo con la parola UNO.')
await new Promise(r => setTimeout(r, 4000))
adapter.prompt('Rispondi solo con la parola DUE.')
await adapter.settled()
await adapter.settled()
await adapter.close()

console.log(cronologia.join('\n'))
console.log()

const testo = (i: number): string => (snap.turns[i]?.parts ?? [])
  .map(p => (p.kind === 'text' ? p.text : '')).join('').trim()

check('due prompt ravvicinati sono due turni, non uno',
  snap.turns.length === 2, `turni: ${snap.turns.length}`)
check('in ordine: FIFO',
  promptText(snap.turns[0]?.prompt ?? []).includes('UNO')
  && promptText(snap.turns[1]?.prompt ?? []).includes('DUE'))
check('il secondo turno non parte prima che il primo sia chiuso',
  (snap.turns[1]?.startedAt ?? 0) < (snap.turns[0]?.endedAt ?? 0)
  && (snap.turns[0]?.endedAt ?? 0) <= (snap.turns[1]?.endedAt ?? 0))
check('ogni risposta sta nel suo turno',
  testo(0).includes('UNO') && !testo(0).includes('DUE')
  && testo(1).includes('DUE') && !testo(1).includes('UNO'),
  `t1 "${testo(0)}" · t2 "${testo(1)}"`)
// Fra un turno e il successivo la sessione NON deve dichiararsi ferma: quell'`idle`
// durerebbe un decimo di secondo, ma e lo stato su cui suona la notifica «ha finito».
// L'`idle` iniziale (prima del primo prompt) e legittimo e non si conta.
const primaChiusura = cronologia.findIndex(r => r.includes('chiuso'))
const ultimaChiusura = cronologia.map(r => r.includes('chiuso')).lastIndexOf(true)
check('nessuna sosta bugiarda: fra un turno e il prossimo non si dichiara ferma',
  !cronologia.slice(primaChiusura, ultimaChiusura).some(r => r.includes('stato   idle')),
  cronologia.slice(primaChiusura, ultimaChiusura).join(' | '))
check('nessun turno resta aperto',
  snap.turns.every(t => t.ended))

console.log(`\n${ok}/${ok + ko} verifiche passate`)
process.exit(ko === 0 ? 0 : 1)
