// Gli effetti collaterali (§9) per OpenCode: da una parte tool conclusa a
// `file.edited` / `command.executed`.
//
// Sta in un modulo a parte perche' la stessa identica logica serve a due strade:
// lo stream dal vivo (`translate.ts`) e l'importazione di una conversazione gia'
// scritta (`import.ts`). Se divergessero, lo stesso comando mostrerebbe righe
// diverse a seconda che tu l'abbia visto accadere o l'abbia riaperto il giorno
// dopo — e non c'e modo di accorgersene guardando la UI.
//
// Le forme sono misurate sul filo e nel database (che la stessa forma), non lette
// nei tipi: tools/prova-opencode-coda.ts e tools/prova-opencode-import.ts.
//   bash   input {command, description} · output: stringa · metadata {output, exit, truncated}
//   write  input {filePath, content}    · output "Wrote file successfully."
//   edit   input {filePath, oldString, newString} · output "Edit applied successfully."
//
// L'output di bash e' **una sola corrente**: stdout e stderr viaggiano insieme e
// non c'e campo che li distingua, quindi tutto va in stdout e sta scritto qui —
// mettere meta' in stderr sarebbe una separazione inventata.

import type { Hunk, Payload } from '../../core/events.ts'

/** Lo stato di una parte tool: identico dal filo e dal database. */
export type StatoTool = Record<string, unknown>

/**
 * Da una parte tool conclusa al suo effetto canonico, o null se quel tool non ne
 * produce. Le voci non misurate non si indovinano: un tool domani nuovo resta
 * senza effetto finche' qualcuno non lo misura e lo aggiunge qui.
 */
export function effettoTool(tool: string, stato: StatoTool): Payload | null {
  const input = (stato['input'] ?? {}) as Record<string, unknown>
  const metadata = (stato['metadata'] ?? {}) as Record<string, unknown>
  const output = stato['output'] ?? metadata['output']

  if (tool === 'bash') {
    const command = String(input['command'] ?? '')
    if (!command) return null
    // `"(no output)"` non e' l'output del comando: e il segnaposto che il tool
    // mette quando non c'e' niente (misurato). Scriverlo come stdout farebbe
    // credere che il processo abbia stampato quella frase.
    const grezzo = typeof output === 'string' ? output : ''
    return {
      k: 'command.executed',
      command,
      stdout: grezzo === '(no output)' ? '' : grezzo,
      // Una sola corrente, vedi il capoccia del file.
      stderr: '',
      interrupted: false,
      ...(typeof metadata['exit'] === 'number' ? { exitCode: metadata['exit'] } : {}),
    }
  }

  if (tool === 'write' || tool === 'edit') {
    const path = String(input['filePath'] ?? input['path'] ?? '')
    if (!path) return null
    if (tool === 'write') {
      // Stessa trappola di Claude Code (§9): il file nuovo non ha un originale da
      // cui fare il diff, quindi l'hunk si sintetizza dal contenuto — altrimenti
      // il caso piu' comune di tutti mostrerebbe «file modificato» con diff vuoto.
      const content = String(input['content'] ?? '')
      return { k: 'file.edited', path, hunks: [hunkDiAggiunta(content)], created: true }
    }
    const vecchio = String(input['oldString'] ?? '')
    const nuovo = String(input['newString'] ?? '')
    if (!vecchio && !nuovo) return null
    return { k: 'file.edited', path, hunks: [hunkDiSostituzione(vecchio, nuovo)], created: false }
  }

  return null
}

/** §9: hunk di sola aggiunta, sintetizzato quando il file non esisteva. */
function hunkDiAggiunta(content: string): Hunk {
  const lines = content.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return {
    oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length,
    lines: lines.map(l => '+' + l),
  }
}

/**
 * §9: l'hunk di una sostituzione, dalle due stringe che il tool porta.
 *
 * I numeri di riga il filo non li dice — `edit` consegna solo vecchio e nuovo —
 * quindi partono da 1 e valgono come numerazione della porzione, non del file.
 * La vista li usa per accoppiare tolte e aggiunte in righe affiancate, che e'
 * cio' che si legge; le posizioni nel file restano ignote ed e' piu' onesto cosi'
 * che non inventarle.
 */
function hunkDiSostituzione(vecchio: string, nuovo: string): Hunk {
  const tolte = vecchio ? vecchio.split('\n') : []
  const aggiunte = nuovo ? nuovo.split('\n') : []
  return {
    oldStart: 1, oldLines: tolte.length, newStart: 1, newLines: aggiunte.length,
    lines: [...tolte.map(l => '-' + l), ...aggiunte.map(l => '+' + l)],
  }
}
