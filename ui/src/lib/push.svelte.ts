// Le notifiche che arrivano quando STARK non è aperto.
//
// Sono una cosa **diversa** da `notify.svelte.ts`, e la differenza è tutta qui: quelle
// le fa la pagina, e valgono finché la pagina è viva. Su un telefono non lo è quasi
// mai. Queste le manda il daemon al servizio di push del sistema, che sveglia il
// Service Worker anche a schermo spento — vedi `src/daemon/push.ts`.
//
// Perché è un interruttore a parte e non «le notifiche» in generale: l'iscrizione è
// **di questo dispositivo**, non dell'utente. Accenderle sull'iPhone non deve
// accenderle sul portatile, e spegnere la campanella (che è il volume di questa
// scheda) non deve smettere di avvisarti quando il telefono è in tasca.

const KEY = 'stark.push'

export type StatoPush =
  /** Il browser non ha né Service Worker né push: Safari fuori dalla schermata Home. */
  | 'nonSupportato'
  /** Il daemon non può mandarli (manca `web-push`). */
  | 'nonDisponibile'
  /** Si possono accendere, ma non sono accesi. */
  | 'spente'
  /** Questo dispositivo è iscritto. */
  | 'accese'
  /** Il permesso è stato negato: non si può più chiedere da codice. */
  | 'negato'

/**
 * Da base64url a byte: è la forma in cui `pushManager` vuole la chiave VAPID.
 *
 * Il tipo di ritorno è `ArrayBuffer` e non `Uint8Array` di proposito: TypeScript
 * distingue `Uint8Array<ArrayBufferLike>` (che potrebbe stare su memoria condivisa) da
 * quello su `ArrayBuffer`, e `applicationServerKey` accetta solo il secondo. Restituire
 * direttamente il buffer toglie di mezzo la distinzione invece di zittirla con un cast.
 */
function chiave(b64: string): ArrayBuffer {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

export class PushPhone {
  stato = $state<StatoPush>('spente')
  /** Quanti dispositivi sono iscritti a questo STARK. Serve a dire «anche altrove». */
  iscritti = $state(0)
  /** Perché non si può, quando non si può. Mai una spiegazione inventata da noi. */
  motivo = $state<string | null>(null)

  #auth: () => Record<string, string>

  constructor(auth: () => Record<string, string>) {
    this.#auth = auth
    void this.#init()
  }

  async #init(): Promise<void> {
    // `serviceWorker` manca in contesti non sicuri, e `PushManager` manca su Safari
    // finché il sito non è stato aggiunto alla schermata Home: è un limite di iOS, non
    // nostro, e va detto invece di mostrare un interruttore che non fa niente.
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      this.stato = 'nonSupportato'
      this.motivo = window.matchMedia('(display-mode: standalone)').matches
        ? 'This browser has no push support.'
        : 'On iPhone, notifications only work once STARK is added to the Home Screen: '
          + 'open the Share menu, then “Add to Home Screen”, and open STARK from there.'
      return
    }
    try {
      const r = await fetch('/api/push', { headers: this.#auth() })
      const d = await r.json() as { disponibile: boolean; motivo?: string; iscritti?: number }
      this.iscritti = d.iscritti ?? 0
      if (!d.disponibile) {
        this.stato = 'nonDisponibile'
        this.motivo = d.motivo ?? 'The daemon cannot send push notifications.'
        return
      }
      // La verità su «sono accese» è l'iscrizione che il browser ha davvero, non un
      // flag nostro: cancellare i dati del sito la toglie senza dirlo a nessuno, e un
      // interruttore acceso su un'iscrizione che non esiste è una bugia.
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      this.stato = sub ? 'accese' : (Notification.permission === 'denied' ? 'negato' : 'spente')
      if (sub) localStorage.setItem(KEY, sub.endpoint)
    } catch {
      this.stato = 'nonDisponibile'
      this.motivo = 'The daemon did not answer about notifications.'
    }
  }

  /** Accende: registra il worker, chiede il permesso, si iscrive, lo dice al daemon. */
  async accendi(): Promise<void> {
    try {
      const permesso = await Notification.requestPermission()
      if (permesso !== 'granted') {
        this.stato = permesso === 'denied' ? 'negato' : 'spente'
        return
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const r = await fetch('/api/push', { headers: this.#auth() })
      const { key } = await r.json() as { key: string }
      const sub = await reg.pushManager.subscribe({
        // Obbligatorio e non negoziabile: senza, i browser rifiutano l'iscrizione. È
        // anche una promessa che manteniamo — ogni push che mandiamo mostra qualcosa.
        userVisibleOnly: true,
        applicationServerKey: chiave(key),
      })
      const res = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { ...this.#auth(), 'content-type': 'application/json' },
        body: JSON.stringify(sub),
      })
      const d = await res.json() as { iscritti?: number }
      this.iscritti = d.iscritti ?? this.iscritti
      localStorage.setItem(KEY, sub.endpoint)
      this.stato = 'accese'
    } catch (e) {
      this.motivo = String((e as Error).message ?? e)
      this.stato = 'spente'
    }
  }

  /** Spegne **solo questo dispositivo**: gli altri iscritti continuano a ricevere. */
  async spegni(): Promise<void> {
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      const endpoint = sub?.endpoint ?? localStorage.getItem(KEY)
      if (sub) await sub.unsubscribe()
      if (endpoint) {
        const res = await fetch('/api/push/unsubscribe', {
          method: 'POST', headers: { ...this.#auth(), 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
        const d = await res.json() as { iscritti?: number }
        this.iscritti = d.iscritti ?? 0
      }
      localStorage.removeItem(KEY)
      this.stato = 'spente'
    } catch (e) {
      this.motivo = String((e as Error).message ?? e)
    }
  }

  /** Manda una notifica di prova adesso: fra qui e il telefono ci sono i server di
   *  Apple, la VAPID e la schermata Home, e senza un modo di provarlo si scopre che
   *  non funziona la prima volta che serviva. */
  async prova(): Promise<void> {
    await fetch('/api/push/test', { method: 'POST', headers: this.#auth() })
  }
}
