---
id: 18
title: 'Board cloud su Postgres: schema, rotte, proxy daemon'
status: review
priority: high
created: 2026-09-02T14:07:20.516148+02:00
updated: 2026-09-02T18:47:10.365127+02:00
started: 2026-09-02T14:07:25.820161+02:00
claimed_by: veenz
claimed_at: 2026-09-02T18:47:10.365127+02:00
class: standard
---

La board passa interamente al cloud (strada A). Schema Drizzle: projects, tasks (con position e claim per utente cloud), board_config, activity. Rotte cloud dietro auth Bearer. Il daemon diventa proxy: cwd -> origin della repo -> inoltra al cloud. La UI non cambia. kanban-md non serve piu'.
