---
id: 9
title: Login cloud obbligatorio come gate d'accesso a STARK
status: review
priority: high
created: 2026-09-01T17:40:21.840837+02:00
updated: 2026-09-01T22:05:33.796211+02:00
started: 2026-09-01T17:40:23.689792+02:00
claimed_by: veenz
claimed_at: 2026-09-01T22:05:33.796211+02:00
class: standard
---

Il login cloud diventa obbligatorio per accedere alla UI di STARK. Senza sessione cloud valida si mostra una schermata di login, non l'app. Il token locale resta per la sicurezza di rete (due livelli). Gate agganciato nel bootstrap dello store (dopo il check del token).
