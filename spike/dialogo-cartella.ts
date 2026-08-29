// Cosa manda davvero STARK a PowerShell per aprire il selettore di cartelle.
//
// Serve perche' lo script viaggia in `-EncodedCommand` (base64 di UTF-16LE): guardarlo
// nel sorgente non dice se e' arrivato intero, e un dialogo che non si apre non lascia
// nessuna traccia da leggere. Qui si usa lo stesso seam d'iniezione delle prove — il
// parametro `exec` — per **catturare** la riga di comando vera senza aprire niente.
//
// Costo: zero. Nessun processo Windows parte, nessuna finestra compare.
//
// Cosa ci si fa dopo, su una macchina Windows o WSL, per validare lo script generato
// senza mostrarlo a nessuno (sintassi, compilazione del C#, allineamento del vtable):
//
//   node spike/dialogo-cartella.ts        # scrive /tmp/generato.ps1
//   powershell.exe -NoProfile -STA -Command "
//     \$e=\$null
//     [System.Management.Automation.Language.Parser]::ParseInput(
//       (Get-Content -Raw '<percorso windows>'), [ref]\$null, [ref]\$e) | Out-Null; \$e"
//
// Il click vero resta all'utente: una prova automatica non ha il permesso di aprire una
// finestra addosso a chi non l'ha chiesta.
import { pickFolderNative } from '../src/daemon/native-browse.ts'
import { writeFileSync } from 'node:fs'
const visti: { cmd: string; args: string[]; opts?: unknown }[] = []
const finto = (async (cmd: string, args: string[], opts?: unknown) => {
  visti.push({ cmd, args, ...(opts ? { opts } : {}) })
  if (cmd === 'wslpath' && args[0] === '-w') return { stdout: 'C:\\Users\\david\n', stderr: '' }
  if (cmd === 'wslpath' && args[0] === '-u') return { stdout: '/mnt/c/Progetti\n', stderr: '' }
  return { stdout: 'C:\\Progetti\n', stderr: '' } // la "scelta" del dialogo
}) as never
const r = await pickFolderNative(finto)
console.log('esito:', JSON.stringify(r))
for (const v of visti) {
  const enc = v.args.indexOf('-EncodedCommand')
  console.log(`  ${v.cmd}  ${enc >= 0 ? v.args.slice(0, enc + 1).join(' ') + ' <base64>' : v.args.join(' ')}`
    + (v.opts ? `   cwd=${JSON.stringify((v.opts as { cwd?: string }).cwd)}` : ''))
  if (enc >= 0) {
    writeFileSync('/tmp/generato.ps1', Buffer.from(v.args[enc + 1]!, 'base64').toString('utf16le'))
    console.log(`  → script decodificato in /tmp/generato.ps1 (${v.args[enc + 1]!.length} char di base64)`)
  }
}
