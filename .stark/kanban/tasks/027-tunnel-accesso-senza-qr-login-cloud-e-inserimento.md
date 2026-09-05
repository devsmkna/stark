---
id: 27
title: 'Tunnel: accesso senza QR — login cloud e inserimento codice'
status: done
priority: high
created: 2026-09-05T12:35:47.163533+02:00
updated: 2026-09-05T12:41:30.41634+02:00
started: 2026-09-05T12:35:47.179921+02:00
completed: 2026-09-05T12:41:30.402003+02:00
class: standard
---

FATTO il 5 settembre 2026, commit 95476f0, deployato e verificato dal vivo. tunnel.starkapp.dev senza cookie = pagina di login dell'hub (prima: 404). Login usa-e-getta (sessione revocata subito, al browser solo il cookie d'instradamento), credenziali sbagliate -> 303 su /?e=credenziali (mai render del POST), freno 10/min per IP. Dopo il login: 1 macchina -> 303 su /pair?m=<slug>; piu' macchine -> lista coi nomi (hostname nell'handshake, lab. base64url — i daemon con la build di stamattina appaiono 'unnamed machine' finche' non fanno pull); 0 -> spiegazione. Il codice resta sulla pagina del daemon: la password scopre la porta, non la apre. Verificato dal vivo: pagina login ok, redirect errore ok, scelta con DUE macchine vere ok, link -> cookie piantato + 403 del guard senza codice vivo + 200 con codice vivo. 25 verifiche in tools/tunnel-cloud-check.ts.
