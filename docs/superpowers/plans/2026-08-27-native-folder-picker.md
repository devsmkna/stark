# Finder di sistema per New chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere a "New chat" un bottone che apre il selettore di cartelle nativo
della macchina del daemon (Explorer su WSL, Finder su macOS, Nautilus/zenity su Linux),
accanto — non al posto — del browser manuale già esistente (`Open path…`).

**Architecture:** Il dialogo nativo lo apre il **daemon** (mai il browser: un
`<input webkitdirectory>` non dà un percorso assoluto utilizzabile). Nuovo modulo
`src/daemon/native-browse.ts` con `execFile` per piattaforma, stessa forma di
`src/daemon/reveal.ts` già esistente. Nuova rotta `POST /api/browse-native` e un campo
`nativeFolderPicker` su `GET /api/system`. `NewChat.svelte` aggiunge un bottone che
chiama la rotta e scrive il risultato in `cwd`.

**Tech Stack:** Node (`node:child_process.execFile`), TypeScript eseguito diretto (no
build per il daemon), Svelte 5 (`$state`/`$effect`) per la UI.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-08-27-native-folder-picker-design.md`.
  Ogni requisito lì dentro vale implicitamente per ogni task qui sotto.
- `execFile`, **mai** `exec`: argomenti come array, mai una stringa di shell interpolata.
- Il dialogo nativo parte **sempre** dalla home del processo (`os.homedir()`), mai dalla
  cartella già scritta nella casella — decisione esplicita, non un dettaglio da rivedere.
- Annullo o comando assente → `{ ok: false }`, **mai** un'eccezione che risale e **mai**
  un messaggio di errore mostrato in UI: silenzioso, si torna allo stato di prima.
- `nativeFolderPickerAvailable()` va ricalcolato a **ogni chiamata**, non messo in cache
  all'avvio del daemon (vedi la spec, motivo: staleness già osservata col rilevamento
  Tailscale).
- Il tree manuale esistente (`GET /api/browse`, `registry.browse`, il markup
  `browsing`/`browseDirs`/… in `NewChat.svelte`) **non si tocca**.
- Node ≥ 22.18 (già garantito dal repo).

---

### Task 1: `src/daemon/native-browse.ts` — il modulo, provato in isolamento

**Files:**
- Create: `src/daemon/native-browse.ts`
- Modify (aggiunta di checks, non di codice di produzione): `src/cli/daemon-check.ts`

**Interfaces:**
- Produce (usato dal Task 2): `nativeFolderPickerAvailable(): Promise<boolean>`,
  `pickFolderNative(): Promise<NativePickResult>`, dove
  `type NativePickResult = { ok: true; path: string } | { ok: false }`.
- Produce (usato solo dai test di questo task): `commandExists(name: string): Promise<boolean>`.
- Consuma: `WSL` da `../core/platform.ts` (già esistente, esporta `export const WSL: boolean`).

- [ ] **Step 1: Scrivi il modulo**

```ts
// src/daemon/native-browse.ts
//
// Il Finder di sistema per "New chat" (spec:
// docs/superpowers/specs/2026-08-27-native-folder-picker-design.md). Stessa forma di
// reveal.ts: `execFile` con argomenti come array, mai una stringa di shell, e nessuna
// eccezione che risale al chiamante — un dialogo che non parte è un fastidio
// dell'utente, non un guasto del daemon.

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { WSL } from '../core/platform.ts'

const run = promisify(execFile)

export type NativePickResult = { ok: true; path: string } | { ok: false }

/** Il comando esiste nel PATH di questo processo? Non lancia mai un'eccezione. */
export async function commandExists(name: string): Promise<boolean> {
  try {
    await run('which', [name])
    return true
  } catch {
    return false
  }
}

/**
 * Il meccanismo per il Finder nativo è disponibile su questa macchina, **adesso**.
 * Ricalcolato a ogni chiamata invece che in cache all'avvio: la stessa lezione già
 * scritta per il rilevamento Tailscale (`security.ts`) — una cache calcolata una sola
 * volta resterebbe sbagliata per tutta la vita del processo dopo un'installazione a
 * daemon acceso, e qui il costo di ricontrollare è un solo `execFile` veloce.
 */
export async function nativeFolderPickerAvailable(): Promise<boolean> {
  if (WSL) return commandExists('powershell.exe')
  if (process.platform === 'darwin') return true // osascript è di sistema su macOS
  return commandExists('zenity')
}

/**
 * Apre il selettore di cartelle nativo, partendo sempre dalla home dell'utente del
 * processo — non dalla cartella già scritta nella casella "Folder", per scelta
 * esplicita (vedi la spec). Annullo, comando assente o qualunque errore tornano
 * `{ ok: false }`, mai un'eccezione: un annullo non è un fallimento del daemon.
 */
export async function pickFolderNative(): Promise<NativePickResult> {
  try {
    if (WSL) {
      // `wslpath -w` traduce la home (sia sotto `/mnt/`, DrvFs, sia nativa ext4) nel
      // percorso Windows che `FolderBrowserDialog` sa capire — stessa funzione già
      // usata al contrario in `reveal.ts`.
      const { stdout: winHome } = await run('wslpath', ['-w', homedir()])
      // `-STA`: `FolderBrowserDialog` è un dialogo WinForms e richiede un thread STA,
      // altrimenti PowerShell lancia un'eccezione COM prima di mostrare qualunque cosa.
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
        `$f.SelectedPath = '${winHome.trim().replace(/'/g, "''")}'`,
        'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }',
      ].join('\n')
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script])
      const win = stdout.trim()
      if (!win) return { ok: false } // annullato: nessuna riga in output
      const { stdout: posix } = await run('wslpath', ['-u', win])
      return { ok: true, path: posix.trim() }
    }
    if (process.platform === 'darwin') {
      // Non verificato dal vivo con un click reale (nessuna prova automatica può
      // pilotare un dialogo nativo di macOS): la sintassi segue la documentazione
      // AppleScript. Annullare fa uscire `osascript` con codice diverso da zero,
      // quindi `execFile` rigetta la promise — catturato sotto come annullo.
      const { stdout } = await run('osascript', ['-e',
        'POSIX path of (choose folder with prompt "Seleziona una cartella" default location (path to home folder))'])
      const path = stdout.trim()
      return path ? { ok: true, path } : { ok: false }
    }
    // Linux nativo: non verificato dal vivo (nessuna delle macchine di sviluppo lo è).
    // Annullo → `zenity` esce con codice 1 → `execFile` rigetta → catturato sotto.
    const { stdout } = await run('zenity', ['--file-selection', '--directory', `--filename=${homedir()}/`])
    const path = stdout.trim()
    return path ? { ok: true, path } : { ok: false }
  } catch {
    return { ok: false }
  }
}
```

- [ ] **Step 2: Verifica che compili**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: nessun errore relativo a `src/daemon/native-browse.ts`.

- [ ] **Step 3: Aggiungi i controlli in `src/cli/daemon-check.ts`**

Apri il file e trova la riga (circa la 78):

```ts
check('Origin nostro → 200',
  (await fetch(`${url}/api/sessions`, { headers: { ...auth, origin: url } })).status === 200)
```

Subito **dopo** quella riga, prima del commento `// ─── F3: arrivare a un file citato in chat ──`,
inserisci:

```ts

// ─── Finder di sistema: native-browse ───────────────────────────────────────
//
// Il modulo si prova in isolamento, senza aprire nessun dialogo vero: un vero click
// su `FolderBrowserDialog`/`choose folder`/`zenity` bloccherebbe questo script in
// attesa di un umano, che è esattamente il difetto che la regola di `--reveal` (più
// sotto) esiste per evitare — qui però non c'è nemmeno un flag che lo sblocca, perché
// un `explorer.exe /select,` ritorna subito (fire-and-forget), un dialogo di scelta
// cartella no: bloccherebbe fino alla chiusura manuale.
const { commandExists, nativeFolderPickerAvailable } = await import('../daemon/native-browse.ts')
check('commandExists: un comando reale (`ls`) c\'è', await commandExists('ls'))
check('commandExists: un comando inventato non c\'è',
  !(await commandExists('comando-che-non-esiste-davvero-xyz123')))
{
  // L'attesa è coerente con la piattaforma vera che sta eseguendo la prova, qualunque
  // essa sia — non si assume WSL: si ricalcola cosa ci si aspetta con la stessa logica
  // del modulo sotto test, per restare vero su qualunque macchina di sviluppo.
  const { WSL } = await import('../core/platform.ts')
  const atteso = WSL ? await commandExists('powershell.exe')
    : process.platform === 'darwin' ? true
    : await commandExists('zenity')
  check('nativeFolderPickerAvailable coerente con la piattaforma corrente',
    (await nativeFolderPickerAvailable()) === atteso)
}
```

- [ ] **Step 4: Esegui la prova**

Run: `npm run daemon`
Expected: le tre righe nuove (`commandExists: un comando reale…`, `commandExists: un
comando inventato…`, `nativeFolderPickerAvailable coerente…`) stampano `OK`, e il totale
in fondo cresce di 3 rispetto a prima.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/native-browse.ts src/cli/daemon-check.ts
git commit -m "$(cat <<'EOF'
Modulo per il Finder di sistema (WSL/macOS/Linux), provato in isolamento

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HpC8cpmeLP8jCav4W6Us5h
EOF
)"
```

---

### Task 2: Rotta `POST /api/browse-native` e campo `nativeFolderPicker` su `/api/system`

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/cli/daemon-check.ts`

**Interfaces:**
- Consuma (da Task 1): `nativeFolderPickerAvailable(): Promise<boolean>`,
  `pickFolderNative(): Promise<NativePickResult>` da `./native-browse.ts`.
- Produce (usato dal Task 3): risposta JSON di `POST /api/browse-native` è
  `{ ok: true, path: string }` o `{ ok: false }`; risposta di `GET /api/system` guadagna
  `nativeFolderPicker: boolean`.

- [ ] **Step 1: Importa il modulo in `server.ts`**

Trova la riga (vicino alle altre import del daemon):

```ts
import { reveal } from './reveal.ts'
```

Subito dopo, aggiungi:

```ts
import { nativeFolderPickerAvailable, pickFolderNative } from './native-browse.ts'
```

- [ ] **Step 2: Aggiungi la rotta**

Trova, in `server.ts`:

```ts
    if (method === 'GET' && path === '/api/browse') {
      return send(res, 200, registry.browse(url.searchParams.get('path') ?? undefined))
    }
```

Subito dopo, aggiungi:

```ts
    // Il Finder di sistema (spec: docs/superpowers/specs/2026-08-27-native-folder-
    // picker-design.md), accanto al browser manuale sopra — non al suo posto. Un
    // annullo dell'utente non è un errore: sempre 200, `{ok:false}` a dirlo.
    if (method === 'POST' && path === '/api/browse-native') {
      return send(res, 200, await pickFolderNative())
    }
```

- [ ] **Step 3: Aggiungi il campo a `/api/system`**

Trova:

```ts
    if (method === 'GET' && path === '/api/system') {
      // La diagnostica: chiede la versione all'eseguibile, quindi non è istantanea.
      // È la pagina che si guarda quando qualcosa sembra rotto senza motivo.
      return send(res, 200, {
        url: `http://127.0.0.1:${port()}`,
        port: port(),
        home: STARK_HOME,
        listening: 'localhost only',
        agent: await diagnostics(configDir),
      })
    }
```

Sostituiscila con:

```ts
    if (method === 'GET' && path === '/api/system') {
      // La diagnostica: chiede la versione all'eseguibile, quindi non è istantanea.
      // È la pagina che si guarda quando qualcosa sembra rotto senza motivo.
      return send(res, 200, {
        url: `http://127.0.0.1:${port()}`,
        port: port(),
        home: STARK_HOME,
        listening: 'localhost only',
        agent: await diagnostics(configDir),
        nativeFolderPicker: await nativeFolderPickerAvailable(),
      })
    }
```

- [ ] **Step 4: Verifica che compili**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Aggiungi i controlli di perimetro in `daemon-check.ts`**

Trova, dopo il blocco F1 (`/api/open-app`) e prima di `// ─── una sessione che non parte ──`:

```ts
check('un url malformato → 400, non un\'eccezione che porta giù la richiesta',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'not-a-url', scheme: 'notion' }),
  })).status === 400)
```

Subito dopo, aggiungi:

```ts

// ─── il Finder di sistema: rotta ─────────────────────────────────────────────
//
// Solo perimetro e forma della risposta: **non** si chiama davvero un click reale
// sul dialogo nativo (bloccherebbe questo script in attesa di un umano). Il click
// vero si verifica a mano, sulla macchina, come già per F1.
check('senza token → 403 anche per /api/browse-native',
  (await fetch(`${url}/api/browse-native`, { method: 'POST' })).status === 403)
const sistema = await (await fetch(`${url}/api/system`, { headers: auth })).json() as
  { nativeFolderPicker?: unknown }
check('/api/system espone `nativeFolderPicker` come booleano',
  typeof sistema.nativeFolderPicker === 'boolean', JSON.stringify(sistema.nativeFolderPicker))
```

- [ ] **Step 6: Esegui la prova**

Run: `npm run daemon`
Expected: le due righe nuove stampano `OK`, totale cresciuto di 2 rispetto al Task 1.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/server.ts src/cli/daemon-check.ts
git commit -m "$(cat <<'EOF'
Rotta /api/browse-native e campo nativeFolderPicker su /api/system

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HpC8cpmeLP8jCav4W6Us5h
EOF
)"
```

---

### Task 3: Client (`ui/src/lib/api.ts`)

**Files:**
- Modify: `ui/src/lib/api.ts`

**Interfaces:**
- Consuma (da Task 2): `POST /api/browse-native` → `{ok:true,path}|{ok:false}`;
  `GET /api/system` → ora include `nativeFolderPicker: boolean`.
- Produce (usato dal Task 4): `Api#browseNative(): Promise<NativePickResult>`,
  `type NativePickResult = { ok: true; path: string } | { ok: false }`,
  `SystemInfo['nativeFolderPicker']: boolean`.

- [ ] **Step 1: Aggiungi il tipo**

Trova:

```ts
/** Le sottocartelle di un percorso, per il dialogo «apri path» di New chat. */
export type BrowseResult = { path: string; parent: string | null; dirs: string[]; error?: string }
```

Subito dopo, aggiungi:

```ts

/** L'esito del Finder di sistema: `ok:false` copre sia l'annullo sia un errore — la
 *  UI li tratta identici (silenzioso), quindi non c'è bisogno di distinguerli qui. */
export type NativePickResult = { ok: true; path: string } | { ok: false }
```

- [ ] **Step 2: Estendi `SystemInfo`**

Trova:

```ts
export type SystemInfo = {
  url: string
  port: number
  home: string
  listening: string
  agent: {
    node: string; sdk?: string; cli?: string; executable?: string; bundled: boolean
    configDir: string
    profiles: { name: string; path: string; conversations: number; mcpServers: number; current: boolean }[]
  }
}
```

Sostituiscila con:

```ts
export type SystemInfo = {
  url: string
  port: number
  home: string
  listening: string
  agent: {
    node: string; sdk?: string; cli?: string; executable?: string; bundled: boolean
    configDir: string
    profiles: { name: string; path: string; conversations: number; mcpServers: number; current: boolean }[]
  }
  /** Il Finder nativo è disponibile su QUESTA esecuzione del daemon, ricalcolato a
   *  ogni richiesta — non è una proprietà stabile della macchina. */
  nativeFolderPicker: boolean
}
```

- [ ] **Step 3: Aggiungi il metodo**

Trova:

```ts
  system(): Promise<SystemInfo> { return this.json('/api/system') }
```

Subito dopo, aggiungi:

```ts

  /** Apre il Finder di sistema sulla macchina del daemon. Annullo o fallimento
   *  tornano `{ok:false}`: non è un'eccezione, la UI resta ferma senza avvisi. */
  browseNative(): Promise<NativePickResult> {
    return this.json('/api/browse-native', { method: 'POST' })
  }
```

- [ ] **Step 4: Verifica che compili**

Run: `npx tsc -p tsconfig.json --noEmit && npm run ui:check`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/api.ts
git commit -m "$(cat <<'EOF'
Client: NativePickResult e Api#browseNative(), SystemInfo.nativeFolderPicker

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HpC8cpmeLP8jCav4W6Us5h
EOF
)"
```

---

### Task 4: UI — bottone in `NewChat.svelte`

**Files:**
- Modify: `ui/src/components/NewChat.svelte`

**Interfaces:**
- Consuma (da Task 3): `store.api.system(): Promise<SystemInfo>` (già chiamato qui),
  `store.api.browseNative(): Promise<NativePickResult>`.

- [ ] **Step 1: Aggiungi lo stato e aggiorna l'effetto esistente**

Trova:

```ts
  let profiles = $state<SystemInfo['agent']['profiles'] | null>(null)
  let profilePick = $state<string | null>(null)
  $effect(() => {
    if (store.tab === 'new' && profiles === null) {
      void store.api.system().then(
        s => { profiles = s.agent.profiles },
        () => { profiles = [] },
      )
    }
  })
```

Sostituiscila con:

```ts
  let profiles = $state<SystemInfo['agent']['profiles'] | null>(null)
  let profilePick = $state<string | null>(null)
  // Il Finder nativo: parte `false` finché `/api/system` non risponde, quindi il
  // bottone nasce disabilitato — coerente col resto di STARK, che non mostra mai una
  // possibilità come attiva prima di averla verificata.
  let nativePicker = $state(false)
  let nativeBusy = $state(false)
  $effect(() => {
    if (store.tab === 'new' && profiles === null) {
      void store.api.system().then(
        s => { profiles = s.agent.profiles; nativePicker = s.nativeFolderPicker },
        () => { profiles = []; nativePicker = false },
      )
    }
  })

  /** Il dialogo blocca la risposta HTTP finché l'utente non sceglie o annulla: può
   *  durare secondi o minuti, da qui `nativeBusy` invece di un fallimento apparente. */
  async function browseNative(): Promise<void> {
    nativeBusy = true
    try {
      const r = await store.api.browseNative()
      if (r.ok) cwd = r.path
    } finally {
      nativeBusy = false
    }
  }
```

- [ ] **Step 2: Aggiungi il bottone accanto a "Open path…"**

Trova:

```svelte
          <button class="btn" type="button" onclick={openBrowse}>Open path…</button>
        </div>
```

Sostituiscila con:

```svelte
          <button class="btn" type="button" onclick={openBrowse}>Open path…</button>
          <button class="btn" type="button" disabled={!nativePicker || nativeBusy}
            title={nativePicker ? undefined : 'Not available on this machine (no native folder picker found)'}
            onclick={() => void browseNative()}>
            {nativeBusy ? 'Waiting…' : 'Browse (system Finder)…'}
          </button>
        </div>
```

- [ ] **Step 3: Aggiorna il testo d'aiuto**

Trova:

```svelte
          <div class="hint">The folder decides the project and its colour. Type the full path,
            or <b>Open path…</b> to browse the machine.</div>
```

Sostituiscila con:

```svelte
          <div class="hint">The folder decides the project and its colour. Type the full path,
            <b>Open path…</b> to browse the machine, or <b>Browse (system Finder)…</b> for the
            native picker.</div>
```

- [ ] **Step 4: Verifica che compili**

Run: `npm run ui:check`
Expected: nessun errore.

- [ ] **Step 5: Prova dal vivo**

Run: `npm run ui:build && npm run stark:up`

Nel browser, apri "New chat": il bottone `Browse (system Finder)…` deve comparire
abilitato (siamo su una macchina dove `nativeFolderPickerAvailable()` torna `true` —
macOS la garantisce sempre; su WSL serve `powershell.exe` in PATH, già verificato
presente sulle due macchine reali). Clicca: deve aprirsi il dialogo nativo del sistema.

- Scegli una cartella → la casella "Folder" si riempie col percorso scelto.
- Premi Annulla nel dialogo → nessun cambiamento, nessun errore in UI.

Se il dialogo non compare o il click non risponde entro qualche secondo, fermati e
segnala: non riprovare varianti alla cieca, è il momento di guardare `daemon.log`.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/NewChat.svelte
git commit -m "$(cat <<'EOF'
UI: bottone "Browse (system Finder)" accanto al browser manuale in New chat

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HpC8cpmeLP8jCav4W6Us5h
EOF
)"
```

---

### Task 5: Registrare la feature in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

Questo repo tiene un changelog discorsivo dentro `CLAUDE.md` (sezione "Stato attuale"):
ogni feature finita guadagna un paragrafo con cosa è cambiato, perché, e i numeri di
verifica aggiornati. Le altre 4 task non lo toccano di proposito — si aggiorna una volta
sola, a feature completa, con i numeri veri appena misurati.

- [ ] **Step 1: Prendi i numeri veri**

Run: `npm run check && npm run daemon`

Annota gli ultimi due numeri stampati (`N/N verifiche passate`) di entrambi i comandi —
sono quelli che vanno nel paragrafo, non quelli scritti altrove in questo file (che
riflettono lo stato prima di questa feature).

- [ ] **Step 2: Aggiungi il paragrafo**

Apri `CLAUDE.md`, trova il paragrafo più recente sotto "Stato attuale" (quello che inizia
con `**Le due misure mai fatte, fatte**`) e aggiungi **subito dopo la sua fine** (prima
della riga `Passo corrente:`) un nuovo paragrafo con questa forma (sostituisci `<N>` con
i numeri veri letti al passo 1):

```markdown
**Il Finder di sistema per "New chat"** (27 agosto 2026, chiesto dall'utente dopo aver
visto lo screenshot del browser manuale: «non è conveniente»). Accanto — non al posto —
del tree che elenca le sottocartelle una alla volta, un bottone apre il selettore
nativo della macchina del daemon: `System.Windows.Forms.FolderBrowserDialog` via
PowerShell su WSL, `choose folder` via `osascript` su macOS, `zenity
--file-selection --directory` su Linux nativo — stessa forma a tre rami di
`reveal.ts`, con lo stesso onestà sulla verifica: WSL e macOS scritti seguendo il
pattern, il ramo Linux nativo dichiaratamente non provato dal vivo.
Parte sempre dalla home del processo, mai dalla cartella già scritta nella casella —
scelta esplicita, non un dimenticato: il tree manuale resta la via per navigare da
dove si era, questa è la via per partire da capo col Finder che si conosce già.
`nativeFolderPickerAvailable()` si ricalcola **a ogni richiesta** invece che una sola
volta all'avvio — la stessa lezione già scritta per il rilevamento Tailscale, qui
applicata prima di ripeterla: un `execFile` in più costa pochissimo, una cache
sbagliata per tutta la vita del processo costerebbe un bottone spento senza motivo
dopo aver installato `zenity` a daemon acceso.
Annullare il dialogo, o non avere il comando giusto in `PATH`, tornano identici
(`{ok:false}`, silenzioso): non è un errore da mostrare, è "resta dove eri".
`npm run check` passa a **<N>**, `npm run daemon` a **<N>**.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Registra la feature del Finder di sistema in CLAUDE.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HpC8cpmeLP8jCav4W6Us5h
EOF
)"
```
