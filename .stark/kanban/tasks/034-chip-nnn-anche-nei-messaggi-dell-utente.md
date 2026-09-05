---
id: 34
title: 'Chip #NNN anche nei messaggi dell''utente'
status: backlog
priority: low
created: 2026-09-05T15:51:28.29205+02:00
updated: 2026-09-05T15:51:28.29205+02:00
class: standard
---

Seguito della card #31 (deciso in review finale del 2026-09-05, spec §2 emendata): i prompt dell'utente passano da decoraColoriTesto (percorso stringa), non da renderMarkdown, quindi i #NNN scritti dall'utente non diventano chip e non innescano il fetch della board. Da implementare sul percorso stringa o unificando il render. Vedi docs/superpowers/specs/2026-09-05-task-chip-in-chat-design.md §2.
