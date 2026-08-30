// L'import di OpenCode, misurato: che forma hanno `session.list` e
// `session.messages` — e che faccia ha l'output di un comando bash fallito
// (exit 3), per tradurlo in `command.executed` senza indovinare.
// Costa un turno brevissimo su un modello gratuito.
//   node tools/prova-opencode-import.ts
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  OpenCodeAdapter, catalogoModelli,
} from '../src/adapters/opencode/adapter.ts'
import { clientPer } from '../src/adapters/opencode/host.ts'
import type { PermissionMode } from '../src/core/events.ts'

const CASA = resolve(tmpdir(), 'stark-oc-import')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })

/** I due strati con cui il client SDK avvolge il corpo (misurato, P22). */
const dato = (r: unknown): unknown => {
  const a = (r ?? {}) as Record<string, unknown>
  const b = (a['data'] ?? a) as Record<string, unknown>
  return (b as Record<string, unknown>)['data'] ?? b
}
const adatta = (s: string | undefined | null): string => {
  const t = s ?? ''
  return t.length > 500 ? `${t.slice(0, 500)}…` : t
}

const catalogo = await catalogoModelli()
const libero = catalogo.find(m => m.cost && m.cost.input === 0 && m.cost.output === 0)
const MODELLO = process.env['STARK_OC_MODELLO'] ?? libero?.id ?? 'opencode/gpt-5-nano'

let sessionOc = ''
const grezzi: Array<Record<string, unknown>> = []
const adapter = new OpenCodeAdapter(
  { cwd: CASA, model: MODELLO, mode: 'build' as PermissionMode },
  {
    onPayload: p => { if (p.k === 'session.resumeRef') sessionOc = p.ref },
    onRaw: e => {
      const d = ((e as { data?: unknown }).data ?? (e as { properties?: unknown }).properties ?? {}) as Record<string, unknown>
      const parte = d['part'] as Record<string, unknown> | undefined
      if (parte && String(parte['type']) === 'tool') grezzi.push(parte)
    },
  },
)
await adapter.start()
console.log(`modello: ${MODELLO} · sessione: ${sessionOc}`)

// Un comando con stdout e exit code non zero: la forma dell'output completed.
adapter.prompt('Run exactly this shell command with bash: `echo ciao; exit 3`. Then reply BASTA.')
await Promise.race([adapter.settled(), new Promise(r => setTimeout(r, 120_000))])
await new Promise(r => setTimeout(r, 3000))
await adapter.close()

console.log('\n— la parte bash completa (output e metadata separati) —')
for (const p of grezzi) {
  const nome = String(p['tool'])
  if (nome !== 'bash') continue
  const stato = (p['state'] ?? {}) as Record<string, unknown>
  console.log(`${nome}:${String(stato['status'])}`)
  console.log(`  input    : ${adatta(JSON.stringify(stato['input'] ?? null))}`)
  console.log(`  output   : ${adatta(JSON.stringify(stato['output'] ?? null))}`)
  console.log(`  metadata : ${adatta(JSON.stringify(stato['metadata'] ?? null))}`)
}

console.log('\n— session.list, spacchettato —')
const c = await clientPer(CASA)
try {
  const v = dato(await c.v2.session.list() as never) as unknown
  const righe = Array.isArray(v) ? v : []
  console.log(`${righe.length} sessioni; la prima per intero:`)
  console.log(adatta(JSON.stringify(righe[0], null, 1)))
  const nostra = righe.find(r => JSON.stringify(r).includes(sessionOc))
  console.log(`\nla sessione di questa prova e' nell'elenco: ${nostra ? 'si\'' : 'no'}`)
  if (nostra) {
    console.log('i suoi campi:', Object.keys(nostra).join(', '))
  }

  console.log('\n— session.messages di questa sessione —')
  const m = dato(await c.v2.session.messages({ sessionID: sessionOc } as never) as never) as unknown
  const messaggi = Array.isArray(m) ? m : []
  console.log(`${messaggi.length} messaggi`)
  for (const x of messaggi) console.log(adatta(JSON.stringify(x)))
} catch (e) {
  console.log(`non disponibili: ${String(e)}`)
}
process.exit(0)
