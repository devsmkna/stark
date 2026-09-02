---
id: 16
title: 'macOS: il perimetro Tailscale non si rileva quasi mai all''avvio (timeout 2s contro un CLI che al primo colpo costa 20-34s)'
status: backlog
priority: high
created: 2026-09-02T10:48:17.346526+02:00
updated: 2026-09-02T10:48:17.346526+02:00
class: standard
---

Misurato il 2 settembre 2026 sul MacBook. detectTailnetHost() (security.ts) esegue 'tailscale status --json' con timeout: 2000 e gira UNA VOLTA SOLA alla costruzione del guard. Sul MacBook il primo colpo al CLI costa 20-34 secondi e i successivi 0,04-0,07: il wrapper in /usr/local/bin fa exec sul binario dentro il bundle dell'app, e macOS ne rivalida la firma quando e' uscito dalla cache (si raffredda dopo pochi minuti). Quindi all'avvio il rilevamento fallisce quasi sempre e il perimetro resta chiuso: il telefono prende 403, che sembra un problema di token. Quando funzionava era fortuna — qualcuno aveva usato tailscale poco prima. NOTA: riavviando con il CLI gia' caldo (0,05s misurati un istante prima) il perimetro restava comunque chiuso, quindi la lentezza non e' l'unica causa: da indagare se un processo staccato su macOS possa parlare col daemon Tailscale (TCC/sessione). Ripiego in uso adesso: il daemon gira con STARK_PUBLIC_HOST=macbook-pro-di-vincenzo.tailac3c9e.ts.net, che non dipende dal CLI (fonte 'env' invece di 'tailscale'). Cure da valutare: timeout piu' largo, rilevamento asincrono che aggiunge l'host quando arriva, o un riscaldamento all'avvio.
