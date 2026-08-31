// Il client cloud del daemon: login, logout e stato, verso il server cloud di STARK.
//
// Il token di sessione sta in `~/.stark/cloud-token` (0600), accanto al token locale:
// è la credenziale con cui il daemon sincronizza la board (e le altre feature cloud).
// Il browser non parla col server cloud: passa sempre da qui.
//
// L'indirizzo del server viene da `STARK_CLOUD_URL` (come `STARK_PUBLIC_HOST` per il
// perimetro): è configurazione della macchina, non un'impostazione scrivibile dalla UI.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** L'indirizzo del server cloud, o `null` se non è configurato. */
export function cloudUrl(): string | null {
  const u = process.env['STARK_CLOUD_URL']?.trim()
  return u ? u.replace(/\/+$/, '') : null
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
  home: string, email: string, password: string,
): Promise<{ ok: boolean; email?: string; motivo?: string }> {
  const url = cloudUrl()
  if (!url) return { ok: false, motivo: 'server cloud non configurato (STARK_CLOUD_URL)' }
  const r = await chiama(url, '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) {
    const motivo = (r.body as { error?: string } | null)?.error ?? 'login fallito'
    return { ok: false, motivo }
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
