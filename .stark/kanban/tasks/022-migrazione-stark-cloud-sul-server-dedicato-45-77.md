---
id: 22
title: Migrazione STARK CLOUD sul server dedicato 45.77.53.112
status: done
priority: high
created: 2026-09-05T10:26:12.982342+02:00
updated: 2026-09-05T10:35:50.351765+02:00
started: 2026-09-05T10:26:18.744365+02:00
completed: 2026-09-05T10:35:45.027044+02:00
class: standard
---

FATTO il 5 settembre 2026. Nuovo server: Vultr 45.77.53.112 (Ubuntu 24.04, 2 vCPU, 4GB, Docker gia' a bordo, enabled al boot). Flusso di deploy-dev.sh: build locale amd64 -> sha256 verificato -> load -> compose in /opt/stark-cloud (cloud :8787 + postgres:16-alpine, bind mount data/pgdata). Dati migrati con pg_dump --clean dal vecchio (3 utenti, 10 sessioni, 0 tasks/usage — identici alla fonte, 0 errori al restore): le sessioni valgono ancora, verificato /api/me col token di questa macchina -> email giusta. Vecchio server (80.211.239.109, condiviso): compose down, container rimossi, DATI ANCORA SU DISCO in /opt/stark-cloud (backup di riserva, da cancellare quando il nuovo ha girato qualche giorno). Codice: CLOUD_PREDEFINITO e PUBLIC di deploy-dev.sh aggiornati, commit 1f5677d pushato su main — le altre macchine prendono il nuovo indirizzo al pull; i daemon accesi col vecchio default vanno riavviati dopo il pull. Accesso SSH: chiave id_ed25519 installata su root@45.77.53.112 (password da cambiare, come concordato). NOTA: ancora HTTP nudo su porta 8787, niente TLS — come prima; il compose con Traefik+letsencrypt (cloud/docker-compose.yml) resta la strada quando ci sara' un dominio.
