---
name: stark-todo
description: Read and maintain the shared task lists that STARK shows in its Todo sidebar, stored as `.stark/todo.json` in the project folder. Use this skill whenever you are asked to plan, track, or report on multi-step work — "what's left", "add this to the list", "mark that done", "what were we doing" — and also whenever you start a job with more than two or three steps in a project that has a `.stark/` folder, because a list nobody can see is a list the user has to hold in their head. Also use it when the user mentions the todo sidebar, a checklist, a backlog, or asks you to break work into steps.
---

# STARK todo lists

STARK shows a Todo sidebar built from one file per project: **`.stark/todo.json`**, next to
the folder you are working in. Anything you write there appears there; anything you do not
write there does not exist for the person watching.

That is the whole point of this skill. You already track steps in your head, and you may have
your own scratch notes — but those die when the turn ends, and the user cannot see them, cannot
correct them, and cannot pick them up from a second chat. This file survives all three.

## The shape

The file is a map from **list id** to **list**. More than one list can be open at a time:
a project usually has one running list plus whatever was left from before.

```json
{
  "9f1c2a4e-6b31-4d0a-9f28-5c7ab0e14d33": {
    "title": "Reach STARK from outside the house",
    "created": 1787903044000,
    "__status": "active",
    "tasks": [
      { "id": "t1", "text": "Declare the perimeter with STARK_PUBLIC_HOST", "state": "done" },
      { "id": "t2", "text": "Traefik on the VPS with mTLS", "state": "doing" },
      { "id": "t3", "text": "Measure the tunnel with npm run tunnel", "state": "todo",
        "note": "zero quota — it uses the heartbeats, not a prompt" }
    ]
  }
}
```

**List fields**

| field | meaning |
|---|---|
| `title` | one line, what this list is *for*. It is the sidebar heading. |
| `__status` | `active`, `paused`, `done`, or `abandoned` — see below |
| `created` | milliseconds, set once, never touched again |
| `tasks` | ordered; the order is the order the sidebar shows |

**Task fields**

| field | meaning |
|---|---|
| `id` | short and stable, unique inside its list. Never reuse or renumber. |
| `text` | one line, imperative, what a person would say out loud |
| `state` | `todo`, `doing`, `done`, or `blocked` |
| `note` | optional, one line: why it is blocked, or what the next person needs to know |

Ids are stable because the sidebar tracks them across refreshes and because the user may be
looking at a task while you edit the file. Renumbering makes the thing they were reading jump
to a different row.

## `__status` versus the tasks

`__status` says something the tasks cannot: whether the list is still being worked on. It is
tempting to derive it — every task done, therefore the list is done — but that misses the two
cases that matter, `paused` (we stopped on purpose, the tasks are still open) and `abandoned`
(we are not doing this at all, do not resurrect it).

So keep it explicit, and keep it honest:

- move to `done` when you finish the last task, in the same edit — not later, or the sidebar
  shows a finished list as if it were still running
- move to `paused` when the user changes direction, and say why in the last task's `note`
- use `abandoned` when the work was dropped, not when it failed

A list whose tasks are all `done` but whose `__status` is still `active` is the most common way
this goes wrong, and it makes the sidebar lie about what is left.

## Use the script, not hand-edited JSON

`scripts/todo.py` does read-modify-write for you. Two things about how to call it,
because getting either wrong fails quietly rather than loudly:

- **The script path is relative to this skill's own directory**, which you were told when
  this skill loaded. Use it in full.
- **Run it from the project folder**, because it resolves `.stark/` from the current
  working directory — that is how it knows which project's list to touch. If you run it
  from somewhere else you will not get an error: you will get a brand new `.stark/todo.json`
  in the wrong place, and a sidebar that stays empty while you keep writing to a file
  nobody reads. When in doubt, `pwd` first.

```bash
# <skill> is this skill's directory; run from the project folder
python3 <skill>/scripts/todo.py list                            # show every list, compactly
python3 <skill>/scripts/todo.py new "Reach STARK from outside"  # prints the new list id
python3 <skill>/scripts/todo.py add <list-id> "Declare the perimeter" "Traefik with mTLS"
python3 <skill>/scripts/todo.py set <list-id> t2 doing          # task state
python3 <skill>/scripts/todo.py note <list-id> t3 "blocked on the VPS"
python3 <skill>/scripts/todo.py status <list-id> done           # list state
```

`list` prints the path it read, so one call is also the cheapest way to check you are
pointed at the right project.

Two reasons this matters more than it looks.

**Another chat may be writing at the same time.** STARK lets several conversations run in one
folder, and they share this file. If you read it, think for a minute, then write it back whole,
you silently erase whatever the other one did in between. The script keeps that window as small
as it can be and writes atomically.

**Rewriting the file by hand loses fields you did not know about.** The format will grow. If you
regenerate the JSON from what you remember of it, you drop everything that is not in this
document. The script preserves unknown keys.

If the script is unavailable, edit the file directly — but read it immediately before writing,
change only the keys you mean to change, and keep every other key exactly as you found it.

## When to write, and how much

Write a list when the work has **more than two or three steps** and someone might reasonably ask
"where are we". That is the bar. A single-file edit does not need a list, and a list that
restates the obvious is noise in a sidebar the user is trying to read at a glance.

Keep `text` short enough to read in a narrow column — the sidebar is not wide. Say what will be
true when the task is done, not what you are about to type: "Traefik terminates TLS on the VPS"
reads better than "edit stark.yml".

Update state **as you go**, not in a batch at the end. The value of the sidebar is that it is
right *now*; a list that only becomes accurate after the work is finished is a report, and the
user could have read the transcript for that.

## Where the file lives, and git

`.stark/todo.json`, relative to the project folder. Create the `.stark/` directory if it is not
there.

It lives in the repo on purpose: the user can open it, correct it, and see it in a diff. That
also means it can end up in a commit. If the project has a `.gitignore` and `.stark/` is not in
it, mention it once to the user rather than deciding for them — some people want the list in
version control and some very much do not.
