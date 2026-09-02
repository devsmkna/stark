---
id: 15
title: Fix dalla review adversarial di e013def
status: done
priority: high
created: 2026-09-02T10:05:08.43816+02:00
updated: 2026-09-02T10:12:55.664204+02:00
started: 2026-09-02T10:06:01.818308+02:00
completed: 2026-09-02T10:12:47.921815+02:00
class: standard
---

Tre reviewer (Sonnet) sul commit e013def. Il timore grosso (seq non monotono in applica()) NON si materializza: ++this.seq avviene prima di writeSync. Da chiudere: (1) chiudiOrfani non e' scoped al turno — rifiuta TUTTI i pending anche con un altro turno ancora aperto; (2) chiudiOrfani cancella l'entry da pending senza risolvere la Promise che l'adapter sta aspettando; (3) il turn.ended sintetico del catch fatale ignora this.fermato -> uno Stop puo' finire etichettato 'error'; (4) finestra fra fatale+closed e il setTimeout di ritiraMorta in cui command() inoltra ancora all'adapter morente; (5) 413 riconosciuto per confronto di stringa; (6) notice max_tokens ripetuto per ogni step.
