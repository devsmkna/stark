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
import type { ModeChoice, ModelChoice } from '../core/events.ts'
import { ClaudeCodeAdapter } from './claude-code/adapter.ts'
import { findTranscript, isRecent, listTranscripts } from './claude-code/catalogue.ts'
import { importTranscript } from './claude-code/import.ts'
import { allineaMemoria } from './claude-code/memoria.ts'
import { diagnostics, warmDiagnostics } from './claude-code/profiles.ts'
import { modeChoices } from './claude-code/sdk-options.ts'
import { catalogoModelli } from './claude-code/modelli.ts'
import { catalogoModelli as catalogoOpenCode, modiNoti, OpenCodeAdapter } from './opencode/adapter.ts'

export const claudeCode: AgentBackend = {
  id: 'claude-code',
  open: (spec: SessionSpec, hooks: AdapterHooks) => new ClaudeCodeAdapter({ ...spec, ...hooks }),
  modes: async () => modeChoices(),
  catalogue: catalogoModelli,
  // Misurato, non dedotto: vedi `spike/helper-sola-lettura.ts` (5/5) e
  // `spike/helper-motore.ts` (13/13, attraverso il daemon vero).
  canDeny: true,
  listConversations: listTranscripts,
  isRecent,
  importConversation: importTranscript,
  locateConversation: findTranscript,
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
  available: presente,
  modes: modiNoti,
  // Solo se il CLI c'e': chiederli a un agent non installato farebbe partire un
  // processo che non esiste, e l'elenco tornerebbe vuoto dopo averci provato.
  catalogue: async () => (await presente()) ? catalogoOpenCode() : [],
}

let ocPresente: boolean | null = null

/** Il CLI di OpenCode c'e' su questa macchina? Chiesto una volta e ricordato: e' un
 *  fatto della macchina, e chiederlo a ogni apertura di un elenco costerebbe uno spawn. */
async function presente(): Promise<boolean> {
  if (ocPresente === null) ocPresente = await risolve('opencode')
  return ocPresente
}

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

/**
 * Gli agent che questa macchina ha **installati e che STARK non sa ancora guidare**.
 *
 * Serve al selettore dell'helper (§17), e la regola che decide chi ci finisce e' la
 * stessa dell'interfaccia: «spento con la ragione, mai nascosto» — ma vale per cio' che
 * *c'e'*. Elencare Codex su una macchina dove Codex non e' installato non sarebbe
 * onesta', sarebbe inventare una promessa: non c'e' niente di spento da mostrare, c'e'
 * una cosa che non esiste. Mentre un `codex` installato e non guidabile e' un fatto
 * vero della macchina, e tacerlo farebbe sembrare l'elenco completo quando non lo e'.
 *
 * L'elenco dei nomi e' scritto a mano di proposito: e' «quelli che sappiamo esistere e
 * che un giorno avranno un adapter», non «qualunque cosa nel PATH».
 */
const NON_ANCORA: { cmd: string; label: string }[] = [
  { cmd: 'codex', label: 'Codex' },
  { cmd: 'gemini', label: 'Gemini CLI' },
  { cmd: 'cursor-agent', label: 'Cursor Agent' },
  { cmd: 'amp', label: 'Amp' },
  { cmd: 'qwen', label: 'Qwen Code' },
  { cmd: 'crush', label: 'Crush' },
  { cmd: 'aider', label: 'Aider' },
]

let nonAncora: { id: string; label: string }[] | null = null

export async function agentiNonSupportati(): Promise<{ id: string; label: string }[]> {
  if (nonAncora) return nonAncora
  const esiti = await Promise.all(NON_ANCORA.map(async a => ({ ...a, c: await risolve(a.cmd) })))
  nonAncora = esiti.filter(a => a.c).map(a => ({ id: a.cmd, label: a.label }))
  return nonAncora
}

/**
 * Tutti i modelli guidabili su questa macchina, per agent, piu' chi e' installato e
 * non lo e' ancora.
 *
 * Un agent che c'e' ma non risponde compare **con la sua ragione** invece che sparire:
 * «nessun modello» detto da un agent presente e' un'informazione (login scaduto, chiave
 * assente), mentre farlo sparire dall'elenco lo farebbe sembrare non installato.
 */
export async function catalogoCompleto(profile?: string): Promise<{
  id: string
  label: string
  available: boolean
  reason?: string
  models: ModelChoice[]
}[]> {
  const guidabili = await Promise.all(
    Object.values(BACKENDS).map(async b => {
      const c = (await b.available?.()) ?? true
      if (!c) return { id: b.id, label: ETICHETTE[b.id] ?? b.id, available: false, reason: 'non installato', models: [] }
      // Un agent che non sa imporre un divieto **non** viene spento: funziona, e STARK
      // non deve poter meno di quello che la macchina puo' fare. Ma la sola lettura li'
      // non c'e', e va detta — con una `note`, non un `reason`: la prima e' un avviso su
      // una scelta che si puo' fare, il secondo dice perche' una voce e' spenta.
      const senzaDivieti = b.canDeny !== true
      const grezzi = (await b.catalogue?.()) ?? []
      const models = senzaDivieti
        ? grezzi.map(m => ({ ...m, note: m.note ?? SENZA_SOLA_LETTURA }))
        : grezzi
      return {
        id: b.id, label: ETICHETTE[b.id] ?? b.id,
        available: models.length > 0,
        ...(models.length === 0 ? { reason: 'nessun modello: controlla il login di questo agent' } : {}),
        models,
      }
    }),
  )
  const spenti = (await agentiNonSupportati()).map(a => ({
    id: a.id, label: a.label, available: false,
    reason: 'installato, ma STARK non lo sa ancora guidare',
    models: [] as ModelChoice[],
  }))
  return [...guidabili, ...spenti]
}

/** Detto una volta sola, perche' e' la stessa frase su ogni modello di quell'agent. */
const SENZA_SOLA_LETTURA = 'Su questo agent la sola lettura non e\' ancora garantita: potrebbe modificare file.'

/** Come si chiama un agent a schermo. La UI non deve conoscerne i nomi (§1). */
const ETICHETTE: Record<string, string> = {
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
}
