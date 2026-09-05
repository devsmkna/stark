---
id: 24
title: cloud.starkapp.dev per il cloud + homepage su starkapp.dev
status: done
priority: high
created: 2026-09-05T11:22:37.726324+02:00
updated: 2026-09-05T11:25:43.254053+02:00
started: 2026-09-05T11:22:37.743366+02:00
completed: 2026-09-05T11:25:43.239251+02:00
class: standard
---

FATTO il 5 settembre 2026, commit 6c2e8e0. cloud.starkapp.dev -> API del cloud (il CNAME era gia' creato, DNS-only: i client parlano dritti con Traefik, cert LE dedicato CN=cloud.starkapp.dev). starkapp.dev -> homepage statica (cloud/www/index.html nel repo, nginx:alpine nel compose, palette della UI, un tasto verso github.com/devsmkna/stark) — segnaposto dichiarato, landing rimandata. deploy-dev.sh copia anche la homepage. CLOUD_PREDEFINITO -> https://cloud.starkapp.dev. Verificato: login via sottodominio ok, homepage servita attraverso Cloudflare. Restano vere le note di #23: porta 8787 nuda da togliere a transizione finita, SSL mode Full (strict) da confermare sul pannello CF.
