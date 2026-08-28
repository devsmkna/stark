// Il titolo lo dice STARK, quindi l'agent non deve generarlo.
//
// Perche' questa sonda esiste e non basta leggere il codice: `title` e' un campo che
// **fallisce in silenzio**. Se non arrivasse al CLI, o se il CLI lo ignorasse, la
// sessione funzionerebbe benissimo — semplicemente continuerebbe a spendere una
// chiamata al modello per inventarsi un nome che STARK poi butta via. Nessuna prova
// offline puo' vederlo: serve una sessione vera e un'occhiata al journal **nativo**,
// che e' l'unico posto dove la voce `ai-title` compare.
//
// Costa **un turno corto** di Claude Code.
//
// Uso:  node spike/titolo-non-generato.ts

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Casa propria in /tmp: una prova non ha il permesso di lasciare una chat in mezzo a
// quelle dell'utente (la lezione delle «chat fantasma», gia' pagata una volta).
const HOME = mkdtempSync(resolve(tmpdir(), 'stark-titolo-'))
const LAVORO = mkdtempSync(resolve(tmpdir(), 'stark-titolo-cwd-'))
process.env['STARK_HOME'] = HOME
// L'import e' dinamico **e non e' stile**: `registry.ts` risolve `STARK_HOME` una volta
// sola al load del modulo, e un `import` statico verrebbe issato in cima al file.
const { startDaemon } = await import('../src/daemon/server.ts')

const CONFIG = process.env['CLAUDE_CONFIG_DIR'] ?? resolve(process.env['HOME'] ?? '/root', '.claude')
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

const ap = await j('/api/sessions', { method: 'POST', body: JSON.stringify({ cwd: LAVORO }) })
check('la chat si apre', ap.stato === 201, `HTTP ${ap.stato}`)
const id = String(ap.corpo?.['id'] ?? '')
if (!id) { await s.stop(); process.exit(1) }

// Un turno vero, il piu' corto possibile: il titolo il CLI lo genera **dal primo
// messaggio dell'utente**, quindi senza un turno non ci sarebbe niente da non generare.
const inv = await j(`/api/sessions/${id}/command`, {
  method: 'POST',
  body: JSON.stringify({ c: 'session.prompt', text: 'Rispondi solo con la parola PONG.' }),
})
check('il prompt e\' stato accettato', inv.stato === 200, `HTTP ${inv.stato}`)

// Si aspetta che il turno **compaia e poi finisca**: guardare solo lo stato non basta,
// perche' per il primo secondo la chat non e' ancora `busy` e si uscirebbe subito
// dichiarando finito un turno mai cominciato. Verificato: succede.
let turni = 0, chiuso = false, testo = ''
for (let i = 0; i < 180 && !chiuso; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const st = await j(`/api/sessions/${id}`)
  const snap = st.corpo?.['snapshot'] as Record<string, unknown> | undefined
  const ts = (snap?.['turns'] ?? []) as Record<string, unknown>[]
  turni = ts.length
  const ultimo = ts[ts.length - 1]
  if (ultimo?.['endedAt']) { chiuso = true; testo = JSON.stringify(ultimo['parts']).slice(0, 120) }
}
check('un turno vero e\' partito ed e\' finito', chiuso, `${turni} turni · ${testo}`)
// Il titolo lo genera un lavoro di sfondo: non e' detto che sia gia' passato a turno
// chiuso, quindi gli si lascia il tempo di sbagliare invece di dichiararlo assente.
await new Promise(r => setTimeout(r, 8000))

// ─── il journal **nativo**, che e' l'unico che sa di titoli ──────────────────
const progetti = resolve(CONFIG, 'projects')
let nativo = ''
if (existsSync(progetti)) {
  for (const d of readdirSync(progetti)) {
    const f = resolve(progetti, d, `${id}.jsonl`)
    if (existsSync(f)) { nativo = f; break }
  }
}
check('il journal nativo esiste', nativo !== '', nativo || 'non trovato')
if (nativo) {
  const testo = readFileSync(nativo, 'utf8')
  const aiTitle = (testo.match(/"type":"ai-title"/g) ?? []).length
  const custom = testo.match(/"customTitle":"([^"]*)"/)
  check('l\'agent NON ha generato un titolo', aiTitle === 0, `${aiTitle} voci ai-title`)
  check('il titolo e\' quello di STARK', custom !== null && custom[1]?.startsWith('new chat') === true,
    custom?.[1] ?? '(nessun customTitle)')
}

await j(`/api/sessions/${id}`, { method: 'DELETE' })
await s.stop()
rmSync(HOME, { recursive: true, force: true })
rmSync(LAVORO, { recursive: true, force: true })
console.log(`\n${n - ko}/${n} verifiche passate`)
process.exit(ko ? 1 : 0)
