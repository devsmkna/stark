// Copertura per-provider su OpenCode (docs/anonimizzazione.md §9.13, §12bis).
//
// La misura A-ter ha visto `options.baseURL` funzionare sul provider `anthropic` (a chiave
// finta). Ma la copertura dell'anonimizzazione su OpenCode e' PER PROVIDER: ogni provider
// e' un loader diverso nell'AI SDK, e «i tipi non sono i fatti» — che il campo esista nel
// tipo `Config` non dice che QUEL loader lo onori. Il provider `anthropic` con OAuth ha un
// percorso speciale che ignora `baseURL` (visto nel sorgente): niente vieta che un altro
// provider abbia una sua eccezione.
//
// Questa macchina non ha `anthropic`, ma ha i provider che USA DAVVERO: Zen (`opencode`),
// Baseten, opencode-go, Merge Gateway. Si prova la leva su ciascuno.
//
// COSTO ZERO, e per costruzione: il proxy NON INOLTRA. Blocca ogni richiesta con 402 e
// registra solo se il provider ci ha bussato e con quale percorso. La domanda e' «la leva
// instrada?», non «il turno riesce» — quindi non serve che parta niente verso nessun
// upstream, e nessuna quota di nessun provider viene toccata.
//
// Uso:  node spike/opencode/proxy-per-provider.ts

import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk'

const CATTURA = new URL('../captures/opencode-per-provider.jsonl', import.meta.url).pathname
const PREFISSO = '/pp'

type Bussata = { url: string; prefisso: boolean; ua: string }
let bussate: Bussata[] = []

function proxy(): Promise<number> {
  const srv = createServer((req, res) => {
    bussate.push({
      url: String(req.url),
      prefisso: String(req.url).startsWith(PREFISSO),
      ua: String(req.headers['user-agent'] ?? '').slice(0, 40),
    })
    // Non si inoltra: si blocca. 402 e' distinguibile e non e' un errore di rete.
    req.on('data', () => {})
    req.on('end', () => { res.writeHead(402).end('proxy: bloccato di proposito') })
  })
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok((srv.address() as { port: number }).port)))
}

async function main() {
  mkdirSync(new URL('../captures/', import.meta.url).pathname, { recursive: true })
  writeFileSync(CATTURA, '')
  const porta = await proxy()
  const base = `http://127.0.0.1:${porta}${PREFISSO}/v1`
  console.log(`proxy-blocco su 127.0.0.1:${porta}, baseURL: ${base}\n`)

  // Chiavi finte per i provider che le vogliono client-side (come in A-ter).
  process.env['ANTHROPIC_API_KEY'] ??= 'sk-ant-api03-FINTA-' + 'x'.repeat(80)

  const scena = mkdtempSync(join(tmpdir(), 'ppv-'))

  // Prima, senza baseURL, scopro quali provider ci sono e un modello a testa.
  let provider: Array<{ id: string; models: Record<string, unknown> }> = []
  {
    const ac = new AbortController()
    const s = await createOpencodeServer({ hostname: '127.0.0.1', port: 0, signal: ac.signal, timeout: 30_000 })
    const c = createOpencodeClient({ baseUrl: s.url })
    const rp = await c.config.providers({ query: { directory: scena } } as never) as Record<string, unknown>
    provider = ((rp['data'] ?? rp) as { providers?: typeof provider }).providers ?? []
    ac.abort(); s.close()
  }
  console.log(`provider trovati: ${provider.map(p => p.id).join(', ')}\n`)

  const esiti: Array<{ provider: string; modello: string; bussate: number; conPrefisso: number; nota: string }> = []

  for (const p of provider) {
    const modelli = Object.keys(p.models ?? {})
    // un modello che sappia di essere "free" se c'e', se no il primo — tanto non parte
    const modello = modelli.find(m => /free|nano|lightning|mini/i.test(m)) ?? modelli[0]
    if (!modello) { esiti.push({ provider: p.id, modello: '—', bussate: 0, conPrefisso: 0, nota: 'nessun modello' }); continue }

    bussate = []
    const ac = new AbortController()
    const boia = setTimeout(() => ac.abort(), 60_000)
    let nota = 'ok'
    try {
      const s = await createOpencodeServer({
        hostname: '127.0.0.1', port: 0, signal: ac.signal, timeout: 30_000,
        config: { provider: { [p.id]: { options: { baseURL: base } } }, permission: { edit: 'allow', bash: 'allow' } },
      })
      const c = createOpencodeClient({ baseUrl: s.url })
      const rs = await c.session.create({ query: { directory: scena } } as never) as Record<string, unknown>
      const ses = (rs['data'] ?? rs) as { id: string }
      try {
        await c.session.prompt({
          path: { id: ses.id }, query: { directory: scena },
          body: { model: { providerID: p.id, modelID: modello }, parts: [{ type: 'text', text: 'ping' }] },
        } as never)
      } catch (e) {
        nota = `prompt: ${String((e as Error)?.message ?? e).slice(0, 80)}`
      }
      s.close()
    } catch (e) {
      nota = `server: ${String((e as Error)?.message ?? e).slice(0, 80)}`
    }
    clearTimeout(boia)

    const conPrefisso = bussate.filter(b => b.prefisso).length
    esiti.push({ provider: p.id, modello, bussate: bussate.length, conPrefisso, nota })
    console.log(`${p.id.padEnd(16)} ${modello.slice(0, 34).padEnd(35)} bussate ${bussate.length} (prefisso ${conPrefisso}) · ${nota}`)
  }

  console.log('\n' + '='.repeat(78))
  console.log('LETTURA — la leva `options.baseURL` instrada il traffico di quel provider?')
  for (const e of esiti) {
    const verdetto = e.bussate > 0 ? (e.conPrefisso === e.bussate ? 'SÌ, prefisso tenuto' : 'SÌ, ma prefisso PERSO in parte') : 'NO — non è passata dal proxy'
    console.log(`  ${e.provider.padEnd(16)} → ${verdetto}`)
  }
  console.log('\nNota: «NO» qui non è per forza «leva ignorata»: può essere che il modello finto')
  console.log('venga rifiutato prima della rete (client-side), come in A-ter senza chiave.')
  appendFileSync(CATTURA, JSON.stringify({ quando: new Date().toISOString(), esiti }) + '\n')
  console.log(`\ncattura in ${CATTURA}`)
  process.exit(0)
}

main()
