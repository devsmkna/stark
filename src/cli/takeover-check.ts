// Cosa succede se DUE processi lavorano sulla stessa sessione.
//
// E lo scenario della "presa in carico": STARK riprende la conversazione che stai
// gia usando dalla CLI. Finche la CLI e aperta, per un momento i processi sono due.
// La domanda a cui questo file risponde e se quel momento e innocuo o se qualcuno
// perde pezzi di conversazione — e va risposta PRIMA di farlo su una conversazione
// vera, non dopo.
//
// Prompt minuscoli: si sta misurando un comportamento, non facendo lavorare un modello.

import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClaudeCodeAdapter } from '../adapters/claude-code/adapter.ts'
import type { Payload, PermissionMode } from '../core/events.ts'

const MODEL = process.env['STARK_MODEL'] ?? 'claude-sonnet-5'
const MODE = (process.env['STARK_MODE'] ?? 'auto') as PermissionMode
const ROOT = resolve(import.meta.dirname, '../..')
const SANDBOX = resolve(ROOT, 'spike/sandbox/takeover')
rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })

const sessionId = randomUUID()

type Live = { adapter: ClaudeCodeAdapter; ask: (q: string) => Promise<string> }

async function open(resume: boolean): Promise<Live> {
  let text = ''
  let done: (() => void) | null = null
  const adapter = new ClaudeCodeAdapter({
    cwd: SANDBOX, model: MODEL, mode: MODE,
    ...(resume ? { resume: { ref: sessionId } } : { sessionId }),
    onPayload: (p: Payload) => {
      if (p.k === 'text.delta') text += p.delta
      if (p.k === 'turn.ended') done?.()
    },
  })
  await adapter.start()
  return {
    adapter,
    ask: async (q: string) => {
      text = ''
      const finished = new Promise<void>(res => { done = res })
      adapter.prompt(q)
      await finished
      return text.trim()
    },
  }
}

console.log(`presa in carico — sessione ${sessionId}\n`)

// A resta VIVO per tutta la prova: e la CLI che l'utente non ha ancora chiuso.
const a = await open(false)
console.log('A (prima apertura)  :', await a.ask('Ricorda la lettera ALFA. Rispondi solo "ok".'))

// B entra sulla stessa sessione mentre A e ancora aperto.
const b = await open(true)
console.log('B (presa in carico) :', await b.ask('Ricorda anche la lettera BETA. Rispondi solo "ok".'))
const bSees = await b.ask('Quali lettere ti ho chiesto di ricordare? Elencale e basta.')
console.log('B vede              :', bSees)

// A ora fa una domanda: ha visto passare BETA, oppure e rimasto al suo mondo?
const aSees = await a.ask('Quali lettere ti ho chiesto di ricordare? Elencale e basta.')
console.log('A vede              :', aSees)

await a.adapter.sleep()
await b.adapter.sleep()

// Chi ha vinto sul disco? E la domanda che conta: e cio che un terzo risveglio trovera.
const c = await open(true)
const cSees = await c.ask('Quali lettere ti ho chiesto di ricordare? Elencale e basta.')
console.log('dopo, il disco dice :', cSees)
await c.adapter.sleep()

const has = (s: string, w: string): boolean => s.toUpperCase().includes(w)
console.log('\n──── esito ────')
console.log(`B ha ereditato il contesto di A            ${has(bSees, 'ALFA') ? 'SI' : 'NO'}`)
console.log(`A si e accorto di cio che ha fatto B       ${has(aSees, 'BETA') ? 'SI' : 'NO'}`)
console.log(`il trascritto finale conserva ALFA         ${has(cSees, 'ALFA') ? 'SI' : 'NO'}`)
console.log(`il trascritto finale conserva BETA         ${has(cSees, 'BETA') ? 'SI' : 'NO'}`)
console.log(`\nLettura: se l'ultima riga dice NO, l'ultimo processo a scrivere ha`)
console.log(`sovrascritto il lavoro dell'altro, e la presa in carico va fatta a CLI chiusa.`)
