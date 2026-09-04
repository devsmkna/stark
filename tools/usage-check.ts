// Verifiche a costo zero per `righeUso()` in `src/core/stats.ts`: le righe che
// salgono in cloud. Nessuna sessione aperta, nessuna quota spesa — la funzione è
// pura su snapshot, quindi si prova con snapshot finti, come `gruppi-check.ts` fa
// con le parti di un turno.
//
// Cosa si prova, e perché proprio questo: le tre cose che, se sbagliano, sbagliano
// **in silenzio** e producono un numero credibile ma falso.
//
//   1. la tupla di raggruppamento — se il progetto (o l'agent, o il modello) non
//      entrasse nella chiave, due conversazioni diverse finirebbero sommate in una
//      riga sola e nessuno se ne accorgerebbe;
//   2. i giorni che si spezzano — una chat usata per tre giorni deve dare tre righe,
//      e restare **una** conversazione;
//   3. la somma con `statsFrom()` — le righe sono un'altra strada per gli stessi
//      fatti: se le due strade non arrivano allo stesso totale, una delle due mente.

import { reduce, type SessionSnapshot, type TurnView } from '../src/core/reduce.ts'
import { righeUso, statsFrom, type ChiaveProgetto } from '../src/core/stats.ts'

const checks: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push([name, ok, detail]) }

// ─── snapshot finti, il minimo perché siano del tipo giusto ───────────────────

/** Mezzogiorno del giorno indicato, ora locale: i turni non devono cadere a
 *  cavallo di mezzanotte per sbaglio, o la prova misurerebbe il fuso. */
const ora = (giorno: number, h = 12): number =>
  new Date(2026, 8, giorno, h, 0, 0, 0).getTime()

let nTurno = 0
const turno = (startedAt: number, testo = 'ciao', durataMs = 1000): TurnView => ({
  turnId: `t${++nTurno}`,
  prompt: [{ type: 'text', text: testo }],
  parts: [],
  steps: 1,
  startedAt,
  endedAt: startedAt + durataMs,
  ended: true,
  reason: 'completed',
  usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
})

type Finta = {
  id: string
  cwd?: string
  agent?: string
  model?: string
  turns?: TurnView[]
  files?: number[]
  shell?: number[]
}

function snap(f: Finta): SessionSnapshot {
  const s = reduce([], f.id)
  s.cwd = f.cwd
  s.agent = f.agent
  s.model = f.model
  s.turns = f.turns ?? []
  s.files = (f.files ?? []).map((ts, i) => ({ path: `/f${i}`, created: false, hunks: [], ts }))
  s.shell = (f.shell ?? []).map(ts => ({
    command: 'ls', interrupted: false, stdoutBytes: 0, stderrBytes: 0, ts,
  }))
  return s
}

/** La chiave di progetto che userà il daemon, ridotta all'osso: qui l'origin git
 *  non si risolve davvero, si finge — la funzione sotto prova non deve saperlo. */
const perCartella: ChiaveProgetto = s => ({ key: s.cwd ?? 'unknown', label: s.cwd ?? 'unknown' })

// ─── 1. la tupla di raggruppamento ────────────────────────────────────────────
{
  const snaps = [
    snap({ id: 'a', cwd: '/p1', agent: 'claude-code', model: 'opus', turns: [turno(ora(1))] }),
    snap({ id: 'b', cwd: '/p2', agent: 'claude-code', model: 'opus', turns: [turno(ora(1))] }),
    snap({ id: 'c', cwd: '/p1', agent: 'opencode', model: 'opus', turns: [turno(ora(1))] }),
    snap({ id: 'd', cwd: '/p1', agent: 'claude-code', model: 'sonnet', turns: [turno(ora(1))] }),
  ]
  const { righe } = righeUso(snaps, {}, perCartella)
  check('progetto, agent e modello sono tutti e tre nella chiave',
    righe.length === 4, `righe: ${righe.length}`)

  // E due conversazioni sulla **stessa** tupla si sommano invece di restare separate.
  const stessaTupla = [
    snap({ id: 'e', cwd: '/p1', agent: 'claude-code', model: 'opus', turns: [turno(ora(1))] }),
    snap({ id: 'f', cwd: '/p1', agent: 'claude-code', model: 'opus', turns: [turno(ora(1))] }),
  ]
  const r2 = righeUso(stessaTupla, {}, perCartella).righe
  check('due chat sulla stessa tupla fanno una riga sola',
    r2.length === 1 && r2[0]!.c.prompts === 2, `righe: ${r2.length}`)
  check('…e quella riga conta due conversazioni, non una',
    r2[0]!.c.conversations === 2, String(r2[0]!.c.conversations))
}

// ─── 2. i giorni che si spezzano ──────────────────────────────────────────────
{
  const lunga = snap({
    id: 'x', cwd: '/p1', agent: 'claude-code', model: 'opus',
    turns: [turno(ora(1)), turno(ora(2)), turno(ora(3))],
  })
  const { righe, sessionDays } = righeUso([lunga], {}, perCartella)
  check('una chat usata in tre giorni fa tre righe',
    righe.length === 3, `righe: ${righe.length}`)
  check('ogni riga conta una conversazione',
    righe.every(r => r.c.conversations === 1), righe.map(r => r.c.conversations).join(','))
  check('le righe escono in ordine di giorno',
    righe.map(r => r.day).join(' ') === '2026-09-01 2026-09-02 2026-09-03',
    righe.map(r => r.day).join(' '))

  // È qui che si vede a cosa serve `sessionDays`: sommare le righe direbbe «tre
  // conversazioni», e la scheda grande in Settings mostrerebbe un numero gonfiato.
  const sommaRighe = righe.reduce((n, r) => n + r.c.conversations, 0)
  const distinte = new Set(sessionDays.map(s => s.sessionId)).size
  check('sommare le righe gonfia le conversazioni (è il motivo per cui sessionDays esiste)',
    sommaRighe === 3 && distinte === 1, `somma ${sommaRighe}, distinte ${distinte}`)
  check('sessionDays ha una coppia per giorno, senza doppioni',
    sessionDays.length === 3, String(sessionDays.length))
}

// ─── 3. gli effetti stanno nel giorno loro, non in quello del turno ───────────
{
  // Un turno del giorno 1 che lascia un file dopo mezzanotte: due giorni, due righe.
  const s = snap({
    id: 'y', cwd: '/p1', agent: 'claude-code', model: 'opus',
    turns: [turno(ora(1, 23))], files: [ora(2, 1)], shell: [ora(2, 1)],
  })
  const { righe } = righeUso([s], {}, perCartella)
  const g1 = righe.find(r => r.day === '2026-09-01')
  const g2 = righe.find(r => r.day === '2026-09-02')
  check('il turno sta nel suo giorno e gli effetti nel loro',
    !!g1 && !!g2 && g1.c.prompts === 1 && g1.c.files === 0
    && g2.c.prompts === 0 && g2.c.files === 1 && g2.c.commands === 1,
    JSON.stringify({ g1: g1?.c.prompts, g2: g2?.c.files }))
  check('una chat viva solo per un effetto conta come conversazione quel giorno',
    g2?.c.conversations === 1, String(g2?.c.conversations))
}

// ─── 4. le righe e statsFrom raccontano lo stesso fatto ──────────────────────
{
  const snaps = [
    snap({ id: 'a', cwd: '/p1', agent: 'claude-code', model: 'opus',
           turns: [turno(ora(1)), turno(ora(2))], files: [ora(1)], shell: [ora(2)] }),
    snap({ id: 'b', cwd: '/p2', agent: 'opencode', model: 'sonnet',
           turns: [turno(ora(2)), turno(ora(3))] }),
    snap({ id: 'c', cwd: undefined, agent: undefined, model: undefined,
           turns: [turno(ora(3))] }),
  ]
  const st = statsFrom(snaps, {})
  const { righe, sessionDays } = righeUso(snaps, {}, perCartella)
  const somma = (f: (r: typeof righe[number]) => number): number =>
    righe.reduce((n, r) => n + f(r), 0)

  check('i prompt tornano', somma(r => r.c.prompts) === st.totale.prompts,
    `${somma(r => r.c.prompts)} contro ${st.totale.prompts}`)
  check('i caratteri tornano', somma(r => r.c.chars) === st.totale.chars)
  check('il tempo agent torna', somma(r => r.c.agentMs) === st.totale.agentMs)
  check('i token tornano',
    somma(r => r.c.tokens.input) === st.totale.tokens.input
    && somma(r => r.c.tokens.cacheRead) === st.totale.tokens.cacheRead)
  check('i file e i comandi tornano',
    somma(r => r.c.files) === st.totale.files && somma(r => r.c.commands) === st.totale.commands,
    `${somma(r => r.c.files)}/${somma(r => r.c.commands)} contro ${st.totale.files}/${st.totale.commands}`)
  check('le conversazioni distinte tornano (via sessionDays, non sommando)',
    new Set(sessionDays.map(s => s.sessionId)).size === st.totale.conversations,
    `${new Set(sessionDays.map(s => s.sessionId)).size} contro ${st.totale.conversations}`)
  check('una chiave che manca diventa unknown, non una riga scartata',
    righe.some(r => r.projectKey === 'unknown' && r.agent === 'unknown' && r.model === 'unknown'))
}

// ─── 5. il periodo taglia i turni, non le conversazioni ──────────────────────
{
  const s = snap({
    id: 'z', cwd: '/p1', agent: 'claude-code', model: 'opus',
    turns: [turno(ora(1)), turno(ora(5))],
  })
  const { righe } = righeUso([s], { from: ora(3) }, perCartella)
  check('una chat di marzo usata oggi conta oggi, e solo oggi',
    righe.length === 1 && righe[0]!.day === '2026-09-05', righe.map(r => r.day).join(','))
}

// ─── 6. il daemon: quando manda, e cosa ──────────────────────────────────────
//
// Qui non si prova la rete ma le tre regole che la circondano, e sono tutte cose che
// se sbagliano non fanno rumore: che spento voglia dire spento, che il collasso non
// mandi un invio per turno, e che la finestra dichiarata combaci con i giorni che ci
// finiscono dentro. L'ultima è quella che è già stata sbagliata scrivendo il file:
// partire da «adesso meno due giorni» dichiarava una giornata intera e ne mandava
// mezza, e siccome un invio è una sostituzione il server cancellava l'altra metà.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { creaUsageSync } from '../src/daemon/usage-sync.ts'

type Corpo = {
  window: { from: string; to: string }
  rows: { day: string }[]
  machine: { key: string; label: string }
}

async function provaDaemon(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'stark-usage-'))
  const veroFetch = globalThis.fetch
  const inviati: Corpo[] = []
  let rifiuta = false

  process.env['STARK_CLOUD_URL'] = 'http://127.0.0.1:1/finto'
  // Il token cloud sta su disco: senza, `manda()` si ferma prima di provarci e la
  // prova misurerebbe il fatto di non essere loggati invece del collasso.
  writeFileSync(join(home, 'cloud-token'), JSON.stringify({ token: 'x', email: 'a@b.c' }))

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (rifiuta) throw new Error('rete giù')
    inviati.push(JSON.parse(String(init?.body ?? '{}')) as Corpo)
    return new Response(JSON.stringify({ ok: true, rows: 0 }), { status: 200 })
  }) as typeof fetch

  try {
    // Lo storico è già stato mandato: qui interessa l'invio normale, non il primo.
    writeFileSync(join(home, 'usage-synced'), 'x\n')

    const oggi = new Date(); oggi.setHours(9, 30, 0, 0)
    // Un turno all'alba di due giorni fa: è il caso che smaschera la finestra che
    // parte da «adesso meno due giorni» invece che da mezzanotte. Con quella, questo
    // turno resterebbe fuori dall'invio ma **dentro** la finestra cancellata — cioè
    // sparirebbe dal cloud a ogni sincronizzazione, senza che niente lo dica.
    const dueGiorniFa = new Date(oggi); dueGiorniFa.setDate(dueGiorniFa.getDate() - 2)
    dueGiorniFa.setHours(3, 0, 0, 0)
    const unSnap = snap({
      id: 'd1', cwd: '/p1', agent: 'claude-code', model: 'opus',
      turns: [turno(oggi.getTime()), turno(dueGiorniFa.getTime())],
    })
    const comeGiorno = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    // ─ spento vuol dire spento ─
    let accesa = false
    const sync = creaUsageSync({
      home, snapshots: () => [unSnap], accesa: () => accesa, collassoMs: 50,
    })
    sync.turnoFinito()
    await new Promise(r => setTimeout(r, 120))
    check('con la sincronizzazione spenta non parte niente',
      inviati.length === 0, `${inviati.length} invii`)

    // ─ acceso: un invio, e la finestra è fatta di giorni interi ─
    accesa = true
    const esito = await sync.sincronizza()
    check('acceso, l\'invio parte e va a buon fine', esito.ok, JSON.stringify(esito))
    const primo = inviati[0]
    check('la finestra dichiarata va da due giorni fa a oggi, per giorni interi',
      primo?.window.to === comeGiorno(oggi) && primo?.window.from === comeGiorno(dueGiorniFa),
      `${primo?.window.from} → ${primo?.window.to}`)
    check('il turno di oggi è dentro l\'invio, non solo dentro la finestra',
      (primo?.rows ?? []).some(r => r.day === comeGiorno(oggi)),
      JSON.stringify(primo?.rows))
    check('e anche quello delle 3 di notte del primo giorno della finestra',
      (primo?.rows ?? []).some(r => r.day === comeGiorno(dueGiorniFa)),
      JSON.stringify(primo?.rows))
    check('ogni riga cade dentro la finestra dichiarata',
      (primo?.rows ?? []).every(r => r.day >= primo!.window.from && r.day <= primo!.window.to))

    // ─ il collasso: tre turni ravvicinati fanno un invio, non tre ─
    inviati.length = 0
    sync.turnoFinito(); sync.turnoFinito(); sync.turnoFinito()
    await new Promise(r => setTimeout(r, 200))
    check('tre turni dentro la finestra di collasso fanno un invio solo',
      inviati.length === 1, `${inviati.length} invii`)

    // ─ offline: non si accoda, e il giro dopo riprova ─
    inviati.length = 0
    rifiuta = true
    const giu = await sync.sincronizza()
    check('offline si fallisce dicendolo, senza accodare',
      !giu.ok && giu.motivo.includes('raggiungibile'), JSON.stringify(giu))
    rifiuta = false
    const ripreso = await sync.sincronizza()
    check('il giro dopo rimanda la stessa finestra, senza recuperare code',
      ripreso.ok && inviati.length === 1, `${inviati.length} invii`)
  } finally {
    globalThis.fetch = veroFetch
    delete process.env['STARK_CLOUD_URL']
    rmSync(home, { recursive: true, force: true })
  }
}

await provaDaemon()

// ─── esito ────────────────────────────────────────────────────────────────────
let ko = 0
for (const [name, ok, detail] of checks) {
  if (!ok) ko++
  console.log(`${ok ? '  ok  ' : '  KO  '} ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
console.log(`\n${checks.length - ko}/${checks.length} verifiche passate`)
if (ko > 0) process.exit(1)
