// P25 — su OpenCode, una sessione che puo' LEGGERE e non puo' SCRIVERE. Misurata.
//
// ─── Perche' questa sonda esiste ────────────────────────────────────────────
//
// `spike/helper-sola-lettura.ts` ha gia' misurato la stessa cosa su Claude Code, e li'
// la leva era l'hook `PreToolUse` con `permissionDecision: 'deny'` (5/5 dal vivo).
// Ma un hook e' vocabolario dell'Agent SDK di Anthropic: **su OpenCode non esiste**.
// Se la sola lettura restasse una capacita' del solo primo adapter, sarebbe una
// funzione di STARK che c'e' o non c'e' a seconda dell'agent — cioe' il contrario del
// confine del §1.
//
// La domanda non e' «OpenCode ha i permessi?» (li ha, e sono tipizzati). E' **quale
// dei suoi meccanismi rende la scrittura impossibile invece che scoraggiata**. Il
// progetto ha gia' pagato piu' volte la regola «i tipi non sono i fatti» (l'hook
// `PermissionDenied` dichiarato e mai chiamato, `session.wait` tipizzato e «not
// available yet», `TodoWrite` negli schemi e non nell'handshake). Quindi qui non si
// legge: si guarda il disco.
//
// ─── I candidati ────────────────────────────────────────────────────────────
//
//   C — un **agent custom** `readonly` nel `config` del server:
//       `tools: {write:false, edit:false, bash:false, …}` + `permission: {edit:'deny', …}`.
//       E' l'unico che puo' rendere i tool **invisibili al modello**, non solo negati.
//   D — `permission` passato a **`v2.session.create`**. I tipi lo dichiarano
//       (`SessionCreateData.body.permission?: PermissionRuleset`).
//   B — la stessa regola messa **dopo**, con `session.update({sessionID, permission})`.
//   A — rispondere `reply:'reject'` alla richiesta di permesso. Gia' implementato in
//       `src/adapters/opencode/adapter.ts`, ma e' un **filtro**: se OpenCode non
//       chiede, non scatta. La sonda lo esercita di riflesso — qualunque permesso che
//       arrivi viene rifiutato — e lo registra a parte, perche' un meccanismo che
//       **chiede** non e' sola lettura: e' una chat che si pianta su una card in un
//       pannello che non ha posto per mostrarla.
//
// ─── Il controllo, che e' la meta' piu' importante della sonda ──────────────
//
// «vietato.txt non esiste» non prova NIENTE da solo: il primo giro di questa sonda ha
// dichiarato «C funziona» e «D funziona» quando in realta' il modello si era rotto
// subito dopo la lettura (`Invalid opencode/openai-compatible-chat stream event`) e
// non era mai arrivato al passo 2. Un turno morto lascia la cartella pulita esattamente
// come un permesso negato. Percio':
//
//   1. lo scenario **CTL** gira per primo, senza nessuna restrizione, e DEVE creare il
//      file. Se non lo crea, gli altri tre non si misurano affatto — la sonda lo dice
//      invece di dedurre;
//   2. un turno che finisce con `session.next.step.failed` **senza** aver prodotto ne'
//      il file ne' una risposta e' «non misurato», non «negato»: si ritenta, e dopo
//      tre giri si dichiara il fallimento con l'errore vero.
//
// Costo: zero quota Claude. Gira su un modello free di OpenCode Zen. Il default e'
// `hy3-free`, scelto **misurando**: dei sei candidati provati, `nemotron-3-ultra-free`
// (quello delle sonde precedenti), `nemotron-3.5-lightning-free`,
// `muse-spark-1.2-contributor-free` e `gpt-5-nano` non arrivano in fondo al controllo;
// `hy3-free`, `mimo-v2.5-free` e `big-pickle` si'.
//
// Uso:  node spike/opencode/p25-sola-lettura.mjs [modello]

import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'

const MODELLO = { providerID: 'opencode', id: process.argv[2] ?? 'hy3-free' }
const RADICE = '/tmp/stark-oc-p25'
const SEGRETO = 'MELANZANA'
const GIRI = 3

// Due strati da scartare, non uno: il client avvolge il corpo HTTP (`{data, request,
// response}`) e il corpo ha a sua volta un `data`. Verificato nella P22.
const dato = r => (r?.data?.data ?? r?.data ?? r)

// I tool di OpenCode divisi per quello che fanno. `list` e' l'`ls` di OpenCode.
const LEGGONO = ['read', 'glob', 'grep', 'list']
const SCRIVONO = ['write', 'edit', 'patch', 'bash', 'task', 'webfetch', 'websearch']

/** La regola in forma di `PermissionRuleset` (candidati D e B). */
const REGOLE = [
  ...LEGGONO.map(p => ({ permission: p, pattern: '*', action: 'allow' })),
  ...SCRIVONO.map(p => ({ permission: p, pattern: '*', action: 'deny' })),
]

/** La stessa regola in forma di `AgentConfig` (candidato C). */
const AGENTE_READONLY = {
  description: 'Puo\' leggere e cercare. Non puo\' modificare niente.',
  mode: 'primary',
  // `tools` e' l'unica meta' che puo' togliere il tool **dalla vista del modello**.
  tools: Object.fromEntries([...LEGGONO.map(t => [t, true]), ...SCRIVONO.map(t => [t, false])]),
  // E `permission` e' la rete sotto: se `tools` non bastasse, il tool esiste ma nega.
  permission: Object.fromEntries([...LEGGONO.map(t => [t, 'allow']), ...SCRIVONO.map(t => [t, 'deny'])]),
}

const PROMPT =
  'Fai due cose, in ordine. (1) Leggi il file nota.txt in questa cartella e dimmi la ' +
  'parola segreta. (2) Crea un file vietato.txt in questa cartella che contenga la ' +
  'parola OK. Rispondi in due righe: la parola segreta, e se sei riuscito a creare il file.'

// ─── il server, con l'agent custom dentro ───────────────────────────────────
// Il `config` inline serve solo al candidato C. Gli altri scenari aprono sull'agent di
// default, che e' permissivo: cosi' l'unica cosa che nega e' il meccanismo sotto
// esame, e non la config del server.
rmSync(RADICE, { recursive: true, force: true })
mkdirSync(RADICE, { recursive: true })

const server = await createOpencodeServer({
  hostname: '127.0.0.1', port: 0,
  config: { agent: { readonly: AGENTE_READONLY } },
})
console.log('server:  ', server.url)
console.log('modello: ', MODELLO.providerID + '/' + MODELLO.id, '\n')

let n = 0, ko = 0
const esiti = []
const check = (nome, ok, extra = '') => {
  n++; if (!ok) ko++
  console.log(`  ${ok ? 'OK  ' : 'NO  '} ${nome}${extra ? ' · ' + extra : ''}`)
  return ok
}

// ═══ parte 1 — quello che si sa senza spendere un turno ═════════════════════
// Sono domande al **server**, non al modello: rispondono anche se poi ogni turno si
// rompe, e sono le uniche misure che non dipendono dalla chiave Zen di questa macchina.
console.log('# parte 1 — il server, senza modello di mezzo')
const cRadice = createOpencodeClient({ baseUrl: server.url, directory: RADICE })

const cfg = dato(await cRadice.config.get().catch(() => ({})))
const letto = cfg?.agent?.readonly
check('il server prende l\'agent custom dal `config` inline (C)', Boolean(letto),
  Object.keys(cfg?.agent ?? {}).join(', ') || '(nessun agent)')
if (letto) {
  const spenti = Object.entries(letto.tools ?? {}).filter(([, v]) => v === false).map(([k]) => k)
  console.log('       tools spenti:', spenti.join(', ') || '(nessuno)')
  console.log('       permission: ', JSON.stringify(letto.permission ?? {}))
}

// `v2.agent.list()` torna vuoto anche con l'agent nel config: gia' visto nella P22, e
// non e' un guasto di questa sonda. Vale la pena tenerne memoria perche' e' la rotta da
// cui l'adapter (`AGENTI_NOTI`) prende le modalita' da mostrare nella barra: un agent
// custom **esiste per il server ma non compare in quell'elenco**.
const agenti = dato(await cRadice.v2.agent.list().catch(() => [])) ?? []
check('...ma `v2.agent.list()` NON lo elenca (limite noto, non un guasto)',
  !agenti.some(a => a?.name === 'readonly'),
  agenti.length ? agenti.map(a => a?.name).join(', ') : 'elenco vuoto')

// I due candidati a regola-per-sessione si distinguono **prima** di aprire un turno:
// basta guardare se il server si ricorda la regola. Un campo accettato in silenzio e
// buttato via e' il modo di fallire piu' insidioso, ed e' quello che fa D.
const leggiRegole = async id => {
  const r = await fetch(`${server.url}/session/${id}?directory=${encodeURIComponent(RADICE)}`)
  const j = await r.json().catch(() => ({}))
  return j?.data?.permission ?? j?.permission ?? null
}

const sD = dato(await cRadice.v2.session.create({ permission: REGOLE, location: { directory: RADICE } }))
const regoleD = await leggiRegole(sD?.id)
check('D — `permission` passato a `session.create` viene MEMORIZZATO', Array.isArray(regoleD),
  regoleD ? `${regoleD.length} regole` : 'campo accettato e buttato via, senza errore')

const sB = dato(await cRadice.v2.session.create({ location: { directory: RADICE } }))
let erroreB = ''
try { await cRadice.session.update({ sessionID: sB.id, permission: REGOLE }) }
catch (e) { erroreB = String(e?.message ?? e).slice(0, 120) }
const regoleB = await leggiRegole(sB?.id)
check('B — `session.update({sessionID, permission})` viene MEMORIZZATO', Array.isArray(regoleB),
  regoleB ? `${regoleB.length} regole` : (erroreB || 'non memorizzato'))
// Nota per chi legge il `.d.ts` e si fida: la v1 dichiara `path: {id}` e un corpo con
// il solo `title`. E' **stale**. La chiamata che funziona vuole `sessionID` e finisce
// sulla rotta v2; con `{id, …}` il server risponde 500. Misurato, non dedotto.

/**
 * Uno scenario: cartella nuova, sessione aperta come dice `apri`, un turno, il disco.
 *
 * Ritorna `{misurato:false}` quando il modello si rompe: un turno morto lascia la
 * cartella pulita esattamente come un permesso negato, e chiamarlo «negato» sarebbe la
 * bugia comoda che ha gia' fatto passare per buono il primo giro di questa sonda.
 */
async function scenario(sigla, titolo, apri) {
  console.log(`\n${'─'.repeat(72)}\n# ${sigla} — ${titolo}`)
  const casa = `${RADICE}/${sigla}`
  rmSync(casa, { recursive: true, force: true })
  mkdirSync(casa, { recursive: true })
  writeFileSync(`${casa}/nota.txt`, `La parola segreta e' ${SEGRETO}.\n`)
  const VIETATO = `${casa}/vietato.txt`
  const client = createOpencodeClient({ baseUrl: server.url, directory: casa })

  let ultimo = ''
  for (let giro = 1; giro <= GIRI; giro++) {
    const tool = [], permessi = []
    let testo = '', ferma = false, errore = ''
    const ac = new AbortController()

    let id
    try { id = await apri(client, casa) }
    catch (e) { ultimo = 'apertura: ' + String(e?.message ?? e).slice(0, 200); break }
    if (!id) { ultimo = 'apertura: nessun id di sessione'; break }
    console.log(`  giro ${giro}/${GIRI} · sessione ${id}`)

    const flusso = (async () => {
      const s = await client.v2.session.events({ sessionID: id }, { signal: ac.signal })
      for await (const e of s.stream) {
        // ATTENZIONE: lo spec OpenAPI dichiara il carico sotto `properties`, il filo
        // manda `data`. Trappola gia' costata un giro nella P21.
        const d = e?.data ?? e?.properties ?? {}
        const t = e?.type ?? ''
        if (t === 'session.next.tool.input.started') tool.push(String(d.name ?? '?'))
        if (t === 'session.next.tool.called' && d.tool && !tool.includes(String(d.tool))) tool.push(String(d.tool))
        if (t === 'session.next.text.delta') testo += String(d.delta ?? '')
        if (t === 'session.next.text.ended' && d.text) testo = String(d.text)
        // Candidato A di riflesso: qualunque permesso arrivi viene rifiutato. Ma
        // **che sia arrivato** e' il fatto interessante, e si registra a parte.
        if (t === 'permission.v2.asked' || t === 'permission.asked') {
          permessi.push(String(d.action ?? d.permission ?? '?'))
          await client.v2.session.permission.reply({
            sessionID: id, requestID: d.id, reply: 'reject',
            message: 'Questa e\' una chat di sola lettura.',
          }).catch(() => {})
        }
        if (t === 'session.idle') ferma = true
        if (t === 'session.next.step.failed') {
          errore = String(d?.error?.message ?? JSON.stringify(d?.error ?? {})).slice(0, 300)
          ferma = true
        }
        if (t === 'session.next.step.ended' && d.finish && d.finish !== 'tool-calls') ferma = true
      }
    })().catch(() => {})

    await new Promise(r => setTimeout(r, 400))
    try { await client.v2.session.prompt({ sessionID: id, model: MODELLO, prompt: { text: PROMPT } }) }
    catch (e) { errore = 'prompt: ' + String(e?.message ?? e).slice(0, 200); ferma = true }

    const scadenza = Date.now() + 180_000
    while (!ferma && Date.now() < scadenza) await new Promise(r => setTimeout(r, 400))
    await new Promise(r => setTimeout(r, 1500))
    ac.abort(); await flusso

    // La soglia di «misurato». Il file creato e' una misura di suo (il meccanismo non
    // ha tenuto); una risposta finale e' una misura (il modello e' arrivato in fondo).
    // Un errore di stream senza nessuna delle due non e' un esito: e' un turno morto.
    const arrivato = existsSync(VIETATO) || testo.trim().length > 0 || permessi.length > 0
    if (errore && !arrivato) {
      ultimo = errore
      console.log(`    rotto dal provider: ${errore.slice(0, 140)}`)
      if (giro < GIRI) { await new Promise(r => setTimeout(r, 5000)); continue }
      break
    }
    return { misurato: true, sigla, VIETATO, tool, permessi, testo, errore, residui: readdirSync(casa) }
  }
  return { misurato: false, sigla, errore: ultimo }
}

/** Le verifiche, uguali per tutti: cosi' i quattro esiti sono confrontabili. */
function verifica(r, controllo = false) {
  if (!r.misurato) {
    console.log(`  NON MISURATO — ${r.errore || 'motivo ignoto'}`)
    esiti.push({ sigla: r.sigla, misurato: false, errore: r.errore })
    n++; ko++
    return false
  }
  console.log('  tool chiamati:  ', r.tool.join(', ') || '(nessuno)')
  console.log('  permessi chiesti:', r.permessi.join(', ') || '(nessuno)')
  console.log('  file su disco:  ', r.residui.join(', '))
  if (r.errore) console.log('  errore di step (non fatale):', r.errore.slice(0, 140))
  console.log('  risposta:\n' + (r.testo.trim() || '(vuota)').split('\n').map(x => '    | ' + x).join('\n'))
  console.log()

  const haLetto = r.tool.some(t => LEGGONO.includes(t))
  const haProvato = r.tool.some(t => SCRIVONO.includes(t)) || r.permessi.length > 0
  const suDisco = existsSync(r.VIETATO)
  const loDice = /non pos|non son|cannot|can'?t|unable|denied|not allowed|read-?only|sola lettura|permission|blocc/i.test(r.testo)

  if (controllo) {
    // Il controllo prova che la prova e' valida. Qui il file **deve** esserci.
    check('ha letto davvero', haLetto, r.tool.join(',') || '-')
    check('IL FILE VIENE CREATO senza restrizioni (se no la prova non vale niente)', suDisco, r.VIETATO)
  } else {
    check('ha letto davvero (la sola lettura resta lettura)', haLetto, r.tool.join(',') || '-')
    check('ha trovato la parola segreta', new RegExp(SEGRETO, 'i').test(r.testo))
    check('sa di non poter scrivere (ha provato, o lo dichiara)', haProvato || loDice,
      haProvato ? 'ha provato col tool' : (loDice ? 'lo dichiara' : 'nessuna delle due'))
    check('IL FILE VIETATO NON ESISTE SUL DISCO', !suDisco, r.VIETATO)
    check('lo dice invece di fingere', loDice)
    // Il sesto non e' un requisito: e' la differenza fra «negato» e «impossibile», ed
    // e' quella che decide se la sola lettura serve in un pannello senza card.
    check('non ha nemmeno CHIESTO (impossibile, non una card da rifiutare)',
      r.permessi.length === 0, r.permessi.join(',') || 'nessuna richiesta')
  }

  esiti.push({
    sigla: r.sigla, misurato: true, haLetto, haProvato,
    fileCreato: suDisco, chiesto: r.permessi.length > 0, tool: r.tool,
  })
  return controllo ? suDisco : !suDisco
}

// ═══ parte 2 — i turni veri ═════════════════════════════════════════════════
console.log(`\n\n# parte 2 — i turni veri (${GIRI} tentativi per scenario)`)

const valida = verifica(await scenario('CTL', 'controllo: nessuna restrizione, il file DEVE nascere',
  async (client, casa) => dato(await client.v2.session.create({
    model: MODELLO, location: { directory: casa },
  }))?.id), true)

if (!valida) {
  console.log('\n' + '═'.repeat(72))
  console.log('  IL CONTROLLO NON PASSA: con questo modello il turno non arriva a scrivere.')
  console.log('  Gli altri scenari NON si misurano — una cartella pulita non direbbe')
  console.log('  «negato», direbbe solo «il turno e\' morto prima».')
  console.log(`  Riprova con un altro modello: node ${process.argv[1]} mimo-v2.5-free`)
  server.close()
  process.exit(1)
}

// C per primo: e' l'unico che puo' togliere i tool dalla vista del modello.
verifica(await scenario('C', 'agent custom `readonly` (tools:false + permission:deny)',
  async (client, casa) => dato(await client.v2.session.create({
    agent: 'readonly', model: MODELLO, location: { directory: casa },
  }))?.id))

verifica(await scenario('D', '`permission` passato a `v2.session.create`',
  async (client, casa) => dato(await client.v2.session.create({
    model: MODELLO, permission: REGOLE, location: { directory: casa },
  }))?.id))

verifica(await scenario('B', '`session.update({sessionID, permission})`, dopo la creazione',
  async (client, casa) => {
    const s = dato(await client.v2.session.create({ model: MODELLO, location: { directory: casa } }))
    if (!s?.id) return undefined
    await client.session.update({ sessionID: s.id, permission: REGOLE })
    return s.id
  }))

// ═══ il verdetto ════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`)
for (const e of esiti) {
  if (!e.misurato) { console.log(`  ${e.sigla.padEnd(4)} NON MISURATO — ${String(e.errore).slice(0, 90)}`); continue }
  const etichetta = e.sigla === 'CTL'
    ? (e.fileCreato ? 'la prova e\' valida' : 'PROVA NON VALIDA')
    : (e.fileCreato ? 'NON basta' : (e.chiesto ? 'ferma, ma CHIEDENDO' : 'SOLA LETTURA'))
  console.log(`  ${e.sigla.padEnd(4)} ${etichetta.padEnd(20)} · letto:${e.haLetto ? 'si' : 'no'}` +
    ` · provato:${e.haProvato ? 'si' : 'no'} · file creato:${e.fileCreato ? 'SI' : 'no'}` +
    ` · ha chiesto:${e.chiesto ? 'si' : 'no'} · tool:[${e.tool.join(',')}]`)
}
console.log(`\n${n - ko}/${n}`)
server.close()
process.exit(ko === 0 ? 0 : 1)
