---
id: 7
title: 'Tunneling: accesso remoto senza Tailscale (per autenticati)'
status: done
priority: medium
created: 2026-08-30T16:17:40.999762+02:00
updated: 2026-09-05T11:47:35.964842+02:00
started: 2026-09-05T11:33:15.958544+02:00
completed: 2026-09-05T11:47:35.950157+02:00
class: standard
---

FATTO il 5 settembre 2026, commit a8e4397. Proxy HTTP rovesciato su WebSocket: hub in cloud/src/tunnel.ts (stesso processo del cloud, hostname tunnel.starkapp.dev via Traefik, cert LE emesso), client in src/daemon/tunnel.ts (WS in uscita, auth = token cloud + machine-id nei sottoprotocolli, backoff, interruttore vivo settings.tunnel spento di default — requisito sicurezza). Instradamento: /pair?m=<macchina> dal QR, poi cookie stark-m; il guard resta l'unica difesa e non cambia (Host del tunnel in perimetro come costante di prodotto, fonte 'tunnel', override STARK_TUNNEL_URL). Pannello telefono: il QR preferisce il tunnel quando connesso, riquadro 'Enable the tunnel' prima della checklist Tailscale. Provato: 15 verifiche in-process (tools/tunnel-cloud-check.ts, SSE misurata sui tempi) + giro intero dal vivo attraverso il tunnel pubblico (pair 200 + cookie, claim -> token, health autenticata ok, senza credenziali 403). Deploy fatto. RESTANO (docs/tunnel.md): rate limiting sull'hub, backpressure WS, selettore multi-macchina (da disegnare prima che scrivere), ADR su Notion da registrare. I daemon accesi vanno riavviati dopo il pull per avere le rotte nuove.
