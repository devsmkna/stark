# No-noise mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a device-local "compact mode" toggle (⌘⇧M / Ctrl+Shift+M) that shrinks the conversation header, bottom composer/status bar and sidebar rows, and hides a few secondary bits of text, for users running many STARK windows at once.

**Architecture:** Mirrors the existing theme mechanism exactly. A new `Densifier` class (same shape as `Themer`) holds a `compact` boolean, persists it to `localStorage`, and stamps `data-density="compact"` on `<html>`. All visual changes are pure CSS, scoped with `:global(html[data-density="compact"]) ...` inside each component's existing `<style>` block — no new props, no JS branching in markup except reusing the existing `store.narrow` pattern for the file/command count label.

**Tech Stack:** Svelte 5 (runes), TypeScript run directly (no build step for logic files), Vite for the UI build. No test framework exists for `ui/` — verification is manual, in the browser, per project convention (`CLAUDE.md`: "i difetti di layout si misurano nel browser vero").

## Global Constraints

- State lives on the **device** (`localStorage`), not the daemon — same reasoning as `Themer` (`ui/src/lib/theme.svelte.ts`).
- Default shortcut: `mod+shift+m` (⌘⇧M on Mac, Ctrl+Shift+M elsewhere), reassignable like every other entry in `AZIONI`.
- Only two states: compact / not compact. No intermediate density, no per-panel opt-out.
- Does not touch: conversation content (turns, text, tool blocks), the agent panel, the board, settings screens themselves, the `store.narrow` (860px) mobile breakpoint logic.
- No test harness exists for `ui/` — do not invent one for this feature. Verify manually in the running app (`npm run dev` in `ui/`, or the full daemon) by toggling the shortcut and visually confirming each surface.

---

### Task 1: `Densifier` state module

**Files:**
- Create: `ui/src/lib/density.svelte.ts`
- Modify: `ui/src/lib/store.svelte.ts` (add `readonly density = new Densifier()`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Densifier` class with `compact: boolean` (Svelte `$state`), `toggle(): void`, `set(v: boolean): void`. Used by Task 2 (`store.density.toggle()`) and by CSS via the `data-density` attribute it sets on `document.documentElement`.

- [ ] **Step 1: Write `density.svelte.ts`**

```ts
// La modalità compatta: stessa forma del tema (theme.svelte.ts), stessa ragione —
// è del dispositivo. «Compact» stringe header, barra e righe della sidebar per chi
// tiene più finestre di STARK aperte insieme; vedi
// docs/superpowers/specs/2026-09-03-no-noise-mode-design.md.

const KEY = 'stark.density'

export class Densifier {
  compact = $state<boolean>(false)

  constructor() {
    try {
      this.compact = localStorage.getItem(KEY) === 'compact'
    } catch { /* modalità privata: si resta su «non compatto» */ }
    this.#apply()
  }

  set(v: boolean): void {
    this.compact = v
    try {
      if (v) localStorage.setItem(KEY, 'compact')
      else localStorage.removeItem(KEY)
    } catch { /* vedi sopra */ }
    this.#apply()
  }

  toggle(): void {
    this.set(!this.compact)
  }

  #apply(): void {
    const root = document.documentElement
    if (this.compact) root.setAttribute('data-density', 'compact')
    else root.removeAttribute('data-density')
  }
}
```

- [ ] **Step 2: Wire it into the store**

In `ui/src/lib/store.svelte.ts`, near the existing `readonly theme = new Themer()` (around line 99), add:

```ts
  /** La densità, che è del dispositivo come il tema. Vedi `density.svelte.ts`. */
  readonly density = new Densifier()
```

And add the import near the top with the other lib imports:

```ts
import { Densifier } from './density.svelte.ts'
```

- [ ] **Step 3: Manual verification**

Run `cd ui && npm run dev`, open the app, open the browser console, run:
```js
document.documentElement.getAttribute('data-density') // → null
```
Then in the console (dev only, Task 2 wires the real trigger): confirm no errors on load. This step only confirms the module loads and constructs without throwing — the attribute toggling is verified end-to-end in Task 2.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/density.svelte.ts ui/src/lib/store.svelte.ts
git commit -m "feat(ui): add device-local Densifier for compact mode state"
```

---

### Task 2: Shortcut + Settings entry

**Files:**
- Modify: `ui/src/lib/actions.ts` (add `density` entry to `AZIONI`)
- Modify: `ui/src/App.svelte` (handle `density` id in `esegui()`)
- Modify: `ui/src/components/Settings.svelte` (no new code needed if it already iterates `AZIONI` generically — verify and only add code if it does not)

**Interfaces:**
- Consumes: `store.density.toggle()` from Task 1.
- Produces: working ⌘⇧M / Ctrl+Shift+M shortcut, and (if Settings needs it) a visible toggle row.

- [ ] **Step 1: Add the action entry**

In `ui/src/lib/actions.ts`, add to the `AZIONI` array (after the `sidebar` entry):

```ts
  {
    id: 'density',
    label: 'Toggle no-noise mode',
    hint: 'Shrink the header, status bar and sidebar rows.',
    default: 'mod+shift+m',
  },
```

- [ ] **Step 2: Wire the id in `App.svelte`**

In `ui/src/App.svelte`, in `esegui()` (around line 55), change:

```ts
  function esegui(id: string): void {
    if (id === 'board') { store.toggleBoard(); return }
    if (id === 'sidebar') { store.toggleSidebar(); return }
    if (id !== 'palette') return
```

to:

```ts
  function esegui(id: string): void {
    if (id === 'board') { store.toggleBoard(); return }
    if (id === 'sidebar') { store.toggleSidebar(); return }
    if (id === 'density') { store.density.toggle(); return }
    if (id !== 'palette') return
```

- [ ] **Step 3: Check Settings renders it automatically**

Read `ui/src/components/Settings.svelte` where it renders the shortcuts list (search for `AZIONI` or `combos(`). If it already maps over `AZIONI` to render a row per entry (label + rebind control), no change is needed — the new `density` row appears for free. If instead entries are hand-listed, add a `density` row following the exact same markup pattern used for `sidebar`.

- [ ] **Step 4: Manual verification**

`cd ui && npm run dev`, open the app, press `Cmd+Shift+M` (Mac) or `Ctrl+Shift+M` (other). Confirm in devtools:
```js
document.documentElement.getAttribute('data-density') // → 'compact'
```
Press again → back to `null`. Open Settings → Shortcuts and confirm a "Toggle no-noise mode" row exists and is rebindable, matching the behavior of the existing `sidebar` row.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/actions.ts ui/src/App.svelte ui/src/components/Settings.svelte
git commit -m "feat(ui): wire no-noise mode to mod+shift+m and Settings"
```

---

### Task 3: Compact CSS — conversation header

**Files:**
- Modify: `ui/src/components/Conversation.svelte` (the `.bar` block, ~line 532, and its `<style>` block)

**Interfaces:**
- Consumes: `document.documentElement[data-density="compact"]` set by Task 1/2 — pure CSS, no props needed.
- Produces: nothing consumed by later tasks — this is a leaf.

- [ ] **Step 1: Extend the existing narrow-screen condition to also cover compact mode**

The file/command count label at ~line 566 currently reads:

```svelte
      {#if !store.narrow}
        <b>{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} ·
          {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}</b>
      {/if}
```

Change the condition to also collapse in compact mode:

```svelte
      {#if !store.narrow && !store.density.compact}
        <b>{snap.files.length} {snap.files.length === 1 ? 'file' : 'files'} ·
          {snap.shell.length} {snap.shell.length === 1 ? 'command' : 'commands'}</b>
      {/if}
```

- [ ] **Step 2: Hide the debug-copy button in compact mode**

The button at ~line 557:

```svelte
    <button class="iconb" title={debugCopiato ? 'Copied' : 'Copy debug info'}
      onclick={() => void copiaDebug()}>
      <Icon name={debugCopiato ? 'i-check' : 'i-copy'} />
    </button>
```

Add a class hook and hide it via CSS (keeps the button in the DOM — cheaper than an `{#if}`, and consistent with "sparisce il testo/elemento secondario, non la funzione principale"):

```svelte
    <button class="iconb debugbtn" title={debugCopiato ? 'Copied' : 'Copy debug info'}
      onclick={() => void copiaDebug()}>
      <Icon name={debugCopiato ? 'i-check' : 'i-copy'} />
    </button>
```

- [ ] **Step 3: Add compact CSS rules**

Find the `<style>` block in this file (search for `.bar {` to locate it) and add, near the `.bar` rule:

```css
  :global(html[data-density='compact']) .bar {
    padding-block: 4px;
    gap: 4px;
    min-height: unset;
  }
  :global(html[data-density='compact']) .bar .t {
    font-size: 13px;
  }
  :global(html[data-density='compact']) .bar .iconb {
    width: 24px;
    height: 24px;
  }
  :global(html[data-density='compact']) .debugbtn {
    display: none;
  }
```

If `.bar`, `.t` or `.iconb` already declare `padding`, `font-size`, `width`/`height` elsewhere in this stylesheet, match those property names exactly instead of guessing — read the existing rule first with `grep -n "\.bar \|\.iconb \|class=\"t\"" ui/src/components/Conversation.svelte` and adjust the compact override to shrink relative to whatever the current value is (aim for roughly 75% of the current padding/icon size).

- [ ] **Step 4: Manual verification**

`cd ui && npm run dev`, open a chat, toggle compact mode with the shortcut. Confirm: header is visibly shorter, the file/command label shows icon-only, the debug-copy icon button is gone, the chat title and sleep/panel/close buttons are still present and clickable.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/Conversation.svelte
git commit -m "feat(ui): compact header in no-noise mode"
```

---

### Task 4: Compact CSS — composer/status bar

**Files:**
- Modify: `ui/src/components/Dock.svelte` (the `.pk-meta` price/context block, ~lines 874-886, and its `<style>` block)

**Interfaces:**
- Consumes: `document.documentElement[data-density="compact"]` — pure CSS.
- Produces: nothing consumed by later tasks — leaf.

- [ ] **Step 1: Add compact CSS to hide price and context, shrink the bar**

Locate the `<style>` block in `Dock.svelte` (search for `.dock {` or `.pk-meta {`). Add:

```css
  :global(html[data-density='compact']) .dock {
    padding-block: 4px;
  }
  :global(html[data-density='compact']) .pk-meta .cash,
  :global(html[data-density='compact']) .pk-meta .price,
  :global(html[data-density='compact']) .pk-meta .free,
  :global(html[data-density='compact']) .pk-meta .unit,
  :global(html[data-density='compact']) .pk-meta .ctx-lbl,
  :global(html[data-density='compact']) .pk-meta .ctx-val {
    display: none;
  }
```

As in Task 3 Step 3: check the actual current `padding` property name on `.dock` (`grep -n "\.dock {" -A5 ui/src/components/Dock.svelte`) before writing the override, so the compact rule genuinely shrinks it rather than fighting a more specific existing rule.

- [ ] **Step 2: Manual verification**

`cd ui && npm run dev`, toggle compact mode. Confirm: bottom bar is visibly shorter, the model badge shows only the model name (no `$` price, no context window number), and the model picker still opens and works when clicked.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Dock.svelte
git commit -m "feat(ui): compact composer bar in no-noise mode"
```

---

### Task 5: Compact CSS — sidebar rows

**Files:**
- Modify: `ui/src/components/Sidebar.svelte` (row `<style>` rules)

**Interfaces:**
- Consumes: `document.documentElement[data-density="compact"]` — pure CSS.
- Produces: nothing — leaf, last task.

- [ ] **Step 1: Find the row rule**

Run `grep -n "class=\"row\|\.row {" ui/src/components/Sidebar.svelte` to find the exact class name used per chat row (the spec calls it "righe" generically — confirm the real class name here, it was not confirmed during brainstorming).

- [ ] **Step 2: Add compact CSS**

Using the class name found in Step 1 (call it `.row` below — substitute the real name), add to the `<style>` block:

```css
  :global(html[data-density='compact']) .row {
    padding-block: 2px;
    min-height: unset;
  }
```

Match against the existing `padding`/`min-height` property names on that rule rather than introducing new ones, same discipline as Tasks 3 and 4.

- [ ] **Step 3: Manual verification**

`cd ui && npm run dev`, toggle compact mode. Confirm sidebar rows are visibly shorter/tighter, still fully clickable, text not clipped mid-character.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/Sidebar.svelte
git commit -m "feat(ui): compact sidebar rows in no-noise mode"
```

---

### Task 6: End-to-end manual pass

**Files:** none (verification only).

- [ ] **Step 1: Full toggle cycle**

`cd ui && npm run dev` (or run the full daemon). Open a project with an active chat, an idle chat, and the sidebar populated. Press `Cmd+Shift+M`/`Ctrl+Shift+M`. Confirm simultaneously: header shrinks, bottom bar shrinks, sidebar rows shrink. Press again: everything returns to normal size.

- [ ] **Step 2: Persistence**

With compact mode on, reload the page (`Cmd+R`/`F5`). Confirm it's still compact (localStorage read on `Densifier` construction). Turn it off, reload, confirm it stays off.

- [ ] **Step 3: Settings round-trip**

Open Settings → Shortcuts, rebind "Toggle no-noise mode" to a different combination, close Settings, use the new combination, confirm it toggles compact mode.

- [ ] **Step 4: `tsc --noEmit`**

Run whatever the project's type-check command is (check `package.json` scripts — likely something invoked via `npm run check` or a `tsc` script under `ui/`) and confirm no new type errors were introduced.

- [ ] **Step 5: Final commit if anything was fixed during this pass**

```bash
git add -A
git commit -m "fix(ui): address issues found in no-noise mode manual pass"
```

(Skip this commit if nothing needed fixing.)
