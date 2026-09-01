---
name: stark-kanban
description: Read and maintain the project's kanban board that STARK shows in its Board view, stored as `.stark/kanban/` in the project folder and powered by the `kanban-md` CLI. Use this skill whenever you work in a project that has a board — it is the default coordination surface: read it first, claim a task before working on it, update its status as you go, and create tasks when asked. Also use it when the user mentions the board, a kanban, a task/backlog in a project with a board, or asks you to add, move, or track work items.
---

# STARK kanban board

If a project has a board, **it is the default way to coordinate work**. STARK shows it in
its Board view, and you — the agent — talk to it almost always: you read it, claim a task,
move it as you work, and create tasks when asked. A task nobody claimed is a task two
agents can pick up at once; a status you do not update is a board that lies about what is
happening.

The board lives in **`.stark/kanban/`** next to the folder you are working in. It is powered
by the **`kanban-md`** CLI, which handles the tricky parts for you: atomic claims (no two
agents on the same task), `next_id`, and file writes. You never edit the task files by hand
unless the CLI is unavailable.

## REGOLA — aggiorna lo stato SUBITO, non dopo

Se stai lavorando a un task **e c'è una board**, aggiorni lo stato della board **nel momento
stesso in cui prendi in carico il task**, non alla fine. Non è una cosa da fare "quando hai
tempo": è il primo passo del lavoro.

- **Quando inizi** un task → `claim` + `move in-progress` **subito**, prima di fare altro.
- **Quando cambi stato** (bloccato, in review, fatto) → aggiorna la board **immediatamente**,
  appena succede, mai in un batch a fine lavoro.
- Un task che prendi in carico e non segni in corso è una board che **mente** su cosa sta
  succedendo — e chi la guarda (l'utente, un collega, un altro agent) si fida di quello che
  legge.

Questa regola vale **sempre** quando c'è una board: anche per un task piccolo, anche se pensi
di finirlo in un attimo. La board è la superficie di coordinamento, e una superficie che non
si aggiorna non coordina niente.

## Is there a board?

Before anything else, check whether the project has one:

```bash
test -d .stark/kanban && echo "c'è una board" || echo "nessuna board"
```

- **If there is a board**, use it as described below. This is the default.
- **If there is not**, do not invent one and do not create it unless the user asks. Without
  a board, behave as you always have (the todo list in `.stark/todo.json` is a separate,
  lighter thing — see the `stark-todo` skill).

## Finding the CLI

`kanban-md` is either bundled by STARK or on the `PATH`. Run it as `kanban-md`; if that
fails, try the bundled path:

```bash
kanban-md --version >/dev/null 2>&1 && echo "kanban-md ok" \
  || kanban-md="$(ls "$HOME/.local/share/stark/bin/kanban-md" 2>/dev/null || true)"
```

All commands below take `--dir .stark/kanban` because STARK keeps the board inside
`.stark/`, not in the default `kanban/` folder. Run them from the project folder.

## Read the board first

At the start of a job in a project with a board, look at it before doing anything:

```bash
kanban-md --dir .stark/kanban board        # columns, counts, blocked/overdue
kanban-md --dir .stark/kanban list         # every task, table
kanban-md --dir .stark/kanban list --compact   # one line per task — cheapest to read
```

## Claim a task before working on it

Never start work on a task you have not claimed — that is how two agents collide. Pick and
claim the next available task in one atomic step:

```bash
kanban-md --dir .stark/kanban pick --claim "$(whoami)" --move in-progress
```

Or claim a specific one you were asked to do:

```bash
kanban-md --dir .stark/kanban edit <id> --claim "$(whoami)"
kanban-md --dir .stark/kanban move <id> in-progress --claim "$(whoami)"
```

## Update status as you go

Move the task as its state changes, not in a batch at the end — a board that is only
accurate after the work is done is a report, and the user could have read the transcript:

```bash
kanban-md --dir .stark/kanban move <id> in-progress --claim "$(whoami)"
kanban-md --dir .stark/kanban move <id> review --claim "$(whoami)"
kanban-md --dir .stark/kanban move <id> done
kanban-md --dir .stark/kanban edit <id> --release    # release the claim when done
```

If a task is blocked, say why:

```bash
kanban-md --dir .stark/kanban edit <id> --block "waiting on the VPS"
```

## Create tasks when asked

```bash
kanban-md --dir .stark/kanban create "Title" --priority high --body "details here"
```

Use `--priority` (`low`/`medium`/`high`/`critical`) and `--body` for detail when they help.
The default status is `backlog`.

## A compact summary for context

When you need to embed the board state in a file or a reply, `context` renders a markdown
summary:

```bash
kanban-md --dir .stark/kanban context
```

## When the CLI is unavailable

If `kanban-md` is missing, say so plainly instead of editing the task files by hand — a
hand edit can fight an agent's claim or break `next_id`. Tell the user the board needs the
tool (reinstall STARK, or `brew install antopolskiy/tap/kanban-md`).

## Where it lives, and git

`.stark/kanban/` is inside the project. It is real data the user can open and diff. If the
project has a `.gitignore` and `.stark/` is not in it, mention it once rather than deciding
for them.
