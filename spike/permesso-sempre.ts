// «Consenti sempre» deve consentire davvero anche la prossima volta.
//
// Perche' questa sonda esiste. Il 27 agosto 2026, chiudendo il confine del §1, il
// campo `PermissionAnswer.remember` e' passato da `PermissionUpdate[]` — un tipo
// dell'SDK Anthropic **costruito dentro `daemon/registry.ts`** — a una stringa: il
// soggetto da ricordare. La traduzione in una regola `addRules` scritta in
// `.claude/settings.local.json` e' ora dell'adapter.
//
// E' un cambio che, rompendosi, **non da' nessun errore**: il bottone si comporterebbe
// come «Consenti», e l'evento nel journal direbbe `always` lo stesso. Una bugia scritta
// su disco, che si scopre solo la volta dopo. Nessuna prova offline puo' vederlo:
// serve un turno vero e poi guardare il file dell'utente.
//
// Costo: due turni corti di Claude Code.
//
// Uso:  node spike/permesso-sempre.ts

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const CASA = '/tmp/stark-sempre-progetto'
const HOME = '/tmp/stark-sempre-home'
rmSync(CASA, { recursive: true, force: true })
rmSync(HOME, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })
mkdirSync(HOME, { recursive: true })

process.env['STARK_HOME'] = HOME
const { startDaemon } = await import('../src/daemon/server.ts')

const s = await startDaemon({ port: 0 })
const H = { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }
const j = async (p: string, init: RequestInit = {}) => {
  const r = await fetch(s.url + p, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
  return { stato: r.status, corpo: await r.json().catch(() => null) as Record<string, unknown> | null }
}

let n = 0, ko = 0
const check = (nome: string, ok: boolean, extra = '') => {
  n++; if (!ok) ko++
  console.log(`${ok ? 'OK  ' : 'NO  '} ${nome}${extra ? ' · ' + extra : ''}`)
}

// `ask: ['shell']` invece di lasciare il default: serve una card, e in `auto` mode il
// classificatore risolverebbe prima senza chiamare nessuno (misurato, §16.5).
const ap = await j('/api/sessions', {
  method: 'POST',
  body: JSON.stringify({ cwd: CASA, ask: ['shell'] }),
})
check('la chat si apre chiedendo conferma sui comandi', ap.stato === 201, `HTTP ${ap.stato}`)
if (ap.stato !== 201) { await s.stop(); process.exit(1) }
const id = String((ap.corpo as Record<string, unknown>)['id'])

/**
 * Aspetta che compaia una richiesta di permesso.
 *
 * Si guarda `pendingPermissions` — il nome vero, letto in `reduce.ts`. La prima
 * versione di questa sonda cercava campi indovinati (`pending`, `blocking`) e restava
 * ad aspettare per sempre: una prova che guarda il campo sbagliato non fallisce,
 * scade. E' la quarta volta oggi.
 */
async function aspettaPermesso(): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const v = await j(`/api/sessions/${id}`)
    const sn = (v.corpo as Record<string, unknown>)['snapshot'] as Record<string, unknown>
    const lista = (sn['pendingPermissions'] ?? []) as Array<Record<string, unknown>>
    if (lista.length > 0) return lista[0] ?? null
    if (sn['state'] === 'idle' && i > 8) return null   // il turno e' finito senza chiedere
  }
  return null
}

console.log('\n# primo turno: la card deve comparire')
await j(`/api/sessions/${id}/command`, {
  method: 'POST',
  body: JSON.stringify({ c: 'session.prompt', text: 'Lancia il comando `echo CIAO` e dimmi cosa stampa.' }),
})
const perm = await aspettaPermesso()
check('arriva una richiesta di permesso', perm !== null,
  perm ? String(perm['action'] ?? perm['requestId']) : 'nessuna')
if (!perm) { await s.stop(); process.exit(1) }

// Il soggetto da ricordare: `savable` e' cio' che l'adapter propone.
const salvabili = (perm['savable'] ?? []) as string[]
const scope = salvabili[0] ?? 'Bash'
console.log(`  soggetto proposto: ${scope}`)

const rispondi = await j(`/api/sessions/${id}/command`, {
  method: 'POST',
  body: JSON.stringify({
    c: 'permission.reply',
    requestId: String(perm['requestId'] ?? perm['id']),
    decision: 'always',
    scope,
  }),
})
check('la risposta «sempre» viene accettata', rispondi.stato === 200, `HTTP ${rispondi.stato}`)

// Aspetta che il turno finisca prima di guardare il disco: la regola la scrive l'SDK.
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const v = await j(`/api/sessions/${id}`)
  const sn = (v.corpo as Record<string, unknown>)['snapshot'] as Record<string, unknown>
  if (sn['state'] === 'idle') break
}

// ─── la prova vera: il file dell'utente ─────────────────────────────────────
console.log('\n# la regola sul disco')
const dove = resolve(CASA, '.claude', 'settings.local.json')
const c1 = existsSync(dove) ? readFileSync(dove, 'utf8') : ''
check('il file delle regole locali esiste', c1.length > 0, dove)
check('e dentro c\'e\' il soggetto che abbiamo detto di ricordare',
  c1.includes(scope), c1.replace(/\s+/g, ' ').slice(0, 200))

// ─── e l'evento non deve mentire ────────────────────────────────────────────
// Si legge il **journal**, non lo snapshot: la fonte autorevole e' quella, e cercare
// la decisione fra le `parts` di un turno significava indovinare una forma. E' la
// quarta volta oggi che una prova guarda il posto sbagliato e sembra dire qualcosa.
const { readFileSync: leggi, readdirSync } = await import('node:fs')
const cartella = resolve(HOME, 'sessioni')
const file = readdirSync(cartella).filter(f => f.endsWith('.jsonl') && !f.endsWith('.raw.jsonl'))[0]
const righe = leggi(resolve(cartella, String(file)), 'utf8').trim().split('\n')
const replied = righe
  .map(r => JSON.parse(r) as { payload?: Record<string, unknown> })
  .map(e => e.payload)
  .find(p => p?.['k'] === 'permission.replied')
check('il journal registra «always», e adesso non e\' una bugia',
  replied?.['decision'] === 'always', String(replied?.['decision']))

await j(`/api/sessions/${id}/command`, { method: 'POST', body: JSON.stringify({ c: 'session.close' }) })
console.log(`\n${n - ko}/${n} verifiche passate`)
await s.stop()
process.exit(ko > 0 ? 1 : 0)
