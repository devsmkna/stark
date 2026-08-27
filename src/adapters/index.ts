// Quali agent STARK sa guidare, e come si sceglie fra loro.
//
// Questo file e' **l'unico** posto del sistema che nomina un agent specifico. Sopra di
// lui esiste solo `AgentBackend` (`core/adapter.ts`); sotto di lui, una cartella per
// agent. Se un giorno servisse un `if` su quale agent e' in uso **fuori di qui**,
// quello e' il difetto da registrare, non da aggirare — ADR-012, paletto n.1.
//
// I backend sono due dal 27 agosto 2026, ed e' il momento in cui il contratto smette
// di essere una promessa. Vale la pena notare quanto sono diversi dietro la stessa
// interfaccia: Claude Code **spawna un processo per conversazione** e lo stato lo tiene
// il nostro journal; OpenCode ha **un server per macchina** con N conversazioni dentro
// e lo stato in un SQLite suo. Chi sta sopra non vede la differenza — che era
// esattamente la domanda di ADR-012.

import { spawn } from 'node:child_process'
import type { AgentBackend, AdapterHooks, SessionSpec } from '../core/adapter.ts'
import type { ModeChoice } from '../core/events.ts'
import { ClaudeCodeAdapter } from './claude-code/adapter.ts'
import { isRecent, listTranscripts } from './claude-code/catalogue.ts'
import { importTranscript } from './claude-code/import.ts'
import { allineaMemoria } from './claude-code/memoria.ts'
import { diagnostics, warmDiagnostics } from './claude-code/profiles.ts'
import { modeChoices } from './claude-code/sdk-options.ts'
import { modiNoti, OpenCodeAdapter } from './opencode/adapter.ts'

export const claudeCode: AgentBackend = {
  id: 'claude-code',
  open: (spec: SessionSpec, hooks: AdapterHooks) => new ClaudeCodeAdapter({ ...spec, ...hooks }),
  modes: async () => modeChoices(),
  listConversations: listTranscripts,
  isRecent,
  importConversation: importTranscript,
  diagnostics,
  warmDiagnostics,
  setCommandDescriptions: allineaMemoria,
}

/**
 * Il secondo adapter (ADR-012/ADR-013). «Quanto basta» a far girare una conversazione
 * con permessi e Stop, non un secondo prodotto.
 *
 * I tre metodi opzionali del contratto restano **non implementati**, e opzionale qui
 * vuol dire davvero «quel fatto non c'e'»: OpenCode non ha conversazioni nate in un
 * terminale a parte da importare (la sua TUI e il suo server leggono lo stesso
 * database, quindi non c'e' niente da portare dentro), e non ha un `CLAUDE.md` globale
 * su cui scrivere una regola per le descrizioni dei comandi.
 */
export const openCode: AgentBackend = {
  id: 'opencode',
  open: (spec: SessionSpec, hooks: AdapterHooks) => new OpenCodeAdapter(spec, hooks),
  // L'SDK avvia `opencode` dal PATH (via `cross-spawn`), quindi la domanda «c'e'?» e'
  // esattamente «il binario si risolve?». Si guarda una volta e si ricorda: e' un fatto
  // della macchina, e chiederlo a ogni apertura dell'elenco costerebbe uno spawn.
  available: async () => {
    if (ocPresente === null) ocPresente = await risolve('opencode')
    return ocPresente
  },
  modes: modiNoti,
}

let ocPresente: boolean | null = null

/** Il comando esiste nel PATH? `--version` e non `which`: funziona anche con un alias
 *  o un wrapper, che e' come `opencode` viene installato di solito. */
function risolve(cmd: string): Promise<boolean> {
  return new Promise(res => {
    const p = spawn(cmd, ['--version'], { stdio: 'ignore' })
    p.on('error', () => res(false))
    p.on('exit', code => res(code === 0))
  })
}

const BACKENDS: Record<string, AgentBackend> = {
  [claudeCode.id]: claudeCode,
  [openCode.id]: openCode,
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

/** Gli agent di questa macchina, con chi c'e' davvero. */
export async function agentiDisponibili(): Promise<Array<{
  id: string; available: boolean; modes: ModeChoice[]
}>> {
  return Promise.all(agentIds().map(async id => ({
    id,
    available: (await BACKENDS[id]?.available?.()) ?? true,
    // Le modalita' viaggiano con l'elenco degli agent perche' chi disegna le
    // impostazioni le vuole insieme: una tendina per agent, con le sue voci.
    modes: (await BACKENDS[id]?.modes?.()) ?? [],
  })))
}
