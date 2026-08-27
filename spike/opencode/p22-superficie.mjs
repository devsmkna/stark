// P22 — la superficie di OpenCode misurata con l'SDK UFFICIALE, non col fetch a mano.
//
// La P21 aveva parlato al server con `fetch`. Sbagliato per la regola del progetto: se
// esiste qualcosa di ufficiale e gia' pronto si preferisce sempre (ADR-009). E c'e':
// `@opencode-ai/sdk`, versionato **appaiato al CLI** (1.17.20 ↔ 1.17.20), esattamente
// come `@anthropic-ai/claude-agent-sdk` ↔ Claude Code. Espone anche
// `createOpencodeServer()`, cioe' sa avviare il processo da se': l'analogo di `query()`.
//
// ─── Il ragionamento che ha deciso questa sonda ──────────────────────────────
//
// La P21 era ostaggio del modello: la chiave Zen di questa macchina ne regge uno solo
// e quello si rompe a meta' turno. Ma quasi tutta la superficie che serve misurare
// **non passa dal modello**: `revert`, `compact`, `switchModel`, `switchAgent`,
// `interrupt`, `context`, `diff`, `history`, `wait` sono metodi del client, chiamabili
// a comando. Quindi la prova di carico si puo' fare in modo deterministico, e la quota
// Claude dell'utente non si tocca.
//
// Ogni passo e' isolato: uno che fallisce viene registrato e non ferma gli altri —
// «questo non c'e'» e' un risultato quanto «questo c'e'».
//
// Uso:  node spike/opencode/p22-superficie.mjs
// L'SDK e' una dipendenza dichiarata del progetto: la decisione e' stata presa (ADR-013).

import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'

const CASA = '/tmp/stark-oc-p22'
const FUORI = '/tmp/p22-eventi.jsonl'
const MODELLO = { providerID: 'opencode', id: process.argv[2] ?? 'nemotron-3-ultra-free' }

rmSync(CASA, { recursive: true, force: true })
mkdirSync(CASA, { recursive: true })
writeFileSync(`${CASA}/nota.txt`, 'La parola nascosta e: MELANZANA\n')
writeFileSync(`${CASA}/opencode.json`, JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  permission: { edit: 'ask', bash: 'ask', read: 'allow' },
}, null, 2))
rmSync(FUORI, { force: true })

const esiti = []
/** Un passo isolato: quello che non c'e' si registra, non fa cadere il resto. */
async function passo(nome, f) {
  try {
    const v = await f()
    esiti.push({ nome, ok: true, v })
    console.log(`  OK    ${nome}`)
    return v
  } catch (e) {
    esiti.push({ nome, ok: false, errore: String(e?.message ?? e).slice(0, 200) })
    console.log(`  NO    ${nome} — ${String(e?.message ?? e).slice(0, 120)}`)
    return undefined
  }
}

// L'SDK avvia il processo. `config` inline: non serve scrivere un file per cambiare i
// permessi — che e' un fatto interessante di suo, perche' STARK vuole decidere i
// permessi **per conversazione** e non per cartella.
const server = await createOpencodeServer({
  hostname: '127.0.0.1', port: 0,
  config: { permission: { edit: 'ask', bash: 'ask', read: 'allow' } },
})
console.log('server avviato dall\'SDK:', server.url, '\n')
const client = createOpencodeClient({ baseUrl: server.url, directory: CASA })

// Il client SDK avvolge il corpo HTTP (`{data, request, response}`) e il corpo a sua
// volta ha un `data`: due strati da scartare, non uno. Verificato, non dedotto — la
// prima versione ne toglieva uno e `session.create` sembrava non tornare un id.
const dato = r => (r?.data?.data ?? r?.data ?? r)

// ─── quello che si sa senza aprire una conversazione ────────────────────────
console.log('# prima di aprire una conversazione')
const capacita = await passo('experimental.capabilities.get', async () =>
  dato(await client.experimental.capabilities.get()))
const agenti = await passo('v2.agent.list', async () => dato(await client.v2.agent.list()))
const comandi = await passo('v2.command.list', async () => dato(await client.v2.command.list()))
const skill = await passo('v2.skill.list', async () => dato(await client.v2.skill.list()))
const modelli = await passo('v2.model.list', async () => dato(await client.v2.model.list()))
await passo('v2.permission.saved.list', async () => dato(await client.v2.permission.saved.list()))

// ─── la conversazione ───────────────────────────────────────────────────────
console.log('\n# la conversazione')
const ses = await passo('v2.session.create', async () =>
  dato(await client.v2.session.create({ model: MODELLO, location: { directory: CASA } })))
if (!ses?.id) { console.log('\nsenza sessione non si prosegue'); await fine() }
const id = ses.id

// Il flusso **per sessione**, con cursore `after`: e' la scoperta che vale piu' di
// tutte, perche' e' la stessa forma del journal append-only di STARK (§13).
var ac = new AbortController()
const visti = []
const conteggio = new Map()
var flusso = (async () => {
  const s = await client.v2.session.events({ sessionID: id }, { signal: ac.signal })
  for await (const e of s.stream) {
    appendFileSync(FUORI, JSON.stringify(e) + '\n')
    const t = e?.type ?? '?'
    conteggio.set(t, (conteggio.get(t) ?? 0) + 1)
    if (!visti.includes(t)) visti.push(t)
    const d = e?.data ?? e?.properties ?? {}
    if (t === 'permission.v2.asked' || t === 'permission.asked') {
      console.log(`  → permesso: ${d.action ?? d.permission} ${JSON.stringify(d.resources ?? d.patterns ?? '')}`)
      await client.v2.session.permission.reply({ sessionID: id, permissionID: d.id, reply: 'once' })
        .catch(() => client.v2.permission.reply?.({ sessionID: id, requestID: d.id, reply: 'once' }))
    }
    if (t === 'question.v2.asked' || t === 'question.asked') {
      console.log('  → domanda:', JSON.stringify(d).slice(0, 200))
    }
  }
})().catch(e => console.log('  flusso chiuso:', String(e?.message ?? e).slice(0, 80)))

await new Promise(r => setTimeout(r, 500))

await passo('v2.session.prompt (legge e scrive un file)', async () =>
  dato(await client.v2.session.prompt({
    sessionID: id, model: MODELLO,
    prompt: { text: 'Leggi nota.txt e scrivi la parola trovata dentro trovata.txt. Non chiedermi conferme.' },
  })))

// `wait` invece di un `setTimeout`: aspettare a tempo e' indovinare.
await passo('v2.session.wait (fine del turno, chiesta invece che dedotta)', async () =>
  dato(await client.v2.session.wait({ sessionID: id })))

// ─── quello che si chiede a conversazione aperta ────────────────────────────
console.log('\n# a conversazione aperta')
await passo('v2.session.context (quanto e\' pieno il contesto)', async () =>
  dato(await client.v2.session.context({ sessionID: id })))
await passo('session.diff (gli effetti su file: si CHIEDONO, non arrivano)', async () =>
  dato(await client.session.diff({ sessionID: id })))
await passo('session.todo (la checklist che Claude Code non ha piu\')', async () =>
  dato(await client.session.todo({ sessionID: id })))
await passo('v2.session.messages', async () =>
  dato(await client.v2.session.messages({ sessionID: id, limit: 5 })))
await passo('v2.session.history (il passato, con cursore)', async () =>
  dato(await client.v2.session.history({ sessionID: id, limit: 5 })))
await passo('v2.fs.find (i file da citare con @)', async () =>
  dato(await client.v2.fs.find({ query: 'nota' })))
await passo('v2.session.switchModel', async () =>
  dato(await client.v2.session.switchModel({ sessionID: id, model: MODELLO })))
await passo('v2.session.switchAgent', async () =>
  dato(await client.v2.session.switchAgent({ sessionID: id, agent: agenti?.[0]?.name ?? 'plan' })))
await passo('v2.session.revert.stage', async () =>
  dato(await client.v2.session.revert?.stage?.({ sessionID: id })))
await passo('revert.stage (v1)', async () =>
  dato(await client.revert.stage({ sessionID: id })))
await passo('revert.clear (v1)', async () =>
  dato(await client.revert.clear({ sessionID: id })))
await passo('v2.session.compact (compattazione a comando)', async () =>
  dato(await client.v2.session.compact({ sessionID: id })))
await passo('v2.session.interrupt (a sessione ferma)', async () =>
  dato(await client.v2.session.interrupt({ sessionID: id })))
await passo('v2.permission.saved.list (dopo un permesso)', async () =>
  dato(await client.v2.permission.saved.list()))

await new Promise(r => setTimeout(r, 3000))
await fine()

async function fine() {
  try { ac?.abort() } catch { /* la sonda puo' finire prima che il flusso esista */ }
  await (flusso ?? Promise.resolve()).catch(() => {})
  console.log(`\n${visti.length} tipi di evento visti:`)
  for (const t of visti) console.log(`  ${String(conteggio.get(t)).padStart(4)}x  ${t}`)
  console.log('\n# riepilogo dei passi')
  for (const e of esiti) console.log(`  ${e.ok ? 'OK  ' : 'NO  '} ${e.nome}${e.ok ? '' : ' — ' + e.errore}`)
  writeFileSync('/tmp/p22-esiti.json', JSON.stringify({ capacita, agenti, comandi, skill, modelli: modelli?.length, esiti }, null, 2))
  console.log('\ndettaglio in /tmp/p22-esiti.json · eventi in ' + FUORI)
  server.close()
  process.exit(0)
}
