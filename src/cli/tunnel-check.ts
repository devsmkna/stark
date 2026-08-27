// Prova che un tunnel non rompa quello che il daemon fa bene.
//
// `daemon-check.ts` prova il daemon su loopback, dove il flusso è vivo per costruzione:
// non c'è niente in mezzo che possa trattenerlo. Un proxy sì — e il modo in cui lo
// rompe è **silenzioso**, perché gli eventi arrivano tutti, solo tutti insieme alla
// fine. Contarli non basta: va guardato *quando* arrivano.
//
//   npm run tunnel -- https://stark.tuodominio.it            (token da ~/.stark/token)
//   npm run tunnel -- https://stark.tuodominio.it <token>
//
// Non costa quota: non manda nessun prompt. Si appoggia al **battito** che il daemon
// scrive ogni 15 secondi sul flusso dell'elenco (`server.ts`, `: .`) — che esiste per
// tenere viva la connessione, e qui diventa il segnale più pulito che ci sia: tre righe
// identiche a distanza nota, che un proxy che bufferizza consegna in blocco alla fine.

import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = (process.argv[2] ?? '').replace(/\/+$/, '')
if (!base) {
  console.error('uso: npm run tunnel -- https://stark.tuodominio.it [token]')
  process.exit(2)
}
const token = process.argv[3] ?? process.env['STARK_TOKEN']
  ?? readFileSync(resolve(process.env['STARK_HOME'] ?? resolve(homedir(), '.stark'), 'token'), 'utf8').trim()
const auth = { authorization: `Bearer ${token}` }

const esiti: [string, boolean, string][] = []
const check = (nome: string, ok: boolean, dettaglio = ''): void => { esiti.push([nome, ok, dettaglio]) }

console.log(`contro ${base}\n`)

// ─── ci si arriva, e il perimetro ci riconosce ──────────────────────────────
//
// Le prove su un `Host` falsificato non hanno senso qui: il proxy riscrive l'Host prima
// che la richiesta arrivi a noi, quindi risponderebbero sul proxy e non sul perimetro.
// Vengono saltate, e va detto invece di essere taciuto.
console.log('(saltate: le prove su Host/Origin falsificato — le riscrive il proxy, non arrivano al daemon)\n')

{
  const r = await fetch(`${base}/api/health`, { headers: auth })
  check('il daemon risponde attraverso il tunnel', r.status === 200, `HTTP ${r.status}`)
  if (r.status === 403) {
    console.error('\n403: o il token è sbagliato, o il nome pubblico non è dichiarato.')
    console.error(`Sulla macchina di STARK: STARK_PUBLIC_HOST=${new URL(base).hostname} e **riavvia** il daemon.`)
    console.error('(il perimetro si legge una volta sola, all\'avvio: cambiarlo a daemon acceso non ha effetto)')
    process.exit(1)
  }
}

{
  const r = await fetch(`${base}/api/system`, { headers: auth })
  const sys = await r.json() as { perimeter?: { open: boolean; hosts: { host: string; source: string }[] } }
  const atteso = new URL(base).hostname
  check('il perimetro dichiara proprio questo nome',
    sys.perimeter?.hosts.some(h => h.host === atteso) ?? false,
    (sys.perimeter?.hosts ?? []).map(h => `${h.host} (${h.source})`).join(', ') || 'nessuno')
}

// ─── il flusso è vivo ───────────────────────────────────────────────────────

{
  const ATTESA = 40_000        // due battiti da 15s, più il margine per il primo
  const inizio = performance.now()
  const arrivi: number[] = []
  const stream = await fetch(`${base}/api/stream`, { headers: auth, signal: AbortSignal.timeout(ATTESA + 5_000) })
  check('il flusso dell\'elenco si apre',
    stream.status === 200 && (stream.headers.get('content-type') ?? '').includes('text/event-stream'),
    `HTTP ${stream.status} · ${stream.headers.get('content-type') ?? '—'}`)

  const lettore = stream.body!.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const corsa = await Promise.race([
        lettore.read(),
        new Promise<'scaduto'>(r => setTimeout(() => r('scaduto'), Math.max(0, ATTESA - (performance.now() - inizio)))),
      ])
      if (corsa === 'scaduto' || corsa.done) break
      // Ogni **arrivo di rete**, non ogni evento: è il chunk che un proxy trattiene.
      arrivi.push(performance.now() - inizio)
      decoder.decode(corsa.value, { stream: true })
    }
  } catch { /* la finestra è scaduta: atteso */ }
  void lettore.cancel().catch(() => {})

  const primo = arrivi[0] ?? Infinity
  // Il daemon manda subito la lista al collegamento, quindi il primo pezzo deve
  // arrivare in fretta: se ci mette quanto tutta la finestra, è già bufferizzato.
  check('il primo pezzo arriva subito', primo < 5_000, `${primo === Infinity ? 'mai' : `${primo | 0}ms`}`)
  // Poi almeno un battito. Con la finestra a 40s e il battito a 15s ne devono passare
  // due: se ne arriva **zero**, il flusso è aperto ma non consegna.
  const dopo = arrivi.filter(t => t > primo + 2_000).length
  check('i battiti arrivano mentre la finestra è aperta, non alla chiusura',
    dopo >= 1, `${arrivi.length} pezzi in ${ATTESA / 1000}s: ${arrivi.map(t => `${t | 0}ms`).join(' ')}`)
  // E la connessione ha retto: è il difetto dei proxy con un idle timeout corto, che
  // il battito esiste apposta per evitare.
  const ultimo = arrivi[arrivi.length - 1] ?? 0
  check('la connessione regge la finestra senza cadere', ultimo > ATTESA * 0.5,
    `ultimo pezzo a ${ultimo | 0}ms su ${ATTESA}ms`)
}

// ─── esito ──────────────────────────────────────────────────────────────────

let rotte = 0
for (const [nome, ok, dettaglio] of esiti) {
  if (!ok) rotte++
  console.log(`${ok ? 'OK  ' : 'ROTT'} ${nome}${dettaglio ? ` · ${dettaglio}` : ''}`)
}
console.log(`\n${esiti.length - rotte}/${esiti.length} verifiche passate`)
if (rotte > 0) {
  console.log('\nSe è caduto il flusso: il proxy sta bufferizzando. Traefik non lo fa da sé')
  console.log('(le risposte streaming le manda subito), ma il middleware `buffering` sì,')
  console.log('e un tunnel Cloudflare gratuito è documentato farlo. Vedi docs/fuori-casa.md.')
}
process.exit(rotte > 0 ? 1 : 0)
