// L'helper dal lato del daemon: non lascia niente, non compare, non puo' scrivere.
//
// Perche' questa sonda esiste. Le tre promesse dell'helper (§17) sono tutte del tipo
// che **fallisce in silenzio**: una chat che compare nell'elenco non da' errore, un
// journal scritto per sbaglio non da' errore, e un divieto che non morde lascia il
// turno finire benissimo. Nessuna prova offline puo' vederle: servono un daemon vero,
// un processo figlio vero e un'occhiata al disco.
//
// Costa un turno corto di Claude Code.
//
// Uso:  node spike/helper-motore.ts

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const HOME = '/tmp/stark-helper-home'
const BERSAGLIO = '/tmp/stark-helper-vietato.txt'
rmSync(HOME, { recursive: true, force: true })
rmSync(BERSAGLIO, { force: true })
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

// ─── il catalogo ────────────────────────────────────────────────────────────
const cat = await j('/api/models')
const agenti = (cat.corpo?.['agents'] ?? []) as Array<Record<string, unknown>>
const modelli = agenti.flatMap(a => (a['models'] as unknown[]) ?? [])
console.log('# agent:', agenti.map(a => `${a['id']}(${((a['models'] as unknown[]) ?? []).length})`).join(' '))
check('il catalogo elenca i modelli senza che esista una chat', modelli.length > 0, `${modelli.length}`)
check('e li ha di piu\' di un agent solo', agenti.filter(a => ((a['models'] as unknown[]) ?? []).length > 0).length >= 2)
check('un agent presente ma non guidabile porta la sua ragione',
  agenti.every(a => a['available'] === true || typeof a['reason'] === 'string'))

// ─── l'apertura ─────────────────────────────────────────────────────────────
const ap = await j('/api/helper', { method: 'POST', body: JSON.stringify({}) })
check('l\'helper si apre', ap.stato === 201, `HTTP ${ap.stato}`)
if (ap.stato !== 201) { await s.stop(); process.exit(1) }
const id = String(ap.corpo?.['id'])

const elenco = await j('/api/sessions')
const righe = (elenco.corpo?.['sessions'] ?? []) as Array<Record<string, unknown>>
check('NON compare nell\'elenco delle chat', !righe.some(r => r['id'] === id), `${righe.length} righe`)

const sessioni = resolve(HOME, 'sessioni')
const fileDopoApertura = existsSync(sessioni) ? readdirSync(sessioni) : []
check('NON scrive nessun journal su disco', fileDopoApertura.length === 0, fileDopoApertura.join(', ') || 'cartella vuota')

// ─── il turno: legge, e non puo' scrivere ───────────────────────────────────
await j(`/api/sessions/${id}/command`, {
  method: 'POST',
  body: JSON.stringify({
    c: 'session.prompt',
    text: `Crea il file ${BERSAGLIO} con dentro la parola OK. Poi dimmi in una riga se ci sei riuscito.`,
  }),
})

async function aspettaFine(): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const v = await j(`/api/sessions/${id}`)
    const sn = v.corpo?.['snapshot'] as Record<string, unknown> | undefined
    if (sn && sn['state'] === 'idle' && ((sn['turns'] as unknown[]) ?? []).length > 0) return sn
  }
  return null
}
const snap = await aspettaFine()
check('il turno arriva in fondo', snap !== null)

const testo = JSON.stringify(snap ?? {})
check('il file vietato NON esiste sul disco', !existsSync(BERSAGLIO), BERSAGLIO)
check('e lo dice, invece di fingere', /sola lettura|read-only|non .{0,20}(riuscito|posso)|cannot|denied|rifiut/i.test(testo))

// ─── la ricerca non lo trova, e non resta niente ────────────────────────────
const cerca = await j('/api/search?q=' + encodeURIComponent('OK'))
const trovati = (cerca.corpo?.['results'] ?? []) as Array<Record<string, unknown>>
check('la ricerca non lo trova', !trovati.some(r => r['id'] === id))

// ─── uno solo ───────────────────────────────────────────────────────────────
const secondo = await j('/api/helper', { method: 'POST', body: JSON.stringify({}) })
const id2 = String(secondo.corpo?.['id'])
check('aprirne un altro ne apre uno nuovo', secondo.stato === 201 && id2 !== id)
const vecchio = await j(`/api/sessions/${id}`)
const vs = vecchio.corpo?.['snapshot'] as Record<string, unknown> | undefined
check('e chiude il precedente: uno solo alla volta', vecchio.stato === 404 || vs?.['state'] === 'closed',
  `HTTP ${vecchio.stato} stato=${String(vs?.['state'])}`)

await j('/api/helper', { method: 'DELETE' })
const finali = existsSync(sessioni) ? readdirSync(sessioni) : []
check('alla fine su disco non e\' rimasto niente', finali.length === 0, finali.join(', ') || 'cartella vuota')

await s.stop()
console.log(`\n${n - ko}/${n}`)
process.exit(ko === 0 ? 0 : 1)
