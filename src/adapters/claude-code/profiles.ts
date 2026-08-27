// Cosa c'è su questa macchina, dal lato di Claude Code.
//
// Sta nell'adapter perché è tutta conoscenza sua: dove tiene le configurazioni, come si
// chiama il file con dentro i server MCP, che `CLAUDE_CONFIG_DIR` è la manopola che
// sposta tutto. Il daemon la chiede e la mostra; non la sa.
//
// A cosa serve: è la pagina che si guarda quando qualcosa sembra rotto senza motivo.
// Puntare un progetto al profilo sbagliato è il modo più confondente in cui STARK può
// rompersi — l'agent non trova nessuna conversazione da riprendere e forse nemmeno il
// login, con l'aria di essere guasto invece che mal configurato.

import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Una configurazione di Claude Code trovata sul disco. */
export type Profile = {
  /** Il nome è il suffisso della cartella: `.claude-digitizers` → «digitizers». */
  name: string
  path: string
  /** Quante conversazioni della CLI ci sono dentro. */
  conversations: number
  /** Quanti server MCP dichiara. */
  mcpServers: number
  /** È quello che STARK sta usando adesso. */
  current: boolean
}

export type Diagnostics = {
  node: string
  /** La versione dell'SDK, dal suo package.json. */
  sdk?: string
  /** La versione del CLI, **chiesta all'eseguibile**: dal numero dell'SDK si potrebbe
   *  dedurre, e dedurre non è sapere. */
  cli?: string
  executable?: string
  /** L'eseguibile è quello che l'SDK si porta dietro, non uno installato a parte. */
  bundled: boolean
  configDir: string
  profiles: Profile[]
}

const SDK_DIR = 'node_modules/@anthropic-ai/claude-agent-sdk'

function versionOf(pkg: string): string | undefined {
  try {
    const j = JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8')) as { version?: string }
    return j.version
  } catch { return undefined }
}

/** L'eseguibile che l'SDK si porta dietro, se il pacchetto della piattaforma c'è. */
function bundledExecutable(): string | undefined {
  for (const p of [
    'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
    'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
    'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
  ]) {
    const abs = resolve(p)
    if (existsSync(abs)) return abs
  }
  return undefined
}

/**
 * Dove Claude Code tiene la sua configurazione: quello che ci viene detto, altrimenti
 * `CLAUDE_CONFIG_DIR`, altrimenti `~/.claude`. È la stessa catena che segue il CLI, ed
 * era scritta due volte qui dentro — alla terza (la memoria globale, dove STARK scrive
 * la regola sulle descrizioni) è diventata una funzione, per la stessa ragione per cui
 * lo è diventato il rilevamento di WSL: tre copie di una scelta sono tre posti in cui
 * può divergere.
 */
export function configDirOf(configDir?: string): string {
  return resolve(configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? resolve(homedir(), '.claude'))
}

/** I profili sono le cartelle `~/.claude*` che contengono davvero una configurazione. */
export function listProfiles(configDir?: string): Profile[] {
  const attuale = configDirOf(configDir)
  const casa = homedir()
  const candidati = new Set<string>([attuale])
  try {
    for (const f of readdirSync(casa)) {
      if (f === '.claude' || f.startsWith('.claude-')) candidati.add(resolve(casa, f))
    }
  } catch { /* niente da elencare */ }

  const out: Profile[] = []
  for (const path of candidati) {
    try {
      if (!statSync(path).isDirectory()) continue
    } catch { continue }
    const projects = resolve(path, 'projects')
    if (!existsSync(projects) && !existsSync(resolve(path, '.claude.json'))) continue
    out.push({
      name: profileName(path),
      path,
      conversations: countTranscripts(projects),
      mcpServers: countMcp(path),
      current: path === attuale,
    })
  }
  return out.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name))
}

function profileName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  if (base === '.claude') return 'default'
  return base.replace(/^\.claude-?/, '') || base
}

function countTranscripts(projects: string): number {
  if (!existsSync(projects)) return 0
  let n = 0
  try {
    for (const dir of readdirSync(projects)) {
      try {
        n += readdirSync(resolve(projects, dir)).filter(f => f.endsWith('.jsonl')).length
      } catch { /* una cartella che non si legge non ferma il conto */ }
    }
  } catch { return 0 }
  return n
}

/** I server MCP di un profilo stanno nel suo `.claude.json`, sotto `mcpServers`. */
function countMcp(path: string): number {
  try {
    const j = JSON.parse(readFileSync(resolve(path, '.claude.json'), 'utf8')) as
      { mcpServers?: Record<string, unknown> }
    return Object.keys(j.mcpServers ?? {}).length
  } catch { return 0 }
}

/**
 * La versione, chiesta una volta sola.
 *
 * Chiederla costa **otto secondi** — l'eseguibile è un pacchetto grosso che deve
 * srotolarsi prima di rispondere — e non cambia mentre il daemon è vivo. Senza questa
 * cache la pagina System restava otto secondi su «sto leggendo», che è il genere di
 * lentezza che fa credere che qualcosa sia rotto.
 */
let versione: Promise<string | undefined> | null = null

function cliVersion(executable: string | undefined): Promise<string | undefined> {
  if (!executable) return Promise.resolve(undefined)
  versione ??= run(executable, ['--version'], { timeout: 30_000 })
    .then(({ stdout }) => stdout.trim().split(/\s+/)[0])
    // Un fallimento non si tiene: la prossima volta si riprova, magari l'eseguibile
    // era solo occupato. Tenere «non lo so» per sempre sarebbe una bugia stabile.
    .catch(() => { versione = null; return undefined })
  return versione
}

/**
 * Scaldare la cache all'avvio del daemon: nessuno la aspetta, e quando qualcuno aprirà
 * System sarà già lì. Costa un processo in più per avvio, e lo paga il computer mentre
 * nessuno guarda invece dell'utente mentre guarda.
 */
export function warmDiagnostics(): void {
  void cliVersion(bundledExecutable())
}

/**
 * La diagnostica. La versione del CLI si **chiede** all'eseguibile invece di dedurla
 * dal numero dell'SDK: i due patch si inseguono, ma «si inseguono» non è «sono uguali»,
 * e questa è la pagina che si legge quando qualcosa non torna.
 *
 * I profili invece si rileggono ogni volta: una cartella nuova può comparire mentre il
 * daemon è in piedi, e costa una `readdir`.
 */
export async function diagnostics(configDir?: string): Promise<Diagnostics> {
  const executable = bundledExecutable()
  const cli = await cliVersion(executable)
  return {
    node: process.version.replace(/^v/, ''),
    ...(versionOf(SDK_DIR) ? { sdk: versionOf(SDK_DIR) } : {}),
    ...(cli ? { cli } : {}),
    ...(executable ? { executable } : {}),
    bundled: executable !== undefined,
    configDir: configDirOf(configDir),
    profiles: listProfiles(configDir),
  }
}
