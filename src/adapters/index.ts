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
    // `windowsHide`: il daemon non ha console, quindi senza questo la sonda fa
    // lampeggiare una finestra nera. Vedi `core/platform.ts`.
    const p = spawn(cmd, ['--version'], { stdio: 'ignore', windowsHide: true })
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

/** Un agent della macchina e i modelli che sa guidare. */
export type AgentModels = {
  id: string
  label: string
  available: boolean
  reason?: string
  /** Un avviso su **tutto** l'agent, non su un suo modello. */
  note?: string
  models: ModelChoice[]
}

/**
 * Per quanto ci si fida di un elenco gia' preso.
 *
 * Cinque minuti e non «per sempre» perche' i modelli **cambiano davvero** mentre STARK
 * e' acceso: un piano che scade, un login diverso, un modello nuovo pubblicato. E non
 * cinque secondi, perche' ogni scadenza costa un processo per agent.
 *
 * La cache sta **qui** e non dentro i singoli adapter, dove per Claude Code stava
 * prima, per una ragione misurata: OpenCode non ce l'aveva, e il menu pagava ~2,3s a
 * ogni apertura anche subito dopo la precedente (misurato: claude-code 3233 → 0 → 0 ms,
 * opencode 3165 → 2316 → 2824). Due cache scritte da due parti sono due TTL che
 * divergono; una sola, sul punto d'ingresso, vale per qualunque agent venga dopo senza
 * che debba ricordarsi di averla.
 */
const VALIDA_MS = 5 * 60 * 1000

const cache = new Map<string, { quando: number; dati: AgentModels[] }>()
const inVolo = new Map<string, Promise<AgentModels[]>>()

/** Solo per le prove, e per chi cambia login senza aspettare cinque minuti. */
export function scordaCatalogo(): void { cache.clear(); inVolo.clear() }

/**
 * Scalda il catalogo senza che nessuno lo stia aspettando.
 *
 * Chiamato all'avvio del daemon accanto a `warmDiagnostics`: la prima apertura del menu
 * e' quella che si nota, ed e' l'unica che pagherebbe i tre secondi per intero.
 * Non si aspetta e non si segnala: se fallisce, la prima domanda vera riprovera'.
 */
export function scaldaCatalogo(profile?: string): void {
  void catalogoCompleto(profile).catch(() => { /* riprovera' chi la chiede davvero */ })
}

/**
 * Si risponde **subito con quello che si ha**, anche se scaduto, e si va a riprendere
 * l'elenco nuovo di lato (stale-while-revalidate). Un catalogo di cinque minuti fa e'
 * quasi sempre identico a quello di adesso, e farlo aspettare tre secondi per
 * scoprirlo e' il costo che questa funzione esiste per non far pagare. Chi apre il
 * menu vede i modelli; se nel frattempo ne e' comparso uno, arriva alla prossima.
 *
 * Tutti i modelli guidabili su questa macchina, per agent, piu' chi e' installato e
 * non lo e' ancora.
 *
 * Un agent che c'e' ma non risponde compare **con la sua ragione** invece che sparire:
 * «nessun modello» detto da un agent presente e' un'informazione (login scaduto, chiave
 * assente), mentre farlo sparire dall'elenco lo farebbe sembrare non installato.
 */
export async function catalogoCompleto(profile?: string): Promise<AgentModels[]> {
  const chiave = profile ?? ''
  const avuto = cache.get(chiave)
  if (avuto) {
    // Scaduto non vuol dire inutile: si restituisce lo stesso e si aggiorna dietro.
    if (Date.now() - avuto.quando >= VALIDA_MS) void aggiorna(chiave, profile).catch(() => {})
    return avuto.dati
  }
  return aggiorna(chiave, profile)
}

/**
 * Una richiesta sola per chiave, anche se in dieci la chiedono insieme.
 *
 * Senza questo, aprire il menu in tre pannelli affiancati farebbe partire tre handshake
 * per agent — che e' esattamente il costo che la cache toglie, rimesso dalla porta di
 * servizio il primo giro, quando la cache e' ancora vuota.
 */
function aggiorna(chiave: string, profile?: string): Promise<AgentModels[]> {
  const gia = inVolo.get(chiave)
  if (gia) return gia
  const p = componi(profile)
    .then(dati => { cache.set(chiave, { quando: Date.now(), dati }); return dati })
    .finally(() => { inVolo.delete(chiave) })
  inVolo.set(chiave, p)
  return p
}

/**
 * Il `profile` arriva fino all'adapter, e prima non ci arrivava: `catalogoCompleto` lo
 * prendeva come parametro e poi chiamava `b.catalogue?.()` **senza**, nonostante il
 * contratto del §1 lo dichiari (`catalogue?(profile?: string)`). Su una macchina con un
 * profilo Claude per progetto l'elenco era quindi sempre quello del profilo di default,
 * in silenzio. Non lo nota nessuno finche' i due profili hanno gli stessi modelli.
 */
async function componi(profile?: string): Promise<AgentModels[]> {
  const guidabili = await Promise.all(
    Object.values(BACKENDS).map(async b => {
      const c = (await b.available?.()) ?? true
      if (!c) return { id: b.id, label: ETICHETTE[b.id] ?? b.id, available: false, reason: 'not installed', models: [] }
      // Un agent che non sa imporre un divieto **non** viene spento: funziona, e STARK
      // non deve poter meno di quello che la macchina puo' fare. Ma la sola lettura li'
      // non c'e', e va detta — con una `note`, non un `reason`: la prima e' un avviso su
      // una scelta che si puo' fare, il secondo dice perche' una voce e' spenta.
      //
      // E va detta **una volta sola, sull'agent**, non su ognuno dei suoi modelli: e' un
      // fatto di chi li guida, non di quale si sceglie. Stamparla su tutti e 61 li
      // avrebbe riempiti di triangoli identici — cioe' esattamente il difetto corretto
      // il 27 agosto («I 61 modelli di OpenCode non hanno piu' 61 triangoli di avviso»),
      // rifatto uguale un giorno dopo. Un avviso su ogni riga non e' un avviso: e' lo
      // sfondo, e nasconde quello vero che sta su una riga sola.
      const models = (await b.catalogue?.(profile)) ?? []
      return {
        id: b.id, label: ETICHETTE[b.id] ?? b.id,
        available: models.length > 0,
        ...(models.length === 0 ? { reason: 'no models — check this agent\'s login' } : {}),
        ...(b.canDeny !== true ? { note: SENZA_SOLA_LETTURA } : {}),
        models,
      }
    }),
  )
  const spenti = (await agentiNonSupportati()).map(a => ({
    id: a.id, label: a.label, available: false,
    reason: 'installed, but STARK can\'t drive it yet',
    models: [] as ModelChoice[],
  }))
  return [...guidabili, ...spenti]
}

/** Detto una volta sola, perche' e' la stessa frase su ogni modello di quell'agent. */
const SENZA_SOLA_LETTURA = 'Read-only isn\'t enforced on this agent yet: it could modify files.'

/** Come si chiama un agent a schermo. La UI non deve conoscerne i nomi (§1). */
const ETICHETTE: Record<string, string> = {
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
}
