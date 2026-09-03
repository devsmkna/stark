// Le impostazioni di STARK, quelle che valgono su questa macchina e non su un browser.
//
// La divisione non è arbitraria e vale la pena scriverla, perché decide cosa va qui e
// cosa resta nel browser:
//
//   - qui sta ciò che **cambia cosa fa l'agent** (la tabella dei permessi) o che
//     descrive un progetto (il suo colore, se è silenziato). Deve valere da qualunque
//     browser apra STARK, e sopravvivere al browser stesso.
//   - nel browser resta ciò che è del **dispositivo**: il tema, e se questo computer
//     deve suonare. «Voglio sentire i suoni su questo portatile» non è un fatto del
//     progetto, e portarselo sul fisso sarebbe sbagliato.
//
// Il file è JSON e non un journal: qui non serve la storia di come si è arrivati allo
// stato, serve lo stato. È l'unica cosa in STARK di cui questo è vero.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CATEGORY_DEFAULTS, PERMISSION_CATEGORIES,
  type CategoryRules, type PermissionCategory, type PermissionMode,
} from '../core/events.ts'

/** Cosa STARK sa di un progetto, che è una cartella. */
export type ProjectSettings = {
  /** L'indice del colore, 0-6. Assente: lo decide l'ordine alfabetico, come prima. */
  colour?: number
  /** Silenziato: niente notifiche da nessuna delle sue chat. */
  muted?: boolean
  /**
   * Il `CLAUDE_CONFIG_DIR` di questo progetto — quale login, MCP e memoria usa. Deciso
   * alla prima chat quando la macchina ne ha più di uno (vedi NewChat); assente vuol
   * dire «quello di default del daemon», com'era prima che esistesse questo campo.
   */
  profile?: string
}

export type Settings = {
  permissions: CategoryRules
  /** Per cartella di lavoro, che è l'unica identità stabile che un progetto ha. */
  projects: Record<string, ProjectSettings>
  /**
   * Se l'agent deve scrivere **perché** lancia un comando, non solo cosa.
   *
   * Non è una preferenza di STARK su STARK: è una regola che finisce nel `CLAUDE.md`
   * globale dell'agent (vedi `memoria.ts`), quindi vale anche fuori da qui — nel
   * terminale, in un altro strumento, ovunque quel file venga letto. Accesa di
   * default perché la riga di un tool senza motivazione mostra solo il comando, e su
   * un `grep` di trenta caratteri quello non dice niente a chi sta guardando.
   */
  toolDescriptions: boolean
  /**
   * In quale modalità permessi **partono le chat nuove**.
   *
   * Esiste perché era l'unica differenza strutturale fra STARK e la CLI nuda, e non si
   * poteva toccare: `auto` era cablato nel registro. Misurato il 27 agosto 2026: la CLI
   * senza `--permission-mode` parte in **`default`**, STARK chiedeva **`auto`**. Sono
   * due comportamenti diversi — in `default` un'azione pericolosa **si ferma e chiede**,
   * in `auto` decide un classificatore — e chi vuole esattamente ciò che avrebbe dal
   * terminale deve poterlo dire.
   *
   * Il default resta `auto`, che è la scelta di ADR-008 e non viene rovesciata qui:
   * quella decisione era sull'attrito (zero card), non sul costo, e il costo del
   * classificatore misurato sulla quota del piano è risultato **sotto la risoluzione
   * della misura** — 32 chiamate non spostano un punto percentuale.
   */
  /**
   * La modalità con cui parte una chat nuova, **per agent** (ADR-014).
   *
   * `defaultMode` (senza `s`) resta perché i file già scritti ce l'hanno, e vale per
   * l'agent di default: buttarlo vorrebbe dire far ripartire da `auto` chi aveva scelto
   * `default`, senza dirglielo. Una preferenza persa in silenzio è peggio di un campo
   * in più.
   */
  defaultMode: PermissionMode
  defaultModes?: Record<string, PermissionMode>
  /**
   * Le scorciatoie da tastiera, per id di azione: `{ "palette": "mod+k" }`.
   *
   * Stanno qui e non nel browser perché sono una preferenza **dell'utente**, non del
   * dispositivo — chi ne cambia una vuole ritrovarla anche riaprendo da un'altra
   * scheda. Il prezzo di tenerle sul daemon è che una macchina sola descrive tastiere
   * diverse, ed è per questo che il valore salvato dice `mod` e non `cmd`: a
   * risolverlo in ⌘ o Ctrl è il browser che le legge (`ui/src/lib/shortcuts.ts`).
   *
   * Il daemon non le interpreta e non le convalida contro un elenco di azioni: quali
   * azioni esistono lo sa la UI, e un daemon che rifiutasse un id sconosciuto
   * cancellerebbe la scorciatoia di una versione più nuova di sé.
   */
  shortcuts?: Record<string, string>
  /**
   * Il modello con cui partono le **chat nuove** (chiesto dall'utente, 1º settembre
   * 2026), nella coppia che lo identifica: l'agent che lo dichiara e l'id.
   *
   * Sta qui e non nel browser per la stessa ragione di `defaultMode`: cambia cosa
   * fa l'agent alla nascita di una conversazione, che è un fatto della macchina.
   * Non tocca il «New chat here» del menu contestuale — quello porta il modello
   * della chat da cui si è premuto, per scelta — e non tocca le chat riprese.
   *
   * La coppia è **vincolata all'agent**: un id modello esiste solo dentro il
   * catalogo di chi lo dichiara, quindi chi sceglie un altro agent nel dialogo
   * parte col default di quello, non col preferito.
   */
  preferredModel?: { agent: string; model: string }
  /**
   * Freccia su nella casella vuota: richiama l'ultimo prompt mandato in quella chat,
   * poi quello prima ancora — come la history di una shell. Non è nell'elenco
   * `shortcuts` sopra perché non è una combinazione da catturare: è sempre la stessa
   * freccia, e a cambiare è solo se è accesa.
   */
  historyArrowUp: boolean
  /**
   * Esc mentre l'agent lavora: interrompe il turno in corso. Stessa cosa che Esc fa
   * già ovunque in STARK — chiudere ciò che è aperto — applicata al lavoro
   * dell'agent invece che a un menu. Per questo resta **fuori** da `VIETATI` in
   * `shortcuts.ts`: qui non si assegna un tasto diverso, si spegne o si accende il
   * significato che Esc ha già.
   */
  interruptEscape: boolean
}

export const DEFAULTS: Settings = {
  permissions: { ...CATEGORY_DEFAULTS }, projects: {}, toolDescriptions: true,
  defaultMode: 'auto', historyArrowUp: true, interruptEscape: true,
}

/**
 * La modalità con cui partono le chat nuove.
 *
 * Qui **non si convalida contro un elenco**, e il cambio è ADR-014: prima c'erano le
 * sei parole di Claude Code scritte a mano nel daemon, che è esattamente il posto in
 * cui il §1 dice che non devono stare. Un altro agent ne ha altre — OpenCode ha
 * `build` e `plan` — e un elenco fisso qui rifiuterebbe le sue.
 *
 * A dire se una modalità si può usare è l'**adapter**, che la dichiara nelle proprie
 * opzioni e, se non ce l'ha, declassa **dicendolo** (misurato dal vivo su OpenCode:
 * `auto` → `default` con una nota nel flusso). Qui resta solo la difesa contro un file
 * scritto male: una stringa vuota, o qualcosa che non è una stringa, torna al default.
 */
const saneMode = (m: unknown): PermissionMode =>
  typeof m === 'string' && m.trim().length > 0 && m.length < 64 ? m : 'auto'

/**
 * Le modalità per agent, ripulite. Una chiave con un valore non-stringa si butta invece
 * di far tornare tutto ai default: perdere una preferenza è un fastidio, perderle tutte
 * per una riga sbagliata è un guasto.
 */
function sanePerAgent(v: unknown): { defaultModes?: Record<string, PermissionMode> } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const out: Record<string, PermissionMode> = {}
  for (const [k, m] of Object.entries(v as Record<string, unknown>)) {
    if (typeof m === 'string' && m.trim().length > 0 && m.length < 64) out[k] = m
  }
  return Object.keys(out).length > 0 ? { defaultModes: out } : {}
}

/**
 * Le scorciatoie ripulite. Stessa disciplina delle modalità per agent: una voce
 * scritta male si butta da sola invece di far tornare tutto ai default. Non si
 * convalida la *forma* della combinazione — quella la legge `parse()` nel browser, che
 * su una stringa illeggibile risponde «nessuna scorciatoia» invece di rompersi.
 */
function saneShortcuts(v: unknown): { shortcuts?: Record<string, string> } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
    if (typeof s === 'string' && s.trim().length > 0 && s.length < 64) out[k] = s.trim()
  }
  return Object.keys(out).length > 0 ? { shortcuts: out } : {}
}

const FILE = 'settings.json'

/**
 * Legge le impostazioni, e **non fallisce mai**.
 *
 * Un file rotto o scritto a mano male non deve impedire a STARK di partire: si torna ai
 * default, che sono quelli buoni per il 90% dei casi. Perdere una preferenza è un
 * fastidio; non poter aprire l'app perché una virgola è fuori posto è un guasto.
 */
/**
 * La coppia preferita, sanata: entra solo se **entrambi** i campi sono stringhe
 * non vuote. Una metà (agent senza modello, o il contrario) non è una preferenza —
 * è un mezzo dato che alla nascita della chat diverrebbe un modello sbagliato o
 * mancante, e buttare la metà buona con quella cattiva è ciò che non si perderebbe
 * in silenzio.
 */
export function sanePreferred(v: unknown): { agent: string; model: string } | undefined {
  if (!v || typeof v !== 'object') return undefined
  const agent = (v as Record<string, unknown>)['agent']
  const model = (v as Record<string, unknown>)['model']
  if (typeof agent !== 'string' || !agent.trim() || typeof model !== 'string' || !model.trim()) {
    return undefined
  }
  return { agent, model }
}

export function readSettings(home: string): Settings {
  const path = resolve(home, FILE)
  if (!existsSync(path)) return { ...DEFAULTS, projects: {} }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>
    return {
      permissions: sanePermissions(raw.permissions),
      projects: saneProjects(raw.projects),
      // `!== false` e non `?? true`: un file scritto prima che questa voce esistesse
      // non ce l'ha, e per quel file la risposta giusta è il default, cioè accesa.
      toolDescriptions: raw.toolDescriptions !== false,
      defaultMode: saneMode(raw.defaultMode),
      historyArrowUp: raw.historyArrowUp !== false,
      interruptEscape: raw.interruptEscape !== false,
      ...(sanePerAgent(raw['defaultModes'])),
      ...(saneShortcuts(raw['shortcuts'])),
      ...(sanePreferred(raw['preferredModel']) ? { preferredModel: sanePreferred(raw['preferredModel']) } : {}),
    }
  } catch {
    return { ...DEFAULTS, projects: {} }
  }
}

export function writeSettings(home: string, s: Settings): Settings {
  mkdirSync(home, { recursive: true })
  const pulito: Settings = {
    permissions: sanePermissions(s.permissions),
    projects: saneProjects(s.projects),
    toolDescriptions: s.toolDescriptions !== false,
    defaultMode: saneMode(s.defaultMode),
    historyArrowUp: s.historyArrowUp !== false,
    interruptEscape: s.interruptEscape !== false,
    ...(sanePerAgent(s.defaultModes)),
    ...(saneShortcuts(s.shortcuts)),
    ...(sanePreferred(s.preferredModel) ? { preferredModel: sanePreferred(s.preferredModel) } : {}),
  }
  writeFileSync(resolve(home, FILE), `${JSON.stringify(pulito, null, 2)}\n`)
  return pulito
}

/**
 * Le categorie su cui l'utente vuole essere interrogato. È questo che il registro
 * traduce in matcher per l'hook, e da cui nasce il pannello dei permessi.
 */
export function askCategories(s: Settings): PermissionCategory[] {
  return PERMISSION_CATEGORIES.filter(c => s.permissions[c] === 'ask')
}

/**
 * Una categoria che non conosciamo si butta, una che manca prende il default. Le
 * impostazioni arrivano da una richiesta HTTP: quello che entra qui va sempre guardato.
 */
function sanePermissions(raw: unknown): CategoryRules {
  const out = { ...CATEGORY_DEFAULTS }
  if (raw && typeof raw === 'object') {
    for (const c of PERMISSION_CATEGORIES) {
      const v = (raw as Record<string, unknown>)[c]
      if (v === 'ask' || v === 'allow') out[c] = v
    }
  }
  return out
}

function saneProjects(raw: unknown): Record<string, ProjectSettings> {
  const out: Record<string, ProjectSettings> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [cwd, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!cwd || typeof v !== 'object' || v === null) continue
    const p = v as Record<string, unknown>
    const colour = typeof p['colour'] === 'number' ? Math.floor(p['colour']) : undefined
    const muted = p['muted'] === true
    const profile = typeof p['profile'] === 'string' && p['profile'] ? p['profile'] : undefined
    out[cwd] = {
      ...(colour !== undefined && colour >= 0 && colour < 7 ? { colour } : {}),
      ...(muted ? { muted } : {}),
      ...(profile ? { profile } : {}),
    }
  }
  return out
}
