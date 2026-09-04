# Rinominare i progetti (contenitori) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user give a project (a working-directory "container") a custom display name that replaces the folder-basename label everywhere it's shown in the UI, without touching how projects are grouped, colored, ordered, or muted.

**Architecture:** A new optional `name` field on the existing per-project settings record (`settings.projects[cwd]`), read through a new pure function `projectName(cwd, overrides)` that falls back to the existing `project(cwd)` (raw folder basename) when no override exists. `project(cwd)` keeps being the only function used for identity (grouping keys, colour assignment, collapse/order state) — it is never replaced, only supplemented. Renaming happens in Settings → Projects via double-click on the name, mirroring the existing chat-rename gesture in `Conversation.svelte`.

**Tech Stack:** Svelte 5 (runes), TypeScript run directly, daemon settings persisted via existing `PUT /api/settings` (`store.saveSettings`/`store.setProject`). No test framework exists for `ui/` — verification is `npm run check` (offline structural checks) plus manual browser verification, per project convention.

## Global Constraints

- Identity (grouping, colour assignment via `colours()`, `store.collapse` open/closed state, `store.order` manual ordering) stays keyed on the **raw** folder basename (`project(cwd)`) — never on the custom name. Renaming a project must not move it, recolour it, or change its collapsed state.
- `settings.projects[cwd].name` empty/absent means "use the folder name" — not a separate disabled state.
- No uniqueness validation on the custom name — it's a label, not an identifier.
- Rename gesture: double-click on the name text in Settings → Projects, same pattern as `Conversation.svelte`'s chat-title rename (`renaming`/`draft` state, `onblur`/`Enter` commits, `Escape` cancels).
- Known, pre-existing, explicitly out-of-scope limitation: two different folders sharing the same basename are already merged into one sidebar group today (identity is the name string, not the full path). This plan does not change that.

---

### Task 1: `projectName()` and the `name` field

**Files:**
- Modify: `ui/src/lib/view.ts` (add `projectName` after `project`, ~line 63)
- Modify: `ui/src/lib/api.ts:115` (add `name?: string` to the `projects` record type)
- Modify: `ui/src/lib/store.svelte.ts:36` (import `projectName`), `:588` (use it), `:671` and `:675` (widen `project()`/`setProject()` types)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `projectName(cwd: string | undefined, overrides: Record<string, { name?: string }> | undefined): string`, exported from `ui/src/lib/view.ts`. Every later task imports this from `'../lib/view.ts'` (components) or `'./view.ts'` (`store.svelte.ts`), and calls it as `projectName(cwd, store.settings?.projects)`.

- [ ] **Step 1: Add `projectName` to `view.ts`**

Read the current function first:

```
sed -n '55,64p' ui/src/lib/view.ts
```

It should show:

```ts
export const ORDER: Group[] = ['Waiting', 'Working', 'Sleeping']

/** Il progetto è l'ultimo pezzo della cartella. Niente di più: è ciò che si legge. */
export function project(cwd: string | undefined): string {
  if (!cwd) return 'no folder'
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || cwd
}
```

Add immediately after the closing `}` of `project`:

```ts

/**
 * Il nome mostrato: quello scelto a mano se c'è, altrimenti la cartella. `project()`
 * resta la sola funzione da usare per l'identità (raggruppamento, colore, ordine,
 * aperto/chiuso) — non cambia mai con questa. `projectName()` è solo per il testo
 * che l'utente legge.
 */
export function projectName(
  cwd: string | undefined,
  overrides: Record<string, { name?: string }> | undefined,
): string {
  const custom = cwd ? overrides?.[cwd]?.name?.trim() : undefined
  return custom || project(cwd)
}
```

- [ ] **Step 2: Widen the settings type in `api.ts`**

```
grep -n "projects: Record" ui/src/lib/api.ts
```

Change:

```ts
  projects: Record<string, { colour?: number; muted?: boolean; profile?: string }>
```

to:

```ts
  projects: Record<string, { colour?: number; muted?: boolean; profile?: string; name?: string }>
```

- [ ] **Step 3: Widen `Store.project()` / `Store.setProject()` in `store.svelte.ts`**

```
grep -n "project(cwd: string | undefined)\|async setProject" ui/src/lib/store.svelte.ts
```

Change:

```ts
  project(cwd: string | undefined): { colour?: number; muted?: boolean; profile?: string } {
    return (cwd ? this.settings?.projects[cwd] : undefined) ?? {}
  }

  async setProject(cwd: string, patch: { colour?: number; muted?: boolean; profile?: string }): Promise<void> {
```

to:

```ts
  project(cwd: string | undefined): { colour?: number; muted?: boolean; profile?: string; name?: string } {
    return (cwd ? this.settings?.projects[cwd] : undefined) ?? {}
  }

  async setProject(cwd: string, patch: { colour?: number; muted?: boolean; profile?: string; name?: string }): Promise<void> {
```

The body of `setProject` is unchanged — it already spreads `patch` over the existing record, and `JSON.stringify` drops keys whose value is `undefined` when the settings object is sent to the daemon, so `{ name: undefined }` correctly clears a previously-set custom name.

- [ ] **Step 4: Use `projectName` for the call-notification title**

```
sed -n '30,40p' ui/src/lib/store.svelte.ts
```

Confirm the import line reads:

```ts
import { activityText, project } from './view.ts'
```

Change it to:

```ts
import { activityText, project, projectName } from './view.ts'
```

Then:

```
grep -n "CALL_HEAD\[kind\]" ui/src/lib/store.svelte.ts
```

Change:

```ts
        title: `${CALL_HEAD[kind]} · ${project(r.cwd)}`,
```

to:

```ts
        title: `${CALL_HEAD[kind]} · ${projectName(r.cwd, this.settings?.projects)}`,
```

`project` stays imported and used elsewhere in this file (e.g. inside `this.project(cwd).muted` two lines above — that's the *method*, unrelated to the imported function, do not touch it).

- [ ] **Step 5: Typecheck**

```
cd ui && npx tsc --noEmit -p .
```

Expected: only the one pre-existing unrelated error at `store.svelte.ts:311` (`leggiPreferenza(...) === '1'` boolean/string comparison — confirmed pre-existing on `main` before this plan). No new errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/view.ts ui/src/lib/api.ts ui/src/lib/store.svelte.ts
git commit -m "feat(ui): add projectName() override, keep project() as raw identity"
```

---

### Task 2: Sidebar group header and search row

**Files:**
- Modify: `ui/src/components/Sidebar.svelte` (`Blocco` type ~line 88, `tree` derivation ~line 123, header render ~line 558, search-row render ~line 447, import ~line 9)

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing consumed by later tasks — independent leaf, same as Tasks 3–9.

- [ ] **Step 1: Add `cwd` to `Blocco` and capture it before rows get emptied**

```
grep -n "type Blocco" -A5 ui/src/components/Sidebar.svelte
```

Change:

```ts
  type Blocco = {
    key: string
    proj: string
    rows: SessionRow[]
  }
```

to:

```ts
  type Blocco = {
    key: string
    proj: string
    cwd: string | undefined
    rows: SessionRow[]
  }
```

Then:

```
grep -n "const tree = \$derived" -A12 ui/src/components/Sidebar.svelte
```

Change:

```ts
    return perProgetto(recenti).map(([name, rows]) => ({
      key: `p:${name}`,
      proj: name,
      // Chiuso: l'intestazione resta, le righe no.
      rows: store.collapse.isClosed(name) ? [] : [...rows].sort((a, b) => peso(a) - peso(b)),
    }))
```

to:

```ts
    return perProgetto(recenti).map(([name, rows]) => ({
      key: `p:${name}`,
      proj: name,
      // Preso da `rows` (non ancora svuotate): un progetto chiuso non deve perdere
      // la propria cwd solo perché le righe sotto sono nascoste.
      cwd: rows[0]?.cwd,
      // Chiuso: l'intestazione resta, le righe no.
      rows: store.collapse.isClosed(name) ? [] : [...rows].sort((a, b) => peso(a) - peso(b)),
    }))
```

- [ ] **Step 2: Import `projectName`**

```
grep -n "ORDER, colours, group" ui/src/components/Sidebar.svelte
```

Change:

```ts
  import {
    ORDER, colours, group, hhmm, label, needsYou, project, stamp,
  } from '../lib/view.ts'
```

to:

```ts
  import {
    ORDER, colours, group, hhmm, label, needsYou, project, projectName, stamp,
  } from '../lib/view.ts'
```

- [ ] **Step 3: Use it in the group header**

```
grep -n 'class="ghead"' ui/src/components/Sidebar.svelte
```

Change:

```svelte
        <i class="dotk p{palette.get(section.proj) ?? 0}"></i>
        <span class="ghead">{section.proj}</span>
```

to:

```svelte
        <i class="dotk p{palette.get(section.proj) ?? 0}"></i>
        <span class="ghead">{projectName(section.cwd, store.settings?.projects)}</span>
```

(`section.proj` stays everywhere else on this button — `isClosed`, `needsCounts.get`, `class:drop`, `onclick`, all four drag handlers — those are identity, unchanged.)

- [ ] **Step 4: Use it in the search result row**

```
grep -n 'class="dotk p{palette.get(project(row.cwd))' ui/src/components/Sidebar.svelte
```

Change:

```svelte
                <i class="dotk p{palette.get(project(row.cwd)) ?? 0}"></i> {project(row.cwd)}
```

to:

```svelte
                <i class="dotk p{palette.get(project(row.cwd)) ?? 0}"></i> {projectName(row.cwd, store.settings?.projects)}
```

(The `.get(project(row.cwd))` colour lookup stays raw — `palette` is keyed by raw name.)

- [ ] **Step 5: Manual check**

`cd ui && npm run dev`, open Settings → Projects (once Task 11 exists you can rename here; until then just confirm the sidebar still shows folder names exactly as before — this task alone changes nothing visible, since no override exists yet). Confirm no console errors, collapse/expand still works, drag-reorder still works.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/Sidebar.svelte
git commit -m "feat(ui): sidebar shows project display name, keeps raw name as identity"
```

---

### Task 3: Palette (⌘K)

**Files:**
- Modify: `ui/src/components/Palette.svelte`

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing — leaf.

- [ ] **Step 1: Import and use in the search filter**

```
grep -n "import { project, colours }" ui/src/components/Palette.svelte
```

Change:

```ts
  import { project, colours } from '../lib/view.ts'
```

to:

```ts
  import { project, projectName, colours } from '../lib/view.ts'
```

Then:

```
grep -n "r.title.toLowerCase" ui/src/components/Palette.svelte
```

Change:

```ts
    return store.rows.filter(r =>
      r.title.toLowerCase().includes(t) || project(r.cwd).toLowerCase().includes(t))
```

to:

```ts
    return store.rows.filter(r =>
      r.title.toLowerCase().includes(t) || projectName(r.cwd, store.settings?.projects).toLowerCase().includes(t))
```

- [ ] **Step 2: Use it in the row**

```
grep -n 'class="pp"' ui/src/components/Palette.svelte
```

Change:

```svelte
        <i class="dotk p{palette.get(project(r.cwd)) ?? 0}"></i>
        <span class="pt">{r.title}</span>
        <span class="pp">{project(r.cwd)}</span>
```

to:

```svelte
        <i class="dotk p{palette.get(project(r.cwd)) ?? 0}"></i>
        <span class="pt">{r.title}</span>
        <span class="pp">{projectName(r.cwd, store.settings?.projects)}</span>
```

- [ ] **Step 3: Manual check**

`cd ui && npm run dev`, press ⌘K/Ctrl+K, confirm the palette still opens and lists chats with their project label, no console errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/Palette.svelte
git commit -m "feat(ui): palette search and rows use project display name"
```

---

### Task 4: Conversation header title fallback

**Files:**
- Modify: `ui/src/components/Conversation.svelte`

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing — leaf.

- [ ] **Step 1: Import and use for the title fallback only**

```
grep -n "import { colours, dayBanner" ui/src/components/Conversation.svelte
```

Change:

```ts
  import { colours, dayBanner, hhmm, project, since, timeOnly, toolIcon, turnStatus } from '../lib/view.ts'
```

to:

```ts
  import { colours, dayBanner, hhmm, project, projectName, since, timeOnly, toolIcon, turnStatus } from '../lib/view.ts'
```

Then:

```
grep -n "const colour = \$derived(colours" ui/src/components/Conversation.svelte
```

Change:

```ts
  const colour = $derived(colours(store.rows).get(project(snap.cwd)) ?? 0)
  const title = $derived(row?.title ?? project(snap.cwd))
```

to:

```ts
  const colour = $derived(colours(store.rows).get(project(snap.cwd)) ?? 0)
  const title = $derived(row?.title ?? projectName(snap.cwd, store.settings?.projects))
```

(`colour` stays keyed on raw `project(snap.cwd)` — unchanged.)

- [ ] **Step 2: Manual check**

`cd ui && npm run dev`, open a chat that has never been given a title (first prompt not sent yet, if reachable) or check an existing chat's header still reads correctly. No console errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Conversation.svelte
git commit -m "feat(ui): conversation header title fallback uses project display name"
```

---

### Task 5: Dock composer folder labels

**Files:**
- Modify: `ui/src/components/Dock.svelte` (three occurrences)

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing — leaf.

- [ ] **Step 1: Import**

```
grep -n "import { MODE_BLURB, MODE_ICON, project" ui/src/components/Dock.svelte
```

Change:

```ts
import { MODE_BLURB, MODE_ICON, project, stamp, until, fmtTok, fmtCosto } from '../lib/view.ts'
```

to:

```ts
import { MODE_BLURB, MODE_ICON, project, projectName, stamp, until, fmtTok, fmtCosto } from '../lib/view.ts'
```

- [ ] **Step 2: Replace all three occurrences**

```
grep -n 'i-folder" />{project(snap.cwd)}' ui/src/components/Dock.svelte
```

Expected: 3 matches. Each reads:

```svelte
                <span class="g"><Icon name="i-folder" />{project(snap.cwd)}</span>
```

Replace **all three** occurrences (same exact text each time) with:

```svelte
                <span class="g"><Icon name="i-folder" />{projectName(snap.cwd, store.settings?.projects)}</span>
```

- [ ] **Step 3: Confirm exactly 3 replaced, 0 remaining**

```
grep -c 'i-folder" />{project(snap.cwd)}' ui/src/components/Dock.svelte
```

Expected: `0`

```
grep -c 'i-folder" />{projectName(snap.cwd' ui/src/components/Dock.svelte
```

Expected: `3`

- [ ] **Step 4: Manual check**

`cd ui && npm run dev`, open a chat, hover the usage/status area in the bottom bar (or open it flat, depending on layout mode) — confirm the folder label still shows in all three density states (hover-foot, repo-branch-foot, and the hover-without-bars state).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/Dock.svelte
git commit -m "feat(ui): composer folder labels use project display name"
```

---

### Task 6: NewChat dialog

**Files:**
- Modify: `ui/src/components/NewChat.svelte` (three occurrences)

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing — leaf.

- [ ] **Step 1: Import**

```
grep -n "import { colours, hhmm, project }" ui/src/components/NewChat.svelte
```

Change:

```ts
  import { colours, hhmm, project } from '../lib/view.ts'
```

to:

```ts
  import { colours, hhmm, project, projectName } from '../lib/view.ts'
```

- [ ] **Step 2: Recents list label**

```
grep -n 'palette.get(project(r)) ?? 0' ui/src/components/NewChat.svelte
```

Change:

```svelte
                <button class="rec" onclick={() => { cwd = r }} title={r}>
                  <i class="dotk p{palette.get(project(r)) ?? 0}"></i> {project(r)}
                </button>
```

to:

```svelte
                <button class="rec" onclick={() => { cwd = r }} title={r}>
                  <i class="dotk p{palette.get(project(r)) ?? 0}"></i> {projectName(r, store.settings?.projects)}
                </button>
```

(`r` here is a raw `cwd` string, not a `SessionRow` — `project(r)`/`projectName(r, ...)` both take it directly. The colour lookup stays raw.)

- [ ] **Step 3: Continuation row label**

```
grep -n "{project(r.cwd)}{#if r.branch}" ui/src/components/NewChat.svelte
```

Change:

```svelte
                  {project(r.cwd)}{#if r.branch}{' · '}{r.branch}{/if}
```

to:

```svelte
                  {projectName(r.cwd, store.settings?.projects)}{#if r.branch}{' · '}{r.branch}{/if}
```

- [ ] **Step 4: Manual check**

`cd ui && npm run dev`, open "New chat", confirm the recents list and the continue-existing-chat list both render without errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/NewChat.svelte
git commit -m "feat(ui): new-chat dialog uses project display name"
```

---

### Task 7: SplitPick

**Files:**
- Modify: `ui/src/components/SplitPick.svelte`

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing — leaf.

- [ ] **Step 1: Import and use**

```
grep -n "import { label, project } from '../lib/view.ts'" ui/src/components/SplitPick.svelte
```

Change:

```ts
  import { label, project } from '../lib/view.ts'
```

to:

```ts
  import { label, project, projectName } from '../lib/view.ts'
```

Then:

```
grep -n 'class="sub"' ui/src/components/SplitPick.svelte
```

Change:

```svelte
          <span class="sub">{project(r.cwd)} · {label(r.state)}</span>
```

to:

```svelte
          <span class="sub">{projectName(r.cwd, store.settings?.projects)} · {label(r.state)}</span>
```

Note: `project` stays imported and used — check with `grep -n "project(" ui/src/components/SplitPick.svelte` first; if the only remaining use after this edit is none, remove `project` from the import instead of leaving an unused import. (As of this plan's writing, `project` has no other call site in this file — so the import becomes just `{ label, projectName }`.)

- [ ] **Step 2: Manual check**

`cd ui && npm run dev`, open a split-pane "pick a chat" selector, confirm rows render.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/SplitPick.svelte
git commit -m "feat(ui): split-pick selector uses project display name"
```

---

### Task 8: Board project selector

**Files:**
- Modify: `ui/src/components/Board.svelte`

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing — leaf.

- [ ] **Step 1: Import and use**

```
grep -n "import { project } from '../lib/view.ts'" ui/src/components/Board.svelte
```

Change:

```ts
  import { project } from '../lib/view.ts'
```

to:

```ts
  import { projectName } from '../lib/view.ts'
```

(`project` has no other call site in this file — verify with `grep -n "project(" ui/src/components/Board.svelte` before removing; it should show only the one occurrence changed in the next step.)

Then:

```
grep -n '<option value={p.cwd}>' ui/src/components/Board.svelte
```

Change:

```svelte
        <option value={p.cwd}>{project(p.cwd)}</option>
```

to:

```svelte
        <option value={p.cwd}>{projectName(p.cwd, store.settings?.projects)}</option>
```

- [ ] **Step 2: Manual check**

`cd ui && npm run dev`, open the board, confirm the project selector dropdown lists projects.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Board.svelte
git commit -m "feat(ui): board project selector uses project display name"
```

---

### Task 9: Todo column labels

**Files:**
- Modify: `ui/src/components/Todo.svelte`

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing — leaf.

- [ ] **Step 1: Import**

```
grep -n "import { project } from '../lib/view.ts'" ui/src/components/Todo.svelte
```

Change:

```ts
  import { project } from '../lib/view.ts'
```

to:

```ts
  import { project, projectName } from '../lib/view.ts'
```

- [ ] **Step 2: Current-project label**

```
grep -n 'class="pj"' ui/src/components/Todo.svelte
```

Change:

```svelte
    {#if store.todoScope === 'project' && dati?.cwd}<span class="pj">{project(dati.cwd)}</span>{/if}
```

to:

```svelte
    {#if store.todoScope === 'project' && dati?.cwd}<span class="pj">{projectName(dati.cwd, store.settings?.projects)}</span>{/if}
```

- [ ] **Step 3: "All" section group label**

```
grep -n 'class="gn"' ui/src/components/Todo.svelte
```

Change:

```svelte
              <span class="gn">{project(p.cwd)}</span>
```

to:

```svelte
              <span class="gn">{projectName(p.cwd, store.settings?.projects)}</span>
```

`project` stays imported: it's still used elsewhere for the `title={p.cwd}` sibling comment's raw-name reasoning — actually check with `grep -n "project(" ui/src/components/Todo.svelte`; if no other call remains, drop `project` from the import (keep only `projectName`).

- [ ] **Step 4: Manual check**

`cd ui && npm run dev`, open the agent panel's Todo tab, switch between "This project" and "All", confirm labels render.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/Todo.svelte
git commit -m "feat(ui): todo column uses project display name"
```

---

### Task 10: Settings — Notifications mute list, Usage, Journal, Import

**Files:**
- Modify: `ui/src/components/Settings.svelte` (mute-list row, usage-by-project row, two journal rows — NOT the Projects section itself, that's Task 11)

**Interfaces:**
- Consumes: `projectName` from Task 1.
- Produces: nothing consumed by Task 11 (Task 11 does its own import line edit).

- [ ] **Step 1: Import**

```
grep -n "import { MODE_BLURB, MODE_ICON, project } from '../lib/view.ts'" ui/src/components/Settings.svelte
```

Change:

```ts
  import { MODE_BLURB, MODE_ICON, project } from '../lib/view.ts'
```

to:

```ts
  import { MODE_BLURB, MODE_ICON, project, projectName } from '../lib/view.ts'
```

- [ ] **Step 2: "Stay quiet for" mute row**

```
grep -n 'Mute \${nome}' ui/src/components/Settings.svelte
```

This row is inside `{#each progetti as [cwd, nome] (cwd)}` in the Notifications section. Since Task 11 changes how `progetti`'s `nome` is computed (it will already be the display name after Task 11), **do this step only if Task 11 has not run yet in your working copy** — check first:

```
grep -n "const progetti = \$derived.by" -A8 ui/src/components/Settings.svelte
```

If the map still computes `m.set(r.cwd, project(r.cwd))` (raw), this row already receives the raw name via `nome` and needs no change here — it will start showing the display name automatically once Task 11 changes the `progetti` computation. **Skip editing this row directly; it inherits the fix from Task 11.**

- [ ] **Step 3: Usage-by-project row**

```
grep -n "r.key==='unknown'?'no folder':project(r.key)" ui/src/components/Settings.svelte
```

Change:

```svelte
                <span class="b-body"><span class="b-name">{r.key==='unknown'?'no folder':project(r.key)}</span><span class="b-meta">{migliaia(r.c.prompts)} prompts · {durata(r.c.agentMs)}</span></span>
```

to:

```svelte
                <span class="b-body"><span class="b-name">{r.key==='unknown'?'no folder':projectName(r.key, store.settings?.projects)}</span><span class="b-meta">{migliaia(r.c.prompts)} prompts · {durata(r.c.agentMs)}</span></span>
```

- [ ] **Step 4: Journal rows (two occurrences, delete-confirm and normal)**

```
grep -n "s.cwd ? project(s.cwd) : 'no folder'" ui/src/components/Settings.svelte
```

Expected: 2 matches, both reading:

```svelte
                  <span class="j-body"><span class="j-title">{s.title}</span><span class="j-proj">{s.cwd ? project(s.cwd) : 'no folder'}</span></span>
```

Replace **both** with:

```svelte
                  <span class="j-body"><span class="j-title">{s.title}</span><span class="j-proj">{s.cwd ? projectName(s.cwd, store.settings?.projects) : 'no folder'}</span></span>
```

- [ ] **Step 5: Confirm counts**

```
grep -c "s.cwd ? project(s.cwd)" ui/src/components/Settings.svelte
```
Expected: `0`
```
grep -c "s.cwd ? projectName(s.cwd" ui/src/components/Settings.svelte
```
Expected: `2`

- [ ] **Step 6: Manual check**

`cd ui && npm run dev`, open Settings → Usage, confirm the by-project breakdown renders. Open Settings → Storage, confirm journal rows render.

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/Settings.svelte
git commit -m "feat(ui): settings usage/journal lists use project display name"
```

---

### Task 11: Settings — Projects section rename UI

**Files:**
- Modify: `ui/src/components/Settings.svelte` (`progetti` derivation ~line 220, Projects section render ~line 754-787, new rename state + handlers, new CSS)

**Interfaces:**
- Consumes: `projectName` (Task 1, imported in Task 10 — re-check the import already includes it), `store.setProject` (existing, widened in Task 1).
- Produces: working double-click-to-rename in Settings → Projects. Nothing consumed by later tasks.

- [ ] **Step 1: Make `progetti` compute the display name**

```
grep -n "const progetti = \$derived.by" -A8 ui/src/components/Settings.svelte
```

Change:

```ts
  const progetti = $derived.by(() => {
    const m = new Map<string, string>()
    for (const r of store.rows) if (r.cwd) m.set(r.cwd, project(r.cwd))
    for (const cwd of Object.keys(store.settings?.projects ?? {})) {
      if (!m.has(cwd)) m.set(cwd, project(cwd))
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  })
```

to:

```ts
  const progetti = $derived.by(() => {
    const m = new Map<string, string>()
    for (const r of store.rows) if (r.cwd) m.set(r.cwd, projectName(r.cwd, store.settings?.projects))
    for (const cwd of Object.keys(store.settings?.projects ?? {})) {
      if (!m.has(cwd)) m.set(cwd, projectName(cwd, store.settings?.projects))
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  })
```

This is what makes Task 10 Step 2's mute row (and every other reader of `progetti`) show the display name automatically — `progetti` is the single source both the Projects section and the Notifications mute list read from.

- [ ] **Step 2: Add rename state**

Find where other dialog-local `$state` declarations live near the top of the `<script>` block (search `let swpopOpen`):

```
grep -n "let swpopOpen" ui/src/components/Settings.svelte
```

Add two new state variables right after that line:

```ts
  let renamingProj = $state<string | null>(null)
  let projDraft = $state('')
```

- [ ] **Step 3: Add the rename handlers**

Add these two functions right after the `progettiFiltrati` derivation (search `const progettiFiltrati`, insert after its closing `)`):

```ts
  function startRenameProj(cwd: string, nome: string): void {
    projDraft = nome
    renamingProj = cwd
  }
  async function commitRenameProj(cwd: string): Promise<void> {
    const raw = project(cwd)
    const value = projDraft.trim()
    renamingProj = null
    if (value === raw) { await store.setProject(cwd, { name: undefined }); return }
    if (value && value !== (store.project(cwd).name ?? raw)) await store.setProject(cwd, { name: value })
  }
```

(`value === raw` means the user typed back the plain folder name — treat that as "clear the override", same as leaving it empty, so the row doesn't carry a redundant explicit override that merely duplicates the folder name.)

- [ ] **Step 4: Replace the name span with an editable one**

```
grep -n '<span class="o-body"><span class="o-t">{nome}</span>' ui/src/components/Settings.svelte
```

Change:

```svelte
              <span class="o-body"><span class="o-t">{nome}</span><span class="o-sub mono">{cwd}</span></span>
```

to:

```svelte
              <span class="o-body">
                {#if renamingProj === cwd}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input class="pj-rn" autofocus bind:value={projDraft}
                    onblur={() => void commitRenameProj(cwd)}
                    onkeydown={e => {
                      if (e.key === 'Enter') void commitRenameProj(cwd)
                      if (e.key === 'Escape') renamingProj = null
                    }} />
                {:else}
                  <button class="o-t pj-name" ondblclick={() => startRenameProj(cwd, nome)}
                    title="{nome} — double-click to rename">{nome}</button>
                {/if}
                <span class="o-sub mono">{cwd}</span>
              </span>
```

- [ ] **Step 5: Add CSS for the new elements**

Find the existing `.pjrow` rule:

```
grep -n "\.pjrow {" ui/src/components/Settings.svelte
```

Add right after it:

```css
  .pj-name {
    background: none; border: none; padding: 0; font: inherit; font-size: 13px;
    font-weight: 600; color: var(--ink); text-align: left; cursor: text; width: fit-content;
  }
  .pj-rn {
    font: inherit; font-size: 13px; font-weight: 600; width: 100%;
    border: 1px solid var(--accent); border-radius: 6px; padding: 1px 6px;
    background: var(--surface); color: var(--ink); outline: none;
  }
```

- [ ] **Step 6: Manual check**

`cd ui && npm run dev`, open Settings → Projects. Double-click a project name, confirm it becomes an editable field, type a new name, press Enter, confirm the row now shows the new name and the sidebar group header (Task 2) also picks it up. Reload the page, confirm the name persists. Double-click again, clear the field to empty, press Enter, confirm it reverts to the folder name. Double-click, type the *exact* folder name back, press Enter, confirm no error (this is the "clears redundant override" branch in Step 3). Press Escape mid-edit, confirm no change is saved.

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/Settings.svelte
git commit -m "feat(ui): rename a project's display name from Settings, double-click gesture"
```

---

### Task 12: End-to-end manual pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck and offline structural checks**

```
cd ui && npx tsc --noEmit -p .
```
Expected: only the one pre-existing unrelated error noted in Task 1 Step 5.

```
cd /Users/veenz/Documents/projects/stark/.claude/worktrees/project-rename && npm run check
```
Expected: all checks pass (same count as on `main` before this plan — confirm no regressions).

- [ ] **Step 2: Build**

```
npm run ui:build
```
Expected: build succeeds, only pre-existing `:global()` lightningcss warnings.

- [ ] **Step 3: Full rename round-trip in a running daemon**

Start a throwaway daemon (temp `STARK_HOME`, ephemeral `STARK_PORT`), as done for the no-noise-mode feature:

```
STARK_HOME=/tmp/stark-projrename-$$ STARK_PORT=20999 node src/cli/stark.ts start
```

Open the printed URL. Rename a project in Settings → Projects. Confirm the new name shows in: sidebar group header, ⌘K palette, New Chat recents, the chat header (if that project's chat has no title yet), the Dock folder label, the Todo column, the Board project selector, Settings → Usage, Settings → Storage journal rows, Settings → Notifications mute list. Confirm the project's **colour and sidebar position do not change** from the rename. Confirm collapsing/expanding the renamed group still works. Stop the daemon (`node src/cli/stark.ts stop`) and delete the temp `STARK_HOME` when done.

- [ ] **Step 4: Final commit if anything was fixed during this pass**

```bash
git add -A
git commit -m "fix(ui): address issues found in project-rename manual pass"
```

(Skip this commit if nothing needed fixing.)
