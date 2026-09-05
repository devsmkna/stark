// TOTP (RFC 6238) e codici di recupero, con `node:crypto` e nient'altro.
//
// Stessa disciplina di scrypt in auth.ts: lo standard definisce l'algoritmo per
// intero — HMAC-SHA1, finestra da 30s, dynamic truncation — quindi una libreria
// sarebbe una dipendenza in più per un risultato che sappiamo scrivere e verificare.
// La prova (`tools/totp-check.ts`) gira sui vettori dell'appendice B dell'RFC: se
// quelli passano, l'implementazione è quella giusta, non una che «sembra» giusta.
//
// Base32 e non hex per il segreto: è ciò che gli authenticator (Google, Aegis, 1Password)
// leggono da un `otpauth://`, e scriverlo in hex vorrebbe dire un QR che nessuna app apre.

import { createHmac, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto'

const ALFABETO32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Un segreto nuovo, 20 byte (160 bit, la lunghezza consigliata dall'RFC per SHA1),
 *  in base32 senza padding — la forma che va in un `otpauth://`. */
export function nuovoSegreto(): string {
  return base32encode(randomBytes(20))
}

/** L'URI `otpauth://` da dare a un QR: l'authenticator lo legge e sa già tutto. */
export function otpauthUri(segreto: string, email: string, issuer = 'STARK'): string {
  // Il `:` fra issuer e account resta letterale — è il separatore che gli authenticator
  // leggono; le due metà sì che si codificano, per un'email con caratteri strani.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`
  const q = new URLSearchParams({ secret: segreto, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${q.toString()}`
}

/** Il codice a 6 cifre per un dato passo temporale (default: adesso). Esportato per
 *  la prova sui vettori RFC, che fissa il tempo. */
export function codiceTOTP(segreto: string, perMs: number = ora(), passoS = 30): string {
  const contatore = Math.floor(perMs / 1000 / passoS)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(contatore))
  const hmac = createHmac('sha1', base32decode(segreto)).update(buf).digest()
  // Dynamic truncation (RFC 4226 §5.3): l'offset è il nibble basso dell'ultimo byte.
  const off = hmac[hmac.length - 1]! & 0x0f
  const bin = ((hmac[off]! & 0x7f) << 24) | (hmac[off + 1]! << 16)
    | (hmac[off + 2]! << 8) | hmac[off + 3]!
  return String(bin % 1_000_000).padStart(6, '0')
}

/**
 * Verifica un codice, con finestra ±1 passo (l'orologio del telefono può derivare di
 * qualche secondo) e **confronto a tempo costante**. Torna il passo che ha corrisposto,
 * o `null`: il passo serve a chi chiama per rifiutare il replay (§ no-replay) — lo
 * stesso codice non deve valere due volte nei suoi 30 secondi.
 */
export function verificaTOTP(segreto: string, codice: string, perMs: number = ora()): number | null {
  const pulito = codice.replace(/\s/g, '')
  if (!/^\d{6}$/.test(pulito)) return null
  for (const d of [0, -1, 1]) {
    const passo = perMs + d * 30_000
    if (pariStringa(codiceTOTP(segreto, passo), pulito)) return Math.floor(passo / 1000 / 30)
  }
  return null
}

// ─── codici di recupero ────────────────────────────────────────────────────────
//
// La via d'uscita se perdi l'authenticator, e — per il tunnel — anche l'unico modo di
// autorizzare un device nuovo quando sei remoto senza niente di fidato in mano. Sono
// segreti forti e monouso: si mostrano UNA volta all'attivazione, si salvano hashati
// (scrypt, come le password), e usarne uno lo consuma.

/** Dieci codici in chiaro, da mostrare una volta sola. Forma `xxxx-xxxx`, leggibile. */
export function nuoviCodiciRecupero(n = 10): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const g = randomBytes(5).toString('hex') // 10 hex
    out.push(`${g.slice(0, 4)}-${g.slice(4, 8)}`)
  }
  return out
}

export function hashCodice(codice: string): string {
  const sale = randomBytes(16)
  const h = scryptSync(normalizza(codice), sale, 32)
  return `${sale.toString('hex')}$${h.toString('hex')}`
}

/** Torna l'indice del codice che corrisponde (per consumarlo), o -1. Confronto a tempo
 *  costante su ogni candidato: non deve trapelare *quale* ha corrisposto dal tempo. */
export function trovaCodice(codice: string, hashes: string[]): number {
  let trovato = -1
  for (let i = 0; i < hashes.length; i++) {
    const [saleHex, hHex] = hashes[i]!.split('$')
    if (!saleHex || !hHex) continue
    const atteso = Buffer.from(hHex, 'hex')
    const calc = scryptSync(normalizza(codice), Buffer.from(saleHex, 'hex'), atteso.length)
    if (atteso.length === calc.length && timingSafeEqual(atteso, calc)) trovato = i
  }
  return trovato
}

const normalizza = (c: string): string => c.replace(/[\s-]/g, '').toLowerCase()

// ─── base32 (RFC 4648, senza padding) ───────────────────────────────────────────

function base32encode(buf: Buffer): string {
  let bits = 0, valore = 0, out = ''
  for (const b of buf) {
    valore = (valore << 8) | b
    bits += 8
    while (bits >= 5) { out += ALFABETO32[(valore >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ALFABETO32[(valore << (5 - bits)) & 31]
  return out
}

function base32decode(s: string): Buffer {
  let bits = 0, valore = 0
  const out: number[] = []
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = ALFABETO32.indexOf(ch)
    if (i < 0) continue
    valore = (valore << 5) | i
    bits += 5
    if (bits >= 8) { out.push((valore >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(out)
}

function pariStringa(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** L'ora, isolata qui perché in questo runtime `Date.now()` a volte è vietato negli
 *  script: la prova passa un tempo fisso e non la chiama. */
function ora(): number { return Date.now() }
