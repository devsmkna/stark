---
id: 12
title: Card permesso/domanda orfane su turno morto + troncamento max_tokens invisibile
status: done
priority: high
created: 2026-09-01T22:26:46.654206+02:00
updated: 2026-09-01T22:44:11.705874+02:00
started: 2026-09-01T22:44:11.70672+02:00
completed: 2026-09-01T22:44:11.70672+02:00
claimed_by: veenz
claimed_at: 2026-09-01T22:44:11.705874+02:00
class: standard
---

Sez. C: claude-code non ha l'equivalente di abbandonaBloccantePendente (fix del 30 ago fatta solo su OpenCode) -> sweep degli orfani nel registry su turn.ended non-completed, per tutti gli adapter. E message_delta ignorato: stop_reason max_tokens oggi indistinguibile da un turno normale.
