// Arrivare a un file citato in chat, invece di lasciarlo un percorso da copiare a
// mano (F3, Notion, 25 agosto 2026). Versione minima, esplicitamente sancita lì:
// **aprire il gestore di file del sistema sulla cartella giusta, col file
// selezionato** quando l'ambiente lo consente — non serve che STARK sappia qual è
// l'editor preferito, e non è la stessa cosa di «aprire la cartella»: sono comandi
// diversi su tutti e tre i sistemi, e la specifica chiede il primo, non il secondo.
//
// Non allarga il perimetro di STARK: il daemon esegue già comandi arbitrari come
// root sulla macchina (ADR-002 — «web app locale», non un sandbox). Sta dietro le
// stesse quattro difese di ogni altra rotta (token, `Origin`, `Host`, bind su
// loopback): è comodo aggiungerla «al volo» fuori da quella guardia, ed è così che
// si buca un perimetro che regge — qui non succede, la rotta passa dallo stesso
// `route()` di `server.ts`.
//
// `execFile`, non `exec`: gli argomenti viaggiano come array, mai come stringa di
// shell, quindi un percorso con spazi o caratteri strani non è un'iniezione — è
// solo un argomento.

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
// `WSL` sta in `core/platform.ts`: era la stessa costante, con lo stesso commento,
// anche in `launch.ts` e serviva a un terzo posto (il CLI, per aprire il browser).
import { esegui, WIN, WSL } from '../core/platform.ts'


export type RevealResult = { ok: true } | { ok: false; error: string }

/**
 * Rivela `path` nel gestore di file della macchina. Non lancia mai un errore: un
 * gestore di file che non parte non deve far cadere il daemon, è un fastidio
 * dell'utente, non un guasto di STARK.
 */
export async function reveal(path: string): Promise<RevealResult> {
  const p = resolve(path)
  if (!existsSync(p)) return { ok: false, error: 'file not found on this machine' }

  try {
    if (WIN) {
      // Windows nativo: `resolve()` ha già dato un percorso Windows, quindi non c'è
      // niente da tradurre — è tutto il ramo WSL meno `wslpath`. Resta identico il
      // motivo per cui l'esito si ignora: `explorer.exe /select,` esce con un codice
      // diverso da zero **anche quando ha funzionato**, ed è un comportamento noto
      // dell'eseguibile, non un errore di STARK.
      //
      // Non verificato dal vivo: nessuna delle macchine di sviluppo è Windows nativo.
      await esegui('explorer.exe', [`/select,${p}`]).catch(() => { /* vedi sopra */ })
      return { ok: true }
    }
    if (WSL) {
      // `wslpath -w` traduce da solo sia un percorso sotto `/mnt/` (DrvFs, come sul
      // fisso) sia uno nativo ext4 (come sul portatile, verificato il 26 agosto
      // 2026: dà `\\wsl.localhost\<distro>\…`, la forma corrente — non serve
      // distinguere i due casi a mano, lo fa `wslpath`. `explorer.exe /select,`
      // torna quasi sempre con un codice diverso da zero **anche quando ha
      // funzionato** — verificato dal vivo, è un comportamento noto dell'eseguibile
      // stesso, non un errore di STARK — quindi non si tratta un suo fallimento
      // come un fallimento nostro.
      const { stdout } = await esegui('wslpath', ['-w', p])
      const win = stdout.trim()
      await esegui('explorer.exe', [`/select,${win}`]).catch(() => { /* vedi sopra */ })
      return { ok: true }
    }
    if (process.platform === 'darwin') {
      await esegui('open', ['-R', p])
      return { ok: true }
    }
    // Linux nativo: nessun comando è universale per «selezionare», dipende dal
    // gestore installato — Nautilus (GNOME, il caso più comune) lo sa fare.
    // Non verificato dal vivo su questa macchina (le due reali sono entrambe WSL2):
    // se manca, si scende alla versione minima onestamente disponibile ovunque —
    // aprire la cartella — invece di far finta che «selezionare» sia garantito.
    try {
      await esegui('nautilus', ['--select', p])
    } catch {
      await esegui('xdg-open', [dirname(p)])
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}
