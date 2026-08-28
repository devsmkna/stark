// P23 — i fatti che solo il MODELLO puo' produrre.
//
// La P22 ha coperto la superficie deterministica (revert, compact, switchModel,
// context, diff, history): tutta roba chiamabile a comando. Restano fuori quattro cose
// che nascono solo se il modello decide di farle, e sono proprio quelle su cui il
// vocabolario canonico di STARK non ha ancora una risposta:
//
//   1. `todo.updated`   — la checklist. Claude Code 2.1.241 non ce l'ha piu'; OpenCode si'.
//   2. `question.v2.*`  — la domanda a scelta multipla, dal lato di OpenCode.
//   3. il sotto-agent   — il tool `task`, e come si vede il lavoro DENTRO di esso.
//   4. un edit vero     — per vedere se, con un file davvero cambiato, `session.diff`
//                         e `file.edited` si svegliano (nella P21 erano muti).
//
// ─── Come e' costruita, e perche' cosi' ─────────────────────────────────────
//
// Il modello disponibile su questa macchina (uno solo, `nemotron-3-ultra-free`) si
// rompe a meta' turno e a volte non parte affatto. Due contromisure, entrambe scelte
// per ragioni, non per prudenza generica:
//
//  - **Si ritenta.** Un fallimento a monte (502 di Nvidia, `ModelUnavailable`) non e'
//    un dato su OpenCode: e' rumore. Ritentare separa il rumore dal fatto.
//  - **La verita' si legge da `history`, non dal flusso.** `v2.session.history` torna
//    il log durevole degli eventi con `durable.seq` — cioe' quello che e' successo per
//    davvero. Se lo stream perde un pezzo per una disconnessione, la storia no. E' la
//    stessa ragione per cui in STARK la UI ricostruisce dallo snapshot del journal e
//    non da cio' che ha visto passare.
//
// Uso:  node spike/opencode/p23-fatti-del-modello.mjs [modello]

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'

const CASA = '/tmp/stark-oc-p23'
const MODELLO = { providerID: 'opencode', id: process.argv[2] ?? 'nemotron-3-ultra-free' }
const TENTATIVI = 4

rmSync(CASA, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })
writeFileSync(`${CASA}/conti.txt`, 'uno\ndue\ntre\n')

const server = await createOpencodeServer({
  hostname: '127.0.0.1', port: 0,
  // `edit: 'allow'`: qui non si sta provando il meccanismo dei permessi (l'ha fatto la
  // P21), si sta provando cosa succede a valle di un file davvero cambiato.
  config: { permission: { edit: 'allow', bash: 'allow', read: 'allow' } },
})
const client = createOpencodeClient({ baseUrl: server.url, directory: CASA })
const dato = r => (r?.data?.data ?? r?.data ?? r)
// La storia a volte torna un oggetto d'errore invece di un array (il server puo'
// rispondere `ServiceUnavailable` sotto carico). Un `.slice` su quello fa cadere la
// sonda a meta' prova: qui si degrada a «non lo so» invece che a un crash.
const lista = v => (Array.isArray(v) ? v : [])

/**
 * Manda un prompt e aspetta che la storia si fermi.
 *
 * Non c'e' `session.wait` — l'endpoint esiste nei tipi dell'SDK ma il server risponde
 * «Session wait is not available yet» (misurato dalla P22). Quindi la fine del turno si
 * riconosce da **quando la storia smette di crescere**, che e' esattamente la
 * deduzione che l'adapter dovra' fare al posto di `turn.ended`.
 */
async function turno(id, testo) {
  for (let giro = 1; giro <= TENTATIVI; giro++) {
    const prima = lista(dato(await client.v2.session.history({ sessionID: id }))).length
    await client.v2.session.prompt({ sessionID: id, model: MODELLO, prompt: { text: testo } })
    let fermo = 0, ultimo = prima
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const ora = lista(dato(await client.v2.session.history({ sessionID: id }))).length
      if (ora === ultimo) { if (++fermo >= 4) break } else { fermo = 0; ultimo = ora }
    }
    const storia = lista(dato(await client.v2.session.history({ sessionID: id })))
    const nuovi = storia.slice(prima)
    const rotto = nuovi.some(e => e.type === 'session.next.step.failed')
    const fatto = nuovi.some(e => e.type === 'session.next.step.ended')
    if (fatto && !rotto) return nuovi
    console.log(`    (giro ${giro}: ${nuovi.length} eventi, ${rotto ? 'step fallito' : 'nessuno step'} — ritento)`)
    if (giro === TENTATIVI) return nuovi
    await new Promise(r => setTimeout(r, 8000))
  }
  return []
}

const riepilogo = {}
async function scena(nome, testo) {
  console.log(`\n# ${nome}`)
  const ses = dato(await client.v2.session.create({ model: MODELLO, location: { directory: CASA } }))
  const nuovi = await turno(ses.id, testo)
  const tipi = {}
  for (const e of nuovi) tipi[e.type] = (tipi[e.type] ?? 0) + 1
  const tool = nuovi.filter(e => e.type === 'session.next.tool.called').map(e => e.data?.tool)
  console.log('  eventi:', Object.entries(tipi).map(([k, v]) => `${v}x ${k}`).join(' · ') || 'nessuno')
  if (tool.length) console.log('  tool usati:', tool.join(', '))
  const todo = dato(await client.session.todo({ sessionID: ses.id }))
  const diff = dato(await client.session.diff({ sessionID: ses.id }))
  // ATTENZIONE al nome: `v2.session.context` NON torna «quanto e' pieno il contesto»,
  // torna **i messaggi che compongono il contesto**. Il consumo arriva invece come
  // evento, `session.next.context.updated` — cioe' OpenCode lo **spinge**, mentre
  // Claude Code lo fa **chiedere** (`getContextUsage()`). Misurato, non dedotto.
  const ctx = dato(await client.v2.session.context({ sessionID: ses.id }))
  console.log(`  todo: ${JSON.stringify(todo).slice(0, 160)}`)
  console.log(`  diff: ${JSON.stringify(diff).slice(0, 200)}`)
  console.log(`  context: ${JSON.stringify(ctx).slice(0, 200)}`)
  riepilogo[nome] = { sessionID: ses.id, tipi, tool, todo, diff, ctx, eventi: nuovi.length }
  return { id: ses.id, nuovi }
}

// 1. la checklist: si chiede un lavoro a piu' passi, che e' cio' che la fa comparire
await scena('todo — un lavoro a piu\' passi',
  'Fai un piano a tre passi per riordinare conti.txt e tienilo aggiornato mentre lavori. Poi eseguilo.')

// 2. la domanda: si chiede una cosa ambigua, che il modello non puo' decidere da solo
await scena('question — una scelta che non tocca a te',
  'Devo rinominare conti.txt. Chiedimi tu quale nome preferisco fra numeri.txt e lista.txt, non deciderlo da solo.')

// 3. il sotto-agent
await scena('task — delegare a un sotto-agent',
  'Delega a un sub-agent il compito di contare le righe di conti.txt e riportami solo il numero.')

// 4. un edit vero, per svegliare diff e file.edited
const q = await scena('edit — un file davvero cambiato',
  'Aggiungi la riga "quattro" alla fine di conti.txt. Fallo e basta.')

// dopo un edit vero: il revert ha qualcosa da annullare?
console.log('\n# revert, dopo un edit vero')
for (const [nome, f] of [
  ['revert.stage', () => client.v2.session.revert.stage({ sessionID: q.id })],
  ['revert.commit', () => client.v2.session.revert.commit({ sessionID: q.id })],
  ['revert.clear', () => client.v2.session.revert.clear({ sessionID: q.id })],
]) {
  try { console.log(`  ${nome}:`, JSON.stringify(dato(await f())).slice(0, 200)) }
  catch (e) { console.log(`  ${nome}: NO —`, String(e?.message ?? e).slice(0, 120)) }
}

writeFileSync('/tmp/p23-riepilogo.json', JSON.stringify(riepilogo, null, 2))
console.log('\ndettaglio in /tmp/p23-riepilogo.json')
server.close()
process.exit(0)
