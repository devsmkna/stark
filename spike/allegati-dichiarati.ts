// Cosa dichiara ciascun agent su **cosa si puo' allegare a un prompt**.
//
// Serve a rifare la misura su cui poggia `core/allegati.ts`, e va rifatta a ogni salto
// di versione dell'SDK o del server: le due risposte sono opposte, e la seconda e' la
// sola che si possa leggere invece di scrivere.
//
//   - Claude Code: `list_models` dell'handshake **non dice niente** sulla
//     multimodalita'. Se un giorno lo dicesse, `ALLEGABILI` in `sdk-options.ts`
//     smetterebbe di essere l'elenco giusto: si leggerebbe da li'.
//   - OpenCode: ogni modello porta `capabilities.input.{text,image,audio,video,pdf}`.
//     Attenzione al posto: i tipi promettono `attachment`/`modalities` **piatti** sul
//     modello, il filo manda `capabilities` annidato. Una sonda che guarda il campo
//     sbagliato non fallisce — risponde «nessun modello accetta allegati».
//
// Costo: ZERO quota. Un handshake e una domanda di configurazione, nessun turno.
//
// Uso:  node spike/allegati-dichiarati.ts
import { tmpdir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'
import { allegabiliDi } from '../src/adapters/opencode/adapter.ts'
import { clientPer, lascia } from '../src/adapters/opencode/host.ts'

console.log('── Claude Code ───────────────────────────────────────────')
{
  const q = query({
    prompt: (async function* () { await new Promise<void>(() => {}) })() as never,
    options: buildOptions({ cwd: tmpdir(), model: 'default', mode: 'default' }) as never,
  })
  try {
    const info = await q.initializationResult() as Record<string, unknown>
    const models = (info['models'] ?? []) as Array<Record<string, unknown>>
    console.log(`${models.length} modelli · campi dichiarati:`,
      [...new Set(models.flatMap(m => Object.keys(m)))].join(' '))
    const multimodale = models.some(m => Object.keys(m).some(k => /image|vision|attach|modal/i.test(k)))
    console.log('parla di multimodalita\'?', multimodale ? 'SI — rileggere ALLEGABILI' : 'no')
  } finally {
    await q.return(undefined as never).catch(() => { /* gia' morto */ })
  }
}

console.log('\n── OpenCode ──────────────────────────────────────────────')
{
  const c = await clientPer(tmpdir()) as never as { config: { providers(): Promise<unknown> } }
  const r = await c.config.providers()
  const v = ((r as Record<string, unknown>)['data'] ?? r) as {
    providers?: Array<{ id?: string; models?: Record<string, Record<string, unknown>> }>
  }
  const tutti = (v.providers ?? []).flatMap(p => Object.entries(p.models ?? {})
    .map(([mid, m]) => ({ id: `${p.id}/${mid}`, accepts: allegabiliDi(m), m })))
  const con = (k: string) => tutti.filter(x => x.accepts.some(t => t.includes(k))).length
  console.log(`${tutti.length} modelli · con immagini ${con('image')} · con pdf ${con('pdf')}`
    + ` · senza niente ${tutti.filter(x => x.accepts.length === 0).length}`)
  // Il caso che rende `attachment` da solo inservibile: c'e' o non c'e' piu'?
  const bugia = tutti.filter(x =>
    (x.m['capabilities'] as Record<string, unknown> | undefined)?.['attachment'] === true
    && x.accepts.length === 0)
  console.log(`«attachment: true» ma niente da allegare: ${bugia.length}`,
    bugia.slice(0, 3).map(x => x.id).join(' '))
  lascia()
}
process.exit(0)
