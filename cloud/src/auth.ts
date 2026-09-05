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
import { and, eq, isNull, lt, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from './db/client.ts'
import { users, sessions, recoveryCodes } from './db/schema.ts'
import {
  nuovoSegreto, otpauthUri, verificaTOTP,
  nuoviCodiciRecupero, hashCodice, trovaCodice,
} from './totp.ts'

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
  const r = await loginMfa(email, password)
  return r.ok ? { token: r.token, email: r.email } : null
}

/** Se l'account ha il TOTP acceso — senza toccare le credenziali. Serve alla pagina
 *  di login del tunnel per sapere se chiedere il secondo campo. */
export async function haTotp(email: string): Promise<boolean> {
  const [a] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()))
  return !!a?.totpEnabled
}

/**
 * Login con MFA. Se l'account ha il TOTP acceso, `code` è obbligatorio ed è o un
 * codice TOTP o uno di recupero (monouso). Il replay dello stesso TOTP nei suoi 30s è
 * bloccato marcando la sessione col passo consumato — ma quello vive nel client del
 * tunnel, quindi la difesa vera contro il brute-force è il freno per IP sulla pagina.
 * Qui ci limitiamo a non accettare un codice fuori finestra.
 */
export async function loginMfa(
  email: string, password: string, code?: string,
): Promise<{ ok: true; token: string; email: string } | { ok: false; motivo: 'credenziali' | 'mfa' }> {
  const e = email.trim().toLowerCase()
  const [account] = await db.select().from(users).where(eq(users.email, e))
  if (!account || !verificaPassword(password, account.passwordHash)) return { ok: false, motivo: 'credenziali' }
  if (account.totpEnabled) {
    const c = (code ?? '').trim()
    if (!c) return { ok: false, motivo: 'mfa' }
    const buono = account.totpSecret && verificaTOTP(account.totpSecret, c) !== null
    if (!buono && !(await consumaRecupero(account.id, c))) return { ok: false, motivo: 'mfa' }
  }
  const token = randomBytes(32).toString('hex')
  await db.insert(sessions).values({ token, userId: account.id })
  return { ok: true, token, email: e }
}

/** Consuma un codice di recupero se corrisponde a uno non ancora usato. */
async function consumaRecupero(userId: string, codice: string): Promise<boolean> {
  const righe = await db.select().from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
  const i = trovaCodice(codice, righe.map(r => r.codeHash))
  if (i < 0) return false
  await db.update(recoveryCodes).set({ usedAt: new Date() }).where(eq(recoveryCodes.id, righe[i]!.id))
  return true
}

// ─── enrolment TOTP ─────────────────────────────────────────────────────────────

/**
 * Passo 1: genera un segreto e lo scrive **senza** accendere il TOTP (`totpEnabled`
 * resta null). Torna il segreto e l'URI per il QR. Accendere si fa solo dopo che
 * l'utente prova di leggerlo (`abilitaTotp`), mai prima: un segreto scritto ma non
 * verificato non deve poter chiudere fuori nessuno.
 */
export async function preparaTotp(token: string): Promise<{ ok: boolean; secret?: string; uri?: string; error?: string }> {
  const u = await chiId(token)
  if (!u) return { ok: false, error: 'non autenticato' }
  const secret = nuovoSegreto()
  await db.update(users).set({ totpSecret: secret, totpEnabled: null }).where(eq(users.id, u.id))
  return { ok: true, secret, uri: otpauthUri(secret, u.email) }
}

/** Passo 2: accende il TOTP solo se il codice quadra col segreto appena preparato.
 *  Torna i codici di recupero in chiaro — l'unica volta che si vedono. */
export async function abilitaTotp(token: string, codice: string): Promise<{ ok: boolean; recovery?: string[]; error?: string }> {
  const u = await chiId(token)
  if (!u) return { ok: false, error: 'non autenticato' }
  const [account] = await db.select().from(users).where(eq(users.id, u.id))
  if (!account?.totpSecret) return { ok: false, error: 'prima genera un segreto' }
  if (verificaTOTP(account.totpSecret, codice) === null) return { ok: false, error: 'codice sbagliato' }
  await db.update(users).set({ totpEnabled: new Date() }).where(eq(users.id, u.id))
  // Codici di recupero freschi: si buttano i vecchi e se ne fanno dieci nuovi.
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, u.id))
  const codici = nuoviCodiciRecupero()
  await db.insert(recoveryCodes).values(codici.map(c => ({ userId: u.id, codeHash: hashCodice(c) })))
  return { ok: true, recovery: codici }
}

/** Spegne il TOTP: chiede la password (non basta la sessione — un device rubato non
 *  deve poter togliere la seconda difesa) e cancella segreto e codici. */
export async function disabilitaTotp(token: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const u = await chiId(token)
  if (!u) return { ok: false, error: 'non autenticato' }
  const [account] = await db.select().from(users).where(eq(users.id, u.id))
  if (!account || !verificaPassword(password, account.passwordHash)) return { ok: false, error: 'password sbagliata' }
  await db.update(users).set({ totpSecret: null, totpEnabled: null }).where(eq(users.id, u.id))
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, u.id))
  return { ok: true }
}

/** Lo stato MFA di un account, per la UI. */
export async function statoTotp(token: string): Promise<{ ok: boolean; enabled?: boolean; recoveryLeft?: number; error?: string }> {
  const u = await chiId(token)
  if (!u) return { ok: false, error: 'non autenticato' }
  const [account] = await db.select().from(users).where(eq(users.id, u.id))
  const left = await db.select().from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, u.id), isNull(recoveryCodes.usedAt)))
  return { ok: true, enabled: !!account?.totpEnabled, recoveryLeft: left.length }
}

/**
 * Verifica identità + MFA per il tunnel, senza aprire una sessione (usa-e-getta lato
 * hub). Torna l'id se tutto quadra. `code` obbligatorio solo se l'account ha il TOTP.
 */
export async function verificaAccesso(
  email: string, password: string, code?: string,
): Promise<{ id: string } | null> {
  const r = await loginMfa(email, password, code)
  if (!r.ok) return null
  const u = await chiId(r.token)
  await revoca(r.token)
  return u ? { id: u.id } : null
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
