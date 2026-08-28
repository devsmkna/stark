Aggiornato il todo di progetto («Accesso da fuori casa senza Tailscale»):

- **t2 — Traefik sul VPS con Let's Encrypt e mTLS** → `done`
- **t3 — Misurare il tunnel con `npm run tunnel`** → `blocked`, con la nota del perché: il DNS sul VPS punta ancora a Cloudflare in modalità *proxied*.

Ho messo `blocked` e non lasciato `todo` perché la differenza conta quando si rilegge.

Nota di merito: con Cloudflare in proxied la misura non è solo rumorosa, sarebbe **falsa** nella direzione peggiore.
