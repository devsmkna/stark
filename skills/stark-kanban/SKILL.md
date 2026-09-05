---
name: stark-kanban
description: Read and maintain the project's kanban board that STARK shows in its Board view. The board lives on the STARK cloud, shared across machines and teammates, and you talk to it through the local STARK daemon's HTTP API. Use this skill whenever you work in a project that has a board — it is the default coordination surface: read it first, claim a task before working on it, update its status as you go, and create tasks when asked. Also use it when the user mentions the board, a kanban, a task/backlog in a project with a board, or asks you to add, move, or track work items.
---

# STARK kanban board

If a project has a board, **it is the default way to coordinate work**. STARK shows it in
its Board view, and you — the agent — talk to it almost always: you read it, claim a task,
move it as you work, and create tasks when asked. A task nobody claimed is a task two
agents can pick up at once; a status you do not update is a board that lies about what is
happening.

The board lives **on the STARK cloud**, keyed by the git origin of the repo: every machine
and every teammate logged into the same cloud sees the same board, live. You reach it
through the **local STARK daemon**, which proxies to the cloud — never by editing files.
(`.stark/kanban/` on disk is only a leftover local copy or a placeholder marker: do not
edit it, and do not trust it as current.)

## REGOLA — aggiorna lo stato SUBITO, non dopo

Se stai lavorando a un task **e c'è una board**, aggiorni lo stato della board **nel
momento stesso in cui prendi in carico il task**, non alla fine.

- **Quando inizi** un task → claim + move a `in-progress` **subito**, prima di fare altro.
- **Quando cambi stato** (bloccato, in review, fatto) → aggiorna la board
  **immediatamente**, mai in un batch a fine lavoro.

Questa regola vale **sempre** quando c'è una board, anche per un task piccolo.

## Setup: one block you paste once per shell

All commands go through the daemon on `127.0.0.1:4571`, authenticated with the local
token. Paste this once, from the project folder:

```bash
STARK="http://127.0.0.1:4571"
AUTH="Authorization: Bearer $(cat ~/.stark/token)"
CWD="$(pwd)"
```

If `~/.stark/token` does not exist or the daemon does not answer, STARK is not running on
this machine: say so plainly (the user starts it with `stark`) instead of falling back to
editing files.

## Is there a board?

```bash
curl -s -H "$AUTH" "$STARK/api/board?cwd=$CWD"
```

- A JSON with `columns` → there is a board: use it as described below.
- `"assente": true` → no board yet. Do not create one unless the user asks.
- `"motivo": "cloud non configurato o non loggato"` → the machine is not logged into the
  STARK cloud: tell the user (Settings → Cloud in STARK), do not work around it.

## Read the board first

At the start of a job in a project with a board, look at it before doing anything. The
response is the whole board: columns in order (`backlog`, `todo`, `in-progress`,
`review`, `done`, `archived`), each with its tasks (`id`, `title`, `status`, `priority`,
`claimed_by`, `blocked`, `body`, …).

```bash
curl -s -H "$AUTH" "$STARK/api/board?cwd=$CWD"
```

## Claim a task before working on it

Never start work on a task you have not claimed — that is how two agents collide. The
claim is **per cloud user**: claim with the email of the account this machine is logged
in as, which you read once from the daemon:

```bash
EMAIL=$(curl -s -H "$AUTH" "$STARK/api/cloud/status" | sed -n 's/.*"email":"\([^"]*\)".*/\1/p')
```

Claim and move in one call (task 18 as the example):

```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"status\":\"in-progress\",\"claimed_by\":\"$EMAIL\"}" \
  "$STARK/api/board/task/18/edit?cwd=$CWD"
```

## Update status as you go

Move the task as its state changes, not in a batch at the end:

```bash
# in review
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"status":"review"}' "$STARK/api/board/task/18/edit?cwd=$CWD"

# done, releasing the claim (empty string = release)
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"status":"done","claimed_by":""}' "$STARK/api/board/task/18/edit?cwd=$CWD"
```

If a task is blocked, say why (empty string clears the block):

```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"blocked":"waiting on the VPS"}' "$STARK/api/board/task/18/edit?cwd=$CWD"
```

The edit route also accepts `title`, `priority`, `body`, `assignee`, `position` — send
only the fields you are changing.

## Create tasks when asked

New cards land at the bottom of `backlog`:

```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' \
  -d '{"title":"Title here","priority":"high","body":"details here"}' \
  "$STARK/api/board/task?cwd=$CWD"
```

`priority` is one of `low`/`medium`/`high`/`critical`; `body` is optional detail.

## Migrating an old local board

If the cloud board is `assente` but the project has an old file-based board
(`.stark/kanban/tasks/*.md`), initializing moves it up **with its card numbers intact**:

```bash
curl -s -X POST -H "$AUTH" "$STARK/api/board/init?cwd=$CWD"
```

Do this only when the user asks to put the board on the cloud, and report the outcome
(`importati: N`). The local files stay behind as history; from then on the cloud is the
only truth.

## Errors are answers, not obstacles

Every route answers JSON: `{"ok":false,"motivo":"…"}` or `{"error":"…"}` tells you
exactly what is wrong (not logged in, no git origin, task not found). Read it and tell
the user, instead of retrying blind or falling back to editing files by hand.
