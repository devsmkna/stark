// Su che macchina stiamo girando, e come si apre una cosa nel programma di sistema.
//
// Questo file nasce dalla terza copia: `launch.ts` (aprire `notion://`) e `reveal.ts`
// (mostrare un file nel gestore) avevano già la stessa costante `WSL`, calcolata allo
// stesso modo, con lo stesso commento. Alla terza — il CLI, che deve aprire il browser
// su `stark up` — la copia diventava il modo normale di fare la cosa, ed è il momento
// in cui una costante duplicata va messa in un posto solo.
//
// Cosa **non** sta qui: la decisione di *cosa* si può aprire. `launch.ts` tiene la sua
// whitelist di schemi perché quella difende una rotta HTTP, cioè un input che arriva
// dalla rete. Qui c'è solo il come, che è conoscenza sull'ambiente e non un permesso.

import { execFile, execFileSync } from 'node:child_process'
import type { ExecFileOptions, ExecFileSyncOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'

/**
 * Lanciare un comando **senza far comparire una finestra**.
 *
 * Su Windows un processo figlio eredita la console del padre; se il padre non ne ha
 * una, il sistema gliene **alloca una nuova, con la sua finestra**. Il daemon di STARK
 * non ha console — nasce con `DETACHED_PROCESS` apposta, per sopravvivere alla
 * chiusura del terminale — quindi ogni comando che lancia si porta dietro un lampo di
 * finestra nera addosso all'utente. `windowsHide` è il flag che lo impedisce
 * (`CREATE_NO_WINDOW`), e su POSIX viene ignorato: nessun ramo per piattaforma.
 *
 * Sta qui, e non ripetuto in ogni chiamata, per la stessa ragione di `WSL`: erano
 * quindici copie della stessa opzione, e la sedicesima l'avrebbe dimenticata. Chi
 * aggiunge un comando nuovo eredita la cura senza doverla conoscere.
 *
 * Trovato dal vivo il 28 agosto 2026 su una macchina Windows nativa: `git.exe` lanciato
 * da `ramoDi()` a fine turno faceva lampeggiare una console a ogni risposta del
 * modello, catturato con `Win32_ProcessStartTrace` (padre `node.exe … stark.ts run`).
 */
const nascondi = <T extends { windowsHide?: boolean }>(o?: T): T =>
  ({ ...((o ?? {}) as T), windowsHide: true })

const runNudo = promisify(execFile)

export const esegui = (file: string, args: readonly string[], options?: ExecFileOptions):
  Promise<{ stdout: string; stderr: string }> =>
  runNudo(file, args, nascondi({ ...options, encoding: 'utf8' as const }))

/** Come `esegui`, ma sincrono: unico caso, il rilevamento Tailscale all'avvio. */
export const eseguiSync = (file: string, args: readonly string[],
  options?: ExecFileSyncOptions): Buffer | string => execFileSync(file, args, nascondi(options))

/** Uso interno di questo file: è `esegui`, sotto un nome più corto. */
const run = esegui

/**
 * WSL si riconosce dal kernel, non dal filesystem: sia il fisso (repo su `/mnt/…`,
 * DrvFs) sia il portatile (repo su ext4 nativo) sono comunque Windows sotto — è per
 * questo che serve un solo controllo, non uno per ciascuna macchina. Calcolato una
 * volta: il kernel sotto un processo non cambia mentre gira.
 */
export const WSL = (() => {
  try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')) } catch { return false }
})()

/**
 * Windows **nativo**, cioè Node che gira su `win32` — non WSL, che è Linux con Windows
 * sotto. Le due cose vanno tenute separate ovunque, e sono mutuamente esclusive: su
 * `win32` non esiste `/proc/version`, quindi `WSL` è già `false` qui.
 *
 * A distinguerle è **come si raggiunge Windows**, non se Windows c'è: da WSL si passa
 * per l'interop (`cmd.exe`, `wslpath`, percorsi da tradurre), da `win32` si chiamano
 * gli stessi programmi diretti, con i percorsi già nella forma giusta.
 */
export const WIN = process.platform === 'win32'

/**
 * Su quale dei quattro siamo, in una parola sola.
 *
 * `WSL` e `WIN` da sole rispondono a «come si raggiunge Windows», che è la domanda di
 * `reveal`/`launch`. Questa risponde a «di che macchina sto parlando all'utente», che è
 * un'altra cosa: serve a scegliere il comando di installazione giusto da mostrare, e a
 * decidere dove cercare un programma. L'ordine conta — WSL è anche `linux`, e Windows
 * nativo non è WSL — quindi si guarda prima il caso più specifico.
 */
export type SistemaOperativo = 'windows' | 'wsl' | 'macos' | 'linux'
export const SO: SistemaOperativo =
  WIN ? 'windows' : WSL ? 'wsl' : process.platform === 'darwin' ? 'macos' : 'linux'

/** La cartella da cui `cmd.exe` accetta di partire — vedi `openInBrowser`. */
export const CWD_WINDOWS = '/mnt/c/Windows'

export type OpenResult = { ok: true } | { ok: false; error: string }

/**
 * Apre `url` nel browser predefinito della macchina.
 *
 * Da usare **solo** con URL che abbiamo costruito noi (`http://127.0.0.1:<porta>/…`):
 * non c'è nessun controllo sullo schema qui dentro, di proposito, perché chi chiama è
 * il CLI e l'unico input è la porta del daemon. Un URL che arriva da un client di rete
 * passa invece da `launch.ts`, che ha la whitelist.
 */
export async function openInBrowser(url: string): Promise<OpenResult> {
  try {
    if (WIN) {
      // Stessa riga del ramo WSL — `start` con il titolo vuoto — ma senza interop e
      // senza `cwd`: qui `cmd.exe` parte già da un percorso Windows, quindi la trappola
      // dell'UNC non esiste. Il titolo vuoto invece resta necessario per la stessa
      // ragione: `start` legge il primo argomento fra virgolette come titolo della
      // finestra, e senza scambierebbe l'URL per il titolo.
      //
      // Non verificato dal vivo: nessuna delle macchine di sviluppo è Windows nativo.
      await run('cmd.exe', ['/c', 'start', '', url])
      return { ok: true }
    }
    if (WSL) {
      // Le due trappole verificate dal vivo su WSL2 (26 agosto 2026), entrambe
      // silenziose se sbagliate:
      //
      // 1. la `cwd` **deve** essere un percorso Windows nativo. Lanciato dalla cartella
      //    del daemon — un percorso WSL, cioè la UNC `\\wsl.localhost\…` — `cmd.exe` si
      //    lamenta di UNC non supportate e la riga non parte affatto.
      // 2. il titolo vuoto (`''`, non la stringa `'""'`) serve perché `start` legge il
      //    primo argomento fra virgolette come titolo della finestra: senza, scambia
      //    l'URL per il titolo e non apre niente.
      await run('cmd.exe', ['/c', 'start', '', url], { cwd: CWD_WINDOWS })
      return { ok: true }
    }
    if (process.platform === 'darwin') {
      // Non verificato dal vivo: nessuna delle due macchine reali è macOS.
      await run('open', [url])
      return { ok: true }
    }
    // Linux nativo. Su una macchina senza sessione grafica `xdg-open` fallisce, ed è
    // giusto che si veda: chi chiama stampa comunque l'indirizzo da copiare a mano.
    await run('xdg-open', [url])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}
