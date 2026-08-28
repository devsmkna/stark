// STARK consuma piu' token del `claude` da terminale, a parita' di lavoro?
//
// La domanda non si risponde contando i token di un turno: quelli dipendono da cosa
// hai chiesto. Si risponde guardando **cosa c'e' nel prompt prima che tu scriva**,
// perche' quello e' cio' che STARK decide e l'utente no. `getContextUsage()` e' la
// stessa domanda a cui risponde `/context` nel terminale, e la porta categoria per
// categoria: system prompt, tool, memoria (CLAUDE.md), skill.
//
// Costo: ZERO quota. Sono handshake piu' una richiesta sul canale di controllo —
// nessun turno parte mai.
//
// Due trappole misurate scrivendo questa sonda, e vale la pena saperle:
//  1. un generatore di prompt **vuoto** chiude lo stdin e il processo muore prima che
//     si possa chiedere il contesto («Query closed before response received»). Serve
//     un generatore che non finisca mai: nessun turno, ma la porta resta aperta.
//  2. `System tools (deferred)` **non** entra nel totale (verificato: la somma delle
//     altre categorie da' esattamente `totalTokens`). Sono i tool che il modello
//     carica su richiesta con la ricerca tool, non quelli nel prefisso.
//
// Uso:  node spike/costo-vs-cli.ts
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'

const CWD = process.cwd()
const PRESET = { type: 'preset', preset: 'claude_code' } as const

// Cio' che STARK passa **davvero**: la funzione vera, non una copia. Una copia si
// sarebbe scollata dal codice al primo cambiamento, ed e' esattamente il modo in cui
// questa sonda avrebbe smesso di rispondere alla domanda per cui esiste continuando a
// stampare numeri credibili.
const COME_STARK = buildOptions({ cwd: CWD, mode: 'auto' }) as Record<string, unknown>
// `cwd` lo mette gia' `buildOptions`; qui si toglie per non litigare con le scene.
delete COME_STARK['cwd']

type Cat = { name: string; tokens: number }

async function misura(etichetta: string, opts: Record<string, unknown>) {
  const q = query({
    prompt: (async function* () { await new Promise(() => {}) })() as never,
    options: { cwd: CWD, ...opts } as never,
  })
  try {
    const info = await q.initializationResult() as Record<string, unknown>
    const ctx = await (q as unknown as { getContextUsage(): Promise<Record<string, unknown>> })
      .getContextUsage()
    const cat = (ctx['categories'] as Cat[]) ?? []
    const t = (n: string) => cat.find(c => c.name === n)?.tokens ?? 0
    return {
      etichetta,
      modo: String(info['current_permission_mode'] ?? '?'),
      totale: Number(ctx['totalTokens']),
      max: Number(ctx['maxTokens']),
      sys: t('System prompt'),
      tools: t('System tools'),
      deferred: t('System tools (deferred)'),
      memoria: t('Memory files'),
      skill: t('Skills'),
    }
  } catch (e) {
    return { etichetta, errore: String((e as Error)?.message ?? e).slice(0, 120) }
  } finally {
    try { await q.interrupt?.() } catch { /* sta gia' morendo */ }
  }
}

const scene: [string, Record<string, unknown>][] = [
  // Le due che rispondono alla domanda.
  ['STARK (buildOptions vero)', { ...COME_STARK }],
  ['STARK senza il preset', { ...COME_STARK, systemPrompt: undefined }],
  // Il termine di paragone: l'SDK senza nessuna delle scelte di STARK.
  ['SDK nudo + preset', { systemPrompt: PRESET }],
  // Una variabile per volta, per sapere **da dove** viene ogni differenza.
  ['solo permissionMode auto', { systemPrompt: PRESET, permissionMode: 'auto' }],
  ['solo canUseTool', { systemPrompt: PRESET, canUseTool: COME_STARK.canUseTool }],
  ['solo includePartialMessages', { systemPrompt: PRESET, includePartialMessages: true }],
  ['solo strictMcpConfig true', { systemPrompt: PRESET, strictMcpConfig: true }],
  // `settingSources` omesso == CLI (il cambio della v0.1.0 e' stato annullato): si prova.
  ['settingSources esplicito', { systemPrompt: PRESET, settingSources: ['user', 'project', 'local'] }],
]

const ris: Awaited<ReturnType<typeof misura>>[] = []
for (const [et, o] of scene) {
  process.stdout.write(`… ${et}\n`)
  ris.push(await misura(et, o))
}

const col = (n: number | undefined) => String(n ?? '?').padStart(7)
console.log('\n' + '='.repeat(96))
console.log(`${'scena'.padEnd(30)}${'system'.padStart(8)}${'tool'.padStart(8)}${'defer'.padStart(8)}${'memoria'.padStart(8)}${'skill'.padStart(8)}${'TOTALE'.padStart(9)}  modo`)
for (const r of ris) {
  if ('errore' in r && r.errore) { console.log(`${r.etichetta.padEnd(30)} ERRORE ${r.errore}`); continue }
  const x = r as Extract<typeof r, { totale: number }>
  console.log(`${x.etichetta.padEnd(30)}${col(x.sys)}${col(x.tools)}${col(x.deferred)}${col(x.memoria)}${col(x.skill)}${col(x.totale)}  ${x.modo}`)
}

const base = ris[0] as { totale?: number }
console.log('\nDifferenza sul totale rispetto a STARK:')
for (const r of ris.slice(1)) {
  const x = r as { etichetta: string; totale?: number }
  if (x.totale === undefined || base.totale === undefined) continue
  const d = x.totale - base.totale
  console.log(`   ${x.etichetta.padEnd(30)} ${d >= 0 ? '+' : ''}${d}`)
}
process.exit(0)
