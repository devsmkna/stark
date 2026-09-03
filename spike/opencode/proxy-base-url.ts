// Misura A-ter dell'anonimizzazione (docs/anonimizzazione.md §12): l'equivalente di
// `ANTHROPIC_BASE_URL` esiste su OpenCode?
//
// LA DOMANDA: finche' non e' misurata, l'anonimizzazione e' una funzione di un adapter
// solo. OpenCode e' un server per macchina che parla a piu' provider; il tipo `Config`
// dichiara `provider.<id>.options.baseURL`, e `createOpencodeServer` passa la config al
// processo via `OPENCODE_CONFIG_CONTENT`. Ma «i tipi non sono i fatti»: che il campo
// esista non dice che il traffico ci passi, ne' con quale credenziale, ne' che un
// prefisso di percorso sopravviva.
//
// COSA MISURA, nelle stesse quattro domande della misura A (spike/proxy-base-url.ts):
//   1. il server di OpenCode passa davvero dalla baseURL iniettata via config SDK?
//   2. con quale credenziale? (OAuth dell'abbonamento o chiave API — si osserva al
//      proxy come schema+prefisso, mai il segreto)
//   3. il turno arriva in fondo su una base URL non sua?
//   4. il prefisso di percorso `/s/<id>` sopravvive? (l'instradamento per sessione di
//      A-bis, che qui vale per il *server*, non per sessione: un server per macchina
//      significa che il prefisso identifica l'agent, non la conversazione — o cosi'
//      si scoprira' che deve essere)
//
// Il modello NON si indovina: si chiede al server quali provider ha e si prende
// l'anthropic piu' economico (haiku). Se anthropic non c'e', la sonda lo dice e si
// ferma — un'assenza dichiarata, non un fallimento mascherato.
//
// DUE LEZIONI PAGATE DAL PRIMO GIRO, il 3 settembre 2026:
//   - `session.prompt` risolve anche quando il turno muore dentro: l'esito vero sta nei
//     messaggi della sessione (`ProviderAuthError` nel primo giro, mentre la sonda
//     stampava «completato»). Una prova che guarda il posto sbagliato non fallisce: mente.
//   - su questa macchina OpenCode NON ha una credenziale Anthropic, quindi «zero bussate»
//     non diceva niente sulla baseURL: la richiesta non partiva proprio (l'AI SDK lancia
//     client-side se manca la chiave). La misura si fa CON UNA CHIAVE FINTA in env:
//     il client si costruisce, la richiesta parte, e a noi interessa solo DOVE bussa.
//     Il 401 a monte e' l'esito atteso, non un fallimento.
//
// COSTO: zero — nessuna credenziale vera, nessun turno riesce, nessuna quota.
// Uso:   node spike/opencode/proxy-base-url.ts

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk'

const UPSTREAM = 'api.anthropic.com'
const CATTURA = new URL('../captures/opencode-proxy.jsonl', import.meta.url).pathname
const PREFISSO = '/s/PROVA-ATER'
const senzaPrefisso = (u: string) => u.startsWith(PREFISSO) ? u.slice(PREFISSO.length) || '/' : u

type Bussata = {
  ts: number
  metodo: string
  url: string
  prefissoTenuto: boolean
  credenziale: string
  intestazioni: Record<string, string>
  esito?: number
  corpoIn?: number
}
const bussate: Bussata[] = []

/** Abbastanza per riconoscere il tipo, mai abbastanza per usarla (regola §6.1). */
function credenziale(h: IncomingMessage['headers']): string {
  const auth = h['authorization']
  if (typeof auth === 'string') {
    const [schema, tok] = auth.split(' ', 2)
    return `${schema} ${String(tok).slice(0, 14)}… (${String(tok).length} car.)`
  }
  const key = h['x-api-key']
  if (typeof key === 'string') return `x-api-key ${key.slice(0, 14)}… (${key.length} car.)`
  return 'nessuna'
}

function redigi(corpo: string): string {
  // Nei corpi non passano credenziali (stanno nelle intestazioni), ma la regola resta:
  // se mai comparisse una stringa a forma di token, meglio storpiata che archiviata.
  return corpo.replace(/sk-ant-[a-zA-Z0-9_-]{20,}/g, s => s.slice(0, 14) + '…REDATTO')
}

function proxy(): Promise<number> {
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    const b: Bussata = {
      ts: Date.now(),
      metodo: String(req.method),
      url: String(req.url),
      prefissoTenuto: String(req.url).startsWith(PREFISSO),
      credenziale: credenziale(req.headers),
      intestazioni: Object.fromEntries(
        ['user-agent', 'anthropic-beta', 'anthropic-version', 'content-type', 'accept-encoding']
          .filter(k => req.headers[k]).map(k => [k, String(req.headers[k])])),
    }
    bussate.push(b)

    const pezzi: Buffer[] = []
    req.on('data', c => pezzi.push(c))
    req.on('end', () => {
      const corpo = Buffer.concat(pezzi)
      b.corpoIn = corpo.length
      const up = httpsRequest({
        host: UPSTREAM, method: req.method, path: senzaPrefisso(String(req.url)),
        headers: { ...req.headers, host: UPSTREAM },
      }, r => {
        b.esito = r.statusCode
        res.writeHead(r.statusCode ?? 502, r.headers)
        r.pipe(res)
      })
      up.on('error', e => { res.writeHead(502); res.end(String(e)) })
      up.end(corpo)
      if (corpo.length) {
        appendFileSync(CATTURA, JSON.stringify({
          ts: b.ts, metodo: b.metodo, url: b.url,
          corpo: redigi(corpo.toString('utf8').slice(0, 300_000)),
          troncato: corpo.length > 300_000,
        }) + '\n')
      }
    })
  })
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => {
    ok((srv.address() as { port: number }).port)
  }))
}

async function main() {
  mkdirSync(new URL('../captures/', import.meta.url).pathname, { recursive: true })
  writeFileSync(CATTURA, '')
  const porta = await proxy()
  const base = `http://127.0.0.1:${porta}${PREFISSO}/v1`
  console.log(`proxy su 127.0.0.1:${porta}, baseURL iniettata: ${base}\n`)

  const scena = mkdtempSync(join(tmpdir(), 'ater-'))
  // La chiave FINTA: fa costruire il client e partire la richiesta. Il formato imita
  // una chiave API vera quanto basta perche' il loader non la rifiuti in locale.
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-FINTA-' + 'x'.repeat(80)
  const ac = new AbortController()
  // Watchdog: una sonda che non finisce non ha il permesso di restare appesa.
  const boia = setTimeout(() => { console.log('\nTEMPO SCADUTO (180s)'); process.exit(1) }, 180_000)

  const server = await createOpencodeServer({
    hostname: '127.0.0.1', port: 0, signal: ac.signal, timeout: 30_000,
    config: {
      provider: { anthropic: { options: { baseURL: base } } },
      permission: { edit: 'allow', bash: 'allow' },
    },
  })
  process.on('exit', () => { try { server.close() } catch { /* gia' morto */ } })
  console.log(`server OpenCode: ${server.url}`)

  const c = createOpencodeClient({ baseUrl: server.url })

  // Il modello si chiede, non si indovina.
  const rp = await c.config.providers({ query: { directory: scena } } as never) as Record<string, unknown>
  const dati = (rp['data'] ?? rp) as { providers?: Array<{ id: string; models: Record<string, unknown> }> }
  const anthropic = dati.providers?.find(p => p.id === 'anthropic')
  if (!anthropic) {
    console.log('\nESITO: il provider `anthropic` NON è configurato su questa macchina.')
    console.log('provider presenti: ' + (dati.providers?.map(p => p.id).join(', ') ?? 'nessuno'))
    console.log('La misura non può girare qui: serve `opencode auth login` per Anthropic.')
    process.exit(1)
  }
  const modelli = Object.keys(anthropic.models ?? {})
  const modello = modelli.find(m => m.includes('haiku')) ?? modelli[0]
  console.log(`provider anthropic: ${modelli.length} modelli, scelto ${modello}\n`)

  const rs = await c.session.create({ query: { directory: scena } } as never) as Record<string, unknown>
  const ses = (rs['data'] ?? rs) as { id: string }
  console.log(`sessione ${ses.id} — parte il turno…`)

  let esito = 'prompt risolto'
  try {
    await c.session.prompt({
      path: { id: ses.id },
      query: { directory: scena },
      body: {
        model: { providerID: 'anthropic', modelID: modello },
        parts: [{ type: 'text', text: 'Rispondi con una sola parola: pronto' }],
      },
    } as never)
  } catch (e) {
    esito = `prompt in errore: ${String((e as Error)?.message ?? e).slice(0, 200)}`
  }
  // L'esito vero sta nei messaggi, non nella risoluzione del prompt (lezione del
  // primo giro: «completato» su un turno morto di ProviderAuthError).
  try {
    const rm = await c.session.messages({ path: { id: ses.id }, query: { directory: scena } } as never) as Record<string, unknown>
    const msgs = (rm['data'] ?? rm) as Array<{ info?: { role?: string; error?: unknown } }>
    const ass = msgs.map(m => m.info ?? m as never).filter(i => (i as { role?: string }).role === 'assistant')
    const err = ass.map(a => (a as { error?: unknown }).error).find(e => e)
    if (err) esito = `assistant in errore: ${JSON.stringify(err).slice(0, 250)}`
    else if (ass.length) esito = 'assistant senza errore'
  } catch { /* l'esito resta quello del prompt */ }
  clearTimeout(boia)

  // ── verdetto ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(78))
  console.log(`turno: ${esito}`)
  console.log(`bussate al proxy: ${bussate.length}`)
  console.log('-'.repeat(78))
  for (const b of bussate) {
    console.log(`${b.metodo.padEnd(5)} ${b.url}`)
    console.log(`      prefisso ${b.prefissoTenuto ? 'TENUTO' : 'PERSO'} · ${b.credenziale} · esito ${b.esito ?? '—'} · corpo ${b.corpoIn ?? 0} B`)
    for (const [k, v] of Object.entries(b.intestazioni)) console.log(`      ${k}: ${v.slice(0, 90)}`)
  }
  console.log('='.repeat(78))
  const passate = bussate.filter(b => b.prefissoTenuto)
  console.log('LETTURA (con chiave finta: conta DOVE bussa, non che il turno riesca)')
  console.log(`  1. il traffico passa dalla baseURL iniettata : ${bussate.length > 0 ? 'SÌ' : 'NO — nessuna bussata'}`)
  console.log(`  2. credenziale osservata al proxy            : ${bussate[0]?.credenziale ?? '—'}`)
  console.log(`  3. esito del turno (401 a monte = atteso)    : ${esito}`)
  console.log(`  4. il prefisso di percorso sopravvive        : ${bussate.length ? `${passate.length}/${bussate.length}` : '—'}`)
  console.log(`\ncattura corpi in ${CATTURA}`)
  appendFileSync(CATTURA, JSON.stringify({ ts: Date.now(), verdetto: { esito, bussate } }) + '\n')

  ac.abort()
  server.close()
  process.exit(0)
}

main()
