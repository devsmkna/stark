// Il client cloud del daemon: login, logout e stato, verso il server cloud di STARK.
//
// Il token di sessione sta in `~/.stark/cloud-token` (0600), accanto al token locale:
// è la credenziale con cui il daemon sincronizza la board (e le altre feature cloud).
// Il browser non parla col server cloud: passa sempre da qui.
//
// L'indirizzo del server ha un default cablato (`CLOUD_PREDEFINITO`) e si sovrascrive
// con `STARK_CLOUD_URL`, come `STARK_PUBLIC_HOST` fa per il perimetro: è configurazione
// della macchina, non un'impostazione scrivibile dalla UI.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Il server cloud di STARK, cablato qui.
 *
 * È un default e non un limite: `STARK_CLOUD_URL` lo sovrascrive, ed è la stessa
 * disciplina di `STARK_PUBLIC_HOST` — una variabile d'ambiente e non un'impostazione,
 * perché `settings.json` si scrive via `PUT /api/settings`, cioè dalla superficie che
 * il login dovrebbe proteggere.
 *
 * Sta scritto nel codice perché **è un fatto del prodotto**, non della macchina: chi
 * installa STARK non deve sapere a quale indirizzo vive il server per potersi
 * autenticare, esattamente come non gli si chiede la porta del daemon. Chi ne ha uno
 * suo (un altro deploy, una prova in locale) lo dice con la variabile.
 *
 * L'indirizzo è stato verificato rispondere prima di scriverlo qui: `GET /api/me`
 * → 401, cioè vivo e in attesa di credenziali. Dal 5 settembre 2026 è il dominio,
 * non più un IP nudo — e da subito dopo il **sottodominio**: l'apex `starkapp.dev`
 * è la homepage, il cloud vive su `cloud.starkapp.dev` (Traefik con Let's Encrypt
 * sull'origin, il server dedicato Vultr 45.77.53.112 — che risponde ancora anche su
 * `http://45.77.53.112:8787` per i daemon non aggiornati, finché serve). Password e
 * token adesso viaggiano su TLS, che per un login email+password non è un dettaglio.
 */
const CLOUD_PREDEFINITO = 'https://cloud.starkapp.dev'

/**
 * L'indirizzo del server cloud, o `null` se il cloud è **spento**.
 *
 * Tre casi, e la distinzione fra i primi due è voluta: variabile assente vuol dire
 * «vale il default», mentre una variabile impostata a vuoto (o a `off`) vuol dire
 * «niente cloud» — serve allo sviluppo in locale e alle prove, che devono poter
 * vedere lo stato «non configurato» senza cambiare il codice. Senza questa via
 * d'uscita, cablare il default renderebbe quello stato irraggiungibile.
 */
export function cloudUrl(): string | null {
  const grezzo = process.env['STARK_CLOUD_URL']
  if (grezzo === undefined) return CLOUD_PREDEFINITO
  const u = grezzo.trim()
  if (u === '' || u.toLowerCase() === 'off') return null
  return u.replace(/\/+$/, '')
}

export const cloudTokenPath = (home: string): string => resolve(home, 'cloud-token')

type CloudToken = { token: string; email: string }

function leggiToken(home: string): CloudToken | null {
  const path = cloudTokenPath(home)
  if (!existsSync(path)) return null
  try {
    const t = JSON.parse(readFileSync(path, 'utf8')) as CloudToken
    if (typeof t?.token === 'string' && t.token && typeof t?.email === 'string') return t
  } catch { /* illeggibile: come se non ci fosse */ }
  return null
}

/** Il token cloud, o `null` se non loggati. Serve allo stream che inoltra al cloud. */
export function tokenCloud(home: string): string | null {
  return leggiToken(home)?.token ?? null
}

function scriviToken(home: string, t: CloudToken): void {
  mkdirSync(home, { recursive: true })
  const path = cloudTokenPath(home)
  writeFileSync(path, JSON.stringify(t), { mode: 0o600 })
  chmodSync(path, 0o600)
}

async function chiama(url: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(`${url}${path}`, init)
    let body: unknown = null
    try { body = await res.json() } catch { /* corpo non JSON */ }
    return { ok: res.ok, status: res.status, body }
  } catch {
    return { ok: false, status: 0, body: { error: 'server non raggiungibile' } }
  }
}

/** Login: verifica le credenziali e salva il token. `null` se fallisce (con il motivo). */
export async function loginCloud(
  home: string, email: string, password: string, code?: string,
): Promise<{ ok: boolean; email?: string; motivo?: string; mfa?: boolean }> {
  const url = cloudUrl()
  if (!url) return { ok: false, motivo: 'server cloud non configurato (STARK_CLOUD_URL)' }
  const r = await chiama(url, '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, ...(code ? { code } : {}) }),
  })
  if (!r.ok) {
    const b = r.body as { error?: string; mfa?: boolean } | null
    // `mfa: true` risale fino alla UI, che mostra il campo del codice invece di
    // ripetere «password sbagliata».
    return { ok: false, motivo: b?.error ?? 'login fallito', ...(b?.mfa ? { mfa: true } : {}) }
  }
  const b = r.body as { token?: string; email?: string } | null
  if (!b?.token || !b?.email) return { ok: false, motivo: 'risposta del server non valida' }
  scriviToken(home, { token: b.token, email: b.email })
  return { ok: true, email: b.email }
}

/** Logout: revoca la sessione sul server e toglie il token locale. */
export async function logoutCloud(home: string): Promise<void> {
  const url = cloudUrl()
  const t = leggiToken(home)
  if (url && t) await chiama(url, '/api/logout', {
    method: 'POST',
    headers: { authorization: `Bearer ${t.token}` },
  })
  rmSync(cloudTokenPath(home), { force: true })
}

/**
 * Cambio password dell'account cloud. Il daemon fa solo da tramite: la verifica
 * della password attuale, la scadenza delle altre sessioni e ogni altra decisione
 * stanno sul server (`cloud/src/auth.ts`, `cambiaPassword`). La sessione di QUESTA
 * macchina resta valida per contratto del server, quindi il token locale non si
 * tocca — le altre macchine dovranno rifare il login, ed è il punto.
 */
export async function cambiaPasswordCloud(
  home: string, attuale: string, nuova: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = cloudUrl()
  if (!url) return { ok: false, error: 'server cloud non configurato (STARK_CLOUD_URL)' }
  const t = leggiToken(home)
  if (!t) return { ok: false, error: 'non loggato' }
  const r = await chiama(url, '/api/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` },
    body: JSON.stringify({ current: attuale, new: nuova }),
  })
  if (r.ok) return { ok: true }
  return { ok: false, error: (r.body as { error?: string } | null)?.error ?? 'cambio password fallito' }
}

/** Lo stato cloud: chi è loggato, e se il server è raggiungibile. */
export async function cloudStatus(home: string): Promise<{
  url: string | null
  email: string | null
  server: 'ok' | 'giu' | 'non-configurato'
}> {
  const url = cloudUrl()
  const t = leggiToken(home)
  if (!url) return { url: null, email: t?.email ?? null, server: 'non-configurato' }
  if (!t) return { url, email: null, server: 'ok' }
  const r = await chiama(url, '/api/me', { headers: { authorization: `Bearer ${t.token}` } })
  // Se il token non vale più (scaduto/revocato) lo si toglie: la UI dirà di rifare login.
  if (!r.ok) rmSync(cloudTokenPath(home), { force: true })
  return { url, email: r.ok ? t.email : null, server: r.status === 0 ? 'giu' : 'ok' }
}

// ─── la board cloud (il daemon fa da proxy) ─────────────────────────────────
//
// Il `cwd` della sessione è un path locale, che cambia da macchina a macchina: non va
// bene come chiave della board remota. L'ID stabile è l'**origin della repo git** — lo
// stesso per chiunque abbia il progetto. Il daemon lo risale dal `cwd` e lo passa al
// cloud come query param.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname } from 'node:path'

const execFileP = promisify(execFile)

/**
 * L'origin della repo git che contiene `cwd`, o `null` se non è dentro una repo.
 *
 * Si risale fino alla root della repo (`git rev-parse --show-toplevel`) e si legge
 * l'origin (`git remote get-url origin`). Se manca l'origin (repo locale senza remoto)
 * la board cloud non ha una chiave stabile: si restituisce `null` e la UI lo dirà.
 */
export async function originRepo(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 5000 })
    const root = stdout.trim()
    if (!root) return null
    const { stdout: origin } = await execFileP('git', ['-C', root, 'remote', 'get-url', 'origin'], { timeout: 5000 })
    const o = origin.trim()
    return o || null
  } catch {
    return null
  }
}

/**
 * Inoltra una richiesta board al cloud. `pathCloud` è la rotta cloud (es. `/api/board`),
 * con l'origin già codificato. `null` se il cloud è spento o non loggati.
 */
async function proxyBoard(
  home: string, origin: string, pathCloud: string, init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = cloudUrl()
  const token = tokenCloud(home)
  if (!url || !token) return { ok: false, status: 401, body: { error: 'cloud non configurato o non loggato' } }
  const q = new URLSearchParams({ origin })
  return chiama(url, `${pathCloud}?${q}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  })
}

/**
 * Inoltra al cloud una richiesta MFA col Bearer del daemon. Il daemon fa da solo
 * tramite: la UI di Settings gestisce il proprio TOTP senza che il browser parli col
 * cloud. `status` torna alla UI, che distingue 400 (codice sbagliato) da 200.
 */
export async function proxyTotp(
  home: string, pathCloud: string, init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = cloudUrl()
  const t = leggiToken(home)
  if (!url || !t) return { ok: false, status: 401, body: { error: 'cloud non configurato o non loggato' } }
  return chiama(url, pathCloud, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${t.token}` },
  })
}

/** Legge la board cloud di un progetto. */
export async function boardCloud(home: string, origin: string): Promise<unknown> {
  const r = await proxyBoard(home, origin, '/api/board')
  return r.body
}

/** Crea la board cloud di un progetto se non c'è. */
export async function boardInitCloud(home: string, origin: string): Promise<unknown> {
  const r = await proxyBoard(home, origin, '/api/board/init', { method: 'POST' })
  return r.body
}

/** Crea una card nella board cloud. */
export async function boardTaskCloud(
  home: string, origin: string, input: { title: string; priority?: string; body?: string },
): Promise<unknown> {
  const r = await proxyBoard(home, origin, '/api/board/task', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return r.body
}

/** Modifica una card nella board cloud (stato, titolo, priorità, claim, blocco, corpo, posizione). */
export async function boardEditCloud(
  home: string, origin: string, id: number,
  input: {
    status?: string; title?: string; priority?: string; claimed_by?: string
    blocked?: string; body?: string; assignee?: string; position?: number
  },
): Promise<unknown> {
  const r = await proxyBoard(home, origin, `/api/board/task/${id}/edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return r.body
}

/**
 * Importa una board locale (kanban-md) nella board cloud del progetto. Le card
 * arrivano già lette dai file (`leggiBoardLocale` in `./board.ts`): qui si inoltra
 * e basta, perché ogni decisione — board non vuota, id doppi — sta sul server, che
 * è l'unico a vedere lo stato vero.
 */
export async function boardImportCloud(
  home: string, origin: string,
  input: { name?: string; tasks: unknown[] },
): Promise<unknown> {
  const r = await proxyBoard(home, origin, '/api/board/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return r.body
}
