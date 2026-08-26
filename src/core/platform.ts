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

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * WSL si riconosce dal kernel, non dal filesystem: sia il fisso (repo su `/mnt/…`,
 * DrvFs) sia il portatile (repo su ext4 nativo) sono comunque Windows sotto — è per
 * questo che serve un solo controllo, non uno per ciascuna macchina. Calcolato una
 * volta: il kernel sotto un processo non cambia mentre gira.
 */
export const WSL = (() => {
  try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')) } catch { return false }
})()

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
