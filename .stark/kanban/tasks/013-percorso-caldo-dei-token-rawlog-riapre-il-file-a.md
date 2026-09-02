---
id: 13
title: 'Percorso caldo dei token: RawLog riapre il file a ogni delta, stringify per watcher, avvio OpenCode sequenziale'
status: done
priority: medium
created: 2026-09-01T22:26:46.785372+02:00
updated: 2026-09-01T22:44:11.772511+02:00
started: 2026-09-01T22:44:11.773318+02:00
completed: 2026-09-01T22:44:11.773318+02:00
claimed_by: veenz
claimed_at: 2026-09-01T22:44:11.772511+02:00
class: standard
---

Sez. D: RawLog usa appendFileSync (open+write+close per ogni messaggio nativo, e un ENOSPC li' dentro uccide il loop); JSON.stringify per watcher nel flusso SSE; start() OpenCode fa 4 round-trip in fila parallelizzabili.
