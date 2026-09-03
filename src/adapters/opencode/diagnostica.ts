// Cosa c'è su questa macchina, dal lato di OpenCode.
//
// Il gemello di `claude-code/profiles.ts`, e la stessa lezione di lì: la versione non
// si deduce, si **chiede**. Qui la chiede al server — l'SDK ufficiale la porta nel suo
// `global.health`, e il server è lo stesso processo che guiderebbe le conversazioni —
// con ripiego su `--version` del CLI se il server non parte. Chiederla al binario
// quando il server ce l'ha già acceso sarebbe un processo in più per dire una cosa
// che un HTTP dice in fretta.
//
// La versione dell'SDK invece si legge dal `package.json`: è un fatto scritto sul
// disco, e risolverlo con `createRequire` (e non a mano) è ciò che lo fa valere anche
// dove `node_modules` non sta dove ci si aspetta.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { esegui, WIN } from '../../core/platform.ts'
import { clientPer, lascia } from './host.ts'
import { tmpdir } from 'node:os'

const SDK_PKG = '@opencode-ai/sdk'

export type OpencodeDiagnostics = {
  /** La versione del **server** (quindi del CLI che lo porta), chiesta all'handshake. */
  cli?: string
  /** La versione dell'SDK ufficiale, dal suo `package.json`. */
  sdk?: string
  /** Dove sta il binario, dal `PATH` di questo processo — lo stesso che lo cerca
   *  `esegui('opencode', …)` qui sotto. Manca solo se `which`/`where` non lo trova. */
  executable?: string
  available: boolean
}

/** `where` invece di `which` su Windows nativo, stessa ragione di `native-browse.ts`. */
async function risolviEseguibile(nome: string): Promise<string | undefined> {
  try {
    const r = await esegui(WIN ? 'where' : 'which', [nome])
    return r.stdout.trim().split(/\r?\n/)[0] || undefined
  } catch {
    return undefined
  }
}

function versionOfSdk(): string | undefined {
  try {
    const req = createRequire(import.meta.url)
    const pkg = resolve(req.resolve(`${SDK_PKG}/package.json`))
    const j = JSON.parse(readFileSync(pkg, 'utf8')) as { version?: string }
    return j.version
  } catch {
    // Risoluzione fallita: si prova il percorso relativo, che è dove npm lo mette di
    // solito. Se anche qui non c'è, la versione non c'è e la pagina lo dirà.
    try {
      const j = JSON.parse(readFileSync('node_modules/@opencode-ai/sdk/package.json', 'utf8')) as
        { version?: string }
      return j.version
    } catch { return undefined }
  }
}

/** Un'esecuzione sola per processo, come per Claude Code: chiederlo a ogni apertura
 *  della pagina sarebbe un processo o un HTTP a ogni volta, per un fatto che non
 *  cambia mentre il daemon vive. */
let nota: Promise<OpencodeDiagnostics> | null = null

export function diagnosticsOpencode(): Promise<OpencodeDiagnostics> {
  nota ??= chiedi().catch(() => ({ available: false }) as OpencodeDiagnostics)
  return nota
}

async function chiedi(): Promise<OpencodeDiagnostics> {
  const sdk = versionOfSdk()
  const executable = await risolviEseguibile('opencode')
  // Prima il server: è lo stesso che guiderebbe le conversazioni, quindi la versione
  // che risponde è la versione che STARK usa davvero. Solo se non parte si chiede al
  // binario, che comunque sta nel PATH (è così che lo cerca anche `presente()`).
  try {
    const c = await clientPer(tmpdir())
    try {
      const h = await c.global.health()
      const v = (h.data as { version?: string } | undefined)?.version
      return { ...(v ? { cli: v } : {}), ...(sdk ? { sdk } : {}), ...(executable ? { executable } : {}), available: true }
    } finally {
      lascia()
    }
  } catch { /* il server non è partito: si chiede al binario */ }
  const via = await esegui('opencode', ['--version'], { timeout: 15_000 })
    .then(r => r.stdout.trim().split(/\s+/)[0])
    .catch(() => undefined)
  return { ...(via ? { cli: via } : {}), ...(sdk ? { sdk } : {}), ...(executable ? { executable } : {}), available: via !== undefined }
}

/** Nulla da scaldare che non si scaldi da sé: il primo `clientPer` accende il server,
 *  che STARK terrà acceso comunque. Qui non c'è la carezza a otto secondi del CLI di
 *  Claude, quindi nessuna ragione di paginarla in anticipo. */
export function warmDiagnosticsOpencode(): void { /* intenzionalmente vuoto */ }
