// Le statistiche di questa macchina che salgono al cloud, per unirsi a quelle degli
// altri dispositivi della stessa persona.
//
// Perché serve: `statsFrom()` legge gli snapshot in RAM di **questa** macchina, e i
// journal non si sincronizzano. Chi lavora da tre posti vede un terzo del proprio uso,
// e non c'è nessun modo locale di accorgersene — il numero è giusto per quello che
// misura, solo che misura meno di quel che sembra.
//
// La regola che tiene in piedi tutto: **si manda lo stato completo di una finestra di
// giorni, mai un incremento**. Il server riscrive la finestra intera. Da lì discende
// che qui non c'è nessuna coda, nessun ritentativo, nessun registro di «cosa ho già
// mandato»: se un invio fallisce, il prossimo lo copre da solo. Ogni memoria di ciò
// che è già successo sarebbe una cosa in più che può divergere dalla realtà.
//
// Spenta di default (`usageSync` in `settings.ts`): è la seconda cosa che esce dalla
// macchina dopo il Web Push, e ADR-011 vuole che sia una scelta detta dove si fa.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, platform } from 'node:os'
import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'

import type { SessionSnapshot } from '../core/reduce.ts'
import { giorno, righeUso, type RigaUso, type SessionDay } from '../core/stats.ts'
import { cloudUrl, originRepo, tokenCloud } from './cloud.ts'

/** Al massimo un invio ogni tanto. Un turno che cade dentro la finestra non accoda
 *  niente: alza un flag, e l'invio dopo lo copre — perché manda lo stato completo. */
const COLLASSO_MS = 60_000

/** Quanti giorni indietro rimanda un invio normale.
 *
 *  Uno basterebbe per il caso normale (un turno di oggi non cambia il totale di
 *  marzo). Tre perché una macchina che passa un giorno offline deve poter recuperare
 *  al primo turno online, senza che nessuno tenga il conto di cosa è rimasto indietro. */
const FINESTRA_GIORNI = 3

/** Quanti giorni per invio quando si manda tutto lo storico la prima volta. Il server
 *  accetta 2 MB di corpo e 5000 righe: questo tiene il pezzo largamente sotto. */
const PASSO_STORICO = 90

/**
 * La mezzanotte locale del giorno in cui cade `ts`.
 *
 * Serve a far combaciare due cose che sembrano la stessa e non lo sono: la finestra
 * che si **dichiara** al server è fatta di giorni interi, mentre il taglio che
 * `righeUso()` applica è fatto di millisecondi. Partire da «adesso meno due giorni»
 * vorrebbe dire dichiarare tutta quella giornata e mandarne solo la seconda metà — e
 * siccome un invio è una sostituzione, il server cancellerebbe la mattina e non la
 * riscriverebbe. Il difetto sarebbe pure invisibile: i numeri restano plausibili, solo
 * più bassi, e solo sul giorno più vecchio della finestra.
 */
function mezzanotte(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * La mezzanotte di `n` giorni dopo quella in cui cade `ts`.
 *
 * Per **giorni di calendario**, non sommando 86.400.000 millisecondi: nella notte del
 * cambio d'ora un giorno dura 23 ore o 25, e la somma in millisecondi atterrerebbe
 * alle 23 del giorno prima o all'una del giorno dopo. Basta a spostare una giornata
 * intera nella finestra sbagliata, due volte l'anno, in un modo che nessuno collega
 * al cambio d'ora.
 */
function piuGiorni(ts: number, n: number): number {
  const d = new Date(mezzanotte(ts))
  d.setDate(d.getDate() + n)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ─── l'identità di questa macchina ───────────────────────────────────────────

/**
 * L'id opaco di questo dispositivo, creato la prima volta che serve.
 *
 * Opaco e non l'hostname: l'hostname è una cosa da mostrare, e rinominare il portatile
 * non deve spezzare lo storico in due macchine. L'etichetta viaggia a parte e si
 * riscrive a ogni invio.
 */
export function machineId(home: string): string {
  const path = resolve(home, 'machine-id')
  if (existsSync(path)) {
    const letto = readFileSync(path, 'utf8').trim()
    if (letto) return letto
  }
  const id = randomUUID()
  mkdirSync(home, { recursive: true })
  writeFileSync(path, `${id}\n`, { mode: 0o600 })
  return id
}

/** Il segno che lo storico è già stato mandato una volta da questa macchina. */
const segnoStorico = (home: string): string => resolve(home, 'usage-synced')

// ─── la chiave di progetto, che deve valere fra macchine diverse ─────────────

type Chiave = { key: string; label: string }

/**
 * Come si chiama un progetto quando i numeri di tre macchine si sommano.
 *
 * Non il `cwd`: lo stesso progetto sta in `/mnt/m/...` sul fisso e in `/Users/...` sul
 * MacBook, e sommato per percorso comparirebbe due volte in «By project». La chiave
 * stabile è l'**origin git**, la stessa che identifica la board cloud.
 *
 * Una cartella senza repo resta sul proprio percorso, ed è giusto così: *è* di quella
 * macchina, e fonderla con un'altra sarebbe inventare.
 *
 * La cache non è un'ottimizzazione facoltativa: `originRepo()` lancia `git` due volte,
 * e senza si pagherebbe a ogni invio per ogni cartella aperta.
 */
class Origini {
  private readonly cache = new Map<string, Chiave>()

  async risolvi(snaps: Iterable<SessionSnapshot>): Promise<Map<string, Chiave>> {
    const cartelle = new Set<string>()
    for (const s of snaps) if (s.cwd) cartelle.add(s.cwd)
    for (const cwd of cartelle) {
      if (this.cache.has(cwd)) continue
      const origin = await originRepo(cwd)
      this.cache.set(cwd, origin
        ? { key: origin, label: nomeDaOrigin(origin) }
        : { key: cwd, label: basename(cwd) || cwd })
    }
    return this.cache
  }
}

/** `git@github.com:tizio/stark.git` → `stark`. Solo per mostrarlo. */
function nomeDaOrigin(origin: string): string {
  const pulito = origin.replace(/\.git$/, '').replace(/\/+$/, '')
  const pezzo = pulito.split(/[/:]/).pop() ?? pulito
  return pezzo || origin
}

// ─── l'invio ─────────────────────────────────────────────────────────────────

type Invio = {
  machine: { key: string; label: string; platform: string }
  window: { from: string; to: string }
  rows: { day: string; projectKey: string; projectLabel: string; agent: string; model: string; c: RigaUso['c'] }[]
  sessionDays: SessionDay[]
}

export type EsitoSync =
  | { ok: true; rows: number }
  | { ok: false; motivo: string }

export type UsageSync = {
  /** Un turno è finito: forse è ora di mandare. Non attende, non fallisce. */
  turnoFinito(): void
  /** Manda adesso, e dillo. Serve alle prove e al primo invio. */
  sincronizza(): Promise<EsitoSync>
  /** Lettura: l'uso unito di tutti i dispositivi, dal cloud. `null` se non si può. */
  leggi(periodo: { from?: number; to?: number }): Promise<unknown | null>
}

export type DipendenzeSync = {
  home: string
  /** Gli snapshot vivi del registro. Una funzione, non una lista: cambiano. */
  snapshots: () => Iterable<SessionSnapshot>
  /** Se la sincronizzazione è accesa. Riletta a ogni giro: si spegne a caldo. */
  accesa: () => boolean
  /** Da sostituire nelle prove, per non aspettare un minuto vero. */
  collassoMs?: number
  ora?: () => number
}

export function creaUsageSync(d: DipendenzeSync): UsageSync {
  const origini = new Origini()
  const collasso = d.collassoMs ?? COLLASSO_MS
  const ora = d.ora ?? (() => Date.now())
  let ultimoInvio = 0
  let inCorso = false
  /** C'è qualcosa da mandare che non è ancora partito. Un flag, non una coda: la coda
   *  sarebbe una memoria di cosa è successo, e lo stato completo la rende inutile. */
  let sporco = false
  let timer: NodeJS.Timeout | undefined

  /**
   * L'invio di una finestra di **giorni interi**, dal primo all'ultimo compresi.
   *
   * Le due convenzioni si incontrano qui, ed è l'unico posto in cui devono: la
   * finestra dichiarata al server è fatta di giornate e le include entrambe, mentre il
   * taglio di `righeUso()` è in millisecondi con l'estremo destro **escluso**. Da qui
   * la mezzanotte del giorno dopo l'ultimo — con quella dell'ultimo, tutto ciò che è
   * successo in quel giorno resterebbe fuori dall'invio *ma dentro* la finestra
   * cancellata, e sparirebbe dal cloud a ogni sincronizzazione.
   */
  async function costruisci(primoGiorno: number, ultimoGiorno: number): Promise<Invio> {
    const snaps = [...d.snapshots()]
    const mappa = await origini.risolvi(snaps)
    const chiave = (s: SessionSnapshot): Chiave =>
      (s.cwd ? mappa.get(s.cwd) : undefined) ?? { key: 'unknown', label: 'unknown' }
    const from = mezzanotte(primoGiorno)
    const to = piuGiorni(ultimoGiorno, 1)
    const { righe, sessionDays } = righeUso(snaps, { from, to }, chiave)
    return {
      machine: { key: machineId(d.home), label: hostname(), platform: platform() },
      window: { from: giorno(from), to: giorno(mezzanotte(ultimoGiorno)) },
      rows: righe.map(r => ({
        day: r.day, projectKey: r.projectKey, projectLabel: r.projectLabel,
        agent: r.agent, model: r.model, c: r.c,
      })),
      sessionDays,
    }
  }

  async function manda(invio: Invio): Promise<EsitoSync> {
    const url = cloudUrl()
    const token = tokenCloud(d.home)
    if (!url) return { ok: false, motivo: 'server cloud non configurato' }
    if (!token) return { ok: false, motivo: 'non loggato al cloud' }
    try {
      const res = await fetch(`${url}/api/usage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(invio),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null) as { error?: string } | null
        return { ok: false, motivo: b?.error ?? `il server ha risposto ${res.status}` }
      }
      return { ok: true, rows: invio.rows.length }
    } catch {
      // Offline: non si accoda e non si ritenta. Il prossimo turno rimanda la stessa
      // finestra, e la finestra è larga tre giorni proprio per questo.
      return { ok: false, motivo: 'server non raggiungibile' }
    }
  }

  /** Tutto lo storico, la prima volta, a pezzi da novanta giorni. */
  async function primoInvio(): Promise<EsitoSync> {
    const snaps = [...d.snapshots()]
    let piuVecchio = ora()
    for (const s of snaps) for (const t of s.turns) if (t.startedAt < piuVecchio) piuVecchio = t.startedAt
    let rows = 0
    // A passi di giorni interi, e senza sovrapposizioni: due pezzi che condividessero
    // un giorno farebbero cancellare al secondo ciò che il primo ha appena scritto.
    const oggi = mezzanotte(ora())
    for (let da = mezzanotte(piuVecchio); da <= oggi; da = piuGiorni(da, PASSO_STORICO)) {
      const a = Math.min(piuGiorni(da, PASSO_STORICO - 1), oggi)
      const esito = await manda(await costruisci(da, a))
      // Un pezzo fallito ferma il primo invio senza scrivere il segno: si riprova
      // tutto la volta dopo. È accettabile perché succede una volta sola, e perché
      // un segno scritto a metà lascerebbe uno storico monco che nessuno rimanda più.
      if (!esito.ok) return esito
      rows += esito.rows
    }
    writeFileSync(segnoStorico(d.home), `${new Date().toISOString()}\n`, { mode: 0o600 })
    return { ok: true, rows }
  }

  async function sincronizza(): Promise<EsitoSync> {
    if (!d.accesa()) return { ok: false, motivo: 'sincronizzazione spenta' }
    if (inCorso) return { ok: false, motivo: 'invio già in corso' }
    inCorso = true
    try {
      if (!existsSync(segnoStorico(d.home))) return await primoInvio()
      const oggi = mezzanotte(ora())
      return await manda(await costruisci(piuGiorni(oggi, -(FINESTRA_GIORNI - 1)), oggi))
    } finally {
      inCorso = false
      ultimoInvio = ora()
    }
  }

  function turnoFinito(): void {
    if (!d.accesa()) return
    sporco = true
    const passato = ora() - ultimoInvio
    if (passato >= collasso) { void scarica(); return }
    // Dentro la finestra di collasso: si arma **un** timer, non uno per turno.
    if (timer) return
    timer = setTimeout(() => { timer = undefined; void scarica() }, collasso - passato)
    timer.unref?.()
  }

  async function scarica(): Promise<void> {
    if (!sporco) return
    sporco = false
    // L'esito non si propaga a nessuno di proposito: questo è un effetto collaterale
    // di un turno finito, e un utente che ha appena letto una risposta non deve
    // vedersi comparire un errore di rete su una cosa che non ha chiesto. Se è andata
    // male lo dirà la schermata Usage, che è dove uno guarda.
    await sincronizza()
  }

  async function leggi(periodo: { from?: number; to?: number }): Promise<unknown | null> {
    const url = cloudUrl()
    const token = tokenCloud(d.home)
    if (!url || !token) return null
    // I giorni si tagliano **qui**, nel fuso di questa macchina, e si mandano come
    // `YYYY-MM-DD`: il `day` di una riga è il giorno di chi ha lavorato, e rifare il
    // taglio sul VPS darebbe una seconda verità su cosa sia «oggi».
    const q = new URLSearchParams()
    if (periodo.from !== undefined) q.set('from', giorno(periodo.from))
    if (periodo.to !== undefined) q.set('to', giorno(periodo.to))
    try {
      const res = await fetch(`${url}/api/usage?${q}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  return { turnoFinito, sincronizza, leggi }
}
