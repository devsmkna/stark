// «Consenti sempre», scritto dove Claude Code lo va a leggere.
//
// ─── Perche' questo file esiste, che e' la parte che conta ───────────────────
//
// Fino al 27 agosto 2026 STARK non emulava il «sempre»: rimandava indietro una regola
// `addRules` e la scriveva l'SDK (ADR-009), che e' la cosa giusta. **Solo che non
// succedeva quasi mai.** Misurato quel giorno, con quattro giri su sessioni vere:
//
//   | modalita' | hook PreToolUse | chi decide   | la regola viene scritta? |
//   |-----------|-----------------|--------------|--------------------------|
//   | default   | assente         | `canUseTool` | **si'**                  |
//   | default   | presente        | `PreToolUse` | no                       |
//   | auto      | presente        | `PreToolUse` | no                       |
//
// L'hook `PreToolUse` **scavalca `canUseTool`**, e `PreToolUseHookSpecificOutput` non
// ha alcun campo per ricordare qualcosa: solo `permissionDecision`,
// `permissionDecisionReason`, `additionalContext`. L'hook `PermissionRequest`, che nei
// tipi porta `decision.updatedPermissions`, **non scatta mai** (provato con e senza
// `matcher`). E `defer` non e' una via d'uscita.
//
// Ma l'hook e' proprio la strada che STARK usa sempre: in `auto` mode il classificatore
// risolve prima e `canUseTool` non viene chiamata, quindi i toggle dei permessi
// *devono* passare da li' (ADR-008). Conseguenza: ogni volta che una categoria e' su
// «chiedi» — cioe' l'unico caso in cui una card compare davvero — il bottone «Consenti
// sempre» si comportava come «Consenti», **e il journal scriveva `always`**. Una bugia
// su disco, che si scopre solo la volta dopo.
//
// Il Principio 5 dice che STARK non deve poter meno del CLI, e nella TUI il «sempre»
// funziona. Quindi non si toglie il bottone: si scrive la regola.
//
// ─── La regola di condotta, che e' la stessa di `memoria.ts` ─────────────────
//
// Questo e' un file **dell'utente**, non nostro. Non si riscrive: si legge, si aggiunge
// la voce se manca, si riscrive tutto il resto identico. Il formato non e' inventato —
// e' quello che ha scritto l'SDK stesso in una prova con `canUseTool`:
//
//   { "permissions": { "allow": ["Write"] } }

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Dove Claude Code tiene le regole locali di un progetto. */
export const percorsoRegole = (cwd: string): string =>
  resolve(cwd, '.claude', 'settings.local.json')

export type EsitoRegola = {
  path: string
  /** Il soggetto c'era gia': non si e' toccato niente. */
  giaPresente: boolean
  scritto: boolean
  /** Perche' non si e' potuto fare. Detto, non ingoiato. */
  error?: string
}

/**
 * Aggiungi un soggetto all'elenco dei consentiti, senza toccare nient'altro.
 *
 * `soggetto` e' cio' che l'utente ha detto di ricordare: un nome di tool
 * (`Bash`, `Write`), o una forma piu' stretta se un giorno `savable` ne proporra' una.
 * Qui non si interpreta: si scrive.
 */
export function consentiSempre(cwd: string, soggetto: string): EsitoRegola {
  const path = percorsoRegole(cwd)
  try {
    // Un JSON illeggibile NON si sovrascrive: sarebbe cancellare le regole
    // dell'utente per un errore di battitura suo. Si rifiuta e si dice perche'.
    let radice: Record<string, unknown> = {}
    if (existsSync(path)) {
      const grezzo = readFileSync(path, 'utf8').trim()
      if (grezzo.length > 0) {
        const letto: unknown = JSON.parse(grezzo)
        if (typeof letto !== 'object' || letto === null || Array.isArray(letto)) {
          return { path, giaPresente: false, scritto: false, error: 'non è un oggetto JSON' }
        }
        radice = letto as Record<string, unknown>
      }
    }

    const permessi = (typeof radice['permissions'] === 'object' && radice['permissions'] !== null
      ? radice['permissions'] : {}) as Record<string, unknown>
    const consentiti = Array.isArray(permessi['allow']) ? [...permessi['allow'] as unknown[]] : []

    if (consentiti.some(x => x === soggetto)) {
      return { path, giaPresente: true, scritto: false }
    }
    consentiti.push(soggetto)

    // `...radice` e `...permessi` per primi: tutto quello che non ci riguarda passa
    // attraverso identico. È il file di qualcun altro.
    const nuova = { ...radice, permissions: { ...permessi, allow: consentiti } }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(nuova, null, 2) + '\n', 'utf8')
    return { path, giaPresente: false, scritto: true }
  } catch (e) {
    return { path, giaPresente: false, scritto: false, error: String((e as Error).message ?? e) }
  }
}
