// src/daemon/native-browse.ts
//
// Il Finder di sistema per "New chat" (spec:
// docs/superpowers/specs/2026-08-27-native-folder-picker-design.md). Stessa forma di
// reveal.ts: `execFile` con argomenti come array, mai una stringa di shell, e nessuna
// eccezione che risale al chiamante — un dialogo che non parte è un fastidio
// dell'utente, non un guasto del daemon.

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { WSL } from '../core/platform.ts'

const run = promisify(execFile)

export type NativePickResult = { ok: true; path: string } | { ok: false }

/** Il comando esiste nel PATH di questo processo? Non lancia mai un'eccezione. */
export async function commandExists(name: string): Promise<boolean> {
  try {
    await run('which', [name])
    return true
  } catch {
    return false
  }
}

/**
 * Il meccanismo per il Finder nativo è disponibile su questa macchina, **adesso**.
 * Ricalcolato a ogni chiamata invece che in cache all'avvio: la stessa lezione già
 * scritta per il rilevamento Tailscale (`security.ts`) — una cache calcolata una sola
 * volta resterebbe sbagliata per tutta la vita del processo dopo un'installazione a
 * daemon acceso, e qui il costo di ricontrollare è un solo `execFile` veloce.
 */
export async function nativeFolderPickerAvailable(): Promise<boolean> {
  if (WSL) return commandExists('powershell.exe')
  if (process.platform === 'darwin') return true // osascript è di sistema su macOS
  return commandExists('zenity')
}

/**
 * Apre il selettore di cartelle nativo, partendo sempre dalla home dell'utente del
 * processo — non dalla cartella già scritta nella casella "Folder", per scelta
 * esplicita (vedi la spec). Annullo, comando assente o qualunque errore tornano
 * `{ ok: false }`, mai un'eccezione: un annullo non è un fallimento del daemon.
 */
export async function pickFolderNative(
  exec: typeof run = run,
): Promise<NativePickResult> {
  try {
    if (WSL) {
      // `wslpath -w` traduce la home (sia sotto `/mnt/`, DrvFs, sia nativa ext4) nel
      // percorso Windows che `FolderBrowserDialog` sa capire — stessa funzione già
      // usata al contrario in `reveal.ts`.
      const { stdout: winHome } = await exec('wslpath', ['-w', homedir()])
      // `-STA`: `FolderBrowserDialog` è un dialogo WinForms e richiede un thread STA,
      // altrimenti PowerShell lancia un'eccezione COM prima di mostrare qualunque cosa.
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
        `$f.SelectedPath = '${winHome.trim().replace(/'/g, "''")}'`,
        'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }',
      ].join('\n')
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
      const win = stdout.trim()
      if (!win) return { ok: false } // annullato: nessuna riga in output
      const { stdout: posix } = await exec('wslpath', ['-u', win])
      return { ok: true, path: posix.trim() }
    }
    if (process.platform === 'darwin') {
      // Non verificato dal vivo con un click reale (nessuna prova automatica può
      // pilotare un dialogo nativo di macOS): la sintassi segue la documentazione
      // AppleScript. Annullare fa uscire `osascript` con codice diverso da zero,
      // quindi `execFile` rigetta la promise — catturato sotto come annullo.
      const { stdout } = await exec('osascript', ['-e',
        'POSIX path of (choose folder with prompt "Seleziona una cartella" default location (path to home folder))'])
      const path = stdout.trim()
      return path ? { ok: true, path } : { ok: false }
    }
    // Linux nativo: non verificato dal vivo (nessuna delle macchine di sviluppo lo è).
    // Annullo → `zenity` esce con codice 1 → `execFile` rigetta → catturato sotto.
    const { stdout } = await exec('zenity', ['--file-selection', '--directory', `--filename=${homedir()}/`])
    const path = stdout.trim()
    return path ? { ok: true, path } : { ok: false }
  } catch (e) {
    console.error('[native-browse] pickFolderNative:', e)
    return { ok: false }
  }
}
