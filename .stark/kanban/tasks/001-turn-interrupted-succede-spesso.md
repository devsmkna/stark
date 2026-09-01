---
id: 1
title: Turn interrupted succede spesso
status: done
priority: high
created: 2026-08-29T23:21:40.15502+02:00
updated: 2026-08-30T00:16:58.030641+02:00
started: 2026-08-30T00:16:58.030805+02:00
completed: 2026-08-30T00:16:58.030805+02:00
class: standard
---

Bug frequente: la sessione si interrompe con 'Turn interrupted'. Da indagare: dove si perde la connessione, se è un problema di rete/SSE o del modello.

- Risolto: era il rate limit del provider. Workaround implementato (retry 5s/15s/30s + ripresa).
