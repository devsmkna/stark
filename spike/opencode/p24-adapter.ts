// P24 — il secondo adapter, dal vivo, attraverso il daemon.
//
// Non prova «OpenCode funziona»: prova che il **confine del §1 tiene**. Il daemon apre
// una conversazione passando `agent: 'opencode'` e non sa nient'altro; quello che
// finisce nel journal deve essere vocabolario canonico e basta, indistinguibile per
// forma da quello di Claude Code.
//
// Costo: zero quota Claude. Gira su un modello free di OpenCode Zen — che su questa
// macchina e' fragile, quindi la sonda separa **cio' che dipende dal modello** (il
// turno) da **cio' che dipende dall'adapter** (l'apertura, le capacita', lo stato, il
// ref di ripresa, lo spegnimento). Il secondo si giudica anche se il primo fallisce.
//
// Uso:  node spike/opencode/p24-adapter.ts [modello]

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const CASA = '/tmp/stark-p24-progetto'
const HOME = '/tmp/stark-p24-home'
const MODELLO = process.argv[2] ?? 'opencode/nemotron-3-ultra-free'

rmSync(CASA, { recursive: true, force: true })
rmSync(HOME, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })
mkdirSync(HOME, { recursive: true })
writeFileSync(`${CASA}/nota.txt`, 'La parola nascosta e: MELANZANA\n')

// `STARK_HOME` prima dell'import: `registry.ts` la risolve **una volta sola** al load
// del modulo, e un `import` statico verrebbe issato in cima al file — cioe' eseguito
// prima di questa riga. Stessa trappola gia' documentata in `daemon-check.ts`.
process.env['STARK_HOME'] = HOME
const { startDaemon } = await import('../../src/daemon/server.ts')

const s = await startDaemon({ port: 0 })
const H = { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }
const j = async (p: string, init: RequestInit = {}) => {
  const r = await fetch(s.url + p, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  return { stato: r.status, corpo: await r.json().catch(() => null) as Record<string, unknown> | null }
}

let esiti = 0, falliti = 0
const check = (nome: string, ok: boolean, extra = '') => {
  esiti++
  if (!ok) falliti++
  console.log(`${ok ? 'OK  ' : 'NO  '} ${nome}${extra ? ' · ' + extra : ''}`)
}

// ─── aprire ─────────────────────────────────────────────────────────────────
console.log('# il daemon apre una chat OpenCode senza sapere cosa sia\n')
const apertura = await j('/api/sessions', {
  method: 'POST',
  // **Senza** modello, di proposito: cosi' si prova anche che l'adapter risolva il
  // «decidi tu» chiedendolo a OpenCode invece di lasciare la barra su «default».
  body: JSON.stringify({ cwd: CASA, agent: 'opencode' }),
})
check('POST /api/sessions con agent: opencode', apertura.stato === 201,
  `HTTP ${apertura.stato}`)
if (apertura.stato !== 201) {
  console.log(JSON.stringify(apertura.corpo).slice(0, 400))
  await s.stop(); process.exit(1)
}
const id = String((apertura.corpo as Record<string, unknown>)['id'])
const snap0 = (apertura.corpo as Record<string, unknown>)['snapshot'] as Record<string, unknown>
check('la chat nasce con l\'agent giusto', snap0['agent'] === 'opencode', String(snap0['agent']))
check('e con la cartella giusta', snap0['cwd'] === CASA, String(snap0['cwd']))

// ─── quello che l'adapter dichiara ──────────────────────────────────────────
const dopoAvvio = await j(`/api/sessions/${id}`)
const snap = (dopoAvvio.corpo as Record<string, unknown>)['snapshot'] as Record<string, unknown>
const cap = (snap['capabilities'] ?? {}) as Record<string, unknown>
check('lo stato arriva a idle', snap['state'] === 'idle', String(snap['state']))
check('dichiara di NON avere auto mode', cap['autoMode'] === false)
check('dichiara di avere il revert', cap['revert'] === true)
check('«decidi tu» diventa il modello vero che OpenCode userebbe',
  typeof snap['model'] === 'string' && String(snap['model']).includes('/'),
  String(snap['model']))
check('il ref di ripresa e\' quello di OpenCode', String(snap['resumeRef'] ?? '').startsWith('ses'),
  String(snap['resumeRef']))
const modi = (snap['modes'] ?? []) as Array<Record<string, unknown>>
const spente = modi.filter(m => m['available'] === false)
check('le modalita\' che non esistono sono spente CON la ragione',
  spente.length === 4 && spente.every(m => typeof m['reason'] === 'string' && String(m['reason']).length > 0),
  `${spente.length} spente`)

// ─── i modelli offerti, e cambiarne uno ─────────────────────────────────────
const modelli = (snap['models'] ?? []) as Array<Record<string, unknown>>
check('la barra ha dei modelli veri fra cui scegliere', modelli.length > 0,
  `${modelli.length} modelli`)
check('e sono quelli dei provider autenticati, non il catalogo del mondo',
  modelli.length > 0 && modelli.length < 500, `${modelli.length}`)
// Senza questa la chat nasce su cio' che OpenCode sceglie da se' — che su questa
// macchina e' `big-pickle`, giu' a monte — e non c'e' via d'uscita.
await j(`/api/sessions/${id}/command`, {
  method: 'POST',
  body: JSON.stringify({ c: 'session.setModel', model: MODELLO }),
})
await new Promise(r => setTimeout(r, 800))
const dopoModello = await j(`/api/sessions/${id}`)
const snapM = (dopoModello.corpo as Record<string, unknown>)['snapshot'] as Record<string, unknown>
check('cambiare modello a caldo si vede nello snapshot', snapM['model'] === MODELLO,
  String(snapM['model']))

// ─── il turno (dipende dal modello, quindi si ritenta) ──────────────────────
console.log('\n# un turno vero')
let turno = false
for (let giro = 1; giro <= 3 && !turno; giro++) {
  await j(`/api/sessions/${id}/command`, {
    method: 'POST',
    body: JSON.stringify({ c: 'session.prompt', text: 'Di\' soltanto: PRONTO' }),
  })
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const v = await j(`/api/sessions/${id}`)
    const sn = (v.corpo as Record<string, unknown>)['snapshot'] as Record<string, unknown>
    const turni = (sn['turns'] ?? []) as Array<Record<string, unknown>>
    const ultimo = turni[turni.length - 1]
    if (ultimo && ultimo['endedAt']) {
      // `parts`, non `blocks`: il campo di `TurnView` si chiama cosi'. La prima
      // versione di questa sonda guardava `blocks`, non trovava niente e dava la colpa
      // all'adapter — che invece aveva gia' tradotto tutto. Una prova che guarda il
      // campo sbagliato non fallisce: mente.
      const blocchi = (ultimo['parts'] ?? []) as Array<Record<string, unknown>>
      turno = ultimo['reason'] === 'completed' && blocchi.length > 0
      console.log(`  giro ${giro}: turno chiuso «${String(ultimo['reason'])}», ${blocchi.length} blocchi`)
      if (turno) {
        const testo = blocchi.filter(b => b['kind'] === 'text').map(b => String(b['text'] ?? '')).join('')
        console.log(`  risposta: ${testo.slice(0, 120).trim()}`)
      }
      break
    }
  }
  if (!turno && giro < 3) { console.log('  (ritento: il modello free e\' fragile)'); await new Promise(r => setTimeout(r, 6000)) }
}
check('un turno si apre, si riempie e si chiude', turno,
  turno ? '' : 'non riuscito col modello disponibile — vedi §14-bis')

// ─── chiudere ───────────────────────────────────────────────────────────────
console.log('\n# spegnere')
await j(`/api/sessions/${id}/command`, { method: 'POST', body: JSON.stringify({ c: 'session.sleep' }) })
await new Promise(r => setTimeout(r, 1500))
const fine = await j(`/api/sessions/${id}`)
const snapF = (fine.corpo as Record<string, unknown>)['snapshot'] as Record<string, unknown>
check('lo Sleep porta la chat a sleeping', snapF['state'] === 'sleeping', String(snapF['state']))

console.log(`\n${esiti - falliti}/${esiti} verifiche passate`)
await s.stop()
process.exit(falliti > 0 ? 1 : 0)
