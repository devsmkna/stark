---
id: 2
title: 'Workaround: retry dopo Turn interrupted (5s, 15s, 30s)'
status: done
priority: medium
created: 2026-08-29T23:21:40.172656+02:00
updated: 2026-08-30T00:16:58.060907+02:00
started: 2026-08-29T23:22:38.044681+02:00
completed: 2026-08-30T00:16:58.061112+02:00
class: standard
---

Se succede 'Turn interrupted', rifare la richiesta fino a un massimo di 3 volte con attese crescenti: 5s, 15s, 30s (alla terza). Al ripresa, dire: 'C'è stata un'interruzione dovuta a turn interrupted. Riprendi il lavoro da dove l'hai interrotto.'
