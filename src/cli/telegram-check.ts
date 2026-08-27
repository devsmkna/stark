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
import { EMPTY_USAGE, type CanonicalEvent, type Command } from '../core/events.ts'
import { applyTo, reduce, type SessionSnapshot } from '../core/reduce.ts'

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

// Un registro finto: il bot non deve sapere com'è fatto quello vero, e mettere in scena
// un registro completo costerebbe una sessione vera, cioè quota.
const comandi: { id: string; cmd: Command }[] = []
const aperture: { cwd: string; resume?: { ref: string }; configDir?: string }[] = []
const ascoltatori = new Map<string, ((e: CanonicalEvent) => void)[]>()
const snapshots = new Map<string, SessionSnapshot>()
snapshots.set('aaa', reduce([], 'aaa'))

/** Fa arrivare un evento come farebbe il flusso del registro. */
const evento = (id: string, payload: CanonicalEvent['payload'], seq: number): void => {
  const e = { v: 1, seq, ts: Date.now(), sessionId: id, payload } as CanonicalEvent
  const snap = snapshots.get(id)
  if (snap) applyTo(snap, e)
  for (const f of ascoltatori.get(id) ?? []) f(e)
}

const registro = {
  list: () => righe,
  snapshot: (id: string) => snapshots.get(id) ?? null,
  subscribe: (id: string, _from: number, send: (e: CanonicalEvent) => void) => {
    const elenco = ascoltatori.get(id) ?? []
    elenco.push(send)
    ascoltatori.set(id, elenco)
    return () => { ascoltatori.set(id, (ascoltatori.get(id) ?? []).filter(f => f !== send)) }
  },
  command: async (id: string, cmd: Command) => {
    comandi.push({ id, cmd })
    const r = righe.find(x => x.id === id)
    if (!r?.live) return { ok: false as const, error: 'sessione non attiva' }
    return { ok: true as const }
  },
  open: async (spec: { cwd: string; resume?: { ref: string }; configDir?: string }) => {
    aperture.push(spec)
    const r = righe.find(x => x.id === spec.resume?.ref)
    if (r) r.live = true
    // Il risveglio vero manda `session.state: idle` quando è pronta: `#attendi` sta
    // aspettando proprio quello.
    setTimeout(() => evento(spec.resume?.ref ?? '', { k: 'session.state', state: 'idle' }, 1), 80)
    return spec.resume?.ref ?? 'nuova'
  },
  settings: () => ({ projects: { '/casa/altro': { profile: '/root/.claude-digitizers' } } }),
}

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

// ── scrivere all'agent ─────────────────────────────────────────────────────

comandi.length = 0
chiamate.length = 0
await manda(TELEFONO, 'sistema il bug del diff')
check('un messaggio normale diventa un prompt per la sessione scelta',
  comandi.length === 1 && comandi[0]?.id === 'aaa'
  && comandi[0]?.cmd.c === 'session.prompt'
  && (comandi[0]?.cmd as { text: string }).text === 'sistema il bug del diff',
  JSON.stringify(comandi))
// Nessun «ok, mandato»: la conferma è il messaggio del turno che compare fra un istante,
// e su un canale che conta venti messaggi al minuto un ok è un messaggio sprecato.
check('e non risponde «ok»: la conferma è il turno che compare',
  !chiamate.some(c => c.metodo === 'sendMessage'), chiamate.map(c => c.metodo).join(','))

// Gli slash che non sono del bot appartengono all'agent, e ci arrivano tali e quali.
comandi.length = 0
await manda(TELEFONO, '/clear')
check('uno slash che non è del bot va all\'agent tale e quale',
  (comandi[0]?.cmd as { text?: string })?.text === '/clear', JSON.stringify(comandi))
comandi.length = 0
await manda(TELEFONO, '//status')
check('`//` forza il passaggio anche per un nome che qui collide',
  (comandi[0]?.cmd as { text?: string })?.text === '/status', JSON.stringify(comandi))

comandi.length = 0
await manda(TELEFONO, '/stop')
check('/stop interrompe', comandi[0]?.cmd.c === 'session.interrupt', JSON.stringify(comandi))

// ── il turno si segue modificando UN messaggio ─────────────────────────────

chiamate.length = 0
evento('aaa', { k: 'turn.started', turnId: 't1', prompt: [{ type: 'text', text: 'sistema il bug' }] }, 10)
evento('aaa', { k: 'tool.started', callId: 'c1', name: 'Read' }, 11)
evento('aaa', { k: 'tool.input.ended', callId: 'c1', input: {}, summary: 'src/core/diff.ts', intent: 'leggo come si fanno gli hunk' }, 12)
evento('aaa', { k: 'text.started', partId: 'p1' }, 13)
for (let i = 0; i < 20; i++) evento('aaa', { k: 'text.delta', partId: 'p1', delta: `pezzo ${i} ` }, 14 + i)
await respira(4_200)   // il respiro è 3s: uno solo deve essere scattato
{
  const invii = chiamate.filter(c => c.metodo === 'sendMessage').length
  const modifiche = chiamate.filter(c => c.metodo === 'editMessageText').length
  check('venti eventi non fanno venti messaggi', invii === 1 && modifiche <= 1,
    `${invii} invii, ${modifiche} modifiche`)
  const testo = String(chiamate.find(c => c.metodo === 'sendMessage')?.corpo['text'] ?? '')
  check('e il messaggio dice cosa sta facendo, con la motivazione dell\'agent',
    testo.includes('leggo come si fanno gli hunk') && testo.includes('src/core/diff.ts'), testo)
}

chiamate.length = 0
for (let i = 0; i < 5; i++) evento('aaa', { k: 'text.delta', partId: 'p1', delta: `ancora ${i} ` }, 40 + i)
await respira(4_200)
check('gli aggiornamenti dopo il primo MODIFICANO, non aggiungono',
  chiamate.filter(c => c.metodo === 'editMessageText').length === 1
  && chiamate.filter(c => c.metodo === 'sendMessage').length === 0,
  chiamate.map(c => c.metodo).join(','))

// La fine del turno non aspetta il respiro: è l'unico aggiornamento che deve arrivare
// sempre, ed è quello che si legge tornando a guardare.
chiamate.length = 0
evento('aaa', { k: 'turn.ended', turnId: 't1', reason: 'completed', usage: EMPTY_USAGE, cost: { nominalUsd: 0 } }, 50)
await respira(400)
check('la fine del turno non aspetta il respiro',
  chiamate.some(c => c.metodo === 'editMessageText'), chiamate.map(c => c.metodo).join(','))

// ── permessi ───────────────────────────────────────────────────────────────

// La chat sta seguendo 'aaa' dalla sezione precedente.
chiamate.length = 0
evento('aaa', { k: 'permission.asked', requestId: 'r1', action: 'Bash',
  resources: ['rm -rf node_modules && npm ci'], savable: ['Bash'], source: {} }, 60)
await respira(400)
let tastieraPerm: { text: string; callback_data: string }[][] | undefined
{
  const m = chiamate.find(c => c.metodo === 'sendMessage')
  tastieraPerm = (m?.corpo['reply_markup'] as { inline_keyboard?: typeof tastieraPerm })?.inline_keyboard
  // Un messaggio NUOVO, non una modifica del turno: deve suonare sul telefono e restare
  // premibile. È il caso d'uso più forte del bot.
  check('un permesso arriva come messaggio nuovo, non dentro il turno',
    m !== undefined && String(m.corpo['text']).includes('chiede il permesso'), String(m?.corpo['text']))
  check('con Consenti, Rifiuta e una riga per ogni «sempre»',
    tastieraPerm?.length === 2 && tastieraPerm[0]?.length === 2
    && String(tastieraPerm[1]?.[0]?.text).startsWith('Sempre'), JSON.stringify(tastieraPerm))
  // Il tetto è duro: 64 byte, e un uuid più uno scope non ci starebbero.
  check('ogni callback_data sta nei 64 byte di Telegram',
    (tastieraPerm ?? []).flat().every(b => Buffer.byteLength(b.callback_data) <= 64),
    (tastieraPerm ?? []).flat().map(b => b.callback_data).join(' '))
}

comandi.length = 0
chiamate.length = 0
coda.push({ update_id: seq++, callback_query: { id: 'cb3', data: tastieraPerm?.[1]?.[0]?.callback_data ?? '',
  from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
await respira(400)
check('premere «Sempre: Bash» manda permission.reply con decision e scope',
  comandi[0]?.cmd.c === 'permission.reply'
  && (comandi[0]?.cmd as { decision: string }).decision === 'always'
  && (comandi[0]?.cmd as { scope?: string }).scope === 'Bash', JSON.stringify(comandi))
// I bottoni NON spariscono al click: spariscono quando l'evento torna dal flusso. È la
// stessa cosa che li fa sparire se hai risposto **dal browser**.
check('e i bottoni restano finché l\'evento non torna dal flusso',
  !chiamate.some(c => c.metodo === 'editMessageReplyMarkup'), chiamate.map(c => c.metodo).join(','))

chiamate.length = 0
evento('aaa', { k: 'permission.replied', requestId: 'r1', decision: 'always', scope: 'Bash' }, 61)
await respira(400)
check('quando l\'evento arriva, i bottoni se ne vanno e si legge cosa è successo',
  chiamate.some(c => c.metodo === 'editMessageReplyMarkup')
  && chiamate.some(c => String(c.corpo['text'] ?? '').includes('consentito sempre')),
  chiamate.map(c => c.metodo).join(','))

// Un secondo click sullo stesso bottone non deve rispondere due volte.
comandi.length = 0
coda.push({ update_id: seq++, callback_query: { id: 'cb4', data: tastieraPerm?.[1]?.[0]?.callback_data ?? '',
  from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
await respira(400)
check('un token già usato non risponde una seconda volta', comandi.length === 0, JSON.stringify(comandi))

// Il caso che giustifica tutto: risposto **dal browser**, non da qui.
chiamate.length = 0
evento('aaa', { k: 'permission.asked', requestId: 'r2', action: 'Write',
  resources: ['src/x.ts'], savable: [], source: {} }, 62)
await respira(400)
chiamate.length = 0
evento('aaa', { k: 'permission.replied', requestId: 'r2', decision: 'reject' }, 63)
await respira(400)
check('un permesso risolto dal browser toglie i bottoni da solo',
  chiamate.some(c => c.metodo === 'editMessageReplyMarkup')
  && chiamate.some(c => String(c.corpo['text'] ?? '').includes('rifiutato')),
  chiamate.map(c => c.metodo).join(','))

// ── domande ────────────────────────────────────────────────────────────────

chiamate.length = 0
evento('aaa', { k: 'question.asked', requestId: 'q1', questions: [
  { header: 'Approccio', question: 'Come procediamo?', multiSelect: false,
    options: [{ label: 'Riscrivere', description: 'da capo' }, { label: 'Correggere', description: 'sul posto' }] },
  { header: 'Prove', question: 'Quali prove aggiungiamo?', multiSelect: true,
    options: [{ label: 'Unitarie', description: 'veloci' }, { label: 'End-to-end', description: 'vere' }] },
] }, 70)
await respira(400)
let tastieraQ: { text: string; callback_data: string }[][] | undefined
{
  const m = chiamate.find(c => c.metodo === 'sendMessage')
  tastieraQ = (m?.corpo['reply_markup'] as { inline_keyboard?: typeof tastieraQ })?.inline_keyboard
  // Una alla volta: due domande sono cose **diverse**, non pezzi di una frase sola.
  check('una domanda alla volta, con il conteggio',
    String(m?.corpo['text']).includes('Approccio') && String(m?.corpo['text']).includes('(1/2)')
    && !String(m?.corpo['text']).includes('Prove'), String(m?.corpo['text']))
  check('un bottone per opzione, più Chiudi', tastieraQ?.length === 3, JSON.stringify(tastieraQ))
}

comandi.length = 0
chiamate.length = 0
coda.push({ update_id: seq++, callback_query: { id: 'cb5', data: tastieraQ?.[0]?.[0]?.callback_data ?? '',
  from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
await respira(400)
check('scegliere su una domanda singola passa alla successiva, senza rispondere ancora',
  comandi.length === 0 && chiamate.some(c => String(c.corpo['text'] ?? '').includes('(2/2)')),
  chiamate.map(c => `${c.metodo}:${String(c.corpo['text'] ?? '').slice(0, 30)}`).join(' | '))

// La seconda è a scelta multipla: i bottoni fanno spunta e serve Invia.
{
  const m = chiamate.find(c => c.metodo === 'editMessageText')
  const t2 = (m?.corpo['reply_markup'] as { inline_keyboard?: typeof tastieraQ })?.inline_keyboard
  check('a scelta multipla compaiono le caselle e il bottone Invia',
    String(t2?.[0]?.[0]?.text).startsWith('☐') && (t2?.[2] ?? []).some(b => b.text === 'Invia'),
    JSON.stringify(t2))
  chiamate.length = 0
  coda.push({ update_id: seq++, callback_query: { id: 'cb6', data: t2?.[1]?.[0]?.callback_data ?? '',
    from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
  await respira(400)
  const t3 = (chiamate.find(c => c.metodo === 'editMessageText')?.corpo['reply_markup'] as { inline_keyboard?: typeof tastieraQ })?.inline_keyboard
  check('spuntare non risponde: cambia solo la casella',
    String(t3?.[1]?.[0]?.text).startsWith('☑') && comandi.length === 0, JSON.stringify(t3))

  comandi.length = 0
  coda.push({ update_id: seq++, callback_query: { id: 'cb7', data: (t3?.[2] ?? []).find(b => b.text === 'Invia')?.callback_data ?? '',
    from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
  await respira(400)
  const risposta = comandi[0]?.cmd as { c: string; answers?: Record<string, string | string[]> } | undefined
  // La chiave è **il testo della domanda**, non l'header: è la forma che costruisce già
  // la UI. Sbagliarla manderebbe all'agent risposte che non sa a chi appartengono.
  check('Invia manda question.reply con le domande come chiavi',
    risposta?.c === 'question.reply'
    && risposta.answers?.['Come procediamo?'] === 'Riscrivere'
    && JSON.stringify(risposta.answers?.['Quali prove aggiungiamo?']) === '["End-to-end"]',
    JSON.stringify(risposta))
}

// ── la doppia notifica ─────────────────────────────────────────────────────

chiamate.length = 0
await bot.manda({ kind: 'done', title: 'Done · stark', body: 'sistema il diff', sessionId: 'aaa' })
check('non richiama su una sessione che sta già seguendo dal vivo',
  chiamate.length === 0, chiamate.map(c => c.metodo).join(','))
chiamate.length = 0
await bot.manda({ kind: 'done', title: 'Done · altro', body: 'niente', sessionId: 'bbb' })
check('ma chiama per una sessione diversa', chiamate.length === 1)

// ── risveglio ──────────────────────────────────────────────────────────────

aperture.length = 0
comandi.length = 0
chiamate.length = 0
coda.push({ update_id: seq++, callback_query: { id: 'cb2', data: 'u:bbb', from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
await respira(400)
await manda(TELEFONO, 'riprendi da dove eravamo')
await respira(600)
check('una chat che dorme si riapre con resume, non con un comando',
  aperture.length === 1 && aperture[0]?.resume?.ref === 'bbb', JSON.stringify(aperture))
// Senza il profilo del progetto la chat si risveglia senza login e senza MCP, e sembra
// rotta: è un bug già documentato, che questo punto rifarebbe identico.
check('e col profilo Claude del progetto, non con quello di default',
  aperture[0]?.configDir === '/root/.claude-digitizers', String(aperture[0]?.configDir))
check('e lo dice, perché rileggere il contesto costa quota',
  chiamate.some(c => String(c.corpo['text'] ?? '').includes('costa quota')))
check('e poi manda il prompt',
  comandi.some(c => c.cmd.c === 'session.prompt'), JSON.stringify(comandi))

// ── modello, modalità, nuova, rinomina ─────────────────────────────────────

// La sessione corrente adesso è 'bbb' (risvegliata sopra). Le si dà uno snapshot con
// modelli e modalità, come li avrebbe una chat vera.
snapshots.set('bbb', {
  ...reduce([], 'bbb'),
  model: 'claude-opus-5', mode: 'auto',
  models: [
    { id: 'default', label: 'Default (recommended)', autoMode: true, contextWindow: 200000 },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', autoMode: true, contextWindow: 200000 },
  ],
  modes: [
    { mode: 'auto', available: true },
    { mode: 'bypassPermissions', available: false, reason: 'non si può da root' },
  ],
})

chiamate.length = 0
await manda(TELEFONO, '/model')
{
  const t = (chiamate.find(c => c.metodo === 'sendMessage')?.corpo['reply_markup'] as { inline_keyboard?: { text: string; callback_data: string }[][] })?.inline_keyboard
  check('/model offre quello che dice lo snapshot, non un elenco scritto nel bot',
    t?.length === 2 && String(t[0]?.[0]?.text).includes('Default'), JSON.stringify(t))
  comandi.length = 0
  coda.push({ update_id: seq++, callback_query: { id: 'cb8', data: t?.[1]?.[0]?.callback_data ?? '',
    from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
  await respira(400)
  check('e sceglierlo manda session.setModel',
    comandi[0]?.cmd.c === 'session.setModel'
    && (comandi[0]?.cmd as { model: string }).model === 'claude-sonnet-5', JSON.stringify(comandi))
}

chiamate.length = 0
comandi.length = 0
await manda(TELEFONO, '/mode')
{
  const t = (chiamate.find(c => c.metodo === 'sendMessage')?.corpo['reply_markup'] as { inline_keyboard?: { text: string; callback_data: string }[][] })?.inline_keyboard
  // Una modalità non disponibile resta in elenco **col motivo**: nasconderla direbbe che
  // non esiste. È la regola «mai poter meno del CLI, e dire perché».
  check('una modalità non disponibile resta in elenco col motivo',
    String(t?.[1]?.[0]?.text).includes('non si può da root'), JSON.stringify(t))
  coda.push({ update_id: seq++, callback_query: { id: 'cb9', data: t?.[1]?.[0]?.callback_data ?? '',
    from: { id: TELEFONO }, message: { message_id: 1, chat: { id: TELEFONO } } } })
  await respira(400)
  check('e premerla non manda niente', comandi.length === 0, JSON.stringify(comandi))
}

comandi.length = 0
await manda(TELEFONO, '/rename il diff affiancato')
check('/rename passa dal registro, che sa farlo anche su una chat che dorme',
  comandi[0]?.cmd.c === 'session.rename', JSON.stringify(comandi))

aperture.length = 0
await manda(TELEFONO, '/new /casa/terzo')
check('/new apre una conversazione nuova nella cartella data',
  aperture.length === 1 && aperture[0]?.cwd === '/casa/terzo', JSON.stringify(aperture))

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
