// Prova del daemon da capo a fondo: perimetro di sicurezza, apertura di una sessione,
// flusso SSE, comando, e coerenza fra ciò che è arrivato dal flusso e ciò che sta sul
// disco. Le prove di sicurezza non costano quota; il turno finale costa pochissimo.

import { mkdirSync } from 'node:fs'
import { connect } from 'node:net'
import { resolve } from 'node:path'
import { startDaemon } from '../daemon/server.ts'
import type { CanonicalEvent } from '../core/events.ts'

/**
 * `fetch` non lascia falsificare l'header `Host`: lo standard lo vieta. È esattamente
 * il motivo per cui quel controllo protegge — nemmeno la pagina di un attaccante può
 * cambiarlo. Per provarlo serve una socket grezza, che è ciò che un attaccante userebbe
 * se potesse; il browser, che non può, resta fermo al proprio dominio nell'Host.
 */
function richiestaGrezza(porta: number, host: string, token: string): Promise<number> {
  return new Promise(res => {
    const s = connect(porta, '127.0.0.1', () => {
      s.write(`GET /api/sessions HTTP/1.1\r\nHost: ${host}\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`)
    })
    let buf = ''
    s.on('data', d => { buf += d })
    s.on('close', () => res(Number(/^HTTP\/1\.\d (\d{3})/.exec(buf)?.[1] ?? 0)))
    s.on('error', () => res(0))
  })
}

// Porta 0 e token usa e getta: una prova non deve litigare con il daemon vero, che
// adesso ha una porta fissa e un token che sta su disco.
const daemon = await startDaemon({
  port: 0,
  token: 'prova'.padEnd(64, '0'),
  ...(process.env['STARK_MODEL'] ? { model: process.env['STARK_MODEL'] } : {}),
})
const { url, token } = daemon
const auth = { authorization: `Bearer ${token}` }
const esiti: [string, boolean, string][] = []
const check = (nome: string, ok: boolean, dettaglio = ''): void => { esiti.push([nome, ok, dettaglio]) }

console.log(`daemon su ${url}\n`)

// ─── perimetro ──────────────────────────────────────────────────────────────

check('senza token → 403', (await fetch(`${url}/api/sessions`)).status === 403)
check('token errato → 403',
  (await fetch(`${url}/api/sessions`, { headers: { authorization: 'Bearer ' + 'a'.repeat(64) } })).status === 403)
check('Origin estraneo → 403',
  (await fetch(`${url}/api/sessions`, { headers: { ...auth, origin: 'https://sito-cattivo.example' } })).status === 403)
const porta = Number(new URL(url).port)
check('Host falsificato (DNS rebinding) → 403',
  (await richiestaGrezza(porta, 'sito-cattivo.example', token)) === 403)
check('Host locale con token → 200',
  (await richiestaGrezza(porta, '127.0.0.1', token)) === 200)
check('token giusto → 200', (await fetch(`${url}/api/sessions`, { headers: auth })).status === 200)
check('Origin nostro → 200',
  (await fetch(`${url}/api/sessions`, { headers: { ...auth, origin: url } })).status === 200)

// ─── F3: arrivare a un file citato in chat ──────────────────────────────────
//
// Costa zero quota: è una rotta di sistema, non un turno. Sta dietro le stesse
// quattro difese di ogni altra — provato qui, non dedotto dal fatto che `route()`
// gira per tutte allo stesso modo.
check('senza token → 403 anche per /api/reveal',
  (await fetch(`${url}/api/reveal`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: import.meta.url }),
  })).status === 403)
const rivelaSenzaPath = await fetch(`${url}/api/reveal`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}',
})
check('senza `path` → 400', rivelaSenzaPath.status === 400, String(rivelaSenzaPath.status))
const rivelaSconosciuto = await fetch(`${url}/api/reveal`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ path: '/non/esiste/davvero.txt' }),
})
const corpoSconosciuto = await rivelaSconosciuto.json() as { ok: boolean; error?: string }
check('un file che non c\'è → 404, non un\'eccezione',
  rivelaSconosciuto.status === 404 && corpoSconosciuto.ok === false,
  `${rivelaSconosciuto.status} ${JSON.stringify(corpoSconosciuto)}`)
// Un file vero di questo repo: prova che il comando di sistema gira davvero sulla
// macchina che sta eseguendo la verifica, non solo che il codice compila.
const rivelaVero = await fetch(`${url}/api/reveal`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ path: resolve('package.json') }),
})
const corpoVero = await rivelaVero.json() as { ok: boolean; error?: string }
check('un file vero del repo si rivela sul serio',
  rivelaVero.status === 200 && corpoVero.ok === true,
  `${rivelaVero.status} ${JSON.stringify(corpoVero)}`)

// ─── F1: aprire un link con la sua app ──────────────────────────────────────
//
// Solo il perimetro qui: `serviceFor` rifiuta prima ancora di controllare se
// l'app c'è, quindi queste prove non toccano il filesystem né lanciano niente.
// Il lancio vero — «l'app si apre davvero sulla pagina giusta» — non è
// automatizzabile senza far comparire Notion sullo schermo di chi esegue
// `npm run daemon`: provato dal vivo il 26 agosto 2026, con conferma dell'utente
// che la pagina giusta si è aperta due volte su due (vedi Notion, F1).
check('senza `url`/`scheme` → 400',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}',
  })).status === 400)
check('schema sconosciuto → 400, non un tentativo di lancio',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://notion.so/qualcosa', scheme: 'zzz-mai-sentito' }),
  })).status === 400)
check('dominio che non appartiene allo schema dichiarato → 400',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    // Un client che chiedesse di aprire un dominio qualunque spacciandolo per
    // Notion non deve poterlo fare: il daemon ricontrolla da sé, non si fida
    // di ciò che il client dichiara.
    body: JSON.stringify({ url: 'https://sito-cattivo.example', scheme: 'notion' }),
  })).status === 400)
check('un url malformato → 400, non un\'eccezione che porta giù la richiesta',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'not-a-url', scheme: 'notion' }),
  })).status === 400)

// ─── una sessione che non parte ─────────────────────────────────────────────

// Costa zero quota, e prova la cosa che conta di più in un daemon che deve
// sopravvivere: **una conversazione nata male non porta giù le altre**. È successo il
// contrario — una cartella che non esisteva chiudeva il journal mentre il ciclo dei
// messaggi girava ancora, e l'eccezione, che nessuno stava aspettando, spegneva tutto.
const nata = await fetch(`${url}/api/sessions`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ cwd: '/non/esiste/davvero' }),
})
check('una cartella inesistente non apre una sessione', !nata.ok, String(nata.status))
// L'eccezione arrivava da un ciclo che gira per conto suo: senza aspettare un attimo
// si guarderebbe il daemon prima che il colpo lo raggiunga.
await new Promise(r => setTimeout(r, 1500))
check('e il daemon resta in piedi',
  (await fetch(`${url}/api/sessions`, { headers: auth })).status === 200)

// ─── sessione ───────────────────────────────────────────────────────────────

// La cartella va creata: sta in /tmp, che prima o poi viene svuotata. Senza, la prova
// falliva con un errore che non c'entrava niente con quello che stava provando.
const SANDBOX = '/tmp/stark-daemon-check'
mkdirSync(SANDBOX, { recursive: true })
const aperta = await fetch(`${url}/api/sessions`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ cwd: SANDBOX }),
})
const { id } = await aperta.json() as { id: string }
check('sessione aperta', aperta.status === 201 && !!id, String(aperta.status))

// ─── flusso ─────────────────────────────────────────────────────────────────

const dalVivo: CanonicalEvent[] = []
const stream = await fetch(`${url}/api/sessions/${id}/stream?from=0`, { headers: auth })
const lettore = stream.body!.getReader()
const decoder = new TextDecoder()
let buf = ''
let fine: () => void = () => {}
const finito = new Promise<void>(r => { fine = r })

void (async () => {
  try {
  for (;;) {
    const { done, value } = await lettore.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const blocco = buf.slice(0, i); buf = buf.slice(i + 2)
      const riga = blocco.split('\n').find(r => r.startsWith('data: '))
      if (!riga) continue
      const e = JSON.parse(riga.slice(6)) as CanonicalEvent
      dalVivo.push(e)
      if (e.payload.k === 'turn.ended') fine()
    }
  }
  } catch { /* il daemon si è fermato: la caduta del flusso è attesa, non un errore */ }
})()

await fetch(`${url}/api/sessions/${id}/command`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ c: 'session.prompt', text: 'Rispondi con una sola parola: pronto' }),
})
await finito

// ─── coerenza ───────────────────────────────────────────────────────────────

const daDisco = await (await fetch(`${url}/api/sessions/${id}/events?from=0`, { headers: auth })).json() as { events: CanonicalEvent[] }
const soloVisti = dalVivo.map(e => e.seq)
const soloDisco = daDisco.events.map(e => e.seq).filter(n => n <= (soloVisti[soloVisti.length - 1] ?? 0))

check('il flusso ha consegnato eventi', dalVivo.length > 0, `${dalVivo.length}`)
check('flusso e disco raccontano la stessa storia',
  JSON.stringify(soloVisti) === JSON.stringify(soloDisco),
  `flusso ${soloVisti.length} · disco ${soloDisco.length}`)
check('i seq sono contigui e senza buchi',
  soloVisti.every((n, i) => n === i + 1), soloVisti.slice(0, 8).join(','))

const risposta = dalVivo.filter(e => e.payload.k === 'text.ended')
  .map(e => (e.payload as { text: string }).text).join(' ')
check('la risposta del modello è arrivata', risposta.trim().length > 0, risposta.trim().slice(0, 40))

// ─── sonno ──────────────────────────────────────────────────────────────────

const dormi = await fetch(`${url}/api/sessions/${id}/command`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ c: 'session.sleep' }),
})
check('la sessione si addormenta', dormi.status === 200, String(dormi.status))
const dopo = await (await fetch(`${url}/api/sessions`, { headers: auth })).json() as { sessions: { id: string; live: boolean }[] }
check('dopo il sonno resta nell\'elenco ma non è più viva',
  dopo.sessions.some(s => s.id === id && !s.live))

await lettore.cancel().catch(() => {})
await daemon.stop()

let rotti = 0
for (const [nome, ok, dett] of esiti) {
  if (!ok) rotti++
  console.log(`${ok ? 'OK  ' : 'ROTT'} ${nome}${!ok && dett ? ' — ' + dett : ''}`)
}
console.log(`\n${esiti.length - rotti}/${esiti.length} verifiche passate`)
process.exitCode = rotti === 0 ? 0 : 1
