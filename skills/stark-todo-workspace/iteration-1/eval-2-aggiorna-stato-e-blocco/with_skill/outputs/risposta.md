Fatto. La lista «Accesso da fuori casa senza Tailscale» ora dice:

- **t2 Traefik** → `done`
- **t3 Misurare il tunnel** → `blocked`, con la nota che spiega perché: DNS del VPS ancora su Cloudflare in modalità proxied
- **t4** nuovo, `todo`: «Il DNS del VPS risolve diretto, senza proxy Cloudflare» — è il passo che sblocca t3, e senza scriverlo il blocco resterebbe una diagnosi senza una cosa da fare

La lista resta `active`: due task su quattro sono aperti.

Una cosa da decidere tu: il progetto non ha `.gitignore`, quindi `.stark/todo.json` finirà nei commit.
