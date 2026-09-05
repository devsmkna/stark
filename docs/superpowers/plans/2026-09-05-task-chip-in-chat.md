# Task chip in chat (#NNN) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'agent cita i task della board come `#NNN`; la UI li rende chip cliccabili (e una card blocco alla prima citazione del turno) che aprono la Board sul dettaglio.

**Architecture:** due canali di trigger lato agent (blocco nei file di progetto, già esistente, + append al system prompt iniettato dall'adapter quando `.stark/kanban/` esiste); lato UI un post-processor DOM dentro `renderMarkdown` che risolve `#NNN` contro la board vera (rotta cloud del daemon) e degrada a testo quando non risolve.

**Tech Stack:** TypeScript eseguito diretto (daemon/adapter), Svelte 5 + marked + DOMPurify (UI), prove offline in `src/cli/offline-check.ts` (`check()`), prova browser in `tools/prova-*.mjs` con playwright-core.

**Spec:** `docs/superpowers/specs/2026-09-05-task-chip-in-chat-design.md` · **Card board:** #31

## Global Constraints

- Lavorare in un **worktree** (`EnterWorktree`), mai sul checkout principale; nel worktree servono `npm install` e `npm run ui:build`.
- `npm run typecheck` e `npm run check` verdi prima di ogni commit che tocca `src/`; `svelte-check` non è in `npm run check`, la UI si verifica con la prova browser (Task 7).
- I default dell'SDK non sono i default del CLI: il campo `system` di OpenCode **si misura prima di usarlo** (Task 3), non si deduce dai tipi.
- Il testo iniettato non deve mai lasciare l'agent istruito **meno** del terminale: su Claude Code solo `{ type: 'preset', preset: 'claude_code', append: … }`, mai un systemPrompt sostitutivo.
- Stili dei nodi generati dentro `{@html}`: **globali in `ui/src/app.css`**, non scoped (lezione di `tools/prova-codeblock.mjs`: lo scoped di `Conversation.svelte` non veste ciò che compare altrove).
- La verità dei chip viene **dalla board, non dal testo**: id non risolto → testo intatto, mai errore visibile.
- Commit frequenti, messaggi lunghi nello stile del repo (raccontano il perché).

---

### Task 0: Preparazione (worktree + claim)

**Files:** nessuno (solo ambiente e board).

- [ ] **Step 1: claim della card #31** (dalla radice del checkout principale, prima di tutto):

```bash
kanban-md --dir .stark/kanban edit 31 --claim "$(whoami)"
kanban-md --dir .stark/kanban move 31 in-progress --claim "$(whoami)"
```

Nota: la board di questo progetto sta migrando sul cloud; se `kanban-md` fallisse, usare la rotta del daemon come da skill `stark-kanban` (repo `skills/stark-kanban/SKILL.md`). Non editare i file a mano.

- [ ] **Step 2: worktree** — creare il worktree con `EnterWorktree` (finisce in `.claude/worktrees/`), poi lì dentro:

```bash
npm install
npm run ui:build
```

Attenzione (trappola nota): `npm install` può sporcare `package-lock.json` — non committarlo se il diff è solo rumore di install.

---

### Task 1: Il testo del trigger, condiviso (core) + blocco progetto + skill

**Files:**
- Create: `src/core/board-regola.ts`
- Modify: `src/daemon/board.ts` (costante `REGOLA_BOARD`)
- Modify: `skills/stark-kanban/SKILL.md`
- Test: `src/cli/offline-check.ts` (in coda alle verifiche esistenti)

**Interfaces:**
- Produces: `haBoard(cwd: string): boolean`; `ISTRUZIONE_BOARD: string` (testo pronto per l'append). Task 2 e 3 importano entrambi da `src/core/board-regola.ts`.

- [ ] **Step 1: verifica che fallisce** — in `src/cli/offline-check.ts`, dopo l'ultimo blocco di `check(...)` esistente e prima del `console.log` finale, aggiungere (l'import in testa al file, accanto agli altri import da `src/`):

```ts
import { haBoard, ISTRUZIONE_BOARD } from '../core/board-regola.ts'
```

```ts
// La board si cita in chat come #NNN (card #31): l'istruzione interna esiste, dice
// all'agent la forma esatta della citazione, e il rilevamento della board è lo stesso
// di allineaContestoBoard — la cartella `.stark/kanban/`.
{
  const dir = mkdtempSync(resolve(tmpdir(), 'stark-board-'))
  check('§31: senza `.stark/kanban/` la board non c\'è', haBoard(dir) === false)
  mkdirSync(resolve(dir, '.stark', 'kanban'), { recursive: true })
  check('§31: con `.stark/kanban/` la board c\'è', haBoard(dir) === true)
  check('§31: l\'istruzione interna insegna la citazione `#NNN`',
    ISTRUZIONE_BOARD.includes('#NNN') && ISTRUZIONE_BOARD.includes('claim'))
  rmSync(dir, { recursive: true, force: true })
}
```

(`mkdtempSync`, `mkdirSync`, `rmSync`, `tmpdir`, `resolve` sono quasi certamente già importati in offline-check; se no, aggiungerli da `node:fs`/`node:os`/`node:path`.)

- [ ] **Step 2: eseguire e vederla fallire**

Run: `npm run check`
Expected: FAIL — modulo `../core/board-regola.ts` inesistente (errore di risoluzione import).

- [ ] **Step 3: implementazione** — creare `src/core/board-regola.ts`:

```ts
// Il trigger della board che viaggia DENTRO STARK, non solo nei file di progetto.
//
// Il blocco in CLAUDE.md/AGENTS.md (src/daemon/board.ts) vale dove è scritto e finché
// nessuno lo toglie; questa istruzione invece la inietta l'adapter a ogni sessione che
// nasce o si risveglia su un progetto con una board (card #31). I due canali si
// sommano, non si escludono: il blocco resta perché copre anche il CLI nel terminale.
//
// Sta in core e non in daemon/board.ts perché la importano gli adapter, e un adapter
// che importa dal daemon rovescerebbe la direzione delle dipendenze.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Il progetto ha una board? Stesso segnale di `allineaContestoBoard`: la cartella
 *  `.stark/kanban/` — che con la board cloud resta come marcatore locale. */
export const haBoard = (cwd: string): boolean =>
  existsSync(resolve(cwd, '.stark', 'kanban'))

/**
 * L'istruzione iniettata. Dice tre cose sole: la board è la superficie di
 * coordinamento, la corrispondenza si verifica PRIMA di lavorare, e la citazione ha
 * una forma esatta — `#NNN` — perché la UI la riconosce e la rende cliccabile.
 */
export const ISTRUZIONE_BOARD = `Questo progetto ha una board kanban: è la superficie di coordinamento di default (comandi nella skill \`stark-kanban\`). Quando la richiesta dell'utente è un task, un fix o comunque un lavoro, PRIMA verifica se corrisponde a una card della board. Se corrisponde, cita la card nella risposta nella forma \`#NNN\` (es. \`#12\` — solo l'id così, la UI lo rende cliccabile) e falle claim subito. Se non corrisponde, crea la card e cita allo stesso modo l'id nuovo. Aggiorna lo stato della card nel momento in cui cambia, mai a fine lavoro.`
```

- [ ] **Step 4: la stessa regola nel blocco di progetto** — in `src/daemon/board.ts`, dentro `REGOLA_BOARD`, sostituire la riga:

```
Per i comandi esatti usa la skill \`stark-kanban\`.
```

con:

```
Quando prendi in carico una card, **citala in chat nella forma \`#NNN\`** (es. \`#12\`):
STARK la rende cliccabile e mostra la card nel flusso. Vale anche per una card appena
creata: cita l'id nuovo. Per i comandi esatti usa la skill \`stark-kanban\`.
```

- [ ] **Step 5: la stessa regola nella skill** — in `skills/stark-kanban/SKILL.md`, subito dopo la sezione «REGOLA — aggiorna lo stato SUBITO, non dopo», aggiungere:

```markdown
## REGOLA — cita la card in chat come `#NNN`

Quando lavori su una card (presa o appena creata), **citala nella risposta nella forma
`#NNN`** (es. `#12`): STARK riconosce la forma, la rende cliccabile e mostra la card
nel flusso della conversazione. Solo l'id con il cancelletto — niente titolo incollato,
niente link: il titolo e lo stato li mette la UI leggendo la board vera.
```

- [ ] **Step 6: verificare**

Run: `npm run typecheck && npm run check`
Expected: PASS, comprese le tre `§31`.

- [ ] **Step 7: commit**

```bash
git add src/core/board-regola.ts src/daemon/board.ts skills/stark-kanban/SKILL.md src/cli/offline-check.ts
git commit -m "feat(board): l'istruzione di citare le card come #NNN, nel blocco di progetto e in core (#31)"
```

---

### Task 2: Claude Code — append al preset quando la board c'è

**Files:**
- Modify: `src/adapters/claude-code/sdk-options.ts` (riga `systemPrompt: { type: 'preset', preset: 'claude_code' }` in `buildOptions`)
- Test: `src/cli/offline-check.ts`

**Interfaces:**
- Consumes: `haBoard`, `ISTRUZIONE_BOARD` da `src/core/board-regola.ts` (Task 1).

- [ ] **Step 1: verifica che fallisce** — in offline-check, nel blocco `§31` del Task 1 (prima del `rmSync`), aggiungere:

```ts
  const conBoard = buildOptions({ cwd: dir, model: 'x', mode: 'auto', sessionId: 'a-b' })
  const sp = conBoard.systemPrompt as { type: string; preset: string; append?: string }
  check('§31: con board, il preset resta e l\'istruzione si somma',
    sp.type === 'preset' && sp.preset === 'claude_code' && sp.append === ISTRUZIONE_BOARD,
    JSON.stringify(sp).slice(0, 120))
  const senzaBoard = buildOptions({ cwd: tmpdir(), model: 'x', mode: 'auto', sessionId: 'a-b' })
  const sp2 = senzaBoard.systemPrompt as { type: string; append?: string }
  check('§31: senza board, nessun append — il prompt del terminale, identico a prima',
    sp2.type === 'preset' && sp2.append === undefined)
```

- [ ] **Step 2: vederla fallire**

Run: `npm run check`
Expected: FAIL su «con board, il preset resta e l'istruzione si somma» (append undefined).

- [ ] **Step 3: implementazione** — in `sdk-options.ts`, import in testa:

```ts
import { haBoard, ISTRUZIONE_BOARD } from '../../core/board-regola.ts'
```

e la riga del systemPrompt diventa (il commento lungo esistente sopra la riga NON si tocca — resta vero; aggiungere in coda al commento):

```ts
    // Quando il progetto ha una board (`.stark/kanban/`), all'istruzione del preset si
    // SOMMA il trigger della board (card #31): `append` è la forma documentata
    // dall'SDK («Use default prompt with appended instructions», sdk.d.ts) e il preset
    // resta intero — mai un prompt sostitutivo, vedi sopra perché.
    systemPrompt: haBoard(o.cwd)
      ? { type: 'preset', preset: 'claude_code', append: ISTRUZIONE_BOARD }
      : { type: 'preset', preset: 'claude_code' },
```

- [ ] **Step 4: verificare**

Run: `npm run typecheck && npm run check`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/adapters/claude-code/sdk-options.ts src/cli/offline-check.ts
git commit -m "feat(claude-code): trigger board iniettato con append al preset quando .stark/kanban/ esiste (#31)"
```

---

### Task 3: OpenCode — misurare `system` prima di usarlo

**Files:**
- Investigate: `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` (campo `system` sulla richiesta di prompt), sorgente del server opencode (GitHub `sst/opencode`, come il campo `system` viene usato nel comporre i messaggi)
- Modify (solo se la misura dice «si somma»): `src/adapters/opencode/adapter.ts` (chiamata `session.promptAsync`, ~riga 957)
- Modify: `docs/superpowers/specs/2026-09-05-task-chip-in-chat-design.md` (registrare l'esito della misura, qualunque sia)

**Interfaces:**
- Consumes: `haBoard`, `ISTRUZIONE_BOARD` da `src/core/board-regola.ts`.

- [ ] **Step 1: leggere il sorgente, non i tipi** — cercare nel repo `sst/opencode` (o nel pacchetto server installato, se contiene il sorgente) come il parametro `system` della richiesta di prompt entra nella costruzione dei messaggi: si **aggiunge** al system prompt dell'agent o lo **sostituisce**? Cercare l'handler della rotta prompt e il punto in cui `system` viene consumato.

- [ ] **Step 2: se la lettura non è conclusiva, misurare dal vivo** — sonda usa-e-getta sul modello delle prove opencode esistenti (`tools/prova-opencode-*.ts`): server opencode effimero, una sessione, un prompt con `system: 'Se nelle tue istruzioni compare la parola BANANA_MARCATORE rispondi solo SI, altrimenti solo NO.'`… non basta: per distinguere somma da sostituzione, chiedere all'agent con e senza `system` di elencare se possiede le istruzioni standard del proprio agent (es. conoscenza dei propri tool). Confrontare le due risposte. La sonda non si committa: si cancella dopo la misura (igiene del workspace), l'esito si scrive nella spec.

- [ ] **Step 3a (esito: si somma): implementare** — in `src/adapters/opencode/adapter.ts`, nella costruzione della richiesta di `promptAsync`, aggiungere:

```ts
      ...(haBoard(this.cwd) ? { system: ISTRUZIONE_BOARD } : {}),
```

(adattare `this.cwd` al nome vero del campo cartella dell'adapter — verificarlo nel file). Poi `npm run typecheck && npm run check`.

- [ ] **Step 3b (esito: sostituisce, o non misurabile): NON implementare** — lasciare OpenCode al solo canale `AGENTS.md`, e scrivere nella spec (sezione 1-bis) l'esito con la data e come è stato misurato. Un agent istruito meno del terminale è peggio di un trigger in meno.

- [ ] **Step 4: commit** (in entrambi i casi — anche l'esito negativo è un fatto da registrare):

```bash
git add -A src/adapters/opencode docs/superpowers/specs/2026-09-05-task-chip-in-chat-design.md
git commit -m "opencode: esito della misura sul campo system del prompt (#31)"
```

---

### Task 4: UI — `boardref.ts`, il risolutore dei `#NNN`, e la veste

**Files:**
- Create: `ui/src/lib/boardref.ts`
- Modify: `ui/src/app.css` (in coda: stili `.taskchip`, `.taskcard`)

**Interfaces:**
- Consumes: tipo `Board`, `BoardTask` da `ui/src/lib/api.ts`.
- Produces (usati da Task 5 e 6):
  - `type TaskRef = { id: number; title: string; status: string; priority?: string; claimedBy?: string }`
  - `mappaTask(b: Board): Map<number, TaskRef> | null` — `null` se `assente`
  - `classeStato(status: string): 'work' | 'wait' | 'done' | 'todo'`
  - `decoraTaskDom(doc: Document, tasks: Map<number, TaskRef>, opts?: { carta?: boolean }): void`
  - `citaTask(testo: string, tasks: Map<number, TaskRef>): boolean`

- [ ] **Step 1: implementazione** — `ui/src/lib/boardref.ts`:

```ts
// I `#NNN` in chat diventano card della board (card #31, spec 2026-09-05).
//
// La verità viene dalla board, non dal testo: l'agent scrive solo `#12`, e titolo,
// stato e priorità li mette la UI leggendo la board vera. Un id che la board non
// conosce resta testo — un `#123` che parla di una issue GitHub non deve travestirsi
// da task. Il confronto è numerico: `#012` e `#12` sono lo stesso task.
import type { Board, BoardTask } from './api.ts'

export type TaskRef = {
  id: number; title: string; status: string; priority?: string; claimedBy?: string
}

/** La board in forma da lookup. `null` = il progetto non ha una board. */
export function mappaTask(b: Board): Map<number, TaskRef> | null {
  if (b.assente) return null
  const m = new Map<number, TaskRef>()
  for (const col of b.columns) for (const t of col.tasks as BoardTask[]) {
    m.set(t.id, {
      id: t.id, title: t.title, status: t.status,
      priority: t.priority, claimedBy: t.claimed_by,
    })
  }
  return m
}

/** Lo stato in una delle quattro famiglie di colore già esistenti nel tema. */
export function classeStato(status: string): 'work' | 'wait' | 'done' | 'todo' {
  if (status === 'in-progress') return 'work'
  if (status === 'review') return 'wait'
  if (status === 'done' || status === 'archived') return 'done'
  return 'todo'
}

const RIF = /#(\d{1,4})(?!\d)/g

/** C'è almeno un `#NNN` risolvibile FUORI dal codice? Serve a Conversation per
 *  decidere quale parte del turno porta la card blocco (la prima che cita). */
export function citaTask(testo: string, tasks: Map<number, TaskRef>): boolean {
  const senzaCodice = testo.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  for (const m of senzaCodice.matchAll(RIF)) if (tasks.has(Number(m[1]))) return true
  return false
}

/**
 * Cammina i nodi testo e sostituisce ogni `#NNN` risolvibile con un chip; con
 * `carta: true` la PRIMA citazione porta anche la card blocco, inserita dopo il
 * blocco che la contiene. Dentro `code`, `pre`, link e chip già fatti non si entra:
 * lì `#NNN` è contenuto, non citazione.
 */
export function decoraTaskDom(
  doc: Document, tasks: Map<number, TaskRef>, opts: { carta?: boolean } = {},
): void {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const testi: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = (n as Text).parentElement
    if (el?.closest('code, pre, a, button')) continue
    testi.push(n as Text)
  }
  let carta = opts.carta === true
  for (const nodo of testi) {
    const testo = nodo.textContent ?? ''
    RIF.lastIndex = 0
    if (!RIF.test(testo)) continue
    const frag = doc.createDocumentFragment()
    let cursore = 0
    RIF.lastIndex = 0
    for (const m of testo.matchAll(RIF)) {
      const t = tasks.get(Number(m[1]))
      if (!t) continue
      frag.append(testo.slice(cursore, m.index))
      frag.append(chip(doc, t))
      cursore = (m.index ?? 0) + m[0].length
      if (carta) {
        carta = false
        // La card va DOPO il blocco che contiene la citazione, non dentro la frase.
        const blocco = nodo.parentElement?.closest('p, li, h1, h2, h3, h4, blockquote')
        blocco?.after(cardBlocco(doc, t))
      }
    }
    if (cursore === 0) continue
    frag.append(testo.slice(cursore))
    nodo.replaceWith(frag)
  }
}

function chip(doc: Document, t: TaskRef): HTMLElement {
  const b = doc.createElement('button')
  b.className = 'taskchip'
  b.dataset['task'] = String(t.id)
  b.title = `${t.title} — ${t.status}`
  b.innerHTML = `<i class="tdot ${classeStato(t.status)}"></i>`
    + `<span class="tid">#${t.id}</span><span class="ttl"></span>`
  b.querySelector('.ttl')!.textContent = t.title
  return b
}

function cardBlocco(doc: Document, t: TaskRef): HTMLElement {
  const b = doc.createElement('button')
  b.className = 'taskcard'
  b.dataset['task'] = String(t.id)
  const prioAlta = t.priority === 'high' || t.priority === 'critical'
  b.innerHTML = `<span class="th"><span class="tid">#${t.id}</span><span class="ttl"></span></span>`
    + `<span class="tm"><span class="tbadge ${classeStato(t.status)}"></span>`
    + (prioAlta ? `<span class="tbadge prio"></span>` : '')
    + (t.claimedBy ? `<span class="tclm"></span>` : '') + `</span>`
  b.querySelector('.th .ttl')!.textContent = t.title
  b.querySelector('.tbadge')!.textContent = t.status
  if (prioAlta) b.querySelector('.tbadge.prio')!.textContent = t.priority ?? ''
  if (t.claimedBy) b.querySelector('.tclm')!.textContent = `@${t.claimedBy}`
  return b
}
```

Nota di sicurezza già rispettata dal codice sopra: titolo e claimed_by entrano con `textContent`, mai concatenati nell'`innerHTML` — vengono dalla board, che è scrivibile da chiunque abbia il token, e la regola di `markdown.ts` (DOMPurify prima, nodi costruiti dopo) non va aggirata proprio qui.

- [ ] **Step 2: la veste** — in coda a `ui/src/app.css`:

```css
/* ── #NNN: chip e card della board dentro la conversazione (card #31) ── */
.taskchip{display:inline-flex;align-items:center;gap:6px;vertical-align:baseline;max-width:100%;
  background:var(--surface-2);border:1px solid var(--line-2);border-radius:7px;
  padding:1px 8px 1px 6px;cursor:pointer;font:inherit;color:var(--ink)}
.taskchip:hover{border-color:var(--accent);background:var(--accent-soft)}
.taskchip .tid{font-family:var(--mono);font-size:.82em;font-weight:600;color:var(--accent)}
.taskchip .ttl{font-size:.9em;font-weight:500;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;max-width:34ch}
.tdot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none}
.tdot.work{background:var(--work)} .tdot.wait{background:var(--wait)}
.tdot.done{background:var(--done)} .tdot.todo{background:var(--muted)}
.taskcard{display:block;text-align:left;background:var(--surface-2);
  border:1px solid var(--line-2);border-left:3px solid var(--accent);border-radius:10px;
  padding:10px 14px;margin:10px 0 4px;cursor:pointer;font:inherit;color:var(--ink);max-width:480px}
.taskcard:hover{border-color:var(--accent)}
.taskcard .th{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.taskcard .th .tid{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--accent)}
.taskcard .th .ttl{font-size:13.5px;font-weight:600;flex:1;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.taskcard .tm{display:flex;align-items:center;gap:8px}
.taskcard .tclm{font-family:var(--mono);font-size:10.5px;color:var(--muted)}
.tbadge{font-size:9.5px;font-weight:700;letter-spacing:.03em;border-radius:5px;
  padding:1px 6px;text-transform:uppercase}
.tbadge.work{background:var(--work-bg);color:var(--work)}
.tbadge.wait{background:var(--wait-bg);color:var(--wait)}
.tbadge.done{background:var(--done-bg);color:var(--done)}
.tbadge.todo{background:var(--surface-3);color:var(--muted)}
.tbadge.prio{background:var(--stop-bg);color:var(--stop)}
```

(Se in `app.css` le variabili hanno nomi diversi da `--work`/`--wait`/`--done`/`--stop`, usare i nomi veri del file — verificarli, non dedurli dal mockup.)

- [ ] **Step 3: verificare che compili**

Run: `npm run ui:build`
Expected: build verde.

- [ ] **Step 4: commit**

```bash
git add ui/src/lib/boardref.ts ui/src/app.css
git commit -m "feat(ui): boardref — #NNN risolti contro la board diventano chip e card (#31)"
```

La prova vera del comportamento è la prova browser del Task 7: questi due file da soli non cambiano ancora niente di visibile.

---

### Task 5: `renderMarkdown` impara i task

**Files:**
- Modify: `ui/src/lib/markdown.ts` (funzione `renderMarkdown`, ~riga 75)

**Interfaces:**
- Consumes: `decoraTaskDom`, `TaskRef` da `ui/src/lib/boardref.ts` (Task 4).
- Produces: `renderMarkdown(text, opts)` con `opts` esteso: `{ asked?: boolean; tasks?: Map<number, TaskRef> | null; taskCarta?: boolean }`. Task 6 lo chiama così.

- [ ] **Step 1: implementazione** — import in testa a `markdown.ts`:

```ts
import { decoraTaskDom, type TaskRef } from './boardref.ts'
```

e `renderMarkdown` diventa:

```ts
export function renderMarkdown(
  text: string,
  opts: { asked?: boolean; tasks?: Map<number, TaskRef> | null; taskCarta?: boolean } = {},
): string {
  const html = marked.parse(text, { async: false }) as string
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html), 'text/html')
  highlightCode(doc)
  addCopyButtons(doc)
  addAppLinks(doc)
  markPaths(doc)
  decoraColoriDom(doc)
  // Dopo DOMPurify e dopo i decoratori esistenti: i chip nascono come nodi costruiti,
  // non come stringhe, e non devono mai entrare dentro code/pre/a (boardref.ts).
  if (opts.tasks?.size) decoraTaskDom(doc, opts.tasks, { carta: opts.taskCarta })
  if (opts.asked) markAsked(doc)
  return doc.body.innerHTML
}
```

- [ ] **Step 2: verificare**

Run: `npm run ui:build`
Expected: build verde. (Le chiamate esistenti passano `opts` senza `tasks`: nessun cambiamento di comportamento — verificato dal fatto che le prove browser esistenti, es. `node tools/prova-codeblock.mjs`, restano verdi.)

- [ ] **Step 3: commit**

```bash
git add ui/src/lib/markdown.ts
git commit -m "feat(ui): renderMarkdown accetta la mappa dei task e decora i #NNN (#31)"
```

---

### Task 6: Conversation, store e Board — dati, prima citazione, click

**Files:**
- Modify: `ui/src/lib/store.svelte.ts` (accanto a `boardOpen`/`toggleBoard`, ~riga 275)
- Modify: `ui/src/components/Conversation.svelte` (fetch della board, passaggio `tasks`/`taskCarta` alle chiamate `renderMarkdown` dei part testuali, ramo in `onProseClick`)
- Modify: `ui/src/components/Board.svelte` (selezione iniziale da store)

**Interfaces:**
- Consumes: `mappaTask`, `citaTask`, `TaskRef` (Task 4); `renderMarkdown` esteso (Task 5); `api.board(id)` esistente.
- Produces: `store.boardTask: number | null` e `store.openBoardTask(id: number): void`.

- [ ] **Step 1: store** — in `store.svelte.ts`, accanto a `boardOpen`:

```ts
  /** Il task da mostrare aperto quando la Board compare: lo scrive un click su un
   *  chip `#NNN` in chat, lo consuma (e azzera) Board.svelte. */
  boardTask = $state<number | null>(null)

  openBoardTask(id: number): void {
    this.boardTask = id
    if (!this.boardOpen) this.toggleBoard()
  }
```

- [ ] **Step 2: Board.svelte consuma la selezione** — dove la board ha caricato i dati (dopo che `dati` è popolato; c'è già un flusso/fetch — agganciarsi lì o con un `$effect`):

```ts
  // Un click su un chip in chat arriva qui: si apre quel task, sempre — anche se la
  // Board era già aperta su un altro (regola del link prevedibile, come /chat/<id>).
  $effect(() => {
    const cerca = store.boardTask
    if (cerca == null || !dati || dati.assente) return
    const t = dati.columns.flatMap(c => c.tasks).find(t => t.id === cerca)
    if (t) { aperta = t; crea = false }
    store.boardTask = null
  })
```

(`dati`, `aperta`, `crea` sono i nomi veri già presenti in `Board.svelte` — verificare le maiuscole e la forma del tipo prima di scrivere.)

- [ ] **Step 3: Conversation — la cache dei task** — stato locale del componente (una `Conversation` = un pannello = una sessione):

```ts
  import { api } from '../lib/api.ts'            // se non già importato con questo nome
  import { mappaTask, citaTask, type TaskRef } from '../lib/boardref.ts'

  // I task della board del progetto, per risolvere i `#NNN` del testo.
  // `undefined` = mai chiesti · `null` = il progetto non ha una board.
  let taskRefs = $state<Map<number, TaskRef> | null | undefined>(undefined)

  async function caricaBoard(): Promise<void> {
    try { taskRefs = mappaTask(await api.board(sessionId)) }
    catch { taskRefs = null /* daemon vecchio o board irraggiungibile: si degrada a testo */ }
  }

  // Si chiede la board la prima volta che nel testo compare un possibile `#NNN`, e la
  // si RIchiede quando l'agent finisce un turno: il claim e i move cambiano lo stato
  // mentre lavora, e un chip che mostra uno stato vecchio è una board che mente nel
  // punto più visibile.
  $effect(() => {
    const ceUnRiferimento = snapshot.turns.some(t =>
      t.parts.some(p => p.type === 'text' && /#\d{1,4}(?!\d)/.test(p.text)))
    if (ceUnRiferimento && taskRefs === undefined) void caricaBoard()
  })
  $effect(() => {
    void snapshot.state   // il passaggio a fermo = turno chiuso
    if (snapshot.state !== 'working' && taskRefs !== undefined) void caricaBoard()
  })
```

**Attenzione ai nomi**: `sessionId`, `snapshot`, la forma dei turni/parti (`t.parts`, `p.type === 'text'`, `p.text`) e il nome dello stato (`snapshot.state`, valore «al lavoro») vanno letti da `Conversation.svelte` e dal tipo `SessionSnapshot` — NON copiati alla cieca da qui. La logica sì è questa: (a) primo match testuale grezzo → fetch una volta; (b) turno chiuso → refetch.

- [ ] **Step 4: Conversation — passare i task al render** — la chiamata esistente (~riga 947):

```svelte
{@html renderMarkdown(part.text, { asked: isOpenQuestion(i, part) })}
```

diventa:

```svelte
{@html renderMarkdown(part.text, {
  asked: isOpenQuestion(i, part),
  tasks: taskRefs ?? null,
  taskCarta: taskRefs != null && primaCheCita(turn) === i,
})}
```

con, nello script:

```ts
  // L'indice della prima parte testuale del turno che cita un task risolvibile:
  // è quella — e solo quella — che porta la card blocco (spec §4).
  function primaCheCita(turn: Turn): number {
    if (taskRefs == null) return -1
    return turn.parts.findIndex(p => p.type === 'text' && citaTask(p.text, taskRefs!))
  }
```

(anche qui: `Turn`, `turn`, `i` = indice della parte nel ciclo — usare i nomi veri del componente; se il ciclo delle parti usa un altro indice, adattare).

- [ ] **Step 5: Conversation — il click** — in `onProseClick`, prima o accanto al ramo `data-copy` esistente:

```ts
    const chipEl = (e.target as HTMLElement).closest?.('[data-task]')
    if (chipEl) {
      e.preventDefault()
      store.openBoardTask(Number((chipEl as HTMLElement).dataset['task']))
      return
    }
```

- [ ] **Step 6: build e prove esistenti**

Run: `npm run ui:build && npm run typecheck && npm run check`
Expected: tutto verde.

- [ ] **Step 7: commit**

```bash
git add ui/src/lib/store.svelte.ts ui/src/components/Conversation.svelte ui/src/components/Board.svelte
git commit -m "feat(ui): i #NNN in chat si risolvono contro la board e il click apre il task (#31)"
```

---

### Task 7: La prova browser — chip veri, falsi positivi, click

**Files:**
- Create: `tools/prova-taskchip.mjs` (modellata su `tools/prova-codeblock.mjs`: journal finto, casa in /tmp, porta effimera, playwright-core; leggerla PRIMA di scrivere)
- Modify: `package.json` (script `"taskchip:check": "node tools/prova-taskchip.mjs"`)

**Interfaces:**
- Consumes: tutto il lavoro dei Task 4–6, la UI buildata (`npm run ui:build`).

- [ ] **Step 1: scrivere la prova.** Struttura (seguire l'idioma esatto di `prova-codeblock.mjs` per journal, daemon e browser):

1. Journal finto con un turno dell'agent il cui testo copre i casi:
   - `Questa richiesta corrisponde a #12, lo prendo in carico.` (citazione valida)
   - `C'entra anche #12 di nuovo, e #999 che non esiste.` (ripetizione + id inesistente)
   - un fence: ` ```bash\ngrep "#12" file.txt\n``` ` (dentro il codice resta testo)
2. La rotta board va **stubbata dal browser**, perché il daemon di prova non ha cloud: `page.route('**/api/sessions/*/board', …)` che risponde una `Board` fissa:

```js
const BOARD = { origin: 'x', columns: [
  { status: 'in-progress', tasks: [{ id: 12, title: 'Card permesso orfane', status: 'in-progress', priority: 'high', claimed_by: 'claude' }] },
] }
await page.route('**/api/sessions/*/board', r => r.fulfill({ json: BOARD }))
```

3. Le asserzioni, con `elementFromPoint`/selettori veri (le regole del repo: si misura nel browser, non si ragiona sul CSS):

```js
assert('due chip per #12, non tre', await page.locator('.taskchip').count() === 2)
assert('il chip porta il titolo dalla board',
  (await page.locator('.taskchip .ttl').first().textContent()) === 'Card permesso orfane')
assert('una sola card blocco, alla prima citazione',
  await page.locator('.taskcard').count() === 1)
assert('#999 resta testo', await page.locator('[data-task="999"]').count() === 0
  && (await page.locator('.prose').innerText()).includes('#999'))
assert('dentro il fence #12 resta testo', await page.locator('pre .taskchip').count() === 0)
```

4. Il click: `await page.locator('.taskchip').first().click()` → asserire che la vista Board è comparsa e il dettaglio mostra `Card permesso orfane` (selettori veri di `Board.svelte`: leggerli dal componente, es. la testata del dettaglio con classe `dt`). Anche la rotta board della vista Board va stubbata (stesso `page.route`).
5. Niente finestre addosso a chi non l'ha lanciata: headless come le prove esistenti.

- [ ] **Step 2: eseguirla e farla passare**

Run: `npm run ui:build && node tools/prova-taskchip.mjs`
Expected: tutte le asserzioni stampate verdi, exit 0. Se una fallisce: capire PERCHÉ (systematic debugging), non ritoccare l'asserzione.

- [ ] **Step 3: commit**

```bash
git add tools/prova-taskchip.mjs package.json
git commit -m "test(ui): prova browser dei chip #NNN — risoluzione, falsi positivi, card unica, click (#31)"
```

---

### Task 8: Chiusura — verifica piena, docs, merge, board

**Files:**
- Modify: `docs/ui-implementazione.md` (nota breve: i `#NNN` in chat, dove vive la logica)
- Merge del ramo worktree su `main`.

- [ ] **Step 1: verifica piena nel worktree**

Run: `npm run typecheck && npm run check && npm run ui:build && node tools/prova-taskchip.mjs && node tools/prova-codeblock.mjs`
Expected: tutto verde (prova-codeblock garantisce che `renderMarkdown` esteso non ha rotto i casi vecchi).

- [ ] **Step 2: nota in `docs/ui-implementazione.md`** — aggiungere nella sezione pertinente due righe: i `#NNN` si risolvono in `ui/src/lib/boardref.ts`, entrano da `renderMarkdown` (opzione `tasks`), il click passa da `onProseClick` → `store.openBoardTask`; la prova è `npm run taskchip:check`. Commit:

```bash
git add docs/ui-implementazione.md
git commit -m "docs(ui): dove vivono i chip #NNN e come si provano (#31)"
```

- [ ] **Step 3: portare il ramo su `main`** — dal checkout principale, merge del ramo del worktree (fast-forward o merge esplicito, come da abitudine del repo), poi di nuovo `npm run check` su main.

- [ ] **Step 4: board** — chiudere la card:

```bash
kanban-md --dir .stark/kanban move 31 review
kanban-md --dir .stark/kanban edit 31 --release
```

(`review` e non `done`: il difetto «Chat about this» insegna che le cure sulla condotta dell'agent si dichiarano fatte solo dopo una misura dal vivo — serve una sessione vera su un progetto con board che citi un task e il click che apre il dettaglio. Quella misura la fa l'utente o una sessione successiva; la card lo dice nel body.)

- [ ] **Step 5: aggiornare il body della card** con l'esito:

```bash
kanban-md --dir .stark/kanban edit 31 --body "Implementato (commit <sha>). Da misurare dal vivo: una sessione vera su progetto con board che citi #NNN; l'append su Claude Code; l'esito OpenCode è scritto nella spec. Prove: npm run check (§31) + npm run taskchip:check."
```
