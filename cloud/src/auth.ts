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
import { eq } from 'drizzle-orm'
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

/** Chi possiede questo token, o `null` se non c'è una sessione viva. */
export async function chi(token: string): Promise<string | null> {
  if (!token) return null
  const [sessione] = await db.select().from(sessions).where(eq(sessions.token, token))
  if (!sessione) return null
  const [account] = await db.select().from(users).where(eq(users.id, sessione.userId))
  return account?.email ?? null
}

/** Revoca una sessione (logout). */
export async function revoca(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token))
}
