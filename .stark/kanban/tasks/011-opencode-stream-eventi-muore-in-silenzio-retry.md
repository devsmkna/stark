---
id: 11
title: 'OpenCode: stream eventi muore in silenzio, retry cieco sulla rete locale'
status: done
priority: high
created: 2026-09-01T22:26:46.444536+02:00
updated: 2026-09-01T22:44:11.641848+02:00
started: 2026-09-01T22:44:11.642753+02:00
completed: 2026-09-01T22:44:11.642753+02:00
claimed_by: veenz
claimed_at: 2026-09-01T22:44:11.641848+02:00
class: standard
---

Sez. B della revisione: ascolta() ingoia la fine del flusso (server morto = adapter sordo per sempre); passeggero() non riconosce ECONNREFUSED/ECONNRESET/fetch failed; retry possibile su sessione senza turno aperto (ultimoPrompt mai azzerato); rispondiPermesso non guarda result.error (stessa lezione di rispondiDomanda) e non rimonta la guardia; leak refcount fra clientPer e preso=true.
