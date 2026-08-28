// Il piano, guardato nella UI vera invece che descritto.
//
// Costa un turno di modello: apre una chat in `plan` mode su un daemon con casa
// propria in /tmp, aspetta che l'agent proponga il suo piano, e a quel punto stampa
// l'indirizzo da fotografare. Poi risponde e verifica che la modalità sia davvero
// cambiata — che è la metà del giro che non si vede in uno screenshot.
//
// `STARK_HOME` va assegnata **prima** dell'import del daemon: `registry.ts` la risolve
// al load del modulo, e un import statico verrebbe issato sopra questa riga.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CASA = resolve(tmpdir(), 'stark-piano-ui')
rmSync(CASA, { recursive: true, force: true })
process.env['STARK_HOME'] = CASA

const { startDaemon } = await import('../src/daemon/server.ts')

const SANDBOX = resolve(CASA, 'progetto')
mkdirSync(SANDBOX, { recursive: true })
writeFileSync(resolve(SANDBOX, 'conti.ts'),
  'export function somma(a: number, b: number): number { return a + b }\n')

const daemon = await startDaemon({ port: 0, token: 'piano'.padEnd(64, '0') })
const { url, token } = daemon
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
console.log(`daemon su ${url}`)

const aperta = await (await fetch(`${url}/api/sessions`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    cwd: SANDBOX, mode: 'plan',
    model: process.env['STARK_MODEL'] ?? 'claude-sonnet-5',
  }),
})).json() as { id: string }
console.log(`chat ${aperta.id}`)

await fetch(`${url}/api/sessions/${aperta.id}/command`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    c: 'session.prompt',
    text: 'Proponi un piano molto breve, tre passi, per aggiungere a conti.ts una '
      + 'funzione moltiplica. Non scrivere codice adesso.',
  }),
})

type Snap = {
  snapshot: {
    state: string; mode?: string
    pendingPlans: { requestId: string; plan: string; path?: string }[]
    turns: { parts: { kind: string; of?: string; answer?: string; asked?: string }[] }[]
  }
}
const leggi = async (): Promise<Snap['snapshot']> =>
  (await (await fetch(`${url}/api/sessions/${aperta.id}`, { headers: auth })).json() as Snap).snapshot

let snap = await leggi()
for (let i = 0; i < 200 && snap.pendingPlans.length === 0; i++) {
  await new Promise(r => setTimeout(r, 1500))
  snap = await leggi()
  if (i % 8 === 0) console.log(`  … ${i * 1.5 | 0}s, stato ${snap.state}`)
}

if (snap.pendingPlans.length === 0) {
  console.log('\nNESSUN PIANO proposto. Stato:', snap.state)
  await daemon.stop(); process.exit(1)
}

const piano = snap.pendingPlans[0]!
console.log('\n── piano proposto ──')
console.log(`  stato sessione : ${snap.state}   (atteso: awaiting)`)
console.log(`  caratteri      : ${piano.plan.length}`)
console.log(`  file del piano : ${piano.path ?? '(nessuno)'}`)
console.log(`  prime righe    :\n${piano.plan.split('\n').slice(0, 4).map(l => '    ' + l).join('\n')}`)
console.log(`\n  DA FOTOGRAFARE: ${url}/chat/${aperta.id}?token=${token}`)

// Si aspetta prima di rispondere, così c'è il tempo di fotografarlo: la fotografia la
// scatta un altro processo (`tools/shot.mjs`), non questo.
const attesa = Number(process.env['STARK_ATTESA'] ?? 45)
console.log(`\n  (aspetto ${attesa}s, poi rispondo)`)
await new Promise(r => setTimeout(r, attesa * 1000))

await fetch(`${url}/api/sessions/${aperta.id}/command`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    c: 'plan.reply', requestId: piano.requestId, decision: 'approved', mode: 'acceptEdits',
  }),
})
await new Promise(r => setTimeout(r, 4000))
snap = await leggi()
const risposta = snap.turns.flatMap(t => t.parts).find(p => p.kind === 'answer' && p.of === 'plan')
console.log('\n── dopo la risposta ──')
console.log(`  piani in attesa: ${snap.pendingPlans.length}   (atteso: 0)`)
console.log(`  modalità       : ${snap.mode}   (atteso: acceptEdits)`)
console.log(`  nel flusso     : ${risposta?.answer ?? '(niente)'}`)
console.log(`  piano rileggibile: ${(risposta?.asked?.length ?? 0) > 100}`)

await daemon.stop()
process.exit(0)
