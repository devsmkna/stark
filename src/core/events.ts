// Il vocabolario canonico di STARK. Vedi docs/event-model.md.
//
// Regola non negoziabile (§1 della specifica): fuori dall'adapter nessun componente
// deve conoscere l'esistenza di Claude Code. Qui dentro non entrano nomi dell'API
// Anthropic: si parla di sessioni, turni, parti, permessi ed effetti.

export const MODEL_VERSION = 1 as const

// ─── §5 stati della sessione ────────────────────────────────────────────────

export type SessionState =
  | 'starting'   // processo avviato, initialize non ancora ricevuto
  | 'idle'       // pronta, nessun turno in corso
  | 'busy'       // turno in corso
  | 'awaiting'   // ferma su una richiesta bloccante (permesso o domanda)
  | 'sleeping'   // processo terminato di proposito, journal su disco — ADR-005
  | 'error'
  | 'closed'

// §11: le sei modalità reali di Claude Code. STARK ne espone tre.
export type PermissionMode =
  | 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions'

// ─── tipi di supporto ───────────────────────────────────────────────────────

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * `nominalUsd` si chiama così di proposito. L'utente è su abbonamento a quota
 * fissa: quel numero è un prezzo di listino API, non una spesa. Chiamarlo `usd`
 * inviterebbe la UI a mostrarlo come denaro, che sarebbe una bugia (Principio 3).
 * La risorsa scarsa la racconta `quota.updated`.
 */
export type Cost = { nominalUsd: number }

/**
 * Un comando slash offerto dalla sessione.
 *
 * `argumentHint` è ciò che va scritto dopo il nome (`<file>`, `[low|high]`), e senza
 * di quello metà dei comandi sono indovinelli. `terminalOnly` marca quelli la cui UX
 * è legata al terminale: **non si nascondono** — si mostrano con scritto perché,
 * come ogni altra cosa che il CLI consente e qui non ha senso (Principio 5).
 */
export type SlashCommand = {
  name: string
  description?: string
  argumentHint?: string
  /** Altri nomi che portano allo stesso comando: `/cost` e `/stats` → `/usage`. */
  aliases?: string[]
  terminalOnly?: boolean
}

/**
 * Un modello fra cui la sessione puo scegliere. `id` e cio che si rimanda indietro
 * con `session.setModel`, `resolved` il modello vero a cui un alias punta.
 *
 * Sta nel vocabolario canonico e non in una lista dentro la UI per la ragione del §1:
 * i nomi dei modelli sono vocabolario dell'agent, e la UI non deve conoscerli. Lo
 * stesso vale per `autoMode`, che dipende dal modello e non dall'agent: senza, la UI
 * dovrebbe sapere da se che Haiku non regge auto mode, cioe indovinare.
 */
export type ModelChoice = {
  id: string
  label?: string
  resolved?: string
  autoMode: boolean
}

/**
 * Una modalita dei permessi, e se questa sessione puo davvero usarla.
 *
 * `available: false` non e un motivo per nascondere la voce: il Principio 5 vuole che
 * si veda spenta CON la spiegazione. La spiegazione la scrive l'adapter, che e l'unico
 * che sa chi rifiuta e perche.
 */
export type ModeChoice = {
  mode: PermissionMode
  available: boolean
  reason?: string
}

/**
 * Un server MCP visto da una sessione, e cosa STARK ne ha deciso.
 *
 * Due campi e non uno perche dicono due cose diverse: `enabled` e la scelta di STARK
 * per questa chat, `status` e cosa risponde l'agent. Un server acceso puo essere
 * `needs-auth` o `failed`, e schiacciare le due cose in una sola nasconderebbe
 * esattamente il caso in cui l'utente si chiede perche non funziona.
 *
 * `status` e vocabolario dell'adapter solo all'apparenza: sono i cinque stati che il
 * protocollo dichiara, e la UI li mostra senza interpretarli.
 */
export type McpServer = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  /** L'ha acceso STARK per questa conversazione. Di partenza sono tutti spenti. */
  enabled: boolean
  /** Perche non va, quando `status` e `failed`. */
  error?: string
}

/**
 * Una domanda dell'agent, nella forma documentata di `AskUserQuestion`.
 * Da 1 a 4 domande per richiesta, da 2 a 4 opzioni ciascuna, `header` max 12 caratteri.
 */
export type AgentQuestion = {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string; preview?: string }[]
}

/** §16.3 resta aperto: nell'MVP il prompt è testo semplice. */
/**
 * Un pezzo di ciò che hai mandato. §16.3 era aperto proprio qui: nell'MVP il prompt era
 * solo testo, e uno schermo da far vedere all'agent non aveva strada per arrivarci.
 *
 * L'immagine nel journal viaggia **per riferimento**, non per contenuto: `ref` è lo
 * sha256 dei byte, che stanno in un file accanto ai journal. Metterci dentro il base64
 * gonfierebbe di un megabyte a colpo un file che si rilegge tutto a ogni risveglio, e
 * il §4 continua a valere lo stesso — la rilettura ritrova il riferimento e il file c'è.
 */
export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; ref: string; mediaType: string; bytes: number; name?: string }

/**
 * Cosa la UI allega a un prompt. Qui i byte ci sono davvero, perché è il viaggio
 * dal browser al daemon: è il daemon a scriverli su disco e a sostituirli con un `ref`.
 *
 * I quattro tipi sono quelli che il modello accetta. Un file di testo non sta qui:
 * si incolla, o si nomina per percorso — l'agent sa leggerlo da solo, ed è il motivo
 * per cui non serve spedirglielo.
 */
export type Attachment = {
  type: 'image'
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  /** base64, senza il prefisso `data:`. */
  data: string
  name?: string
}

/** §9: esattamente la forma di `structuredPatch`. Nessun diff da calcolare. */
export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

// ─── §12 capability ─────────────────────────────────────────────────────────

export type Capabilities = {
  interrupt: boolean
  switchModel: boolean
  switchMode: boolean
  /** Dipende dal MODELLO, non solo dall'agent: Haiku non regge auto mode. */
  autoMode: boolean
  permissionAlways: boolean
  questions: boolean
  revert: boolean
  toolProgress: boolean
  fileBrowser: boolean
  pty: boolean
}

// ─── §6-§10 il payload ──────────────────────────────────────────────────────

export type Payload =
  // §6 sessione
  | { k: 'session.created'; agent: string; cwd: string; model: string
      capabilities: Capabilities; tools: string[]; commands: SlashCommand[]
      // Cosa si puo scegliere dalla barra di stato, senza che la UI debba saperlo.
      models?: ModelChoice[]; modes?: ModeChoice[]
      // I comportamenti di protocollo che questa versione implementa. È documentato
      // usare questi nomi per la feature detection invece di confrontare versioni.
      protocolCapabilities?: string[] }
  | { k: 'session.state'; state: SessionState; reason?: string }
  | { k: 'session.model'; model: string }
  | { k: 'session.mode'; mode: PermissionMode }
  // La lista dei tool non è nota alla nascita della sessione: arriva col primo turno.
  // Vedi la correzione al §14 in fondo a docs/event-model.md.
  | { k: 'session.tools'; tools: string[] }
  // Quali server MCP questa conversazione ha davanti, e quali sono accesi. Nel journal
  // perche il §4 vuole che la UI non mostri niente che non nasca da li, e perche il
  // risveglio deve poter riaccendere quello che avevi acceso: senza, una chat che
  // dorme si sveglia senza i suoi strumenti e sembra rotta.
  | { k: 'session.mcp'; servers: McpServer[] }
  // I comandi slash arrivano con l'handshake, ma la lista **cambia in corsa**: l'agent
  // scopre skill nuove lavorando in una sottocartella. È un rimpiazzo, non un'aggiunta.
  | { k: 'session.commands'; commands: SlashCommand[] }
  // Il manico con cui questa sessione si riapre. Sta nel journal perche senza, il
  // journal non basta a risvegliare: saprebbe dire cosa e successo ma non come tornarci.
  | { k: 'session.resumeRef'; ref: string }
  /** Il titolo scelto dall'utente. Da qui in poi STARK non lo riscrive piu da solo. */
  | { k: 'session.renamed'; title: string }
  | { k: 'session.slept' }
  | { k: 'session.woke'; resumedFromSeq: number }
  | { k: 'session.error'; message: string; fatal: boolean }

  // §7 turni, step, parti
  | { k: 'turn.started'; turnId: string; prompt: PromptPart[] }
  | { k: 'turn.ended'; turnId: string; reason: 'completed' | 'aborted' | 'error'
      usage: Usage; cost: Cost }
  | { k: 'step.started'; stepId: string }
  | { k: 'step.ended'; stepId: string; finish: string; usage: Usage }

  | { k: 'text.started'; partId: string }
  | { k: 'text.delta'; partId: string; delta: string }
  | { k: 'text.ended'; partId: string; text: string }

  | { k: 'reasoning.started'; partId: string }
  | { k: 'reasoning.delta'; partId: string; delta: string; estimatedTokens?: number }
  | { k: 'reasoning.ended'; partId: string }

  | { k: 'tool.started'; callId: string; name: string }
  | { k: 'tool.input.delta'; callId: string; delta: string }
  // `summary` e "su cosa" il tool ha lavorato, gia pronto: il comando, il percorso,
  // l'indirizzo. Lo scrive l'adapter perche estrarlo da `input` vuol dire conoscere la
  // forma di un agent, ed e esattamente cio che il §1 vieta fuori di li.
  | { k: 'tool.input.ended'; callId: string; input: unknown; summary?: string }
  | { k: 'tool.ended'; callId: string; ok: boolean; output?: unknown; error?: string }

  // §8 richieste bloccanti — nel caso normale NON esistono affatto (ADR-008)
  | { k: 'permission.asked'; requestId: string; action: string; resources: string[]
      savable: string[]; source: { callId?: string } }
  | { k: 'permission.replied'; requestId: string
      decision: 'once' | 'always' | 'reject'; scope?: string; message?: string }
  // §16.1 risolto: le domande arrivano come una normale richiesta di permesso sul tool
  // `AskUserQuestion`. Non sono un canale a parte, ma restano un evento a parte: per
  // l'utente "scegli fra queste opzioni" e "posso eseguire questo comando?" sono due
  // cose diverse, e una UI che le mostrasse uguali mentirebbe.
  | { k: 'question.asked'; requestId: string; questions: AgentQuestion[] }
  | { k: 'question.replied'; requestId: string
      answers: Record<string, string | string[]>; response?: string }
  | { k: 'question.rejected'; requestId: string }

  // §9 effetti collaterali
  | { k: 'file.edited'; path: string; hunks: Hunk[]; created: boolean
      originalFile?: string; callId?: string }
  | { k: 'command.executed'; command: string; stdout: string; stderr: string
      exitCode?: number; interrupted: boolean; callId?: string }

  // §10 meta
  | { k: 'usage.updated'; usage: Usage; cost: Cost }
  | { k: 'quota.updated'; status: string; kind: string; resetsAt: number
      usingOverage: boolean }
  /**
   * Il contesto è stato riassunto: da qui in su il modello non ha più i messaggi per
   * intero, ma un riassunto. Osservato dal vivo: `manual` con 34.802 → 743 token in
   * 8,7 s. `after` è opzionale perché il protocollo lo dichiara tale — mostrare uno
   * zero al posto di «non lo so» sarebbe la solita bugia comoda.
   */
  | { k: 'context.compacted'; before: number; after?: number
      trigger?: 'manual' | 'auto'; ms?: number }
  | { k: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
  | { k: 'action.blocked'; by: 'classifier' | 'denyRule'; callId?: string; reason: string }

export type PayloadKind = Payload['k']

// ─── §4 involucro ───────────────────────────────────────────────────────────

export type CanonicalEvent = {
  v: typeof MODEL_VERSION
  seq: number       // progressivo per sessione, assegnato da STARK, senza buchi
  ts: number        // epoch ms, assegnato da STARK alla normalizzazione
  sessionId: string
  payload: Payload
}

// ─── §11 comandi dalla UI al daemon ─────────────────────────────────────────

export type PermissionRuleDecision = 'allow' | 'ask' | 'deny'
export type PermissionRules = Record<string, PermissionRuleDecision>

/**
 * Le categorie del pannello dei permessi (§16.5, e ADR-008).
 *
 * **Categorie, non nomi di tool**: «comandi shell» invece di `Bash`, «strumenti
 * esterni» invece di `mcp__*`. I nomi dei tool sono vocabolario di Claude Code, ed è
 * esattamente ciò che il modello canonico esiste per non far uscire dall'adapter — a
 * tradurre una categoria nei tool di un agent è l'adapter, che è l'unico a conoscerli.
 *
 * Sono sei perché sono sei le cose che un utente riconosce guardando cosa sta per
 * succedere. Un elenco di venti tool sarebbe più preciso e inservibile.
 */
export type PermissionCategory =
  | 'shell'     // eseguire comandi
  | 'edit'      // scrivere, cambiare, cancellare file
  | 'read'      // aprire e cercare dentro la cartella
  | 'net'       // rete: pagine, ricerche
  | 'agents'    // sotto-agent che lavorano per conto loro
  | 'external'  // strumenti esterni collegati (MCP)

export const PERMISSION_CATEGORIES: PermissionCategory[] =
  ['shell', 'edit', 'read', 'net', 'agents', 'external']

/** Cosa fa STARK per ciascuna categoria. `deny` è un altro meccanismo: vedi §16.5. */
export type CategoryRules = Record<PermissionCategory, 'allow' | 'ask'>

export const CATEGORY_DEFAULTS: CategoryRules = {
  // Tutto su «fai pure»: è il comportamento che rende il lavoro scorrevole ed è quello
  // che si vuole quasi sempre (ADR-008). Ogni interruttore spostato **aggiunge** un
  // riquadro di conferma dove lo si desidera, invece di toglierne uno.
  shell: 'allow', edit: 'allow', read: 'allow', net: 'allow',
  agents: 'allow', external: 'allow',
}

export type Command =
  | { c: 'session.open'; agent: string; cwd: string; model?: string; mode?: PermissionMode }
  | { c: 'session.prompt'; text: string; attachments?: Attachment[] }
  | { c: 'session.interrupt' }
  | { c: 'session.setModel'; model: string }
  | { c: 'session.setMode'; mode: PermissionMode }
  | { c: 'session.setMcp'; server: string; enabled: boolean }
  | { c: 'permissions.setRules'; rules: PermissionRules }
  | { c: 'session.rename'; title: string }
  | { c: 'session.sleep' }
  | { c: 'session.wake' }
  | { c: 'session.close' }
  | { c: 'permission.reply'; requestId: string
      decision: 'once' | 'always' | 'reject'; scope?: string }
  | { c: 'question.reply'; requestId: string
      answers: Record<string, string | string[]>; response?: string }
  | { c: 'question.reject'; requestId: string }

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Il testo di un prompt, senza le immagini. Sta qui perché serve identico in tre posti
 * — il titolo della conversazione, l'intestazione del turno, l'import — e perché da
 * quando un prompt può contenere altro, `parts.map(p => p.text)` non è più vero.
 */
export const promptText = (parts: PromptPart[]): string =>
  parts.filter(p => p.type === 'text').map(p => p.text).join(' ')
