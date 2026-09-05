---
id: 21
title: 'Phone panel: green ticks with a closed perimeter — il pannello mente'
status: backlog
priority: high
created: 2026-09-05T09:04:54.233441+02:00
updated: 2026-09-05T09:04:54.233441+02:00
class: standard
---

Trovato dal vivo il 5 settembre 2026: QR scansionato -> {"error":"forbidden"}. Log del daemon: '[guard] Host non locale: macbook-pro-di-vincenzo.tailac3c9e.ts.net — GET /pair?c=...'. /api/system: perimeter {open:false, hosts:[]}.

Il difetto NON e' il rilevamento (quello e' la card #16): e' che il pannello 'Use STARK from your phone' interroga Tailscale DAL VIVO (daemon/tailscale.ts) mentre il guard usa il perimetro cachato UNA VOLTA SOLA all'avvio (detectTailnetHost/tailnetCache in security.ts). Le due verita' divergono, e la UI mostra quella sbagliata: cinque spunte verdi, QR generato, codice valido — e il telefono prende 403 che sembra un problema di token. Stessa classe del bug gia' corretto quando soggetto() in push.ts faceva il rilevamento per conto suo.

Cura: il passo 'pubblicato' (e la decisione di mostrare QR/codice) deve confrontarsi col PERIMETRO DEL GUARD, non con Tailscale dal vivo. Se l'hostname vivo non e' fra guard.perimetro.ammessi, il passo resta rosso e dice 'Il daemon non conosce ancora questo nome: riavvialo' invece di far scansionare un codice che non puo' funzionare.

Ripiego che funziona oggi: far ripartire il daemon con STARK_PUBLIC_HOST=<host della tailnet> (fonte 'env', non dipende dal CLI). Il daemon acceso adesso NON ce l'ha, quindi il ripiego di #16 si e' perso a un riavvio: vale la pena renderlo persistente, non una variabile che si dimentica.
