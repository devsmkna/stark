// Quali agent STARK sa guidare, e come si sceglie fra loro.
//
// Questo file e' **l'unico** posto del sistema che nomina un agent specifico. Sopra di
// lui esiste solo `AgentBackend` (`core/adapter.ts`); sotto di lui, una cartella per
// agent. Se un giorno servisse un `if` su quale agent e' in uso **fuori di qui**,
// quello e' il difetto da registrare, non da aggirare — ADR-012, paletto n.1.
//
// Un solo backend elencato non e' una contraddizione con ADR-012: il secondo si sta
// scrivendo, e la ragione per cui questo file nasce **prima** e' che il confine si
// progetta sul codice che gia' esiste. Progettarlo sul secondo adapter mentre lo si
// scrive vorrebbe dire disegnarlo su misura di quello, che e' l'errore opposto e
// identico a quello che ADR-012 esiste per evitare.

import type { AgentBackend, AdapterHooks, SessionSpec } from '../core/adapter.ts'
import { ClaudeCodeAdapter } from './claude-code/adapter.ts'
import { isRecent, listTranscripts } from './claude-code/catalogue.ts'
import { importTranscript } from './claude-code/import.ts'
import { allineaMemoria } from './claude-code/memoria.ts'
import { diagnostics, warmDiagnostics } from './claude-code/profiles.ts'

export const claudeCode: AgentBackend = {
  id: 'claude-code',
  open: (spec: SessionSpec, hooks: AdapterHooks) => new ClaudeCodeAdapter({ ...spec, ...hooks }),
  listConversations: listTranscripts,
  isRecent,
  importConversation: importTranscript,
  diagnostics,
  warmDiagnostics,
  setCommandDescriptions: allineaMemoria,
}

const BACKENDS: Record<string, AgentBackend> = {
  [claudeCode.id]: claudeCode,
}

/**
 * L'agent con cui si apre una conversazione quando nessuno ne chiede uno.
 *
 * E' `claude-code` perche' e' l'unico completo, non perche' sia privilegiato dal
 * modello: il giorno in cui la scelta diventa vera, questa costante e' il posto in cui
 * diventa un'impostazione.
 */
export const DEFAULT_AGENT = claudeCode.id

export function backendFor(agent: string = DEFAULT_AGENT): AgentBackend {
  const b = BACKENDS[agent]
  // Un nome sconosciuto e' un errore del chiamante, e va detto con il nome dentro: chi
  // sbaglia a scriverlo altrimenti si ritrova su Claude Code senza accorgersene, che e'
  // il modo peggiore di fallire — sembra funzionare.
  if (!b) throw new Error(`agent sconosciuto: ${agent}`)
  return b
}

export const agentIds = (): string[] => Object.keys(BACKENDS)
