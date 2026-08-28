// src/daemon/native-browse.ts
//
// Il Finder di sistema per "New chat" (spec:
// docs/superpowers/specs/2026-08-27-native-folder-picker-design.md). Stessa forma di
// reveal.ts: `execFile` con argomenti come array, mai una stringa di shell, e nessuna
// eccezione che risale al chiamante — un dialogo che non parte è un fastidio
// dell'utente, non un guasto del daemon.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { esegui, CWD_WINDOWS, WIN, WSL } from '../core/platform.ts'


export type NativePickResult = { ok: true; path: string } | { ok: false }

/**
 * Il comando esiste nel PATH di questo processo? Non lancia mai un'eccezione.
 *
 * `where` invece di `which` su Windows nativo: `which` lì non esiste, e chiederlo
 * comunque non darebbe «comando assente» ma un errore su `which` stesso — cioè la
 * risposta giusta per il motivo sbagliato, che regge finché qualcuno non installa
 * Git for Windows e si porta dietro un `which` che risponde di tutt'altro PATH.
 */
export async function commandExists(name: string): Promise<boolean> {
  try {
    await esegui(WIN ? 'where' : 'which', [name])
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
  if (WIN) return true // PowerShell fa parte di Windows dal 7 in poi
  // Su WSL si guarda **il disco**, non il `PATH`: l'interop può esserci benissimo con
  // le cartelle di Windows fuori dal `PATH` di Linux, ed è il caso di questa macchina.
  // Chiederlo solo al `PATH` spegneva il bottone per una ragione che non era vera.
  if (WSL) {
    // Un candidato assoluto trovato su disco basta e avanza; solo se non c'è nessuno si
    // ricade sulla domanda al `PATH`, che è ciò che si faceva sempre e che qui era il
    // difetto.
    if (powershellPath() !== 'powershell.exe') return true
    return commandExists('powershell.exe')
  }
  if (process.platform === 'darwin') return true // osascript è di sistema su macOS
  return commandExists('zenity')
}

/**
 * Dove sta PowerShell, **senza dipendere dal `PATH`**.
 *
 * Questa era la metà del difetto segnalato dall'utente («sembra aprire il finder dentro
 * il terminale»): su WSL l'interop c'è, ma le cartelle di Windows non sono per forza nel
 * `PATH` di Linux — su questa macchina il daemon in esecuzione ne ha **zero** voci
 * `/mnt/c` (letto da `/proc/<pid>/environ`, non dedotto). `commandExists` rispondeva
 * quindi no, il selettore nativo non partiva mai, e restava solo il tree dentro la
 * pagina: cioè un bottone spento per una ragione che non era vera.
 *
 * Il ripiego finale è il nome nudo e non `null`: se nessun candidato esiste su disco,
 * si prova comunque dal `PATH` invece di arrendersi prima di aver tentato — e se non
 * c'è nemmeno lì, a dirlo è `execFile` che fallisce, che è la stessa risposta di prima.
 * Serve anche a tenere le prove indipendenti dalla macchina che le esegue: con un `exec`
 * finto il flusso deve arrivare in fondo comunque.
 *
 * Ricalcolato a ogni chiamata, come `nativeFolderPickerAvailable`: stessa lezione già
 * scritta qui sotto, e qui costa due `existsSync`.
 */
function powershellPath(): string {
  const candidati = WIN
    ? [
        resolve(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        resolve(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'PowerShell/7/pwsh.exe'),
      ]
    : [
        // WSL: la stessa coppia vista attraverso il mount di Windows.
        '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
        '/mnt/c/Program Files/PowerShell/7/pwsh.exe',
      ]
  for (const c of candidati) if (existsSync(c)) return c
  return 'powershell.exe'
}

/**
 * Il PowerShell che apre il dialogo, con `dove` come cartella di partenza (un percorso
 * **Windows**: chi chiama lo traduce se serve). Sta in una funzione perché i due rami
 * che lo usano — Windows nativo e WSL — differiscono solo per come arrivano a quel
 * percorso, e due copie divergerebbero alla prima correzione fatta su una sola.
 *
 * **Il dialogo è quello moderno**, ed è l'altra metà di quanto segnalato dall'utente:
 * `FolderBrowserDialog` è la vecchia finestrella ad albero di Windows XP, non la finestra
 * di Explorer che compare allegando un file. Quella si ottiene solo con `IFileOpenDialog`
 * e il flag `FOS_PICKFOLDERS` — la Common Item Dialog, cioè lo stesso identico dialogo
 * del selettore file del browser, con la barra dei percorsi, la ricerca e i preferiti.
 *
 * Perché serve un pezzo di C# invece di una riga: su .NET Framework — cioè su Windows
 * PowerShell 5.1, quello che c'è **sempre** — `FolderBrowserDialog` non è mai stato
 * riscritto sopra la Common Item Dialog (lo è stato solo da .NET Core 3.0 in poi, cioè
 * in `pwsh`, che invece può non esserci). Non esistendo una via gestita, si dichiara
 * l'interfaccia COM e si chiama quella. I metodi che non servono restano dichiarati come
 * `Unused`: in un vtable conta **l'ordine**, non la firma di ciò che non si invoca — ma
 * toglierli sposterebbe tutti quelli dopo, ed è il modo in cui questa cosa si rompe
 * chiamando silenziosamente il metodo sbagliato.
 *
 * Verificato su un PowerShell 5.1 vero senza aprire nessuna finestra: il tipo compila e
 * `GetOptions` torna `0x1808` (i flag di default veri della Common Item Dialog), che
 * dopo `SetOptions` diventano `0x1868` con `FOS_PICKFOLDERS` acceso. Un vtable
 * disallineato non avrebbe restituito quei valori. Il click resta da fare a mano: una
 * prova automatica non ha il permesso di aprire una finestra addosso a chi non l'ha
 * chiesta.
 *
 * Il ripiego su `FolderBrowserDialog` resta **dentro lo script**, non in un secondo giro:
 * su una macchina dove `Add-Type` non può compilare (nessun compilatore C#, criteri di
 * sicurezza), meglio il dialogo vecchio che nessun dialogo.
 *
 * `-STA` resta obbligatorio: sono dialoghi shell, e senza thread STA la COM rifiuta di
 * mostrarli.
 */
function scriptDialogo(dove: string): string {
  const start = dove.replace(/'/g, "''")
  return [
    "$ErrorActionPreference = 'Stop'",
    'function Moderno($start) {',
    "  Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class StarkPicker {',
    '  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] internal class FileOpenDialogRCW {}',
    '  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    '  internal interface IShellItem {',
    '    void Unused1(); void Unused2();',
    '    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);',
    '    void Unused4(); void Unused5();',
    '  }',
    '  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    '  internal interface IFileOpenDialog {',
    '    [PreserveSig] int Show(IntPtr parent);',
    '    void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex();',
    '    void Advise(); void Unadvise();',
    '    void SetOptions(uint fos);',
    '    void GetOptions(out uint fos);',
    '    void SetDefaultFolder(IShellItem psi);',
    '    void SetFolder(IShellItem psi);',
    '    void GetFolder(out IShellItem ppsi);',
    '    void GetCurrentSelection(); void SetFileName(); void GetFileName();',
    '    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);',
    '    void SetOkButtonLabel(); void SetFileNameLabel();',
    '    void GetResult(out IShellItem ppsi);',
    '    void AddPlace(); void SetDefaultExtension(); void Close(); void SetClientGuid();',
    '    void ClearClientData(); void SetFilter();',
    '    void GetResults(); void GetSelectedItems();',
    '  }',
    '  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]',
    '  internal static extern IShellItem SHCreateItemFromParsingName(string path, IntPtr bc,',
    '    [MarshalAs(UnmanagedType.LPStruct)] Guid iid);',
    '  const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_NOCHANGEDIR = 0x08;',
    '  const uint SIGDN_FILESYSPATH = 0x80058000;',
    '  static readonly Guid IID_IShellItem = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");',
    '  public static string Pick(string start, string title) {',
    '    var d = (IFileOpenDialog)(new FileOpenDialogRCW());',
    '    try {',
    '      uint o; d.GetOptions(out o);',
    '      d.SetOptions(o | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR);',
    '      d.SetTitle(title);',
    '      if (!string.IsNullOrEmpty(start)) {',
    '        try { d.SetFolder(SHCreateItemFromParsingName(start, IntPtr.Zero, IID_IShellItem)); } catch {}',
    '      }',
    '      if (d.Show(IntPtr.Zero) != 0) return null;',
    '      IShellItem res; d.GetResult(out res);',
    '      string p; res.GetDisplayName(SIGDN_FILESYSPATH, out p);',
    '      Marshal.ReleaseComObject(res);',
    '      return p;',
    '    } finally { Marshal.ReleaseComObject(d); }',
    '  }',
    '}',
    "'@",
    "  return [StarkPicker]::Pick($start, 'Choose the project folder')",
    '}',
    'function Vecchio($start) {',
    '  Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '  $f = New-Object System.Windows.Forms.FolderBrowserDialog',
    '  $f.SelectedPath = $start',
    '  if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $f.SelectedPath }',
    '  return $null',
    '}',
    `$start = '${start}'`,
    'try { $scelta = Moderno $start } catch { $scelta = Vecchio $start }',
    'if ($scelta) { Write-Output $scelta }',
  ].join('\n')
}

/**
 * Lo script va a PowerShell **codificato**, non come stringa di comando.
 *
 * `-EncodedCommand` prende base64 di UTF-16LE ed è l'unica forma in cui un blocco di
 * C# con virgolette, parentesi graffe e `@'…'@` attraversa indenne due livelli di
 * quoting — quello di `execFile` e quello dell'interop di WSL, che ricostruisce la riga
 * di comando con regole sue. Con `-Command` basterebbe un apice per farne un'altra cosa.
 */
function argomentiPowershell(script: string): string[] {
  return ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
}

/**
 * Apre il selettore di cartelle nativo, partendo sempre dalla home dell'utente del
 * processo — non dalla cartella già scritta nella casella "Folder", per scelta
 * esplicita (vedi la spec). Annullo, comando assente o qualunque errore tornano
 * `{ ok: false }`, mai un'eccezione: un annullo non è un fallimento del daemon.
 */
export async function pickFolderNative(
  exec: typeof esegui = esegui,
): Promise<NativePickResult> {
  try {
    if (WIN) {
      // Windows nativo: lo stesso dialogo del ramo WSL, senza i due `wslpath` — la home
      // è già un percorso Windows e la risposta pure.
      //
      // Non verificato dal vivo: nessuna delle macchine di sviluppo è Windows nativo.
      const { stdout } = await exec(powershellPath(), argomentiPowershell(scriptDialogo(homedir())))
      const scelta = stdout.trim()
      return scelta ? { ok: true, path: scelta } : { ok: false }
    }
    if (WSL) {
      // `wslpath -w` traduce la home (sia sotto `/mnt/`, DrvFs, sia nativa ext4) nel
      // percorso Windows che `FolderBrowserDialog` sa capire — stessa funzione già
      // usata al contrario in `reveal.ts`.
      const { stdout: winHome } = await exec('wslpath', ['-w', homedir()])
      // La `cwd` è quella di Windows e non quella del daemon: lanciato da un percorso
      // WSL, cioè dalla UNC `\\wsl.localhost\…`, PowerShell si lamenta di UNC non
      // supportate. È lo stesso inciampo già documentato per `cmd.exe` in `launch.ts`,
      // e lì costava che la riga non partisse affatto; qui sporca l'avvio senza motivo.
      const dentroWindows = existsSync(CWD_WINDOWS) ? { cwd: CWD_WINDOWS } : {}
      const { stdout } = await exec(powershellPath(),
        argomentiPowershell(scriptDialogo(winHome.trim())), dentroWindows)
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
