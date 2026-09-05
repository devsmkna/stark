---
id: 29
title: MFA (TOTP) + device fidati per il tunnel
status: done
priority: high
created: 2026-09-05T13:23:42.949876+02:00
updated: 2026-09-05T13:56:52.803403+02:00
started: 2026-09-05T13:23:42.973773+02:00
completed: 2026-09-05T13:56:52.788908+02:00
class: standard
---

FATTO il 5 settembre 2026 (commit merge 76a5a6a + fix 6f742b0). MFA opzionale sul tunnel, tre strati: account (TOTP RFC6238 con node:crypto, cloud/src/totp.ts, provato sui vettori appendice B in tools/totp-check.ts; enrolment due passi con QR; 10 codici di recupero monouso hashati scrypt), device (device nuovo dopo login+MFA autorizzato col codice di pairing, poi ha il token e non chiede piu' niente; recovery come via d'uscita), macchina (il daemon resta l'unico a rilasciare il token). Login del tunnel chiede il codice quando l'account ha il TOTP (param mfa=1, non m). /api/login del cloud corretto per accettare il codice e passarlo fino al gate del daemon (Login.svelte) e a Settings — altrimenti un utente con MFA non poteva loggare il daemon (lockout). Gestione in Settings->Cloud->Two-factor (QR+verifica, recovery, spegni con password). Freno 10/min sul login. Provato dal vivo: enable, login TOTP, login recovery, replay recovery respinto, password sola respinta. Migrazione 0004 idempotente (rinumerata dal merge con board-cloud-share). FOLLOW-UP dichiarato in docs/tunnel.md: approvazione con tap da un altro device fidato (il codice copre gia' quel caso).
