---
id: 23
title: 'Cloud: utenze del team + dominio starkapp.dev con TLS'
status: done
priority: high
created: 2026-09-05T11:01:35.663077+02:00
updated: 2026-09-05T11:09:05.962559+02:00
started: 2026-09-05T11:01:43.828279+02:00
completed: 2026-09-05T11:09:05.9483+02:00
class: standard
---

FATTO il 5 settembre 2026. UTENZE: tutte e tre (v.filetti, a.cirrincione, d.visco @digitizers.it) esistevano gia' — arrivate col dump della migrazione (#22) — e la password richiesta era gia' quella: verificato il login di ognuna, nessuna creazione necessaria. DOMINIO: starkapp.dev (Cloudflare proxied, zona NON nell'account CF a cui ho accesso via wrangler — e' altrove, quindi niente API: modalita' SSL e record non verificabili da qui). Sull'origin: Traefik v3 nel compose (commit 0c1301f), Let's Encrypt HTTP-01, cert emesso CN=starkapp.dev scad. 4 dic 2026, rinnovo automatico, acme.json in /opt/stark-cloud/letsencrypt. Verificato end-to-end: https://starkapp.dev/api/me -> 401, login via dominio ok, http -> 301. Cloudflare parla con l'origin su 443 (con Flexible ci sarebbe un loop di redirect, e non c'e'). CLOUD_PREDEFINITO -> https://starkapp.dev, pushato. RESTANO DA FARE A MANO SUL PANNELLO CF: confermare SSL mode Full (strict). E QUI: togliere la porta 8787 nuda dal compose quando tutte le macchine hanno fatto pull+riavvio (il compose lo dice); email ACME = devops@digitizers.it (avvisi di scadenza).
