// Quali conversazioni nate nel terminale ci sono su questa macchina.
//
// L'elenco lo dà **l'SDK ufficiale** (`listSessions`), non un nostro scandaglio della
// cartella: porta già titolo, primo prompt, cartella, branch, data e dimensione, cioè
// esattamente ciò che la schermata di import mostra. È la regola del progetto — se
// esiste qualcosa di ufficiale e già pronto si preferisce sempre — e qui ha anche una
// resa pratica: quando il formato su disco cambierà, a inseguirlo sarà l'SDK.
//
// Una cosa l'SDK **non** dà: il percorso del file del trascritto. `importTranscript`
// invece parte da lì. Il ponte è il nome del file, che è il `sessionId`, dentro
// `<config>/projects/<progetto>/`. È un dettaglio interno di Claude Code, quindi sta
// qui dentro e da nessun'altra parte; e se un giorno smette di valere, la ricerca non
// trova nulla e l'import lo dice, invece di importare il file sbagliato.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { configDirOf, listProfiles } from './profiles.ts'

/** Una conversazione della CLI, come la si riconosce nell'elenco di import. */
export type TranscriptInfo = {
  sessionId: string
  /** Il titolo scritto dal modello, o quello messo a mano con `/rename`. */
  title: string
  /** La prima frase scritta dall'utente. È **questa** che fa dire «ah, è quella». */
  firstPrompt?: string
  cwd?: string
  branch?: string
  lastModified: number
  sizeBytes?: number
  /** Il file esiste ed è leggibile: senza, l'import non ha da dove partire. */
  path?: string
}

/**
 * Da quanto una conversazione dev'essere ferma perché si possa dire che *non* è in
 * corso in un terminale adesso.
 *
 * È una stima, e va chiamata così: il trascritto registra quando è stato scritto
 * l'ultimo messaggio, non se un processo è ancora aperto. Sbagliare per eccesso di
 * avviso costa una frase in più da leggere; sbagliare per difetto significa non dire
 * a qualcuno che sta per guidare la stessa conversazione da due posti.
 */
export const RECENTE_MS = 5 * 60 * 1000

export function isRecent(info: TranscriptInfo, now = Date.now()): boolean {
  return now - info.lastModified < RECENTE_MS
}

/**
 * Il trascritto con questo id, cercato prima nel profilo dato e poi in tutti gli
 * altri della macchina.
 *
 * Il secondo giro non e' zelo: `CLAUDE_CONFIG_DIR` cambia da progetto a progetto su
 * questa stessa macchina (vedi `profiles.ts`), quindi un id perfettamente valido puo'
 * semplicemente non stare dove il daemon e' partito. Cercarlo solo li' vorrebbe dire
 * rispondere «non esiste» a una conversazione che esiste.
 */
export function findTranscript(
  sessionId: string, configDir?: string,
): { ref: string; profile?: string } | undefined {
  const primo = configDirOf(configDir)
  const qui = transcriptPath(sessionId, primo)
  if (qui) return { ref: qui }
  for (const p of listProfiles(configDir)) {
    if (resolve(p.path) === primo) continue          // gia' provato sopra
    const altrove = transcriptPath(sessionId, p.path)
    // `profile` torna solo qui: dice «non era dove credevi, era in quest'altro»,
    // ed e' l'unico caso in cui chi ha chiesto impara qualcosa che non sapeva.
    if (altrove) return { ref: altrove, profile: resolve(p.path) }
  }
  return undefined
}

function configRoot(configDir?: string): string {
  return configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? resolve(homedir(), '.claude')
}

/**
 * Dove sta il file di una conversazione. Si cerca per nome dentro `projects/` invece
 * di ricostruire il nome della cartella dal percorso del progetto: quella traduzione
 * è una convenzione interna con dei casi limite (percorsi con punti, worktree), e
 * sbagliarla vorrebbe dire non trovare proprio le conversazioni che servono.
 */
export function transcriptPath(sessionId: string, configDir?: string): string | undefined {
  const projects = resolve(configRoot(configDir), 'projects')
  if (!existsSync(projects)) return undefined
  for (const dir of readdirSync(projects)) {
    const candidate = resolve(projects, dir, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Le conversazioni importabili, dalla più recente.
 *
 * `includeProgrammatic: false` toglie le sessioni aperte dagli SDK — comprese quelle
 * che apre STARK stesso. Senza, l'elenco di import proporrebbe di importare ciò che
 * è già dentro STARK, che non vuol dire niente.
 */
export async function listTranscripts(configDir?: string, limit = 60): Promise<TranscriptInfo[]> {
  const root = configRoot(configDir)
  // `listSessions` legge la cartella di configurazione dall'ambiente. Le due macchine
  // non hanno lo stesso `CLAUDE_CONFIG_DIR`, e un processo che guarda nella cartella
  // sbagliata non trova niente e sembra rotto senza motivo apparente.
  const prima = process.env['CLAUDE_CONFIG_DIR']
  process.env['CLAUDE_CONFIG_DIR'] = root
  try {
    const found = await listSessions({ limit, includeProgrammatic: false })
    return found.map(s => {
      const path = transcriptPath(s.sessionId, root)
      return {
        sessionId: s.sessionId,
        title: s.customTitle ?? s.summary ?? s.firstPrompt ?? s.sessionId.slice(0, 8),
        lastModified: s.lastModified,
        ...(s.firstPrompt ? { firstPrompt: s.firstPrompt } : {}),
        ...(s.cwd ? { cwd: s.cwd } : {}),
        // `HEAD` è ciò che git riporta in detached: come branch non dice niente.
        ...(s.gitBranch && s.gitBranch !== 'HEAD' ? { branch: s.gitBranch } : {}),
        ...(s.fileSize !== undefined ? { sizeBytes: s.fileSize }
          : path ? { sizeBytes: statSync(path).size } : {}),
        ...(path ? { path } : {}),
      }
    })
  } finally {
    if (prima === undefined) delete process.env['CLAUDE_CONFIG_DIR']
    else process.env['CLAUDE_CONFIG_DIR'] = prima
  }
}
