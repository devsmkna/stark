// Gli effetti collaterali (§9) e i blocchi del classificatore (§10).
//
// Stanno in un modulo a parte perche la stessa identica logica serve a due strade:
// lo stream dal vivo e l'importazione di un trascritto gia scritto. Se divergessero,
// la stessa Write mostrerebbe un diff diverso a seconda che tu l'abbia vista accadere
// o l'abbia riaperta il giorno dopo — e non c'e modo di accorgersene guardando la UI.

import type { Hunk, Payload } from '../../core/events.ts'
import type { NativeEvent } from './native.ts'

export function toolEffect(
  name: string, input: unknown, rich: NativeEvent, callId: string,
): Payload | null {
  const inp = (input ?? {}) as Record<string, unknown>
  if (name === 'Bash') {
    return {
      k: 'command.executed',
      command: String(inp['command'] ?? ''),
      stdout: String(rich['stdout'] ?? ''),
      stderr: String(rich['stderr'] ?? ''),
      interrupted: rich['interrupted'] === true,
      ...(typeof rich['exitCode'] === 'number' ? { exitCode: rich['exitCode'] } : {}),
      callId,
    }
  }
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
    const path = String(rich['filePath'] ?? inp['file_path'] ?? '')
    if (!path) return null
    const patch = Array.isArray(rich['structuredPatch']) ? rich['structuredPatch'] as Hunk[] : []
    // Trappola verificata (§9): su una Write di un file NUOVO `structuredPatch` e
    // vuoto, perche non c'e un originale da cui fare il diff. Inoltrarlo cosi
    // mostrerebbe "file modificato" con un diff vuoto nel caso piu comune di tutti.
    const created = patch.length === 0
    const hunks = created ? [additionHunk(String(rich['content'] ?? inp['content'] ?? ''))] : patch
    const original = rich['originalFile']
    return {
      k: 'file.edited', path, hunks, created, callId,
      ...(typeof original === 'string' ? { originalFile: original } : {}),
    }
  }
  return null
}

/** §9: hunk di sola aggiunta, sintetizzato quando il file non esisteva. */
export function additionHunk(content: string): Hunk {
  const lines = content.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return {
    oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length,
    lines: lines.map(l => '+' + l),
  }
}

/**
 * Finche l'hook `PermissionDenied` non e verificato (§16.4), il blocco si riconosce
 * dal testo dell'errore. E fragile e sta scritto qui in chiaro proprio per questo:
 * quando l'hook sara verificato, questa funzione sparisce.
 */
export function classifyBlock(text: string): 'classifier' | 'denyRule' | null {
  if (/auto mode classifier/i.test(text)) return 'classifier'
  if (/haven't granted it yet|permission to use .* has been denied/i.test(text)) return 'denyRule'
  return null
}

export function flattenContent(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(x => typeof x?.['text'] === 'string' ? x['text'] : '').join('')
  return ''
}
