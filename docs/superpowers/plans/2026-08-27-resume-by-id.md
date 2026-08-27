# Riprendere una chat per id (Resume) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una terza linguetta «Resume» in NewChat, dove incollare un id di sessione
Claude Code apre quella chat in STARK — cercandola in tutti i profili della macchina,
importandola se STARK non la conosce ancora, e rendendola viva con `resume`.

**Architecture:** `registry.importSession` smette di usare `listTranscripts` (bounded
a 60, un solo profilo) e cerca invece con `transcriptPath` in tutti i profili di
`listProfiles()`. Il risultato porta `configDir` quando il profilo trovato non è
quello di default. `Store.resumeById` (nuovo, stesso stile di `wake()`) incatena
import → lettura del `cwd` → apertura con `resume`.

**Tech Stack:** Svelte 5, TypeScript eseguito diretto (daemon), Vite (UI). Nessuna
libreria nuova, nessuna rotta HTTP nuova.

## Global Constraints

- Node ≥ 22.18. TypeScript eseguito diretto per il daemon (niente build); la UI si
  compila con Vite.
- `npm run check` (109 verifiche) deve restare verde ad ogni commit.
- Niente rotta nuova: `POST /api/importable` esiste già e passa `esito` per intero —
  solo `registry.importSession` e i tipi che lo descrivono cambiano.
- Un id non trovato in nessun profilo: messaggio chiaro, nessun residuo (nessun
  journal orfano) — stessa disciplina di `registry.open` sul confine.

---

## File Structure

**Modificare:**
- `src/daemon/registry.ts` — `importSession()` riscritta.
- `src/adapters/claude-code/catalogue.ts` — nessuna modifica di firma, solo lettura
  (verificare che `transcriptPath` sia già esportata, lo è).
- `ui/src/lib/api.ts` — `doImport()` ritorna anche `configDir?: string`.
- `ui/src/lib/store.svelte.ts` — `NewTab` include `'resume'`; nuovo metodo `resumeById`.
- `ui/src/components/NewChat.svelte` — terza linguetta, campo id, chiamata al metodo.
- `src/cli/offline-check.ts` — verifiche nuove per `importSession` (ricerca cross-profilo).

---

## Task 1: `registry.importSession` cerca in tutti i profili

**Files:**
- Modify: `src/daemon/registry.ts`
- Read first: `src/adapters/claude-code/catalogue.ts` (firma di `transcriptPath`),
  `src/adapters/claude-code/profiles.ts` (firma di `listProfiles`/`configDirOf`)

**Interfaces:**
- Consumes: `transcriptPath(sessionId, configDir?)` da `catalogue.ts` (già esportata),
  `listProfiles(configDir?)` e `configDirOf(configDir?)` da `profiles.ts` (già esportate).
- Produces:
  ```ts
  async importSession(sessionId: string):
    Promise<{ ok: true; id: string; configDir?: string } | { ok: false; error: string }>
  ```
  `configDir` presente solo quando il profilo trovato **non** è
  `configDirOf(this.defaults.configDir)`.

- [ ] **Step 1: Aggiungi gli import mancanti in `registry.ts`**

```ts
import { transcriptPath } from '../adapters/claude-code/catalogue.ts'
import { configDirOf, listProfiles } from '../adapters/claude-code/profiles.ts'
```
(`transcriptPath` va aggiunta alla riga che già importa `isRecent, listTranscripts`
da `catalogue.ts` — un solo import per file, non due righe separate.)

- [ ] **Step 2: Riscrivi `importSession`**

Sostituisci il corpo di `importSession` (oggi usa `listTranscripts().find(...)`) con:

```ts
/**
 * Porta dentro una conversazione della CLI, riusandone l'id.
 *
 * Cerca per nome file (`transcriptPath`), non nell'elenco dei 60 trascritti più
 * recenti (`listTranscripts`, pensato per una lista da sfogliare): un id scritto a
 * mano può essere vecchio quanto si vuole. Cerca prima nel profilo di default, poi —
 * se non lo trova — in ognuno degli altri profili della macchina: un id può
 * appartenere a un `CLAUDE_CONFIG_DIR` diverso da quello con cui è partito il daemon.
 *
 * L'id è lo stesso di Claude Code di proposito: è anche il manico con cui la si
 * risveglia, quindi importare e poter riprendere sono la stessa cosa fatta una volta.
 * Un journal già presente non si tocca — reimportare sopra raddoppierebbe la storia.
 */
async importSession(sessionId: string):
  Promise<{ ok: true; id: string; configDir?: string } | { ok: false; error: string }> {
    const dest = resolve(SESSIONS, `${sessionId}.jsonl`)
    const journal = new Journal(dest, sessionId)
    if (journal.lastSeq > 0) {
      journal.close()
      return { ok: false, error: 'già importata' }
    }

    const defaultDir = configDirOf(this.defaults.configDir)
    let path = transcriptPath(sessionId, defaultDir)
    let foundIn: string | undefined
    if (!path) {
      for (const p of listProfiles(this.defaults.configDir)) {
        if (p.path === defaultDir) continue // già provato sopra
        const candidate = transcriptPath(sessionId, p.path)
        if (candidate) { path = candidate; foundIn = p.path; break }
      }
    }
    if (!path) {
      journal.close()
      return { ok: false, error: 'trascritto non trovato su questa macchina' }
    }

    try {
      const { events } = importTranscript(path)
      journal.append({ k: 'session.resumeRef', ref: sessionId }, events[0]?.ts ?? Date.now())
      for (const { payload, ts } of events) journal.append(payload, ts)
    } finally {
      journal.close()
    }
    this.bump()
    return { ok: true, id: sessionId, ...(foundIn ? { configDir: foundIn } : {}) }
}
```

**Nota:** `listProfiles(this.defaults.configDir)` include sempre il profilo di
default fra i candidati (lo fa già `listProfiles` internamente — verifica leggendo
`profiles.ts:82-90` prima di scrivere, per non ripetere la ricerca due volte se
`listProfiles` normalizza i path diversamente da `configDirOf`. Se i confronti di
percorso non tornano identici per lo stesso profilo, usa `resolve()` su entrambi i
lati del confronto `p.path === defaultDir`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: nessun errore.

- [ ] **Step 4: Verifiche in `src/cli/offline-check.ts`**

Aggiungi, vicino alle altre verifiche di import/browse (cerca `pickFolderNative` per
il punto d'inserimento), tre casi usando `registry` — leggi come le verifiche
esistenti costruiscono un `Registry` di prova (variabili `SESSIONS`/`defaults` finte,
probabilmente già presenti più in alto nel file per altre verifiche di `registry.ts`
— se non c'è ancora un'istanza di prova, guarda come `askCategories`/`readSettings`
vengono già esercitate con directory temporanee in questo file, stesso pattern):

```ts
// §resume: importSession cerca per nome file, non nei 60 recenti
{
  // Costruisci una struttura profilo finta: <tmp>/projects/<proj>/<id>.jsonl con un
  // trascritto minimo valido (stesso formato che importTranscript legge altrove in
  // questo file — riusa un trascritto di prova già presente, se ce n'è uno, invece
  // di inventarne il formato da zero).
  ...
  check('§resume: trova un trascritto per id anche fuori dai 60 più recenti', ...)
  check('§resume: cerca anche in un profilo diverso da quello di default', ...)
  check('§resume: un id assente in ogni profilo torna errore chiaro, nessun journal orfano', ...)
}
```

**Nota per chi implementa:** questo step è scritto a un livello più alto degli altri
perché `offline-check.ts` non ha ancora un punto di aggancio pronto per «due profili
finti sullo stesso filesystem temporaneo» — leggi come le verifiche esistenti create
directory temporanee (cerca `mkdtempSync`) e replica lo stesso stile. Se serve una
funzione di supporto nuova per costruire un profilo finto con un trascritto dentro,
scrivila lì accanto, non dentro `registry.ts`.

Run: `node src/cli/offline-check.ts`
Expected: `112/112 verifiche passate` (109 di prima + 3 nuove — se il numero non
torna, leggi quale riga dice FAIL).

- [ ] **Step 5: Commit**

```bash
git add src/daemon/registry.ts src/cli/offline-check.ts
git commit -m "Resume per id: importSession cerca per nome file in tutti i profili"
```

---

## Task 2: `Store.resumeById` e il tipo `NewTab`

**Files:**
- Modify: `ui/src/lib/api.ts`
- Modify: `ui/src/lib/store.svelte.ts`

**Interfaces:**
- Consumes: `Api.doImport`, `Api.open`, `Api.snapshot` (tutte già esistenti).
- Produces:
  ```ts
  // api.ts
  doImport(sessionId: string): Promise<Ack & { id?: string; configDir?: string }>

  // store.svelte.ts
  export type NewTab = 'new' | 'import' | 'resume'
  async resumeById(id: string): Promise<void>
  ```

- [ ] **Step 1: `api.ts` — aggiungi `configDir` al tipo di ritorno di `doImport`**

Trova la riga:
```ts
async doImport(sessionId: string): Promise<Ack & { id?: string }> {
```
diventa:
```ts
async doImport(sessionId: string): Promise<Ack & { id?: string; configDir?: string }> {
```
(il corpo del metodo non cambia — è già un passthrough della risposta del daemon.)

- [ ] **Step 2: `store.svelte.ts` — estendi `NewTab`**

Trova:
```ts
export type NewTab = 'new' | 'import'
```
diventa:
```ts
export type NewTab = 'new' | 'import' | 'resume'
```

- [ ] **Step 3: `store.svelte.ts` — aggiungi `resumeById`**

Subito dopo il metodo `wake()` esistente (stesso raggruppamento logico):

```ts
/**
 * Riprende una chat per id, anche se STARK non l'ha mai vista: la importa (se serve)
 * e la apre live con `resume`. Stesso meccanismo di `wake()`, ma senza partire da una
 * riga dell'elenco — l'unica cosa che si ha è l'id scritto a mano.
 */
async resumeById(id: string): Promise<void> {
  const clean = id.trim()
  if (!clean) return
  this.working = true
  this.refused = null
  try {
    const esito = await this.api.doImport(clean)
    let cwd: string | undefined
    if (esito.ok) {
      cwd = (await this.api.snapshot(clean)).snapshot.cwd
    } else {
      // «Già importata» non è un fallimento vero: l'id è già una chat di STARK, si
      // prova comunque a leggerla. Se non esiste affatto, l'errore dell'import
      // (che dice PERCHÉ — non trovata in nessun profilo) è quello giusto da mostrare.
      try { cwd = (await this.api.snapshot(clean)).snapshot.cwd } catch {
        this.refused = esito.error ?? 'refused'
        return
      }
    }
    if (!cwd) { this.refused = 'this conversation has no folder to resume in'; return }
    // Il profilo trovato durante l'import (se diverso dal default) diventa il fatto
    // del progetto, come la prima chat di una cartella nuova in `newChat()`.
    if (esito.ok && esito.configDir && this.project(cwd).profile !== esito.configDir) {
      void this.setProject(cwd, { profile: esito.configDir })
    }
    const profile = (esito.ok ? esito.configDir : undefined) ?? this.project(cwd).profile
    await this.api.open({ cwd, resume: { ref: clean }, ...(profile ? { configDir: profile } : {}) })
    this.dialog = null
    await this.select(clean)
  } catch (e) {
    this.refused = (e as Error).message
  } finally {
    this.working = false
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p ui/tsconfig.json`
Expected: nessun errore. Se `snapshot.cwd` non risolve, controlla il tipo
`SessionSnapshot` in `$core/reduce.ts` — `cwd` è già un campo esistente lì (usato da
`Conversation.svelte`), non va aggiunto.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/api.ts ui/src/lib/store.svelte.ts
git commit -m "Resume per id: Store.resumeById incatena import, cwd e apertura"
```

---

## Task 3: la linguetta «Resume» in `NewChat.svelte`

**Files:**
- Modify: `ui/src/components/NewChat.svelte`
- Read first: le linguette esistenti (righe ~158-177 circa — la larghezza del
  dialogo, il titolo, i bottoni New/Import — verifica i numeri di riga attuali con
  `grep -n "store.tab" ui/src/components/NewChat.svelte`, potrebbero essere diversi
  dopo i task precedenti se qualcosa è cambiato nel frattempo, cosa improbabile ma
  da controllare)

**Interfaces:**
- Consumes: `Store.resumeById`, `Store.tab` (Task 2), `Store.working`, `Store.refused`.

- [ ] **Step 1: Stato locale per il campo id**

Vicino a `let filter = $state('')`:
```ts
let resumeId = $state('')
const resumeReady = $derived(resumeId.trim().length > 0 && !store.working)
function startResume(): void {
  if (resumeReady) void store.resumeById(resumeId.trim())
}
```

- [ ] **Step 2: Aggiorna `goto()` per accettare la terza linguetta**

Trova:
```ts
function goto(tab: 'new' | 'import'): void {
```
diventa:
```ts
function goto(tab: 'new' | 'import' | 'resume'): void {
```
Il corpo non cambia (il caricamento di `importable` resta condizionato a
`tab === 'import'`, il nuovo tab non carica niente all'apertura — l'utente scrive,
non sfoglia).

- [ ] **Step 3: Larghezza e titolo del dialogo**

Trova la riga con la larghezza condizionale:
```svelte
<div class="dlg" style="width:{store.tab === 'import' ? 560 : 430}px">
```
Il tab «resume» ha un contenuto minimo (un campo di testo) — resta sui 430px di
«new», quindi la condizione non cambia (`'import'` è l'unico caso largo).

Trova il titolo:
```svelte
<div class="dt">{store.tab === 'new' ? 'New chat' : 'Import a conversation'}</div>
```
diventa:
```svelte
<div class="dt">
  {store.tab === 'new' ? 'New chat' : store.tab === 'import' ? 'Import a conversation' : 'Resume a conversation'}
</div>
```

- [ ] **Step 4: Il terzo bottone linguetta**

Trova:
```svelte
<button class:on={store.tab === 'new'} onclick={() => goto('new')}>New</button>
<button class:on={store.tab === 'import'} onclick={() => goto('import')}>Import</button>
```
diventa (aggiungi il terzo, stesso stile):
```svelte
<button class:on={store.tab === 'new'} onclick={() => goto('new')}>New</button>
<button class:on={store.tab === 'import'} onclick={() => goto('import')}>Import</button>
<button class:on={store.tab === 'resume'} onclick={() => goto('resume')}>Resume</button>
```

- [ ] **Step 5: Il corpo della linguetta**

Trova il blocco `{#if store.tab === 'new'}` ... e il corrispondente per `'import'`
(cerca `{:else if store.tab === 'import'}` o un secondo `{#if}` separato — segui lo
stile che il file già usa). Aggiungi, come ramo pari agli altri due:

```svelte
{:else if store.tab === 'resume'}
  <!-- Un campo solo: il cwd si legge dal trascritto trovato, non lo si sceglie qui —
       vedi la spec, `docs/superpowers/specs/2026-08-27-resume-by-id-design.md`. -->
  <div class="field">
    <input placeholder="c15a2fde-a535-4cdd-9764-b40cffaf2bf0" bind:value={resumeId}
      onkeydown={e => { if (e.key === 'Enter') startResume() }} />
  </div>
  <div class="hint">Paste a Claude Code session id. STARK looks for it across every
    profile on this machine, imports its history if it doesn't have it yet, and opens
    it live — the same as <code>claude -r &lt;id&gt;</code>.</div>
{/if}
```

(`.field`/`.hint` sono classi globali già usate altrove nel file per lo stesso scopo —
verifica con `grep -n "class=\"field\"" ui/src/components/NewChat.svelte` che il
markup interno di un campo di testo esistente combaci, per non introdurre uno stile
diverso da quello del resto del dialogo.)

- [ ] **Step 6: Il bottone di conferma in fondo al dialogo**

Trova dove il dialogo decide quale azione lanciare a seconda della linguetta (il
bottone «Create»/«Import» in fondo — cerca `onclick={start}` o simile vicino al
fondo del template). Aggiungi il terzo caso:

```svelte
{:else if store.tab === 'resume'}
  <button class="btn" disabled={!resumeReady} onclick={startResume}>
    {store.working ? 'Opening…' : 'Resume'}
  </button>
```

- [ ] **Step 7: Typecheck e build**

Run: `npx tsc --noEmit -p ui/tsconfig.json && npx vite build` (dalla cartella `ui/`)
Expected: nessun errore, build completa.

- [ ] **Step 8: Verifica dal vivo**

Con Playwright/Chrome DevTools su un daemon di prova (journal sintetico, costo zero):
1. Apri «New chat», tre linguette visibili: New, Import, Resume.
2. Vai su Resume, scrivi un id che non esiste da nessuna parte: dopo l'invio, un
   messaggio d'errore chiaro (non un errore generico, non uno schermo bianco).
3. Se disponibile un id reale su questa macchina (`npm run check` o `npm run slice`
   ne lasciano uno nel journal di prova, o cercane uno vero con
   `ls ~/.claude/projects/*/*.jsonl` se esiste): scrivilo, Invio, verifica che la
   chat si apra e compaia nell'elenco.

- [ ] **Step 9: Commit**

```bash
git add ui/src/components/NewChat.svelte
git commit -m "Resume per id: terza linguetta in New chat"
```

---

## Verifica finale

- [ ] `npm run check` → 112/112 (109 baseline + 3 di Task 1)
- [ ] `npx tsc --noEmit -p tsconfig.json` (daemon) → nessun errore
- [ ] `npx tsc --noEmit -p ui/tsconfig.json` → nessun errore
- [ ] `npx vite build` (dentro `ui/`) → build completa
- [ ] Verifica dal vivo: id inesistente → errore chiaro; id reale (se disponibile) →
  la chat si apre e compare nell'elenco
