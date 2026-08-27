// Quello che il bot deve ricordare fra un'accensione e l'altra.
//
// Sta in `~/.stark/telegram.json` con `0600`, accanto a `token` e `push.json`, e per la
// stessa ragione: **contiene un segreto**. Chi ha il bot token può mettersi in ascolto
// al posto nostro (`setWebhook`) e leggere tutto quello che STARK manda. Non guidare —
// il suo `chat_id` non è nell'elenco — ma leggere sì, e leggere è già la conversazione.
//
// Non in `settings.json`, che si scrive con la umask normale ed è pensato per le
// preferenze; e nemmeno via `PUT /api/settings`, che è la superficie da cui si
// scriverebbe un segreto passando per il corpo di una richiesta.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Un telefono a cui questo STARK risponde. */
export type Accoppiata = {
  chatId: number
  nome: string
  /** Quando è stata accoppiata, in millisecondi. Si mostra nelle impostazioni. */
  da: number
}

/** L'accoppiamento in corso, se ce n'è uno. Il codice non si conserva: solo il suo hash. */
export type Pairing = {
  hash: string
  scade: number
  tentativi: number
}

export type StatoTelegram = {
  token?: string
  /** Da `getMe`. Serve a mostrare `@nome_bot` e a comporre il link `t.me/…`. */
  username?: string
  /** L'ultimo `update_id` consumato. Senza, un riavvio rilegge o perde aggiornamenti. */
  offset: number
  allow: Accoppiata[]
  pairing?: Pairing
  /** Per chat: su quale sessione si sta scrivendo, e il messaggio appuntato in cima. */
  chats: Record<string, { current?: string; pinned?: number }>
}

const VUOTO: StatoTelegram = { offset: 0, allow: [], chats: {} }

export class Stato {
  #path: string
  #dati: StatoTelegram

  constructor(home: string) {
    this.#path = resolve(home, 'telegram.json')
    this.#dati = leggi(this.#path)
  }

  get dati(): StatoTelegram { return this.#dati }

  /**
   * Modifica e salva in un colpo solo. Non c'è una `salva()` separata di proposito: due
   * chiamate separate sono due occasioni di dimenticare la seconda, e uno stato che sta
   * in memoria ma non su disco si scopre solo al riavvio — cioè quando il telefono
   * accoppiato non è più accoppiato.
   */
  cambia(f: (d: StatoTelegram) => void): void {
    f(this.#dati)
    mkdirSync(dirname(this.#path), { recursive: true })
    writeFileSync(this.#path, JSON.stringify(this.#dati, null, 2), { mode: 0o600 })
    // `writeFileSync` non ripermissiona un file che esiste già: se è nato prima con una
    // umask più larga, resterebbe leggibile. Stessa riga, stessa ragione di `identity.ts`.
    chmodSync(this.#path, 0o600)
  }
}

function leggi(path: string): StatoTelegram {
  if (!existsSync(path)) return { ...VUOTO }
  try {
    const d = JSON.parse(readFileSync(path, 'utf8')) as Partial<StatoTelegram>
    return {
      ...VUOTO,
      ...d,
      // I tre contenitori si normalizzano sempre: un file scritto a mano, o troncato da
      // un disco pieno, non deve far fallire l'avvio del daemon per un `undefined`.
      offset: typeof d.offset === 'number' ? d.offset : 0,
      allow: Array.isArray(d.allow) ? d.allow : [],
      chats: d.chats && typeof d.chats === 'object' ? d.chats : {},
    }
  } catch {
    // Un file illeggibile non si cancella: si ignora. Cancellarlo butterebbe via il bot
    // token e gli accoppiamenti per un errore di parsing che può essere temporaneo.
    console.error('[telegram] telegram.json illeggibile: il bot resta spento finché non lo sistemi')
    return { ...VUOTO }
  }
}
