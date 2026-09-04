// L'uso di STARK unito fra i dispositivi di una persona.
//
// `Settings → Usage` nasce da `statsFrom()` sul daemon, che legge gli snapshot in RAM
// di **quella** macchina: i journal non si sincronizzano, quindi chi lavora da tre
// posti vede un terzo del proprio uso. Qui le tre storie si sommano.
//
// Solo il proprietario vede i propri numeri. Nessuna classifica, nessun confronto fra
// account: scartato il 4 settembre 2026, e detto anche in `schema.ts` perché
// `usage_daily` è già quasi tutto ciò che servirebbe e l'assenza non sembri una svista.
//
// La regola che tiene in piedi tutto il resto: **un invio è una sostituzione, non un
// incremento**. Il daemon manda lo stato completo di una finestra di giorni, e qui la
// finestra si riscrive intera dentro una transazione. Ripetere lo stesso invio dà lo
// stesso risultato, quindi non servono code, ritentativi né deduplicazione — e una
// riga che *sparisce* dal calcolo locale (l'ultima chat di quel progetto cancellata)
// sparisce anche di qui, che con un UPSERT senza finestra non succederebbe: resterebbe
// in cloud per sempre, senza che niente la nomini più.

import { eq, and } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from './db/client.ts'
import { machines, users } from './db/schema.ts'

const db = drizzle(sql)

// ─── la forma dei dati, che è quella di `src/core/stats.ts` ──────────────────

export type Conteggi = {
  conversations: number
  prompts: number
  chars: number
  agentMs: number
  tools: number
  files: number
  commands: number
  aborted: number
  errored: number
  interrupted: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export type RigaInvio = {
  day: string
  projectKey: string
  projectLabel?: string
  agent: string
  model: string
  c: Conteggi
}

export type SessionDayInvio = {
  day: string
  sessionId: string
  projectKey: string
  agent: string
  model: string
}

export type Invio = {
  machine: { key: string; label: string; platform?: string }
  /** Gli estremi **inclusi** della finestra riscritta, in `YYYY-MM-DD`. */
  window: { from: string; to: string }
  rows: RigaInvio[]
  sessionDays: SessionDayInvio[]
}

export type Ripartizione = { key: string; label: string; c: Conteggi }

export type Dispositivo = Ripartizione & { lastSeen: string }

export type UsoUnito = {
  totale: Conteggi
  perGiorno: { day: string; c: Conteggi }[]
  perProgetto: Ripartizione[]
  perAgent: Ripartizione[]
  perModello: Ripartizione[]
  perDevice: Dispositivo[]
}

const GIORNO = /^\d{4}-\d{2}-\d{2}$/

/** Quante righe accetta un invio. Il `readJson` del server si ferma già a 64 KB:
 *  questo è il secondo limite, quello che protegge la transazione. */
const MAX_RIGHE = 5000

// ─── scrittura ───────────────────────────────────────────────────────────────

async function idUtente(email: string): Promise<string | null> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  return u?.id ?? null
}

/**
 * Il dispositivo, creato alla prima volta che si fa vivo.
 *
 * `label` e `platform` si riscrivono a ogni invio: sono cose da mostrare, e
 * rinominare la macchina non deve spezzare lo storico — a tenerlo insieme è
 * `machineKey`, che è opaco e non cambia.
 */
async function risolviMacchina(
  userId: string, m: Invio['machine'],
): Promise<string> {
  const chiave = m.key.trim()
  if (!chiave) throw new Error('machine.key obbligatoria')
  const label = (m.label ?? '').trim() || chiave.slice(0, 8)
  const [esistente] = await db.select({ id: machines.id }).from(machines)
    .where(and(eq(machines.userId, userId), eq(machines.machineKey, chiave)))
  if (esistente) {
    await db.update(machines)
      .set({ label, platform: m.platform ?? null, lastSeen: new Date() })
      .where(eq(machines.id, esistente.id))
    return esistente.id
  }
  const [creata] = await db.insert(machines)
    .values({ userId, machineKey: chiave, label, platform: m.platform ?? null })
    .returning({ id: machines.id })
  return creata!.id
}

/** Registra un invio. Ritorna quante righe sono state scritte. */
export async function registraUso(email: string, invio: Invio): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
  const userId = await idUtente(email)
  if (!userId) return { ok: false, error: 'utente sconosciuto' }
  if (!invio?.machine?.key) return { ok: false, error: 'machine.key obbligatoria' }
  const { from, to } = invio.window ?? {}
  if (!GIORNO.test(from ?? '') || !GIORNO.test(to ?? '')) {
    return { ok: false, error: 'window.from e window.to devono essere YYYY-MM-DD' }
  }
  if (from > to) return { ok: false, error: 'window rovesciata' }
  const rows = invio.rows ?? []
  const sessionDays = invio.sessionDays ?? []
  if (rows.length > MAX_RIGHE || sessionDays.length > MAX_RIGHE) {
    return { ok: false, error: `troppe righe in un invio (massimo ${MAX_RIGHE})` }
  }
  // Una riga fuori dalla finestra dichiarata non si scrive: sopravvivrebbe alla
  // cancellazione che apre la transazione, e da lì in poi nessun invio la
  // toccherebbe più — un fantasma che nessuno può correggere.
  const fuori = rows.find(r => !GIORNO.test(r.day) || r.day < from! || r.day > to!)
  if (fuori) return { ok: false, error: `riga fuori dalla finestra: ${fuori.day}` }
  const fuoriSess = sessionDays.find(s => !GIORNO.test(s.day) || s.day < from! || s.day > to!)
  if (fuoriSess) return { ok: false, error: `sessione fuori dalla finestra: ${fuoriSess.day}` }

  const machineId = await risolviMacchina(userId, invio.machine)

  await sql.begin(async tx => {
    // Sostituzione, non incremento: si azzera la finestra **di questa macchina** e la
    // si riscrive. Le altre macchine non vengono toccate — è il motivo per cui la
    // macchina sta nella chiave.
    await tx`
      DELETE FROM usage_daily
      WHERE user_id = ${userId} AND machine_id = ${machineId}
        AND day >= ${from!} AND day <= ${to!}`
    await tx`
      DELETE FROM usage_session_days
      WHERE user_id = ${userId} AND machine_id = ${machineId}
        AND day >= ${from!} AND day <= ${to!}`

    if (rows.length > 0) {
      await tx`INSERT INTO usage_daily ${tx(rows.map(r => ({
        user_id: userId, machine_id: machineId,
        day: r.day, project_key: r.projectKey, project_label: r.projectLabel ?? null,
        agent: r.agent, model: r.model,
        conversations: r.c.conversations, prompts: r.c.prompts,
        chars: r.c.chars, agent_ms: r.c.agentMs,
        tools: r.c.tools, files: r.c.files, commands: r.c.commands,
        aborted: r.c.aborted, errored: r.c.errored, interrupted: r.c.interrupted,
        tok_in: r.c.tokens.input, tok_out: r.c.tokens.output,
        tok_cache_read: r.c.tokens.cacheRead, tok_cache_write: r.c.tokens.cacheWrite,
      })))}`
    }
    if (sessionDays.length > 0) {
      await tx`INSERT INTO usage_session_days ${tx(sessionDays.map(s => ({
        user_id: userId, machine_id: machineId,
        day: s.day, session_id: s.sessionId,
        project_key: s.projectKey, agent: s.agent, model: s.model,
      })))}`
    }
  })

  return { ok: true, rows: rows.length }
}

// ─── lettura ─────────────────────────────────────────────────────────────────

const n = (v: unknown): number => Number(v ?? 0)

/** Da una riga di `SUM(...)` ai `Conteggi`. Postgres restituisce i `SUM` di `bigint`
 *  come stringhe (sono `numeric`): passarli così alla UI darebbe concatenazioni
 *  invece di somme, e il difetto si vedrebbe solo su numeri grandi. */
function conteggi(r: Record<string, unknown>, conversations = 0): Conteggi {
  return {
    conversations,
    prompts: n(r['prompts']),
    chars: n(r['chars']),
    agentMs: n(r['agent_ms']),
    tools: n(r['tools']),
    files: n(r['files']),
    commands: n(r['commands']),
    aborted: n(r['aborted']),
    errored: n(r['errored']),
    interrupted: n(r['interrupted']),
    tokens: {
      input: n(r['tok_in']),
      output: n(r['tok_out']),
      cacheRead: n(r['tok_cache_read']),
      cacheWrite: n(r['tok_cache_write']),
    },
  }
}

const VUOTI = (): Conteggi => ({
  conversations: 0, prompts: 0, chars: 0, agentMs: 0,
  tools: 0, files: 0, commands: 0, aborted: 0, errored: 0, interrupted: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

/**
 * L'uso unito su un periodo. `from` e `to` sono `YYYY-MM-DD`, **inclusi entrambi**.
 *
 * I giorni arrivano già tagliati come stringhe e non come millisecondi di proposito:
 * il `day` di una riga è nel fuso della macchina che ha lavorato, e chi ha fatto quel
 * taglio è il daemon. Rifarlo qui con il fuso del VPS vorrebbe dire avere due verità
 * su cosa sia «oggi», e la seconda sarebbe quella sbagliata.
 */
export async function leggiUso(
  email: string, periodo: { from?: string; to?: string } = {},
): Promise<UsoUnito | null> {
  const userId = await idUtente(email)
  if (!userId) return null
  const from = GIORNO.test(periodo.from ?? '') ? periodo.from! : '0001-01-01'
  const to = GIORNO.test(periodo.to ?? '') ? periodo.to! : '9999-12-31'

  const SOMME = sql`
    SUM(prompts)::bigint        AS prompts,
    SUM(chars)::bigint          AS chars,
    SUM(agent_ms)::bigint       AS agent_ms,
    SUM(tools)::bigint          AS tools,
    SUM(files)::bigint          AS files,
    SUM(commands)::bigint       AS commands,
    SUM(aborted)::bigint        AS aborted,
    SUM(errored)::bigint        AS errored,
    SUM(interrupted)::bigint    AS interrupted,
    SUM(tok_in)::bigint         AS tok_in,
    SUM(tok_out)::bigint        AS tok_out,
    SUM(tok_cache_read)::bigint AS tok_cache_read,
    SUM(tok_cache_write)::bigint AS tok_cache_write`
  const DOVE = sql`user_id = ${userId} AND day >= ${from} AND day <= ${to}`

  // Le conversazioni **distinte** vengono sempre da `usage_session_days`, mai da una
  // somma: sommare `conversations` conterebbe una chat lunga tre giorni come tre.
  const [
    totRighe, totSess,
    perGiornoRighe, perGiornoSess,
    perProgRighe, perProgSess,
    perAgentRighe, perAgentSess,
    perModelloRighe, perModelloSess,
    perDeviceRighe, perDeviceSess,
  ] = await Promise.all([
    sql`SELECT ${SOMME} FROM usage_daily WHERE ${DOVE}`,
    sql`SELECT COUNT(DISTINCT session_id)::bigint AS n FROM usage_session_days WHERE ${DOVE}`,

    sql`SELECT day::text AS day, ${SOMME} FROM usage_daily WHERE ${DOVE} GROUP BY day ORDER BY day`,
    sql`SELECT day::text AS day, COUNT(DISTINCT session_id)::bigint AS n
        FROM usage_session_days WHERE ${DOVE} GROUP BY day`,

    sql`SELECT project_key AS k, MAX(project_label) AS label, ${SOMME}
        FROM usage_daily WHERE ${DOVE} GROUP BY project_key`,
    sql`SELECT project_key AS k, COUNT(DISTINCT session_id)::bigint AS n
        FROM usage_session_days WHERE ${DOVE} GROUP BY project_key`,

    sql`SELECT agent AS k, ${SOMME} FROM usage_daily WHERE ${DOVE} GROUP BY agent`,
    sql`SELECT agent AS k, COUNT(DISTINCT session_id)::bigint AS n
        FROM usage_session_days WHERE ${DOVE} GROUP BY agent`,

    sql`SELECT model AS k, ${SOMME} FROM usage_daily WHERE ${DOVE} GROUP BY model`,
    sql`SELECT model AS k, COUNT(DISTINCT session_id)::bigint AS n
        FROM usage_session_days WHERE ${DOVE} GROUP BY model`,

    sql`SELECT u.machine_id::text AS k, m.label AS label, m.last_seen AS last_seen, ${SOMME}
        FROM usage_daily u JOIN machines m ON m.id = u.machine_id
        WHERE u.user_id = ${userId} AND u.day >= ${from} AND u.day <= ${to}
        GROUP BY u.machine_id, m.label, m.last_seen`,
    sql`SELECT machine_id::text AS k, COUNT(DISTINCT session_id)::bigint AS n
        FROM usage_session_days WHERE ${DOVE} GROUP BY machine_id`,
  ])

  const distinte = (righe: readonly Record<string, unknown>[]): Map<string, number> =>
    new Map(righe.map(r => [String(r['k'] ?? r['day']), n(r['n'])]))

  const rip = (
    righe: readonly Record<string, unknown>[],
    sess: readonly Record<string, unknown>[],
    nome?: (r: Record<string, unknown>) => string,
  ): Ripartizione[] => {
    const d = distinte(sess)
    return righe.map(r => {
      const key = String(r['k'])
      return { key, label: nome?.(r) ?? key, c: conteggi(r, d.get(key) ?? 0) }
    }).sort((a, b) => b.c.agentMs - a.c.agentMs || b.c.prompts - a.c.prompts)
  }

  const dGiorni = distinte(perGiornoSess)

  return {
    totale: conteggi(totRighe[0] ?? {}, n(totSess[0]?.['n'])),
    perGiorno: perGiornoRighe.map(r => ({
      day: String(r['day']),
      c: conteggi(r, dGiorni.get(String(r['day'])) ?? 0),
    })),
    perProgetto: rip(perProgRighe, perProgSess, r => String(r['label'] ?? r['k'])),
    perAgent: rip(perAgentRighe, perAgentSess),
    perModello: rip(perModelloRighe, perModelloSess),
    perDevice: rip(perDeviceRighe, perDeviceSess, r => String(r['label'] ?? r['k']))
      .map(x => {
        const riga = perDeviceRighe.find(r => String(r['k']) === x.key)
        const ls = riga?.['last_seen']
        return { ...x, lastSeen: ls instanceof Date ? ls.toISOString() : String(ls ?? '') }
      }),
  }
}

/** I `Conteggi` vuoti, per chi deve mostrare qualcosa quando non c'è niente. */
export const conteggiVuoti = VUOTI
