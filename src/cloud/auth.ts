// Autenticazione del server cloud: registrazione, login, sessioni.
//
// Scelte (spec 2026-08-30-cloud-board-auth-design.md):
// - email + password, registrazione libera
// - hash con `scrypt` di Node (nessuna dipendenza esterna: argon2/bcrypt sarebbero
//   un pacchetto in più per lo stesso risultato)
// - token opaco + sessione server-side, così un token rubato si può revocare
//
// I dati stanno in file JSONL append-only, come i journal di STARK: niente database,
// e la stessa disciplina di lettura in coda.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Un account: email e hash della password. Mai la password in chiaro. */
export type Account = {
  email: string
  passwordHash: string
  createdAt: number
}

/** Una sessione: il token opaco e a chi appartiene. */
export type Session = {
  token: string
  email: string
  createdAt: number
}

/** Dove vivono account e sessioni. Sovrascrivibile dall'ambiente. */
export const dataDir = (): string => resolve(process.env['CLOUD_DATA'] ?? resolve('.', 'cloud-data'))

const accountPath = (): string => resolve(dataDir(), 'accounts.jsonl')
const sessionPath = (): string => resolve(dataDir(), 'sessions.jsonl')

function leggiRighe(path: string): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean)
}

/** Crea la cartella dati se non c'è: `appendFileSync` non la crea da solo. */
function assicuraCartella(): void {
  mkdirSync(dataDir(), { recursive: true })
}

function leggiAccount(): Account[] {
  const out: Account[] = []
  for (const riga of leggiRighe(accountPath())) {
    try { out.push(JSON.parse(riga) as Account) } catch { /* riga monca */ }
  }
  return out
}

function leggiSessioni(): Session[] {
  const out: Session[] = []
  for (const riga of leggiRighe(sessionPath())) {
    try { out.push(JSON.parse(riga) as Session) } catch { /* riga monca */ }
  }
  return out
}

function scrivi(path: string, righe: unknown[]): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, righe.map(r => JSON.stringify(r)).join('\n') + '\n')
}

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
export function registra(email: string, password: string): boolean {
  const e = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('email non valida')
  if (password.length < 8) throw new Error('password troppo corta (minimo 8 caratteri)')
  if (leggiAccount().some(a => a.email === e)) return false
  assicuraCartella()
  appendFileSync(accountPath(), JSON.stringify({
    email: e, passwordHash: hashPassword(password), createdAt: Date.now(),
  } satisfies Account) + '\n')
  return true
}

/** Verifica le credenziali e apre una sessione. `null` se le credenziali sono sbagliate. */
export function login(email: string, password: string): Session | null {
  const e = email.trim().toLowerCase()
  const account = leggiAccount().find(a => a.email === e)
  if (!account || !verificaPassword(password, account.passwordHash)) return null
  assicuraCartella()
  const sessione: Session = { token: randomBytes(32).toString('hex'), email: e, createdAt: Date.now() }
  appendFileSync(sessionPath(), JSON.stringify(sessione) + '\n')
  return sessione
}

/** Chi possiede questo token, o `null` se non c'è una sessione viva. */
export function chi(token: string): string | null {
  if (!token) return null
  const sessione = leggiSessioni().find(s => s.token === token)
  return sessione?.email ?? null
}

/** Revoca una sessione (logout). */
export function revoca(token: string): void {
  const vive = leggiSessioni().filter(s => s.token !== token)
  scrivi(sessionPath(), vive)
}
