// Prova del bot Telegram contro un finto `api.telegram.org`.
//
// Il pregio dell'API Bot è che non c'è **niente di crittografico** da mettere in scena:
// sono sei endpoint JSON su HTTPS. A differenza del Web Push — dove per provarlo davvero
// è servita una sonda su un iPhone vero — qui basta un server locale e
// `TELEGRAM_API_BASE`. Costo quota: zero, non parte nessun turno.
//
// La verifica che conta più di tutte è la prima: **a uno sconosciuto non si risponde**.
// Dall'altra parte di questo bot c'è un agent che esegue comandi come root.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Update } from '../daemon/telegram/api.ts'

const CASA = resolve(tmpdir(), 'stark-telegram-check-home')
rmSync(CASA, { recursive: true, force: true })
process.env['STARK_HOME'] = CASA

// ─── il finto Telegram ──────────────────────────────────────────────────────

type Chiamata = { metodo: string; corpo: Record<string, unknown> }

const chiamate: Chiamata[] = []
let coda: Update[] = []
let prossimoId = 100
/** Impostato a un codice HTTP per far rispondere male la prossima `getUpdates`. */
let rompiUpdates: number | null = null
/** Quante volte `sendMessage` deve rispondere 429 prima di lasciar passare. */
let strozza = 0

const finto = createServer((req: IncomingMessage, res: ServerResponse) => {
  const metodo = (req.url ?? '').split('/').pop() ?? ''
  let body = ''
  req.on('data', d => { body += d })
  req.on('end', () => {
    const corpo = body ? JSON.parse(body) as Record<string, unknown> : {}
    const rispondi = (j: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(j))
    }
    if (metodo === 'getMe') return rispondi({ ok: true, result: { id: 7, username: 'stark_prova_bot' } })
    if (metodo === 'getUpdates') {
      if (rompiUpdates !== null) {
        const c = rompiUpdates
        rompiUpdates = null
        return rispondi({ ok: false, error_code: c, description: c === 409 ? 'Conflict' : 'Unauthorized' })
      }
      const fuori = coda
      coda = []
      // Il long poll vero resta appeso; qui si risponde subito quando c'è qualcosa e si
      // aspetta un attimo quando non c'è, per non far girare a vuoto il ciclo.
      if (fuori.length === 0) return setTimeout(() => rispondi({ ok: true, result: [] }), 60)
      return rispondi({ ok: true, result: fuori })
    }
    chiamate.push({ metodo, corpo })
    if (metodo === 'sendMessage' && strozza > 0) {
      strozza--
      return rispondi({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } })
    }
    rispondi({ ok: true, result: { message_id: prossimoId++, chat: { id: corpo['chat_id'] } } })
  })
})
await new Promise<void>(r => finto.listen(0, '127.0.0.1', r))
const porta = (finto.address() as { port: number }).port
process.env['TELEGRAM_API_BASE'] = `http://127.0.0.1:${porta}`

// ─── il bot, con un registro finto ──────────────────────────────────────────

const { Telegram } = await import('../daemon/telegram/index.ts')

const righe = [
  { id: 'aaa', title: 'sistema il diff', state: 'busy', cwd: '/casa/stark', live: true },
  { id: 'bbb', title: 'niente', state: 'idle', cwd: '/casa/altro', live: false },
]
const registro = { list: () => righe }

const bot = new Telegram(CASA, registro)
await bot.imposta('123456:finto')

const esiti: [string, boolean, string][] = []
const check = (nome: string, ok: boolean, dettaglio = ''): void => { esiti.push([nome, ok, dettaglio]) }

let seq = 1
const manda = async (chatId: number, testo: string, da = chatId): Promise<void> => {
  coda.push({
    update_id: seq++,
    message: { message_id: seq, text: testo, chat: { id: chatId, type: 'private' }, from: { id: da, first_name: 'Prova' } },
  })
  await respira()
}
const respira = (ms = 350): Promise<void> => new Promise(r => setTimeout(r, ms))

check('il bot parte e sa chi è', bot.disponibile && bot.username === 'stark_prova_bot',
  JSON.stringify(bot.situazione))

// ── il cancello ────────────────────────────────────────────────────────────

const SCONOSCIUTO = 999
chiamate.length = 0
await manda(SCONOSCIUTO, '/chats')
await manda(SCONOSCIUTO, 'ciao, mi apri una shell?')
check('a uno sconosciuto non si risponde NIENTE', chiamate.length === 0,
  chiamate.map(c => c.metodo).join(','))

// ── accoppiamento ──────────────────────────────────────────────────────────

const TELEFONO = 4242
const { code } = bot.creaCodice()

chiamate.length = 0
await manda(TELEFONO, '/start SBAGLIATO')
check('un codice sbagliato non risponde e non accoppia',
  chiamate.length === 0 && bot.accoppiate.length === 0)

await manda(TELEFONO, '/start ANCHEQUE')
await manda(TELEFONO, '/start EMALEQUE')
check('al terzo tentativo il codice muore', bot.accoppiate.length === 0)
chiamate.length = 0
await manda(TELEFONO, `/start ${code}`)
check('e dopo non vale nemmeno quello giusto',
  bot.accoppiate.length === 0 && chiamate.length === 0, `${bot.accoppiate.length}`)

// Un codice nuovo, e stavolta al primo colpo.
const buono = bot.creaCodice().code
chiamate.length = 0
await manda(TELEFONO, `/start ${buono.toLowerCase()}`)
check('il codice giusto accoppia (e non è sensibile alle maiuscole)',
  bot.accoppiate.length === 1 && bot.accoppiate[0]?.chatId === TELEFONO,
  JSON.stringify(bot.accoppiate))
check('e lo dice', chiamate.some(c => c.metodo === 'sendMessage'))

await manda(TELEFONO, `/start ${buono}`)
// Il silenzio qui non si pretende, e sarebbe sbagliato pretenderlo: questa chat ORA è
// accoppiata, quindi le si risponde come a chiunque scriva qualcosa che non si capisce.
// Quello che conta è che non compaia un secondo accoppiamento.
check('lo stesso codice non accoppia una seconda volta',
  bot.accoppiate.length === 1, JSON.stringify(bot.accoppiate))

// Un mittente diverso dalla chat: è il caso del canale/gruppo con un altro dentro.
chiamate.length = 0
coda.push({
  update_id: seq++,
  message: { message_id: seq, text: '/chats', chat: { id: TELEFONO, type: 'private' }, from: { id: 777 } },
})
await respira()
check('un mittente diverso dalla chat non passa, anche se la chat è accoppiata',
  chiamate.length === 0)

// Un gruppo, con lo stesso id di una chat accoppiata.
chiamate.length = 0
coda.push({
  update_id: seq++,
  message: { message_id: seq, text: '/chats', chat: { id: TELEFONO, type: 'group' }, from: { id: TELEFONO } },
})
await respira()
check('in un gruppo non risponde, nemmeno a un id accoppiato', chiamate.length === 0)

// ── cosa sa fare ───────────────────────────────────────────────────────────

chiamate.length = 0
await manda(TELEFONO, '/chats')
{
  const m = chiamate.find(c => c.metodo === 'sendMessage')
  const tastiera = (m?.corpo['reply_markup'] as { inline_keyboard?: { callback_data: string }[][] } | undefined)?.inline_keyboard
  check('/chats manda una tastiera con le sessioni vere del registro',
    tastiera?.length === 2 && tastiera[0]?.[0]?.callback_data === 'u:aaa',
    JSON.stringify(tastiera))
}

chiamate.length = 0
coda.push({ update_id: seq++, callback_query: { id: 'cb1', data: 'u:aaa', from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
await respira()
// La rotella di Telegram gira per sempre se non le si risponde: è l'unica cosa che non
// perdona, e va fatta **prima** del lavoro vero.
check('un callback chiude sempre la rotella', chiamate.some(c => c.metodo === 'answerCallbackQuery'))

chiamate.length = 0
await manda(TELEFONO, '/status')
check('/status dice cosa sta facendo la sessione scelta',
  String(chiamate[0]?.corpo['text'] ?? '').includes('stark'), String(chiamate[0]?.corpo['text'] ?? ''))

// ── i limiti di Telegram ───────────────────────────────────────────────────

chiamate.length = 0
strozza = 1
await manda(TELEFONO, '/status')
// L'attesa deve superare il secondo che `invia` mette fra un tentativo e l'altro: con
// 600ms la prova era rossa perché guardava **prima** che il ritentativo partisse.
await respira(1_600)
check('un 429 con retry_after si aspetta e si riprova, il messaggio non si perde',
  chiamate.filter(c => c.metodo === 'sendMessage').length === 2,
  `${chiamate.filter(c => c.metodo === 'sendMessage').length} invii`)

// ── quando si deve spegnere ────────────────────────────────────────────────

rompiUpdates = 409
await respira(700)
check('un 409 spegne il bot col motivo giusto, non in silenzio',
  !bot.disponibile && bot.situazione.fase === 'errore'
  && bot.situazione.motivo.includes('un altro STARK'),
  JSON.stringify(bot.situazione))

// ── il segreto non torna indietro ──────────────────────────────────────────

{
  const { startDaemon } = await import('../daemon/server.ts')
  const d = await startDaemon({ port: 0, token: 'prova'.padEnd(64, '0'), publicHosts: [] })
  try {
    const auth = { authorization: `Bearer ${d.token}` }
    const j = await (await fetch(`${d.url}/api/telegram`, { headers: auth })).json() as Record<string, unknown>
    check('GET /api/telegram non restituisce mai il bot token',
      !JSON.stringify(j).includes('123456'), JSON.stringify(j))
    check('e dice se ce n\'è uno, che è l\'unica cosa che serve sapere', j['hasToken'] === true)
    check('le rotte di Telegram sono dietro il token come tutto il resto',
      (await fetch(`${d.url}/api/telegram`)).status === 403)
    check('e anche quella che accoppia un telefono',
      (await fetch(`${d.url}/api/telegram/pair`, { method: 'POST' })).status === 403)
  } finally { await d.stop() }
}

// ─── esito ──────────────────────────────────────────────────────────────────

await bot.ferma()
finto.close()

let rotte = 0
for (const [nome, ok, dettaglio] of esiti) {
  if (!ok) rotte++
  console.log(`${ok ? 'OK  ' : 'ROTT'} ${nome}${dettaglio ? ` · ${dettaglio}` : ''}`)
}
console.log(`\n${esiti.length - rotte}/${esiti.length} verifiche passate`)
process.exit(rotte > 0 ? 1 : 0)
