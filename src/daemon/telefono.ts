// Collegare un telefono a questo STARK, senza portarsi dietro il token.
//
// Il problema che risolve. Fino a oggi il telefono entrava con l'indirizzo lungo,
// `https://<macchina>.ts.net/?token=<64 caratteri>`: un segnalibro che non si può dettare
// né riscrivere a mano, che finisce nella cronologia, e che va rifatto ogni volta che il
// token cambia. Adesso il telefono ha un **link fisso** — il nome della macchina, e basta
// — e ci si entra con un **codice di 8 caratteri** letto dallo schermo del computer.
//
// È lo stesso accoppiamento del bot Telegram (`telegram/index.ts`), e di proposito: 8
// caratteri senza `0/O` e `1/I/L`, cinque minuti, un uso solo, tre tentativi, del codice
// si conserva solo l'impronta, e il confronto è a tempo costante. Non è stato reinventato
// perché era già stato pensato una volta, e due meccanismi di accoppiamento che divergono
// sono due superfici da rivedere invece di una.
//
// La differenza che conta rispetto a Telegram: qui la pagina in cui si scrive il codice
// deve essere raggiungibile **senza credenziale**, se no non ci sarebbe modo di darne una.
// Per questo `codiceVivo()` esiste: quella pagina non è sempre accesa, esiste solo nei
// cinque minuti dopo che hai premuto il bottone. Fuori da quella finestra il link fisso
// risponde 403 esattamente come oggi, e la superficie non autenticata semplicemente non
// c'è. Decisione dell'utente, 28 agosto 2026.
//
// Il dispositivo, una volta entrato, resta collegato **finché non lo togli tu** (stessa
// decisione, e chiude la domanda aperta §5 di CLAUDE.md: «che durata deve avere la
// credenziale sul telefono»). Un telefono viene chiuso e riaperto dal sistema di
// continuo, e una credenziale che scade è una credenziale che ti chiude fuori proprio
// quando il computer non ce l'hai davanti. In cambio le impostazioni mostrano l'elenco
// dei dispositivi collegati, con quando sono entrati e un bottone per revocarli: la
// revoca è la difesa, non la scadenza.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Niente 0/O e 1/I/L: un codice si legge da uno schermo e si ribatte su un telefono. */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const DURA = 5 * 60_000
const TENTATIVI = 3

/** Un telefono che è entrato. Del suo token si tiene l'impronta, mai il token. */
export type Dispositivo = {
  id: string
  hash: string
  /** Come si chiama nell'elenco. Ricavato dallo user agent: è l'unica cosa che il
   *  telefono dice di sé senza che nessuno debba digitarla. */
  nome: string
  da: number
  /** Ultima volta che è stato visto. Serve a riconoscere quale revocare. */
  visto: number
}

type Dati = {
  pairing?: { hash: string; scade: number; tentativi: number }
  devices: Dispositivo[]
}

const VUOTO: Dati = { devices: [] }

export class Telefono {
  #path: string
  #dati: Dati = { ...VUOTO }

  constructor(home: string) {
    this.#path = resolve(home, 'telefono.json')
    this.#leggi()
  }

  // ── il codice ─────────────────────────────────────────────────────────────

  /**
   * Apre una finestra di cinque minuti. Chi chiama ha già il token di STARK: questa
   * rotta sta dietro il guard come tutte le altre — è quella *dopo* a non starci.
   */
  apri(): { codice: string; scade: number } {
    let codice = ''
    const b = randomBytes(8)
    for (let i = 0; i < 8; i++) codice += ALFABETO[(b[i] ?? 0) % ALFABETO.length]
    const scade = Date.now() + DURA
    this.#cambia(d => { d.pairing = { hash: impronta(codice), scade, tentativi: 0 } })
    return { codice, scade }
  }

  /** Quanto resta, o `null`. È **questo** che apre la pagina del codice al telefono:
   *  senza un codice vivo quella pagina non esiste e il perimetro non si allarga. */
  codiceVivo(): { scade: number } | null {
    const p = this.#dati.pairing
    if (!p) return null
    if (Date.now() > p.scade) { this.#cambia(d => { delete d.pairing }); return null }
    return { scade: p.scade }
  }

  annulla(): void { this.#cambia(d => { delete d.pairing }) }

  /**
   * Il telefono manda il codice e riceve la propria credenziale.
   *
   * Un codice sbagliato consuma un tentativo, e al terzo la finestra si chiude: se no
   * cinque minuti basterebbero a provarli tutti. Non si dice mai *quanti* ne restano a
   * chi sbaglia — quello lo sa il computer, che è dove sta la persona autorizzata.
   */
  riscatta(codice: string, agente: string): { ok: true; token: string } | { ok: false; error: string } {
    const p = this.#dati.pairing
    if (!p) return { ok: false, error: 'no active code' }
    if (Date.now() > p.scade) { this.annulla(); return { ok: false, error: 'expired code' } }
    if (!pari(impronta(codice.trim().toUpperCase()), p.hash)) {
      this.#cambia(d => {
        if (!d.pairing) return
        d.pairing.tentativi++
        if (d.pairing.tentativi >= TENTATIVI) delete d.pairing
      })
      return { ok: false, error: 'wrong code' }
    }
    const token = randomBytes(32).toString('hex')
    const dev: Dispositivo = {
      id: randomBytes(8).toString('hex'),
      hash: impronta(token),
      nome: nomeDa(agente),
      da: Date.now(),
      visto: Date.now(),
    }
    // Un uso solo: il codice muore appena è servito, non alla scadenza.
    this.#cambia(d => { delete d.pairing; d.devices.push(dev) })
    return { ok: true, token }
  }

  // ── i dispositivi ─────────────────────────────────────────────────────────

  /**
   * Questo token è di un telefono collegato? Chiamata a ogni richiesta, quindi niente
   * di più caro di un hash — ed è il motivo per cui i token dei dispositivi sono hash e
   * non chiavi firmate: verificarli non deve costare.
   */
  riconosce(token: string): boolean {
    if (token.length !== 64) return false
    const h = impronta(token)
    const dev = this.#dati.devices.find(d => pari(d.hash, h))
    if (!dev) return false
    // «Ultima volta visto» si aggiorna al massimo una volta all'ora: serve a riconoscere
    // quale riga revocare, non a fare un registro degli accessi — e scrivere su disco a
    // ogni richiesta di ogni sottorisorsa sarebbe un file riscritto cento volte al minuto.
    if (Date.now() - dev.visto > 3_600_000) this.#cambia(d => {
      const x = d.devices.find(y => y.id === dev.id)
      if (x) x.visto = Date.now()
    })
    return true
  }

  /**
   * Di quale dispositivo è questa credenziale, se di uno. `null` quando chi chiede usa il
   * **token della macchina**: quello non appartiene a nessun telefono e non si revoca.
   *
   * Serve alla UI per una cosa sola, ma che senza è impossibile: dire «questo sei tu» nel
   * proprio elenco. Senza, dal telefono si vedono N righe uguali e l'unico modo di
   * scollegarsi è indovinare quale riga è la propria.
   */
  idDi(token: string): string | null {
    if (token.length !== 64) return null
    const h = impronta(token)
    return this.#dati.devices.find(d => pari(d.hash, h))?.id ?? null
  }

  get dispositivi(): Omit<Dispositivo, 'hash'>[] {
    return this.#dati.devices.map(({ hash: _h, ...resto }) => resto)
  }

  revoca(id: string): boolean {
    const c = this.#dati.devices.length
    this.#cambia(d => { d.devices = d.devices.filter(x => x.id !== id) })
    return this.#dati.devices.length < c
  }

  // ── disco ─────────────────────────────────────────────────────────────────

  #leggi(): void {
    try {
      if (!existsSync(this.#path)) return
      const letto = JSON.parse(readFileSync(this.#path, 'utf8')) as Partial<Dati>
      this.#dati = { devices: Array.isArray(letto.devices) ? letto.devices : [], ...(letto.pairing ? { pairing: letto.pairing } : {}) }
    } catch {
      // Un file illeggibile non fa cadere l'avvio e **non si sovrascrive**: dentro ci
      // sono i telefoni che l'utente ha collegato, e riscriverli a vuoto vorrebbe dire
      // scollegarli tutti per un errore di parsing che può essere temporaneo. Stessa
      // condotta di `telegram/stato.ts`.
      this.#dati = { ...VUOTO }
    }
  }

  #cambia(f: (d: Dati) => void): void {
    f(this.#dati)
    try {
      mkdirSync(dirname(this.#path), { recursive: true })
      writeFileSync(this.#path, JSON.stringify(this.#dati, null, 2))
      // `0600` come il token e `push.json`: qui dentro ci sono le impronte delle
      // credenziali dei telefoni collegati.
      chmodSync(this.#path, 0o600)
    } catch { /* disco pieno o sola lettura: in memoria resta giusto */ }
  }
}

const impronta = (s: string): string => createHash('sha256').update(s).digest('hex')

/** A tempo costante, come il token in `security.ts`: un `===` perde un carattere alla volta. */
function pari(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Un nome leggibile per l'elenco dei dispositivi. Non è riconoscimento del dispositivo e
 * non decide niente: è l'etichetta che permette di capire **quale** riga revocare, e
 * l'unica cosa che il telefono dice di sé senza che nessuno debba digitarla.
 */
function nomeDa(ua: string): string {
  const s = ua || ''
  const sistema = /iPhone/i.test(s) ? 'iPhone'
    : /iPad/i.test(s) ? 'iPad'
    : /Android/i.test(s) ? 'Android'
    : /Macintosh/i.test(s) ? 'Mac'
    : /Windows/i.test(s) ? 'Windows'
    : 'Dispositivo'
  // L'ordine conta: ogni browser su iOS scrive «Safari» in fondo allo user agent, quindi
  // Safari va cercato per ultimo o si mangerebbe Chrome ed Edge.
  const browser = /EdgiOS|Edg\//i.test(s) ? 'Edge'
    : /CriOS|Chrome/i.test(s) ? 'Chrome'
    : /FxiOS|Firefox/i.test(s) ? 'Firefox'
    : /Safari/i.test(s) ? 'Safari'
    : null
  return browser ? `${sistema} · ${browser}` : sistema
}
