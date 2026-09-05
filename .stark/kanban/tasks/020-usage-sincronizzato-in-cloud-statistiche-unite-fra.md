---
id: 20
title: 'Usage sincronizzato in cloud: statistiche unite fra i dispositivi'
status: review
priority: high
created: 2026-09-04T17:49:12.803908+02:00
updated: 2026-09-04T18:21:00.252926+02:00
started: 2026-09-04T17:49:19.560046+02:00
claimed_by: veenz
claimed_at: 2026-09-04T18:21:00.252926+02:00
class: standard
---

Le statistiche di Settings -> Usage oggi si calcolano in locale dagli snapshot in RAM, quindi ogni macchina vede solo il proprio terzo. Salgono in cloud, per utente, con la ripartizione per dispositivo.

Perimetro: sincronizzazione PERSONALE (solo il proprietario vede i propri numeri). Niente classifica, niente confronto fra utenti - scartata esplicitamente il 4 settembre 2026.

Schema: machines, usage_daily (PK user+machine+day+project+agent+model), usage_session_days (per contare le conversazioni distinte senza gonfiarle). UPSERT idempotente: si manda sempre lo stato completo, mai un delta.

Chiave di progetto: l'origin git (come la board), non il cwd - lo stesso progetto ha percorsi diversi su macchine diverse.

Innesco: fine turno, collassato a un invio ogni 60s, finestra ultimi 3 giorni.
Interruttore in Settings, SPENTO di default (coerente con ADR-011: e' la seconda cosa che esce dalla macchina).

Spec: docs/superpowers/specs/2026-09-04-usage-cloud-design.md
