// Autenticazione del server cloud: registrazione, login, sessioni.
//
// Scelte (spec 2026-08-30-cloud-board-auth-design.md):
// - email + password, registrazione libera
// - hash con `scrypt` di Node (nessuna dipendenza esterna: argon2/bcrypt sarebbero
//   un pacchetto in più per lo stesso risultato)
// - token opaco + sessione server-side, così un token rubato si può revocare
//
// I dati stanno in Postgres, con schema e migrazioni Drizzle (vedi src/db/). Niente
// più file JSONL: il cloud è un modulo a sé, con un DB vero.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { and, eq, lt, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from './db/client.ts'
import { users, sessions } from './db/schema.ts'

const db = drizzle(sql)

// ─── password ────────────────────────────────────────────────────────────────

/** Hash di una password con `scrypt`, nella forma `scrypt$<sale>$<hash>`. */
export function hashPassword(password: string): string {
  const sale = randomBytes(16)
  const hash = scryptSync(password, sale, 64)
  return `scrypt$${sale.toString('hex')}$${hash.toString('hex')}`
}

/** Verifica una password contro un hash. Costante nel tempo: non dice quanto è giusta. */
export function verificaPassword(password: string, hash: string): boolean {
  const [algo, saleHex, hashHex] = hash.split('$')
  if (algo !== 'scrypt' || !saleHex || !hashHex) return false
  const sale = Buffer.from(saleHex, 'hex')
  const atteso = Buffer.from(hashHex, 'hex')
  const calcolato = scryptSync(password, sale, atteso.length)
  return timingSafeEqual(atteso, calcolato)
}

// ─── account e sessioni ─────────────────────────────────────────────────────

/** Registra un account. `false` se l'email esiste già. */
export async function registra(email: string, password: string): Promise<boolean> {
  const e = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('email non valida')
  if (password.length < 8) throw new Error('password troppo corta (minimo 8 caratteri)')
  const esistente = await db.select().from(users).where(eq(users.email, e))
  if (esistente.length > 0) return false
  await db.insert(users).values({ email: e, passwordHash: hashPassword(password) })
  return true
}

/** Verifica le credenziali e apre una sessione. `null` se le credenziali sono sbagliate. */
export async function login(email: string, password: string): Promise<{ token: string; email: string } | null> {
  const e = email.trim().toLowerCase()
  const [account] = await db.select().from(users).where(eq(users.email, e))
  if (!account || !verificaPassword(password, account.passwordHash)) return null
  const token = randomBytes(32).toString('hex')
  await db.insert(sessions).values({ token, userId: account.id })
  return { token, email: e }
}

/**
 * Quanto vive una sessione: 90 giorni dalla nascita, poi il token smette di valere e
 * il daemon rifà il login (il suo `verifica()` gestisce già il 401 buttando il token
 * locale). Novanta e non trenta: tre macchine che chiedono la password ogni mese
 * sono attrito che spinge a password peggiori. La revoca resta la difesa pronta
 * (`/api/logout`, cambio password); la scadenza è la rete sotto — un token
 * dimenticato su una macchina dismessa muore da solo.
 */
const VITA_SESSIONE_MS = 90 * 24 * 60 * 60 * 1000

function scaduta(creata: Date): boolean {
  return Date.now() - creata.getTime() > VITA_SESSIONE_MS
}

/** Chi possiede questo token, o `null` se non c'è una sessione viva. */
export async function chi(token: string): Promise<string | null> {
  return (await chiId(token))?.email ?? null
}

/** Come `chi`, ma con l'id: serve al tunnel, che deriva la chiave d'instradamento
 *  dall'identità e non può accontentarsi dell'email (che può cambiare). */
export async function chiId(token: string): Promise<{ id: string; email: string } | null> {
  if (!token) return null
  const [sessione] = await db.select().from(sessions).where(eq(sessions.token, token))
  if (!sessione) return null
  if (scaduta(sessione.createdAt)) {
    // Si toglie adesso, non con un cron: la riga morta sparisce alla prima volta che
    // qualcuno la presenta, e le mai più presentate le pulisce `spazzaSessioni`.
    await db.delete(sessions).where(eq(sessions.token, token))
    return null
  }
  const [account] = await db.select().from(users).where(eq(users.id, sessione.userId))
  return account ? { id: account.id, email: account.email } : null
}

/** Le sessioni scadute e mai più presentate. Da chiamare ogni tanto (all'avvio). */
export async function spazzaSessioni(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.createdAt, new Date(Date.now() - VITA_SESSIONE_MS)))
}

/** Revoca una sessione (logout). */
export async function revoca(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token))
}

/**
 * Cambio password. Chiede quella vecchia anche a sessione valida: un telefono
 * rubato con la sessione aperta non deve poter chiudere fuori il proprietario.
 * Le ALTRE sessioni si revocano: se la password cambia perché era compromessa,
 * lasciarle vive vanificherebbe il cambio. La corrente resta — chi cambia la
 * password non va sbattuto fuori nel farlo.
 */
export async function cambiaPassword(
  token: string, attuale: string, nuova: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const utente = await chiId(token)
  if (!utente) return { ok: false, error: 'non autenticato' }
  if (nuova.length < 8) return { ok: false, error: 'password troppo corta (minimo 8 caratteri)' }
  const [account] = await db.select().from(users).where(eq(users.id, utente.id))
  if (!account || !verificaPassword(attuale, account.passwordHash)) {
    return { ok: false, error: 'password attuale sbagliata' }
  }
  await db.update(users).set({ passwordHash: hashPassword(nuova) }).where(eq(users.id, utente.id))
  await db.delete(sessions).where(and(eq(sessions.userId, utente.id), ne(sessions.token, token)))
  return { ok: true }
}
