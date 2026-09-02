---
id: 10
title: 'Errori fatali: turno mai chiuso, sessione fantasma nel registry, ENOSPC a cascata'
status: done
priority: critical
created: 2026-09-01T22:26:46.226427+02:00
updated: 2026-09-01T22:44:11.584961+02:00
started: 2026-09-01T22:27:16.202523+02:00
completed: 2026-09-01T22:44:11.586559+02:00
claimed_by: veenz
claimed_at: 2026-09-01T22:44:11.584961+02:00
class: standard
---

Da revisione 2026-09-01 (docs/revisione-token-errori-2026-09-01.md, sez. A). (1) consume() di claude-code non emette turn.ended ne' svuota la fila su errore fatale; (2) il registry non ritira mai una sessione il cui loop e' morto -> live:true eterno, prompt in coda morta (sessione 61f480c1 del 1 set); (3) journal.append che lancia dentro emit (ENOSPC) uccide il loop senza 'closed'.
