---
id: 25
title: 'Hardening del tunnel e del cloud: binding macchina, rate limit, registrazione chiusa, scadenza sessioni'
status: done
priority: critical
created: 2026-09-05T11:58:59.312004+02:00
updated: 2026-09-05T12:08:29.614822+02:00
started: 2026-09-05T11:59:05.719672+02:00
completed: 2026-09-05T12:08:29.597763+02:00
class: standard
---

FATTO il 5 settembre 2026, commit a386a54, deployato e verificato dal vivo. (1) DIROTTAMENTO CHIUSO: la chiave d'instradamento non e' piu' il machine-id dichiarato dal daemon ma uno slug derivato dall'HUB — sha256(userId:machineKey) troncato a 16 hex, comunicato nel frame 'benvenuto'. Stesso machine-id sotto un altro account = altra chiave: per rubare il traffico serve il token cloud della vittima. Niente primo-che-arriva-vince, di proposito: due account sulla stessa macchina sono legittimi e convivono. Il QR ora espone lo slug, non il machine-id. (2) FRENI SULL'HUB: rate limit per IP (300/min generali, 20/min su /pair+/claim, 30/min handshake; XFF di Traefik affidabile ora che la 8787 e' chiusa), tetti di memoria (32MB/corpo, 64MB in volo, 128 pendenti/macchina). (3) REGISTRAZIONE DIETRO INVITO: CLOUD_INVITE in /opt/stark-cloud/.env (0600); senza variabile chiusa del tutto. Card #17 (UI registrazione) dovra' chiedere il codice. (4) PORTA 8787 NUDA TOLTA dal compose — verificato: connection refused. (5) SESSIONI A SCADENZA (90 giorni, spazzate all'avvio) + POST /api/password {current,new} che revoca le altre sessioni chiedendo comunque l'attuale. (6) TCB del VPS: compromesso accettato e documentato, non falla. Prove: 22 verifiche in tools/tunnel-cloud-check.ts (incluso il dirottamento provato per davvero e il 429) + giro dal vivo con slug attraverso il tunnel pubblico. PASSWORD DEL TEAM ANCORA DEBOLI: ora c'e' l'endpoint per cambiarle.
