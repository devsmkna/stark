// Verifiche dell'uso unito contro un Postgres **vero**, effimero.
//
// Non è pignoleria: qui il comportamento che conta non sta nel TypeScript ma in ciò
// che succede al database. «Due invii identici lasciano i totali fermi» è
// l'architettura intera — è la ragione per cui non ci sono code, ritentativi né
// deduplicazione — e se un giorno smettesse di essere vero **non lo direbbe nessuno**:
// i numeri resterebbero plausibili, solo più grandi del dovuto.
//
//   node cloud/src/usage-check.ts
//
// Tira su un container Postgres su una porta effimera, applica le migrazioni, prova, e
// lo spegne. Non tocca nessun database esistente: il `DATABASE_URL` lo decide qui.

import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
// Solo il tipo: il modulo si carica dinamicamente più sotto, dopo `DATABASE_URL`.
import type { Invio } from './usage.ts'

const execFileP = promisify(execFile)

const checks: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push([name, ok, detail]) }

/** Una porta libera davvero, chiesta al sistema invece che indovinata. */
function portaLibera(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer()
    s.on('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      const p = typeof a === 'object' && a ? a.port : 0
      s.close(() => res(p))
    })
  })
}

const attesa = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

async function main(): Promise<void> {
  const porta = await portaLibera()
  const nome = `stark-usage-check-${porta}`

  console.log(`  ·  Postgres effimero su :${porta}…`)
  await execFileP('docker', [
    'run', '-d', '--rm', '--name', nome,
    '-e', 'POSTGRES_USER=stark', '-e', 'POSTGRES_PASSWORD=stark', '-e', 'POSTGRES_DB=stark',
    '-p', `127.0.0.1:${porta}:5432`,
    'postgres:16-alpine',
  ])

  try {
    process.env['DATABASE_URL'] = `postgres://stark:stark@127.0.0.1:${porta}/stark`

    // Import **dopo** aver messo la variabile: `db/client.ts` apre la connessione al
    // caricamento del modulo, quindi un import statico si porterebbe dietro l'indirizzo
    // di default e la prova girerebbe su un altro database — o su nessuno.
    const { sql } = await import('./db/client.ts')
    const { migrate } = await import('drizzle-orm/postgres-js/migrator')
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const { registra } = await import('./auth.ts')
    const { registraUso, leggiUso } = await import('./usage.ts')

    // Pronto vuol dire «risponde a una query da qui», non «`pg_isready` dice sì»:
    // l'immagine ufficiale fa partire un server temporaneo per `initdb` e poi lo
    // riavvia, e in mezzo `pg_isready` (che parla sul socket unix, dentro il
    // container) risponde ok mentre da fuori si prende ancora `57P03 the database
    // system is starting up`. Misurato qui, non dedotto: la prima versione di questa
    // sonda usava `pg_isready` ed è morta esattamente così.
    let pronto = false
    for (let i = 0; i < 120 && !pronto; i++) {
      try { await sql`SELECT 1`; pronto = true } catch { await attesa(500) }
    }
    if (!pronto) throw new Error('Postgres non è mai diventato raggiungibile da qui')

    await migrate(drizzle(sql), { migrationsFolder: new URL('./db/migrations', import.meta.url).pathname })

    await registra('uno@example.com', 'password-lunga')
    await registra('due@example.com', 'password-lunga')

    // ─── i mattoni degli invii ────────────────────────────────────────────────
    const c = (prompts: number, chars = 100, agentMs = 1000) => ({
      conversations: 1, prompts, chars, agentMs,
      tools: 0, files: 0, commands: 0, aborted: 0, errored: 0, interrupted: 0,
      tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
    })

    const invioMac: Invio = {
      machine: { key: 'mac-key', label: 'MacBook', platform: 'darwin' },
      window: { from: '2026-09-01', to: '2026-09-03' },
      rows: [
        { day: '2026-09-01', projectKey: 'git@x:stark.git', projectLabel: 'stark',
          agent: 'claude-code', model: 'opus', c: c(30) },
        { day: '2026-09-02', projectKey: 'git@x:stark.git', projectLabel: 'stark',
          agent: 'claude-code', model: 'opus', c: c(10) },
      ],
      sessionDays: [
        { day: '2026-09-01', sessionId: 's-lunga', projectKey: 'git@x:stark.git',
          agent: 'claude-code', model: 'opus' },
        { day: '2026-09-02', sessionId: 's-lunga', projectKey: 'git@x:stark.git',
          agent: 'claude-code', model: 'opus' },
      ],
    }

    const invioFisso: Invio = {
      machine: { key: 'fisso-key', label: 'fisso', platform: 'linux' },
      window: { from: '2026-09-01', to: '2026-09-03' },
      rows: [
        { day: '2026-09-01', projectKey: 'git@x:stark.git', projectLabel: 'stark',
          agent: 'claude-code', model: 'opus', c: c(50) },
      ],
      sessionDays: [
        { day: '2026-09-01', sessionId: 's-fisso', projectKey: 'git@x:stark.git',
          agent: 'claude-code', model: 'opus' },
      ],
    }

    const tutto = { from: '2026-09-01', to: '2026-09-30' }

    // ─── 1. l'idempotenza, che è tutta l'architettura ─────────────────────────
    await registraUso('uno@example.com', invioMac)
    const dopoUno = await leggiUso('uno@example.com', tutto)
    await registraUso('uno@example.com', invioMac)
    await registraUso('uno@example.com', invioMac)
    const dopoTre = await leggiUso('uno@example.com', tutto)
    check('tre invii identici danno lo stesso totale di uno',
      dopoUno!.totale.prompts === 40 && dopoTre!.totale.prompts === 40,
      `${dopoUno!.totale.prompts} poi ${dopoTre!.totale.prompts}`)

    // ─── 2. due macchine si sommano, non si sovrascrivono ─────────────────────
    await registraUso('uno@example.com', invioFisso)
    const unite = await leggiUso('uno@example.com', tutto)
    check('due macchine si sommano invece di sovrascriversi',
      unite!.totale.prompts === 90, String(unite!.totale.prompts))
    check('e si vedono separate in perDevice',
      unite!.perDevice.length === 2
      && unite!.perDevice.some(d => d.label === 'MacBook' && d.c.prompts === 40)
      && unite!.perDevice.some(d => d.label === 'fisso' && d.c.prompts === 50),
      JSON.stringify(unite!.perDevice.map(d => [d.label, d.c.prompts])))

    // ─── 3. una chat lunga tre giorni resta UNA conversazione ─────────────────
    check('una chat viva in due giorni conta come una conversazione, non due',
      unite!.totale.conversations === 2,
      `${unite!.totale.conversations} (attese 2: s-lunga e s-fisso)`)
    // La riga sopra è vera solo perché il conteggio passa da `usage_session_days`.
    // Questa dice **quanto** sarebbe sbagliato senza: sommare le conversazioni giorno
    // per giorno ne dà tre, perché `s-lunga` è viva sia l'1 che il 2. È il numero che
    // finirebbe nella scheda grande di Settings se qualcuno «semplificasse» il
    // conteggio in una somma.
    const sommaPerGiorno = unite!.perGiorno.reduce((n, g) => n + g.c.conversations, 0)
    check('…mentre sommare le conversazioni per giorno ne direbbe tre',
      sommaPerGiorno === 3 && unite!.totale.conversations === 2,
      `somma ${sommaPerGiorno}, totale ${unite!.totale.conversations}`)

    // ─── 4. una riga che sparisce in locale sparisce anche in cloud ───────────
    // È il motivo per cui l'invio dichiara una finestra invece di essere un UPSERT
    // secco: senza, una riga che nessuno nomina più resterebbe lì per sempre.
    const senzaIlDue: Invio = { ...invioMac, rows: [invioMac.rows[0]!], sessionDays: [invioMac.sessionDays[0]!] }
    await registraUso('uno@example.com', senzaIlDue)
    const dopoSparizione = await leggiUso('uno@example.com', tutto)
    check('una riga non più nominata dentro la finestra sparisce',
      dopoSparizione!.totale.prompts === 80, String(dopoSparizione!.totale.prompts))
    check('…e la macchina che non ha parlato resta intatta',
      dopoSparizione!.perDevice.find(d => d.label === 'fisso')?.c.prompts === 50)

    // ─── 5. una riga fuori dalla finestra si rifiuta ──────────────────────────
    const fuori = await registraUso('uno@example.com', {
      ...invioMac,
      window: { from: '2026-09-01', to: '2026-09-01' },
      rows: [{ day: '2026-09-05', projectKey: 'p', agent: 'a', model: 'm', c: c(1) }],
      sessionDays: [],
    })
    check('una riga fuori dalla finestra dichiarata viene rifiutata',
      fuori.ok === false, JSON.stringify(fuori))

    // ─── 6. i numeri di un altro utente non si vedono ─────────────────────────
    await registraUso('due@example.com', invioFisso)
    const suoi = await leggiUso('due@example.com', tutto)
    const miei = await leggiUso('uno@example.com', tutto)
    check('ogni utente vede solo i propri numeri',
      suoi!.totale.prompts === 50 && miei!.totale.prompts === 80,
      `${suoi!.totale.prompts} / ${miei!.totale.prompts}`)

    // ─── 7. il periodo taglia davvero ────────────────────────────────────────
    const soloIlPrimo = await leggiUso('uno@example.com', { from: '2026-09-01', to: '2026-09-01' })
    check('il periodo taglia per giorno, estremi inclusi',
      soloIlPrimo!.totale.prompts === 80, String(soloIlPrimo!.totale.prompts))
    const nessunGiorno = await leggiUso('uno@example.com', { from: '2026-09-10', to: '2026-09-20' })
    check('un periodo vuoto dà zero, non un errore',
      nessunGiorno!.totale.prompts === 0 && nessunGiorno!.perGiorno.length === 0)

    // ─── 8. i grandi numeri restano numeri ───────────────────────────────────
    // `SUM` su `bigint` torna da Postgres come stringa: se non lo si converte, la UI
    // concatena invece di sommare, e il difetto si vede solo quando i token sono tanti.
    await registraUso('due@example.com', {
      machine: { key: 'grande', label: 'grande' },
      window: { from: '2026-09-09', to: '2026-09-09' },
      rows: [{ day: '2026-09-09', projectKey: 'p', agent: 'a', model: 'm',
               c: { ...c(1), chars: 3_000_000_000, tokens: { input: 3_000_000_000, output: 1, cacheRead: 1, cacheWrite: 1 } } }],
      sessionDays: [],
    })
    const grandi = await leggiUso('due@example.com', { from: '2026-09-09', to: '2026-09-09' })
    check('i caratteri e i token oltre i 2,1 miliardi tornano come numeri',
      typeof grandi!.totale.chars === 'number' && grandi!.totale.chars === 3_000_000_000
      && grandi!.totale.tokens.input === 3_000_000_000,
      `${typeof grandi!.totale.chars} ${grandi!.totale.chars}`)

    await sql.end()
  } finally {
    await execFileP('docker', ['stop', nome]).catch(() => { /* già morto */ })
  }

  let ko = 0
  for (const [name, ok, detail] of checks) {
    if (!ok) ko++
    console.log(`${ok ? '  ok  ' : '  KO  '} ${name}${detail && !ok ? `  — ${detail}` : ''}`)
  }
  console.log(`\n${checks.length - ko}/${checks.length} verifiche passate`)
  if (ko > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
