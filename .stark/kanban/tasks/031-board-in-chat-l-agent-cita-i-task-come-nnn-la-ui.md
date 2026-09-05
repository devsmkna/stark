---
id: 31
title: 'Board in chat: l''agent cita i task come #NNN, la UI li rende chip cliccabili'
status: review
priority: medium
created: 2026-09-05T13:55:47.919552+02:00
updated: 2026-09-05T15:54:17.184426+02:00
started: 2026-09-05T14:07:31.269781+02:00
class: standard
---

Implementato e unito su main (merge dopo 61e4cfd; ramo worktree-task-chip-31, 12 commit). Due canali di trigger: blocco progetto+skill e iniezione adapter (Claude Code append al preset; OpenCode campo system, misurato che si somma — spec §1-bis). UI: chip inline B + card blocco D sulla prima citazione visibile del turno; click apre la Board sul dettaglio. Prove: npm run check (§31, 5 verifiche) e npm run taskchip:check (9 asserzioni browser, inclusi id a 3 cifre vs decoratore colori). In review e non done: la condotta dell'agent va misurata dal vivo (una sessione vera che citi #NNN, l'append nei fatti, il click). Seguito: card #34 (chip nei messaggi utente). Minor deferiti nel piano/ledger: boardTask non consumato su board di altro progetto, card dentro liste, chip transitorio in streaming, renderInline senza chip, nessun check sull'iniezione OpenCode, prova-codeblock rossa preesistente (gate login cloud, ricetta in prova-taskchip.mjs).
