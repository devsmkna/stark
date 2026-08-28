// Cosa dice Tailscale, adesso.
//
// Serve a una cosa sola: rispondere a «posso usare STARK dal telefono?» con dei **fatti**
// invece che con una guida da leggere. Ogni passo qui sotto è una domanda a cui la
// macchina sa già rispondere — quindi il pannello non spiega cosa fare, mostra cosa
// manca, e le righe si spuntano da sé mentre le fai.
//
// Si rilegge **a ogni richiesta**, mai in cache. È la lezione già scritta per
// `nativeFolderPickerAvailable()`: un `execFile` in più costa pochissimo, una cache
// sbagliata per tutta la vita del processo costerebbe una riga spenta senza motivo dopo
// aver installato qualcosa a daemon acceso. Vale a maggior ragione qui, dove metà dei
// passi li fa l'utente **mentre guarda il pannello**.
//
// Da non confondere con `detectTailnetHost()` in `security.ts`, che invece è in cache di
// proposito: quello decide il **perimetro**, e il perimetro si legge una volta sola
// all'avvio perché è una difesa, non un'informazione.

import { execFile } from 'node:child_process'
import { esegui } from '../core/platform.ts'

// `esegui` invece di un `promisify(execFile)` locale: nasconde la finestra su Windows.
// Vedi `core/platform.ts` — era la stessa opzione dimenticata in quindici punti.
const run = esegui

/** Un passo della checklist. `fatto` è misurato, mai dedotto da quello prima. */
export type Passo = {
  id: 'installato' | 'collegato' | 'https' | 'pubblicato' | 'telefono'
  fatto: boolean
  /** Cosa si è visto: il nome della macchina, quello del telefono, la porta. */
  dettaglio?: string
  /**
   * Se STARK può eseguirlo da sé. I due che non può non sono una mancanza nostra:
   * abilitare i certificati è un'azione sulla console web del tuo account, e installare
   * l'app sul telefono non si fa da qui.
   */
  azione?: 'collega' | 'pubblica'
}

export type StatoTailscale = {
  passi: Passo[]
  /** Tutto pronto: dal telefono si può entrare. */
  pronto: boolean
  /** Il link fisso da aprire dal telefono. C'è appena la macchina ha un nome. */
  url?: string
  host?: string
}

type Peer = { OS?: string; Online?: boolean; DNSName?: string; HostName?: string }

/** Il nome corto di un dispositivo. `HostName` su iPhone è `localhost` — misurato, non
 *  dedotto: il nome vero sta nella prima etichetta del DNS (`iphone-11.…ts.net.`). */
const nomeCorto = (p: Peer): string =>
  (p.DNSName ?? '').split('.')[0] || p.HostName || 'un dispositivo'

async function json(args: string[]): Promise<Record<string, unknown> | null> {
  try { return JSON.parse((await run('tailscale', args, { timeout: 3000 })).stdout) }
  catch { return null }
}

export async function statoTailscale(porta: number): Promise<StatoTailscale> {
  const st = await json(['status', '--json'])
  if (!st) {
    // Nessuna distinzione fra «non installato» e «il demone non risponde»: da fuori è
    // lo stesso passo da fare, e inventare due messaggi diversi vorrebbe dire indovinare
    // quale dei due è.
    return { pronto: false, passi: [{ id: 'installato', fatto: false }] }
  }
  const passi: Passo[] = [{ id: 'installato', fatto: true }]

  const host = (st['Self'] as Peer | undefined)?.DNSName?.replace(/\.$/, '')
  const collegato = st['BackendState'] === 'Running' && !!host
  passi.push({
    id: 'collegato', fatto: collegato,
    ...(collegato ? { dettaglio: host } : { azione: 'collega' as const }),
  })

  // `CertDomains` vuoto vuol dire che i certificati HTTPS non sono abilitati per questa
  // tailnet. È una spunta nella console web dell'account, quindi STARK non la può fare:
  // la può però **vedere**, ed è la differenza fra dire «abilita HTTPS» e dire «HTTPS
  // non è abilitato, ecco dove si abilita».
  const domini = (st['CertDomains'] as string[] | undefined) ?? []
  passi.push({ id: 'https', fatto: domini.length > 0 })

  // Pubblicato: c'è un handler che rimanda alla porta di **questo** daemon. Non basta
  // che `serve` sia acceso — potrebbe servire un'altra cosa, o un'altra porta.
  const serve = await json(['serve', 'status', '--json'])
  const web = (serve?.['Web'] ?? {}) as Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
  const proxy = Object.values(web)
    .flatMap(v => Object.values(v.Handlers ?? {}))
    .map(h => h.Proxy ?? '')
    .find(p => p.includes(`:${porta}`))
  passi.push({
    id: 'pubblicato', fatto: !!proxy,
    ...(proxy ? { dettaglio: proxy } : { azione: 'pubblica' as const }),
  })

  // Il telefono. Un peer con un sistema da telefono **e online**: offline vorrebbe dire
  // che l'app c'è ma è spenta, e da lì STARK non ci arriva comunque.
  const peers = Object.values((st['Peer'] ?? {}) as Record<string, Peer>)
  const tel = peers.find(p => /^(iOS|android)$/i.test(p.OS ?? '') && p.Online === true)
  passi.push({
    id: 'telefono', fatto: !!tel, ...(tel ? { dettaglio: nomeCorto(tel) } : {}),
  })

  return {
    passi,
    pronto: passi.every(p => p.fatto),
    ...(host ? { host, url: `https://${host}/` } : {}),
  }
}

/**
 * Collega questa macchina all'account Tailscale. Non termina finché non hai fatto il
 * login nel browser, quindi **non si aspetta**: si legge la riga con l'indirizzo e la si
 * restituisce, lasciando il comando a correre per conto suo. È lo stesso indirizzo che
 * `tailscale up` stampa in un terminale — qui diventa un link da premere.
 */
export function collega(): Promise<{ ok: boolean; url?: string; error?: string }> {
  return new Promise(resolve => {
    const child = execFile('tailscale', ['up', '--json'], { timeout: 120_000, windowsHide: true }, () => { /* vedi sotto */ })
    let buf = ''
    let risposto = false
    const rispondi = (r: { ok: boolean; url?: string; error?: string }): void => {
      if (risposto) return
      risposto = true
      resolve(r)
    }
    // `--json` stampa un oggetto con `AuthURL` appena ce n'è uno da visitare. Se la
    // macchina era già collegata non c'è nessun URL e il comando finisce da solo: quello
    // non è un errore, è «era già fatto».
    child.stdout?.on('data', (c: Buffer) => {
      buf += c.toString()
      const m = /"AuthURL"\s*:\s*"([^"]+)"/.exec(buf)
      if (m?.[1]) rispondi({ ok: true, url: m[1] })
    })
    child.on('close', code => rispondi(code === 0
      ? { ok: true }
      : { ok: false, error: 'tailscale up non è riuscito — provalo da un terminale per vedere cosa dice' }))
    child.on('error', () => rispondi({ ok: false, error: 'tailscale non è installato su questa macchina' }))
  })
}

/** Pubblica STARK sulla tailnet: TLS terminato da Tailscale, proxy verso il loopback. */
export async function pubblica(porta: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await run('tailscale', ['serve', '--bg', String(porta)], { timeout: 15_000 })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message.split('\n')[0] ?? 'non riuscito' }
  }
}
