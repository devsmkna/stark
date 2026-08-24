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
  type CategoryRules, type PermissionCategory,
} from '../core/events.ts'

/** Cosa STARK sa di un progetto, che è una cartella. */
export type ProjectSettings = {
  /** L'indice del colore, 0-6. Assente: lo decide l'ordine alfabetico, come prima. */
  colour?: number
  /** Silenziato: niente notifiche da nessuna delle sue chat. */
  muted?: boolean
}

export type Settings = {
  permissions: CategoryRules
  /** Per cartella di lavoro, che è l'unica identità stabile che un progetto ha. */
  projects: Record<string, ProjectSettings>
}

export const DEFAULTS: Settings = { permissions: { ...CATEGORY_DEFAULTS }, projects: {} }

const FILE = 'settings.json'

/**
 * Legge le impostazioni, e **non fallisce mai**.
 *
 * Un file rotto o scritto a mano male non deve impedire a STARK di partire: si torna ai
 * default, che sono quelli buoni per il 90% dei casi. Perdere una preferenza è un
 * fastidio; non poter aprire l'app perché una virgola è fuori posto è un guasto.
 */
export function readSettings(home: string): Settings {
  const path = resolve(home, FILE)
  if (!existsSync(path)) return { ...DEFAULTS, projects: {} }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>
    return {
      permissions: sanePermissions(raw.permissions),
      projects: saneProjects(raw.projects),
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
    out[cwd] = {
      ...(colour !== undefined && colour >= 0 && colour < 7 ? { colour } : {}),
      ...(muted ? { muted } : {}),
    }
  }
  return out
}
