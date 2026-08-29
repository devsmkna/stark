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
import { existsSync } from 'node:fs'
import { esegui, SO, type SistemaOperativo } from '../core/platform.ts'

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

/**
 * Come si invoca `tailscale` su questa macchina: l'eseguibile, e gli argomenti che
 * vengono prima dei nostri (servono solo quando si attraversa un confine, `wsl.exe --`).
 */
export type ViaTailscale = { cmd: string; pre: string[]; dove: 'host' | 'windows' | 'wsl' }

/**
 * Dove cercare `tailscale`, in ordine di preferenza, **secondo il sistema vero**.
 *
 * Prima si chiedeva solo `tailscale` al `PATH`, che è un caso e non la regola: è la
 * stessa malattia già trovata per `powershell.exe` in `native-browse.ts`, e fallisce allo
 * stesso modo — non con un errore, ma dicendo «non installato» a chi ce l'ha installato.
 * Segnalato dall'utente il 28 agosto 2026.
 *
 * Dove il `PATH` non basta, uno per sistema:
 * - **macOS**: installato dall'App Store la CLI sta **dentro il bundle**
 *   (`/Applications/Tailscale.app/Contents/MacOS/Tailscale`) e nel `PATH` non ci finisce
 *   mai. Col pacchetto standalone o con Homebrew sì, ma in due prefissi diversi a seconda
 *   che il Mac sia Intel (`/usr/local`) o Apple Silicon (`/opt/homebrew`).
 * - **Windows**: l'installer mette `tailscale.exe` sotto `Program Files` e **non**
 *   aggiunge quella cartella al `PATH`.
 * - **WSL e Windows si guardano a vicenda**: chi sta in WSL può averlo dentro Linux *o*
 *   su Windows (raggiungibile da `/mnt/c`), e chi sta su Windows può averlo su Windows
 *   *o* dentro una distro (raggiungibile con `wsl.exe --`). Si provano entrambi, **il
 *   nativo per primo**: è quello il cui `serve` punta al loopback su cui STARK sta
 *   davvero ascoltando.
 * - **Linux**: oltre ai due prefissi soliti, `snap` ha il suo.
 *
 * I percorsi assoluti si tengono solo se esistono — il filesystem risponde gratis, un
 * `execFile` andato a vuoto costa un processo e un timeout. I nomi nudi restano sempre:
 * il `PATH` è comunque la via normale, e arrendersi prima di averla provata sarebbe la
 * stessa cosa che si sta correggendo.
 */
export function vieTailscale(): ViaTailscale[] {
  const assoluto = (c: string): boolean => c.includes('/') || c.includes('\\')
  // I percorsi assoluti si tengono solo se esistono — il filesystem risponde gratis,
  // mentre un `execFile` andato a vuoto costa un processo e un timeout. I nomi nudi
  // restano sempre: il `PATH` è comunque la via normale, e arrendersi prima di averla
  // provata sarebbe la stessa cosa che si sta correggendo.
  return vieTailscalePer(SO).filter(v => !assoluto(v.cmd) || existsSync(v.cmd))
}

/**
 * L'elenco per un sistema **dichiarato**, senza guardare il disco: è la parte che si può
 * provare: quale sistema guarda dove, e in quale ordine. `vieTailscale()` ci applica
 * sopra il sistema vero e il filtro sull'esistenza — cioè le due cose che dipendono
 * dalla macchina che esegue, e che in una prova renderebbero il risultato diverso a
 * seconda di chi la lancia (difetto già visto qui con il `sub` della VAPID).
 */
export function vieTailscalePer(so: SistemaOperativo): ViaTailscale[] {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  return (
    so === 'windows' ? [
      { cmd: `${pf}\\Tailscale\\tailscale.exe`, pre: [], dove: 'windows' },
      { cmd: `${pf86}\\Tailscale\\tailscale.exe`, pre: [], dove: 'windows' },
      { cmd: 'tailscale.exe', pre: [], dove: 'windows' },
      // `wsl.exe` esiste solo se la feature è installata: la sua assenza è già la
      // risposta, e non serve chiedere altro.
      { cmd: 'wsl.exe', pre: ['--', 'tailscale'], dove: 'wsl' },
    ] : so === 'wsl' ? [
      { cmd: '/usr/bin/tailscale', pre: [], dove: 'host' },
      { cmd: '/usr/local/bin/tailscale', pre: [], dove: 'host' },
      { cmd: 'tailscale', pre: [], dove: 'host' },
      { cmd: '/mnt/c/Program Files/Tailscale/tailscale.exe', pre: [], dove: 'windows' },
    ] : so === 'macos' ? [
      { cmd: '/usr/local/bin/tailscale', pre: [], dove: 'host' },
      { cmd: '/opt/homebrew/bin/tailscale', pre: [], dove: 'host' },
      { cmd: '/Applications/Tailscale.app/Contents/MacOS/Tailscale', pre: [], dove: 'host' },
      { cmd: 'tailscale', pre: [], dove: 'host' },
    ] : [
      { cmd: '/usr/bin/tailscale', pre: [], dove: 'host' },
      { cmd: '/usr/local/bin/tailscale', pre: [], dove: 'host' },
      { cmd: '/snap/bin/tailscale', pre: [], dove: 'host' },
      { cmd: 'tailscale', pre: [], dove: 'host' },
    ]
  )
}

async function jsonDa(via: ViaTailscale, args: string[]): Promise<Record<string, unknown> | null> {
  try { return JSON.parse((await run(via.cmd, [...via.pre, ...args], { timeout: 3000 })).stdout) }
  catch { return null }
}

/**
 * La prima via che **risponde davvero**, non la prima che esiste: un eseguibile c'è anche
 * quando il suo servizio è spento, e su una macchina con Tailscale sia dentro WSL sia su
 * Windows a decidere dev'essere quello dei due che sta parlando.
 *
 * Restituisce anche lo `status` già letto: è la stessa domanda, e chiederla due volte
 * vorrebbe dire pagare due processi per sapere la stessa cosa.
 */
export async function viaAttiva(): Promise<{ via: ViaTailscale; status: Record<string, unknown> } | null> {
  for (const via of vieTailscale()) {
    const status = await jsonDa(via, ['status', '--json'])
    if (status) return { via, status }
  }
  return null
}

export async function statoTailscale(porta: number): Promise<StatoTailscale> {
  const attiva = await viaAttiva()
  const st = attiva?.status
  if (!st || !attiva) {
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
  // Sulla **stessa via** che ha risposto a `status`: con Tailscale sia dentro WSL sia su
  // Windows, chiedere `serve` all'altro racconterebbe di un altro nodo.
  const serve = await jsonDa(attiva.via, ['serve', 'status', '--json'])
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
export async function collega(): Promise<{ ok: boolean; url?: string; error?: string }> {
  // La via si risolve qui invece di dare per scontato un `tailscale` nel `PATH`. Se non
  // risponde da nessuna parte non c'è nemmeno un eseguibile da lanciare, e dirlo adesso
  // è meglio che tradurre un `ENOENT` in un messaggio che incolpa la cosa sbagliata.
  const attiva = await viaAttiva()
  const via = attiva?.via ?? vieTailscale()[0]
  if (!via) return { ok: false, error: 'tailscale non è installato su questa macchina' }
  return new Promise(resolve => {
    const child = execFile(via.cmd, [...via.pre, 'up', '--json'], { timeout: 120_000, windowsHide: true }, () => { /* vedi sotto */ })
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
    const attiva = await viaAttiva()
    if (!attiva) return { ok: false, error: 'tailscale non risponde su questa macchina' }
    await run(attiva.via.cmd, [...attiva.via.pre, 'serve', '--bg', String(porta)], { timeout: 15_000 })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message.split('\n')[0] ?? 'non riuscito' }
  }
}
