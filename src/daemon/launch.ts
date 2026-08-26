// Aprire un link con l'app dedicata invece che nel browser (F1, Notion, 25 agosto
// 2026) — verificato dal vivo il 26 agosto, non dedotto dallo schema di un URL.
//
// La domanda che contava non era «si può riscrivere `https://` in `notion://`»
// (quello è ovvio): era **cosa succede quando l'app non c'è**. Su Windows un
// protocollo non registrato non torna un errore a chi lancia `start` — fallisce in
// silenzio, o mostra un dialogo di sistema che il processo chiamante non vede mai.
// Per questo si **controlla prima**, nel registro (`HKCR\<schema>`), invece di
// tentare e sperare: è lo stesso motivo per cui F3 controlla `existsSync` prima di
// aprire un gestore di file.
//
// Perimetro volutamente stretto: solo gli schemi in `SCHEMES_NOTI` qui sotto. Non è
// «lancia qualunque protocollo il client chieda» — sarebbe un primitivo più potente
// di quanto la funzione richieda, ed è il genere di cosa che si allarga con
// attenzione, un servizio alla volta, non passando uno schema arbitrario dal client.

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)

const WSL = (() => {
  try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')) } catch { return false }
})()

/** Gli unici schemi che questa rotta sa aprire. Aggiungerne uno è una riga qui, non
 *  un permesso nuovo da concedere al client. */
export const SCHEMES_NOTI = new Set(['notion'])

export type LaunchResult = { ok: true } | { ok: false; error: string }

/**
 * C'è un'app registrata per `scheme` su questa macchina? Controllato **prima** di
 * lanciare, non dedotto dall'esito del lancio — vedi l'intestazione del file.
 */
async function hasHandler(scheme: string): Promise<boolean> {
  try {
    if (WSL) {
      // Verificato dal vivo (26 agosto 2026): uno schema non registrato fa uscire
      // `reg.exe` con codice 1 e un messaggio d'errore chiaro; uno registrato (letto
      // «notion», presente sulla macchina di prova) esce con 0.
      await run('reg.exe', ['query', `HKCR\\${scheme}`])
      return true
    }
    if (process.platform === 'darwin') {
      // Non verificato dal vivo — nessuna delle due macchine reali è macOS.
      // `open` da solo non basta a *controllare* senza lanciare, quindi qui si
      // tenta e si giudica dall'esito: meno solido del ramo WSL, e va detto.
      return true
    }
    // Linux nativo: `xdg-mime` è lo standard per questa domanda. Stdout vuoto vuol
    // dire nessun gestore — non verificato con un vero gestore installato (nessuna
    // delle due macchine reali ne ha uno per schemi come `notion`), ma il comando e
    // la sua sintassi sono quelli documentati dallo standard freedesktop.
    const { stdout } = await run('xdg-mime', ['query', 'default', `x-scheme-handler/${scheme}`])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Apre `url` con l'app dedicata. `scheme` deve essere in `SCHEMES_NOTI`: chi chiama
 * (la rotta HTTP) lo controlla comunque, ma questa funzione non si fida da sola —
 * due controlli costano una riga, un controllo saltato costa un buco.
 */
export async function openApp(url: string, scheme: string): Promise<LaunchResult> {
  if (!SCHEMES_NOTI.has(scheme)) return { ok: false, error: 'unknown scheme' }
  if (!(await hasHandler(scheme))) {
    return { ok: false, error: `no app registered for ${scheme}:// on this machine` }
  }
  try {
    if (WSL) {
      // `cwd` **deve** essere un percorso Windows nativo: lanciato dalla cwd del
      // daemon (un percorso WSL, `\\wsl.localhost\…`), `cmd.exe` si lamenta di UNC
      // non supportati e la riga di comando non parte — verificato dal vivo, non
      // dedotto. `/mnt/c/Windows` esiste su ogni macchina Windows dietro WSL.
      //
      // Il titolo vuoto (`''`, non la stringa `'""'`) è l'argomento esatto provato
      // dal vivo: `start` legge il primo argomento fra virgolette come titolo della
      // finestra, e senza un titolo vuoto scambierebbe l'URL per il titolo. Node
      // passa gli argomenti a `execFile` uno per uno senza ricostruire una riga di
      // comando in stile Windows (gira su Linux, non su `win32`): è l'interop di
      // WSL a mettere le virgolette intorno a ciascuno, compreso quello vuoto.
      await run('cmd.exe', ['/c', 'start', '', url], { cwd: '/mnt/c/Windows' })
      return { ok: true }
    }
    if (process.platform === 'darwin') {
      await run('open', [url])
      return { ok: true }
    }
    await run('xdg-open', [url])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}
