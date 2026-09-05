---
id: 26
title: 'Settings → Cloud: cambio password dell''utente'
status: done
priority: medium
created: 2026-09-05T12:18:18.433673+02:00
updated: 2026-09-05T12:25:43.177421+02:00
started: 2026-09-05T12:18:24.450613+02:00
completed: 2026-09-05T12:25:43.162432+02:00
class: standard
---

FATTO il 5 settembre 2026, commit 990bf89, pushato. Settings -> Cloud ora ha il suo pannello (prima cadeva nel ramo finale e mostrava System, da quando il login e' un gate a schermo intero): email + server, Sign out, cambio password. Form: attuale + nuova + conferma, con le due difese del server ripetute lato client (min 8, le due copie coincidono). Daemon fa da tramite: cambiaPasswordCloud in cloud.ts + POST /api/cloud/password; verifica dell'attuale e revoca delle altre sessioni lato server (auth.ts, #25), token locale non toccato. Provato dal vivo via proxy: current sbagliata 400, cambio vero ok, login con la nuova ok, ripristino con sessione locale ancora valida ok. NOTA: ui/dist e' gitignore, la build vera esce col rilascio (npm version); i daemon accesi vanno riavviati dopo pull per la rotta nuova, e il browser ricarica per la UI.
