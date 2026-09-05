---
id: 28
title: 'Tunnel: /pair senza codice vivo risponde JSON nudo invece di spiegarsi'
status: done
priority: medium
created: 2026-09-05T12:43:39.921307+02:00
updated: 2026-09-05T12:45:23.958838+02:00
started: 2026-09-05T12:43:39.93849+02:00
completed: 2026-09-05T12:45:23.944296+02:00
class: standard
---

FATTO il 5 settembre 2026, commit fa529a2, pushato. GET /pair che accetta HTML, a codice morto: pagina umana 'no active pairing code — Show me a code, poi ricarica, vale 5 minuti', status sempre 403, finestra invariata; curl continua a vedere il JSON. Verificato dal vivo via tunnel: senza codice 403+spiegazione, con codice 200. NOTA: e' un fix del DAEMON — vale sulle macchine dopo pull+riavvio, non serve deploy del cloud.
