# Accesso da fuori casa — dove siamo

Aggiornato: 2026-08-28

Legenda: [ ] da fare · [~] in corso · [x] fatto

## Passi

### 1. [ ] Dichiarare il perimetro con `STARK_PUBLIC_HOST`
- [ ] Scegliere l'hostname pubblico definitivo
- [ ] Impostare la variabile sulla macchina che ospita il daemon
- [ ] Riavviare il daemon (il perimetro si legge **una volta sola**, all'avvio)
- [ ] Verificare che l'hostname compaia in: log d'avvio, `/api/system`,
      Settings → System, `stark status`

Note: si **somma** a Tailscale, non lo sostituisce. Confronto per uguaglianza,
niente wildcard; le voci scartate vengono stampate all'avvio.

### 2. [ ] Traefik sul VPS (Let's Encrypt + mTLS)
- [ ] Tunnel `ssh -R` dal VPS verso il daemon
- [ ] Traefik con certificato Let's Encrypt
- [ ] mTLS: CA, certificato client, installazione sul telefono
- [ ] Prima richiesta end-to-end che arriva alla UI

Note: riferimento `docs/fuori-casa.md`. Il proxy **non** deve mentire su `Host` /
`Origin` — il perimetro si dichiara col passo 1. `X-Forwarded-*` resta ignorato.

### 3. [ ] Misurare il tunnel (SSE strozzato?)
- [ ] `npm run tunnel -- https://<host>`
- [ ] Leggere il risultato: conta **quando** arrivano i pezzi, non quanti
- [ ] Decidere se serve disattivare il buffering lato Traefik

Note: costo zero di quota (usa i battiti da 15s, non un prompt).

## Aperto / da decidere
- Durata della credenziale sul telefono (domanda aperta §5) — oggi il workaround
  è riaprire il link col token.
- Seconda misura di sopravvivenza SSE a schermo spento (§5.4).

## Diario
- 2026-08-28 — piano concordato, nessun passo ancora iniziato.
