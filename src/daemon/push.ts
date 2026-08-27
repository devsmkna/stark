// Le notifiche sul telefono: il daemon che chiama, invece del browser.
//
// Perché non basta quello che c'era già. La notifica di sistema che STARK mostra dal
// 24 agosto la fa **la pagina**, con `new Notification(...)`: funziona finché quella
// pagina è viva. Su un telefono non lo è quasi mai — a schermo spento, o con Safari in
// secondo piano, nella scheda non gira niente e non c'è nessuno a cui dire «ha finito».
// L'unico modo per avvisare un telefono che non ti sta guardando è il **Web Push**: il
// daemon consegna il messaggio al servizio di push del sistema operativo, e quello
// sveglia un Service Worker che vive anche senza pagina.
//
// Verificato prima di scriverlo, non dedotto: la sonda in `tools/sonda-telefono/` ha
// fatto arrivare un push vero su questo iPhone in ~3s (vedi CLAUDE.md). Questo file è
// quella prova portata dentro il daemon.
//
// Costo accettato, e va detto: il push passa dai server di Apple. Il **contenuto** è
// cifrato da capo a fondo (lo standard lo impone, la chiave sta nell'iscrizione del
// browser e il servizio di push non ce l'ha), ma il *fatto* che una notifica sia
// partita, e quando, esce dalla macchina. È l'unica parte di STARK che non resta
// locale, ed è il prezzo di essere avvisati altrove — chi non lo vuole non si iscrive,
// che è il default: senza un'iscrizione qui non parte niente.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Call } from '../core/calls.ts'
import { perimetro, type Perimetro } from './security.ts'

/** Cosa il browser ci consegna quando si iscrive. La forma è quella dello standard. */
export type Subscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

type Stato = {
  vapid: { publicKey: string; privateKey: string }
  subs: Subscription[]
}

/** Il messaggio che viaggia dentro il push, cifrato. Lo legge `sw.js`. */
export type PushPayload = {
  kind: Call
  title: string
  body: string
  /** L'id della chat: serve al Service Worker per aprire quella giusta al tocco. */
  sessionId: string
}

/**
 * `web-push` fa la crittografia e la firma VAPID al posto nostro. Caricato in modo
 * dinamico e con il fallimento gestito: senza, un `npm install` fatto a metà
 * impedirebbe al daemon di **partire**, e le notifiche sono un di più — devono
 * potersi spegnere da sole senza portarsi dietro tutto il resto.
 */
let webpush: typeof import('web-push') | null = null
try {
  webpush = (await import('web-push')).default as unknown as typeof import('web-push')
} catch {
  console.error('[push] `web-push` non è installato: le notifiche sul telefono restano spente.')
}

export class Push {
  readonly disponibile: boolean
  #path: string
  #stato: Stato

  /**
   * Il perimetro arriva da fuori, dal guard: è **la stessa** decisione, e chiederlo
   * qui una seconda volta significherebbe rileggere l'ambiente e ottenere una risposta
   * diversa da quella che il daemon sta davvero applicando (succede appena qualcuno
   * passa `publicHosts` per parametro, com'è giusto che facciano le prove).
   */
  constructor(home: string, perim: Perimetro = perimetro()) {
    this.#path = resolve(home, 'push.json')
    this.disponibile = webpush !== null

    if (existsSync(this.#path)) {
      this.#stato = JSON.parse(readFileSync(this.#path, 'utf8')) as Stato
    } else {
      // Le chiavi si generano una volta e restano: cambiarle invaliderebbe **tutte**
      // le iscrizioni già date, cioè i telefoni smetterebbero di ricevere senza che
      // nessuno abbia toccato niente sul telefono.
      this.#stato = {
        vapid: webpush ? webpush.generateVAPIDKeys() : { publicKey: '', privateKey: '' },
        subs: [],
      }
      this.#salva()
    }
    if (webpush && this.#stato.vapid.publicKey) {
      webpush.setVapidDetails(soggetto(perim), this.#stato.vapid.publicKey, this.#stato.vapid.privateKey)
    }
  }

  /** La chiave pubblica, l'unica cosa che il browser deve sapere per iscriversi. */
  get chiavePubblica(): string { return this.#stato.vapid.publicKey }

  /** Quanti telefoni sono iscritti adesso. Serve alla UI per dire come sta. */
  get quanti(): number { return this.#stato.subs.length }

  iscrivi(s: Subscription): void {
    // L'`endpoint` è l'identità dell'iscrizione: riscriverla invece di aggiungerne una
    // seconda evita che lo stesso telefono riceva la stessa notifica due volte dopo
    // aver ricaricato la pagina.
    this.#stato.subs = [...this.#stato.subs.filter(x => x.endpoint !== s.endpoint), s]
    this.#salva()
  }

  disiscrivi(endpoint: string): void {
    this.#stato.subs = this.#stato.subs.filter(x => x.endpoint !== endpoint)
    this.#salva()
  }

  /**
   * Manda a tutti i telefoni iscritti. Non lancia mai: un push che fallisce non deve
   * poter fermare il turno che lo ha causato.
   *
   * Le iscrizioni morte si tolgono da sole. `404` e `410` sono la risposta dello
   * standard per «questa iscrizione non esiste più» — succede quando si disinstalla la
   * app dalla schermata Home o si cancellano i dati del sito. Tenerle vorrebbe dire
   * ritentare per sempre verso un telefono che non c'è.
   */
  async manda(p: PushPayload): Promise<void> {
    if (!webpush || this.#stato.subs.length === 0) return
    const corpo = JSON.stringify(p)
    const morte: string[] = []
    await Promise.all(this.#stato.subs.map(async s => {
      try {
        await webpush!.sendNotification(s as never, corpo, { TTL: 300 })
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) morte.push(s.endpoint)
        // Il motivo si scrive: un `403 BadJwtToken` da Apple vuol dire quasi sempre
        // che il `sub` della VAPID non è un dominio vero (è già successo — vedi
        // CLAUDE.md), e senza questa riga sembrerebbe un problema del telefono.
        else console.error(`[push] invio fallito (${code ?? '?'}): ${String((e as Error).message ?? e).slice(0, 200)}`)
      }
    }))
    if (morte.length > 0) {
      this.#stato.subs = this.#stato.subs.filter(x => !morte.includes(x.endpoint))
      this.#salva()
      console.error(`[push] rimosse ${morte.length} iscrizioni morte`)
    }
  }

  #salva(): void {
    mkdirSync(dirname(this.#path), { recursive: true })
    // `0600` come il token, e per lo stesso motivo: la chiave privata VAPID qui dentro
    // permette di mandare notifiche a nome di questo STARK.
    writeFileSync(this.#path, JSON.stringify(this.#stato, null, 2), { mode: 0o600 })
    try { chmodSync(this.#path, 0o600) } catch { /* già nostro */ }
  }
}



/**
 * Il `sub` della VAPID. Non è burocrazia: Apple **valida** che sia un indirizzo o un
 * URL veri e rifiuta il push con `403 BadJwtToken` se è finto — è già costato una
 * sessione di debug su un sintomo che sembrava del telefono (vedi CLAUDE.md).
 * L'hostname sulla tailnet è un dominio vero e ce l'abbiamo già; se Tailscale non c'è,
 * si ripiega su un `mailto:` e lo si dice, perché in quel caso il telefono non è
 * comunque raggiungibile da fuori casa.
 */
export function soggetto(p: Perimetro = perimetro()): string {
  const env = process.env['STARK_VAPID_SUBJECT']
  if (env) return env
  // Il primo host del perimetro, quale che sia la fonte. Se è quello dichiarato con
  // `STARK_PUBLIC_HOST` è pure **il** dominio da cui la PWA è servita, quindi è la
  // risposta più corretta possibile alla domanda «chi manda questa notifica».
  const primo = p.ammessi[0]
  if (primo) return `https://${primo.host}`
  console.error('[push] nessun hostname pubblico: uso un mailto: di ripiego per il `sub` della VAPID.\n'
    + '       Se le notifiche non arrivano sull\'iPhone è quasi certamente questo — imposta\n'
    + '       STARK_VAPID_SUBJECT=mailto:tuo@indirizzo, oppure dichiara il nome pubblico\n'
    + '       in STARK_PUBLIC_HOST (o accendi Tailscale).')
  return 'mailto:stark@localhost'
}

