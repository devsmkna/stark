// Prova del proxy in modalità ombra, da capo a fondo e a costo zero: nessuna rete
// esterna, nessuna quota — l'upstream è un server finto locale.
//
// Cosa deve reggere, riga per riga del quaderno:
//   - fail-closed: una sessione non registrata NON si inoltra (§4.3);
//   - il controllo vuole il token del daemon (chi può registrare può instradare);
//   - il prefisso `/s/<id>` si toglie prima di inoltrare (D18) e l'upstream vede il
//     percorso nudo;
//   - le intestazioni di risposta passano INTATTE, `anthropic-ratelimit-*` comprese
//     (§4bis.1: o il pannellino della quota smette di sapere);
//   - `HEAD /api/hello` passa (o il CLI si crede offline);
//   - il registro scrive la richiesta intera (D39) con l'analisi: le esche piantate
//     nelle regioni di D25 si trovano, quella dentro `tools[]` NO (D27).
//
// Uso:  npm run ombra:check

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { avviaProxy } from '../proxy/server.ts'

const CASA = resolve(tmpdir(), 'stark-ombra-check-home')
rmSync(CASA, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })
const TOKEN = 'a'.repeat(64)
writeFileSync(resolve(CASA, 'token'), TOKEN + '\n', { mode: 0o600 })

let passate = 0
let fallite = 0
function check(nome: string, ok: boolean, dettaglio = ''): void {
  if (ok) { passate += 1; console.log(`  ✓ ${nome}`) }
  else { fallite += 1; console.log(`  ✗ ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`) }
}

// ─── l'upstream finto: risponde, e ricorda cosa ha visto ────────────────────
type Vista = { metodo: string; url: string }
const viste: Vista[] = []
const upstream = createServer((req: IncomingMessage, res) => {
  viste.push({ metodo: String(req.method), url: String(req.url) })
  req.on('data', () => {})
  req.on('end', () => {
    res.writeHead(200, {
      'content-type': 'application/json',
      // l'intestazione che il proxy DEVE lasciar passare intatta
      'anthropic-ratelimit-requests-remaining': '99',
    })
    res.end(JSON.stringify({ ok: true }))
  })
})
await new Promise<void>(ok => upstream.listen(0, '127.0.0.1', ok))
const portaUpstream = (upstream.address() as { port: number }).port

const proxy = await avviaProxy({ porta: 0, home: CASA })
const base = `http://127.0.0.1:${proxy.porta}`

// ─── le esche, una per regione di D25, più quella che NON va trovata ────────
const ESCA_SYSTEM = 'AKIAABCDEFGHIJKLMNOP'
const ESCA_RISULTATO = 'postgres://mario:segretissimo@db.acme.example/produzione'
const ESCA_INPUT = 'sk-ant-api03-' + 'x'.repeat(24)
const ESCA_TOOLS = 'ghp_' + 'z'.repeat(24) // in tools[]: si salta (D27)
const CORPO = JSON.stringify({
  model: 'claude-x',
  system: [{ type: 'text', text: `sistema con ${ESCA_SYSTEM} dentro` }],
  messages: [
    { role: 'user', content: 'messaggio semplice, pulito' },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `DATABASE_URL=${ESCA_RISULTATO}` }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: `export K=${ESCA_INPUT}` } },
        { type: 'thinking', thinking: '', signature: 'blob-opaco-che-non-si-tocca' },
      ],
    },
  ],
  tools: [{ name: 'finto', description: `catalogo di terzi con ${ESCA_TOOLS}: da NON segnalare` }],
})

console.log('# fail-closed e controllo\n')

{
  const r = await fetch(`${base}/s/mai-vista/v1/messages`, { method: 'POST', body: '{}' })
  check('una sessione non registrata non si inoltra (403)', r.status === 403, `esito ${r.status}`)
  check("…e l'upstream non ha visto niente", viste.length === 0, `${viste.length} viste`)
}
{
  const r = await fetch(`${base}/control/sessioni`, {
    method: 'POST', body: JSON.stringify({ id: 'prova-1', upstream: `http://127.0.0.1:${portaUpstream}` }),
  })
  check('registrare senza token è rifiutato (403)', r.status === 403, `esito ${r.status}`)
}
{
  const r = await fetch(`${base}/control/sessioni`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ id: 'prova-1', upstream: `http://127.0.0.1:${portaUpstream}` }),
  })
  const corpo = await r.json() as { prefisso?: string }
  check('col token la sessione si registra (201)', r.status === 201, `esito ${r.status}`)
  check('e torna il prefisso', corpo.prefisso === '/s/prova-1', String(corpo.prefisso))
}

console.log('\n# il traffico passa, identico\n')

{
  const r = await fetch(`${base}/s/prova-1/api/hello`, { method: 'HEAD' })
  check('HEAD /api/hello passa (il CLI non si crede offline)', r.status === 200, `esito ${r.status}`)
  check("…e l'upstream l'ha visto senza prefisso", viste.at(-1)?.url === '/api/hello', String(viste.at(-1)?.url))
}
{
  const r = await fetch(`${base}/s/prova-1/v1/messages?beta=true`, { method: 'POST', body: CORPO })
  const giu = await r.json() as { ok?: boolean }
  check('il turno arriva in fondo', r.status === 200 && giu.ok === true, `esito ${r.status}`)
  check('il prefisso si toglie prima di inoltrare (D18)',
    viste.at(-1)?.url === '/v1/messages?beta=true', String(viste.at(-1)?.url))
  check('le intestazioni ratelimit passano intatte (§4bis.1)',
    r.headers.get('anthropic-ratelimit-requests-remaining') === '99',
    String(r.headers.get('anthropic-ratelimit-requests-remaining')))
}

console.log("\n# l'ombra ha guardato le regioni giuste\n")

{
  const righe = readFileSync(resolve(CASA, 'ombra', 'prova-1.jsonl'), 'utf8').trim().split('\n')
  // due righe: la hello (senza corpo) e il turno
  check('il registro ha una riga per richiesta', righe.length === 2, `${righe.length} righe`)
  const turno = JSON.parse(righe.at(-1) ?? '{}') as {
    corpo?: string
    trovati?: Array<{ regione: string; forma: string; indizio: string }>
    byteSaltati?: number
  }
  check('la richiesta è salvata intera (D39)', turno.corpo === CORPO,
    `corpo ${turno.corpo?.length ?? 0} car. su ${CORPO.length}`)
  const dove = (regione: string): string[] =>
    (turno.trovati ?? []).filter(t => t.regione === regione).map(t => t.forma)
  check("l'esca in system si trova", dove('system').includes('chiave con prefisso noto'),
    JSON.stringify(dove('system')))
  check("l'esca nel tool_result si trova (l'imbuto del §2)",
    dove('tool_result').includes('stringa di connessione con credenziali'),
    JSON.stringify(dove('tool_result')))
  check("l'esca nell'input del tool_use si trova",
    dove('tool_use.input').includes('chiave con prefisso noto'), JSON.stringify(dove('tool_use.input')))
  check("l'esca dentro tools[] NON si segnala (D27)",
    !(turno.trovati ?? []).some(t => t.indizio.startsWith('ghp_')),
    JSON.stringify(turno.trovati))
  check('…ma il peso di tools[] si misura', (turno.byteSaltati ?? 0) > 50, `${turno.byteSaltati} B`)
  check('nessun indizio contiene il segreto intero',
    !(turno.trovati ?? []).some(t => t.indizio.includes(ESCA_INPUT) || t.indizio.includes('segretissimo')),
    JSON.stringify(turno.trovati))
}

console.log('\n# la fine di una sessione chiude la porta\n')

{
  const r = await fetch(`${base}/control/sessioni/prova-1`, {
    method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` },
  })
  check('la deregistrazione risponde 204', r.status === 204, `esito ${r.status}`)
  const dopo = await fetch(`${base}/s/prova-1/v1/messages`, { method: 'POST', body: '{}' })
  check('e da lì in poi il traffico è rifiutato', dopo.status === 403, `esito ${dopo.status}`)
}

proxy.close()
upstream.close()
console.log(`\n${passate} passate, ${fallite} fallite`)
process.exit(fallite === 0 ? 0 : 1)
