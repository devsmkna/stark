// Le funzioni "mancanti" in headless mancano davvero, o mancava la dichiarazione?
//
// Il CLI tratta l'assenza di `supportedDialogKinds` come "questo client non sa
// mostrare finestre" e fa cadere tutto cio che ne ha bisogno. Questa prova dichiara
// i dialoghi e guarda se i tool tornano nell'elenco.

import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClaudeCodeAdapter } from '../adapters/claude-code/adapter.ts'
import { DIALOG_KINDS } from '../adapters/claude-code/native.ts'
import type { PermissionMode } from '../core/events.ts'

const MODEL = process.env['STARK_MODEL'] ?? 'claude-sonnet-5'
const MODE = (process.env['STARK_MODE'] ?? 'auto') as PermissionMode
const DICHIARA = process.env['STARK_NODIALOG'] !== '1'
const SANDBOX = resolve(import.meta.dirname, '../../spike/sandbox/dialog')
rmSync(SANDBOX, { recursive: true, force: true }); mkdirSync(SANDBOX, { recursive: true })

let tools: string[] = []
let dialoghi = 0
let fine: (() => void) | null = null
const finito = new Promise<void>(res => { fine = res })

const adapter = new ClaudeCodeAdapter({
  cwd: SANDBOX, model: MODEL, mode: MODE, sessionId: randomUUID(),
  ...(DICHIARA ? { dialogKinds: [...DIALOG_KINDS] } : {}),
  ...(process.env['STARK_PPT'] ? { extraArgs: ['--permission-prompt-tool', process.env['STARK_PPT']] } : {}),
  onDialog: async d => {
    dialoghi++
    console.log(`\n*** DIALOGO: ${d.kind} ***`)
    console.log(JSON.stringify(d.payload).slice(0, 900))
    // Risposta neutra: si sta misurando il canale, non si sta decidendo niente.
    return { behavior: 'cancelled' }
  },
  onPayload: p => {
    if (p.k === 'session.tools') tools = p.tools
    if (p.k === 'tool.started') console.log(`  tool: ${p.name}`)
    if (p.k === 'notice') console.log(`  [${p.level}] ${p.text.slice(0, 120)}`)
    if (p.k === 'turn.ended') fine?.()
  },
})

console.log(`dialoghi dichiarati: ${DICHIARA ? DIALOG_KINDS.length : 0}\n`)
await adapter.start()
adapter.prompt('Usa il tool AskUserQuestion per chiedermi se preferisco il caffè o il tè. Non fare altro.')
await finito
await adapter.sleep()

const cerca = ['AskUserQuestion', 'ExitPlanMode', 'TodoWrite', 'Bash']
console.log(`\n──── esito ────`)
console.log(`tool disponibili: ${tools.length}`)
for (const t of cerca) console.log(`  ${t.padEnd(18)} ${tools.includes(t) ? 'SI' : 'no'}`)
console.log(`dialoghi ricevuti: ${dialoghi}`)
