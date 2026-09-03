// Il flusso esatto fra il CLI di Claude Code e l'API — cioe' DOVE si anonimizza.
//
// La misura A (`proxy-base-url.ts`) ha detto **che** il proxy e' praticabile. Questa dice
// **cosa ci passa dentro**: quali endpoint, che forma ha il corpo, in quali campi vive il
// testo, e con che forma torna indietro la risposta.
//
// Il metodo e' quello che questo progetto preferisce: invece di elencare a memoria i campi
// dell'API, si **cammina il JSON vero** e si stampa un inventario dei percorsi in cui c'e'
// del testo, con quanti byte ciascuno. Cosi' la mappa la produce il traffico. Se domani
// l'API aggiunge un campo, la sonda lo vede senza che nessuno l'abbia previsto.
//
// LA SCENA: si fa leggere all'agent un file che contiene tre esche riconoscibili — un nome,
// una chiave finta, una email. Servono a **seguirle** dentro il payload: rispondono alla
// domanda «il contenuto di un file letto dall'agent dove finisce, esattamente?», che e' il
// buco strutturale del §2 e la ragione per cui il journal non basta.
//
// COSTO: un turno con un tool, quindi due andate e ritorno con l'API. Modesto ma non zero.
//
// Uso:  node spike/flusso-anthropic.ts

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from '../src/adapters/claude-code/sdk-options.ts'

const UPSTREAM = 'api.anthropic.com'
const PREFISSO = '/s/FLUSSO-1'
const DIR = new URL('./captures/', import.meta.url).pathname

// Le tre esche. Forme diverse di proposito: una senza forma riconoscibile (il nome), una
// con prefisso noto (la chiave), una con forma (l'email) — le tre classi del §5.
const ESCHE = {
  nome: 'Ludovica Ferrante-Malaspina',
  chiave: 'sk-ant-FINTA-0000000000000000000000000000',
  email: 'l.ferrante@cliente-esca.example',
}

type Giro = {
  n: number
  metodo: string
  percorso: string
  richiestaByte: number
  rispostaByte: number
  esito?: number
  /** Percorsi JSON in cui vive del testo, nella richiesta. */
  campi: Record<string, { volte: number; byte: number }>
  /** Dove sono finite le esche, per percorso JSON. */
  escheIn: Record<string, string[]>
  /** Tipi di evento e di delta visti nella risposta SSE. */
  eventi: Record<string, number>
  /** I frammenti in cui e' arrivato l'input di un tool: serve a mostrare lo spezzettamento. */
  frammentiToolInput: string[]
}

const giri: Giro[] = []

/** Cammina un JSON e riporta ogni stringa "sostanziosa" col suo percorso, con gli indici
 *  di array generalizzati a `[]`: e' la forma in cui la mappa serve a chi dovra' filtrare. */
function inventario(v: unknown, via = '', out: Record<string, { volte: number; byte: number }> = {},
  esche: Record<string, string[]> = {}) {
  if (typeof v === 'string') {
    if (v.length >= 8) {
      const c = out[via] ?? (out[via] = { volte: 0, byte: 0 })
      c.volte++; c.byte += v.length
    }
    for (const [nome, esca] of Object.entries(ESCHE)) {
      if (v.includes(esca)) (esche[via] ?? (esche[via] = [])).push(nome)
    }
  } else if (Array.isArray(v)) {
    for (const x of v) inventario(x, `${via}[]`, out, esche)
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      inventario(x, via ? `${via}.${k}` : k, out, esche)
    }
  }
  return { out, esche }
}

/** Spacchetta lo stream SSE della risposta in tipi di evento e frammenti di tool input. */
function leggiSSE(testo: string) {
  const eventi: Record<string, number> = {}
  const frammenti: string[] = []
  for (const riga of testo.split('\n')) {
    if (!riga.startsWith('data: ')) continue
    let e: Record<string, unknown>
    try { e = JSON.parse(riga.slice(6)) } catch { continue }
    const tipo = String(e['type'] ?? '?')
    // Un `content_block_delta` dice poco: quello che conta e' **che delta** e'.
    const d = e['delta'] as Record<string, unknown> | undefined
    const cb = e['content_block'] as Record<string, unknown> | undefined
    const etichetta = tipo === 'content_block_delta' && d ? `${tipo}/${d['type']}`
      : tipo === 'content_block_start' && cb ? `${tipo}/${cb['type']}`
      : tipo
    eventi[etichetta] = (eventi[etichetta] ?? 0) + 1
    if (d?.['type'] === 'input_json_delta') frammenti.push(String(d['partial_json'] ?? ''))
  }
  return { eventi, frammenti }
}

const senzaPrefisso = (u: string) => u.startsWith(PREFISSO) ? u.slice(PREFISSO.length) || '/' : u

function proxy(req: IncomingMessage, res: ServerResponse) {
  const pezzi: Buffer[] = []
  req.on('data', (c: Buffer) => pezzi.push(c))
  req.on('end', () => {
    const corpo = Buffer.concat(pezzi)
    const g: Giro = {
      n: giri.length + 1,
      metodo: req.method ?? '?',
      percorso: senzaPrefisso(req.url ?? '/'),
      richiestaByte: corpo.length,
      rispostaByte: 0,
      campi: {}, escheIn: {}, eventi: {}, frammentiToolInput: [],
    }
    giri.push(g)
    if (corpo.length) {
      try {
        const b = JSON.parse(corpo.toString('utf8'))
        const { out, esche } = inventario(b)
        g.campi = out; g.escheIn = esche
        writeFileSync(join(DIR, `flusso-richiesta-${g.n}.json`), JSON.stringify(b, null, 2))
      } catch { /* non JSON: si lascia stare */ }
    }

    const h = { ...req.headers }
    delete h['host']; delete h['connection']
    // MISURATO, non previsto: senza toglierlo la risposta arriva **gzip**, e uno stream
    // compresso non si puo' riscrivere leggendolo. Per un proxy che deve deanonimizzare
    // le due strade sono questa (chiedere `identity`, e pagare banda vera fra noi e
    // Anthropic) oppure decomprimere e ricomprimere. Qui si chiede identity.
    delete h['accept-encoding']
    const su = httpsRequest(
      { host: UPSTREAM, port: 443, path: senzaPrefisso(req.url ?? '/'), method: req.method,
        headers: { ...h, host: UPSTREAM } },
      giu => {
        g.esito = giu.statusCode
        res.writeHead(giu.statusCode ?? 502, giu.headers)
        const risp: Buffer[] = []
        giu.on('data', (c: Buffer) => { risp.push(c); g.rispostaByte += c.length })
        giu.on('end', () => {
          const grezzo = Buffer.concat(risp)
          writeFileSync(join(DIR, `flusso-risposta-${g.n}.txt`), grezzo)
          const testo = grezzo.toString('utf8')
          const { eventi, frammenti } = leggiSSE(testo)
          g.eventi = eventi; g.frammentiToolInput = frammenti
        })
        giu.pipe(res)
      },
    )
    su.on('error', () => { g.esito = -1; res.writeHead(502).end() })
    su.end(corpo)
  })
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  // La scena: una cartella con dentro un file che porta le tre esche.
  const scena = mkdtempSync(join(tmpdir(), 'flusso-'))
  writeFileSync(join(scena, 'clienti.txt'),
    `Referente: ${ESCHE.nome}\nContatto: ${ESCHE.email}\nToken: ${ESCHE.chiave}\n`)

  const server = createServer(proxy)
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const porta = (server.address() as { port: number }).port
  console.log(`proxy su http://127.0.0.1:${porta}${PREFISSO} → https://${UPSTREAM}`)
  console.log(`scena: ${scena}\n`)

  const opts = buildOptions({
    cwd: scena, mode: 'acceptEdits', model: 'claude-sonnet-5',
    title: 'sonda flusso',   // spegne la chiamata di generazione del titolo
  }) as Record<string, unknown>
  opts['env'] = { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${porta}${PREFISSO}` }

  let testo = ''
  try {
    const q = query({
      // La scena serve a far attraversare al **nome** tutti e quattro i punti del flusso:
      // entra come contenuto di un file letto (tool_result), esce come prosa del modello
      // (text_delta) ed esce come **input di un tool di scrittura** (input_json_delta) —
      // che e' il caso in cui una deanonimizzazione sbagliata scriverebbe un segnaposto
      // dentro un file vero.
      prompt: 'Leggi il file clienti.txt in questa cartella, poi scrivi un file scheda.md '
        + 'che contenga una riga con il nome del referente. Infine dimmi chi e.',
      options: opts as never,
    })
    for await (const m of q) {
      const msg = m as Record<string, unknown>
      if (msg['type'] === 'assistant') {
        const c = (msg['message'] as Record<string, unknown>)?.['content']
        if (Array.isArray(c)) for (const b of c) if (b?.['type'] === 'text') testo += String(b['text'])
      }
      if (msg['type'] === 'result') break
    }
  } catch (e) {
    console.log(`errore: ${String((e as Error)?.message ?? e).slice(0, 300)}`)
  }
  server.close()
  await new Promise(r => setTimeout(r, 500))

  // ── resoconto ───────────────────────────────────────────────────────────────
  console.log(`risposta dell'agent: ${testo.trim().slice(0, 200) || '(nessuna)'}\n`)
  console.log('='.repeat(78))
  for (const g of giri) {
    console.log(`\n── giro ${g.n}: ${g.metodo} ${g.percorso}  [${g.esito}]  `
      + `${g.richiestaByte} B su / ${g.rispostaByte} B giu`)
    const campi = Object.entries(g.campi).sort((a, b) => b[1].byte - a[1].byte)
    if (campi.length) {
      console.log('   dove vive il testo (percorso JSON → volte, byte):')
      for (const [via, c] of campi.slice(0, 14)) {
        console.log(`     ${via.padEnd(46)} ${String(c.volte).padStart(4)} × ${String(c.byte).padStart(7)} B`)
      }
      if (campi.length > 14) console.log(`     … e altri ${campi.length - 14} percorsi`)
    }
    if (Object.keys(g.escheIn).length) {
      console.log('   ESCHE ritrovate:')
      for (const [via, quali] of Object.entries(g.escheIn)) {
        console.log(`     ${via.padEnd(46)} ${[...new Set(quali)].join(', ')}`)
      }
    }
    const ev = Object.entries(g.eventi).sort((a, b) => b[1] - a[1])
    if (ev.length) {
      console.log('   risposta, eventi SSE:')
      for (const [t, n] of ev) console.log(`     ${t.padEnd(46)} ${n}`)
    }
    if (g.frammentiToolInput.length) {
      console.log(`   input del tool arrivato in ${g.frammentiToolInput.length} frammenti:`)
      console.log(`     ${JSON.stringify(g.frammentiToolInput.slice(0, 12))}`)
    }
  }
  console.log('\n' + '='.repeat(78))
  console.log(`catture: ${DIR}flusso-{richiesta,risposta}-N.{json,txt}`)
  process.exit(0)
}

main()
