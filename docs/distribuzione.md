# Come si distribuisce STARK: bundle precompilati su starkapp.dev

Fino al 5 settembre 2026 `install.sh`/`install.ps1` clonavano `github.com/devsmkna/stark`
e compilavano in locale (`npm install`, poi `npm run ui:build`) — e `stark update` faceva
lo stesso con `git fetch`/`checkout --detach`. Da quel giorno chi installa non tocca più
GitHub: scarica un **bundle già pronto** — codice, `node_modules` e interfaccia già
compilata — da `starkapp.dev`, un server che STARK possiede e controlla per intero. È il
passo che rende possibile rendere **privato** il repo GitHub (sviluppo, issue, storia
completa) senza rompere l'installer: quando succederà, a leggere il repo resterà solo la
CI, con le sue credenziali — non più chi installa.

Perché non uno specchio git pubblico del repo privato (la prima idea, scartata): un
utente che scarica un bundle già pronto salta interamente `npm install` e
`npm run ui:build` in locale — minuti, non secondi, dice il commento che c'era in
`install.sh` — e il repo privato non ha bisogno di nessun'altra credenziale per restare
leggibile da fuori: a leggerlo resta solo la CI, con le sue.

## Cosa fa scattare cosa

Un tag `vX.Y.Z` resta **la release** (`docs/rilascio.md` spiega perché un tag e non un
numero scritto a mano). Cambia solo cosa succede quando esce:

1. `.github/workflows/publish-release.yml` parte sul push del tag. Una build per ogni
   piattaforma supportata (matrix), ciascuna: `npm ci --omit=dev` (non `install`: la
   cartella è appena clonata, non c'è nessun lockfile locale da rispettare più del
   solito) + `npm run ui:build`, impacchettati in `stark-<piattaforma>.tar.gz` — `src/`,
   `node_modules/`, `ui/dist/`, `package.json`, `package-lock.json`. Un formato solo,
   `tar.gz`, anche su Windows: dalla 1803 in poi Windows include `tar` (bsdtar), quindi
   non serve un secondo formato solo per lì.
2. Un job finale scarica tutti i bundle e li manda su `starkapp.dev` via `rsync`, sia
   sotto `releases/<tag>/` (un bundle preciso, per chi lo vuole) sia sotto
   `releases/latest/` — la cartella che `install.sh`/`install.ps1`/`stark update`
   leggono davvero, perché nessuno dei tre sa né deve sapere qual è il tag più recente
   prima di chiederlo. Nella stessa cartella finisce `version.txt`, una riga col tag:
   è quello che confronta `daemon/aggiornamenti.ts` (`core/release.ts` fa il confronto
   vero e proprio, invariato da prima — la regola non è cambiata, è cambiato solo come
   ci si arriva).
3. `install.sh`/`install.ps1` cambiano molto più raramente delle release, e non seguono
   i tag: `.github/workflows/publish-installer.yml` li pubblica a ogni push su `main`
   che li tocca, fuori da `releases/`, alla radice di `starkapp.dev` — la stessa
   distinzione fra «segue ogni push» e «segue solo una release» che il progetto fa
   altrove (`docs/rilascio.md`).

## Le piattaforme

| target | runner GitHub-hosted |
|---|---|
| linux-x64 | `ubuntu-24.04` |
| linux-arm64 | `ubuntu-24.04-arm` |
| darwin-x64 | `macos-13` |
| darwin-arm64 | `macos-14` |
| win-x64 | `windows-2022` |
| win-arm64 | **non pubblicata**: nessun runner GitHub-hosted nativo per quella combinazione. `install.ps1` lo dice invece di scaricare un bundle che non esiste. Se serve davvero, la strada da provare è forzare `npm install --cpu=arm64 --os=win32` da un runner x64 — npm risolve gli `optionalDependencies` sui flag passati, non sull'host reale, ma non è stato ancora verificato dal vivo. |

WSL non è una piattaforma a parte: `uname -s` dentro WSL2 risponde `Linux` come su
qualunque altra distribuzione, quindi prende il bundle `linux-x64`/`linux-arm64` senza
bisogno di un caso in più — né in `install.sh` (non lo distingueva già), né nel bundle
stesso (nessuna dipendenza compilata contro l'ABI di Node: l'unico pezzo per-piattaforma
è l'eseguibile di Claude Code, che l'SDK sceglie da sé via `optionalDependencies`, e non
è un modulo nativo caricato con `require()` — la piattaforma su cui gira `npm ci` non
deve combaciare con quella su cui gira poi il bundle).

## Il server (45.77.53.112 → starkapp.dev)

Non un webserver dedicato: **lo stesso VPS che già ospita `stark-cloud`** (l'account, il
login, la board condivisa, il tunnel — `/opt/stark-cloud/docker-compose.dev.yml`). Sul
45.77.53.112 gira già Traefik come reverse proxy davanti a Docker, con TLS via Let's
Encrypt gestito **da Traefik stesso** (`certresolver=letsencrypt`, sfida HTTP-01
sull'entrypoint `web`), e `starkapp.dev` è già instradato — via un router Traefik
attaccato per `Host()` — al container `home` (`nginx:alpine`), che serve staticamente
`/opt/stark-cloud/www` (bind mount in sola lettura dentro il container, lettura/scrittura
sull'host). Non serve installare niente, non serve toccare Traefik, non serve un
certificato in più: quel container **già risponde** su `starkapp.dev`, e i file che
`install.sh`/`stark update` scaricano sono file dentro quella stessa cartella.

Un utente di sistema a bassi privilegi, `deploy`, sull'**host** (non dentro un
container: Docker non serve a questo passo, `rsync` scrive su un bind mount che il
container legge), la cui chiave SSH è ristretta con **`rrsync`** — lo script "rsync
ristretto" incluso ufficialmente nel pacchetto `rsync` (`/usr/share/doc/rsync/scripts/rrsync`
su Debian/Ubuntu), non uno strumento nostro:

```
# /home/deploy/.ssh/authorized_keys
command="/usr/local/bin/rrsync -wo /opt/stark-cloud/www/",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-actions-deploy
```

La radice è `/opt/stark-cloud/www/` intera — non solo `releases/`: sotto ci stanno sia
`releases/` (i bundle) sia `install.sh`/`install.ps1` alla radice, accanto a qualunque
`index.html` segnaposto ci sia già per l'apex. Il costo accettato, e vale la pena dirlo
esplicitamente: chi avesse quella chiave privata potrebbe riscrivere l'installer o un
bundle di release — cioè trojanizzare ogni installazione futura — ma **non** toccare
`stark-cloud` stesso: `rrsync -wo` con quella radice non vede `data/`, `pgdata/` né
`letsencrypt/`, che sono cartelle sorelle di `www/`, non sue. È per questo che la
chiave vive **solo** come secret di GitHub Actions (`STARK_DEPLOY_SSH_KEY`), mai su una
macchina di sviluppo, e `STARK_DEPLOY_HOST_KEY` (l'host key del VPS, verificata **a
mano** confrontando l'impronta con quella del pannello del provider, non un
`ssh-keyscan` alla cieca in CI) protegge dal lato opposto — che il push non finisca
altrove per un DNS o un routing compromesso.

Niente `nginx`/`certbot` da installare, niente `ufw` da toccare: le porte 80/443 sono
già di Traefik (pubblicate dal suo container, `0.0.0.0:80->80`, `0.0.0.0:443->443`), e
il traffico esterno le raggiunge comunque le regole del firewall dell'host — Docker
gestisce le sue `iptables` per le porte che pubblica. `/releases/...` non ha bisogno di
`autoindex` esplicito: `nginx:alpine` lo tiene spento di default. Content-type di
`.sh`/`.ps1`: `nginx:alpine` di base non li conosce e li serve come
`application/octet-stream` — funziona lo stesso con `curl | sh`/`irm | iex`, e se un
giorno servisse un content-type più pulito basta un `default.conf` in più montato nel
container `home`, non toccato qui perché non è un requisito, solo un miglioramento.

## DNS

**Già fatto**, prima ancora di iniziare questo lavoro: `starkapp.dev` è un record `A`
su Cloudflare **proxato** (nuvola arancione), impostato quando è nato `stark-cloud`
(vedi il commento in cima a `docker-compose.dev.yml`). Non è in contraddizione con
`docs/fuori-casa.md`, che consiglia DNS-only: quella pagina parla del **daemon**
locale di ogni utente — privato, non bufferizzabile (SSE), con mTLS suo — mentre qui
non c'è niente di riservato: un installer e dei bundle sono pensati per essere
pubblici, quindi il proxy è un vantaggio netto (CDN gratuito sui bundle, anche 350+ MB
l'uno, e protezione da bot/DDoS su un endpoint `curl | sh`, bersaglio naturale).

L'unica cosa che il proxy **non** inoltra è SSH: per questo il deploy da CI
(`.github/workflows/`) punta all'**IP diretto** (`45.77.53.112`), non all'hostname — le
due cose restano disaccoppiate anche se un giorno l'IP del VPS cambia.

## Cosa non è cambiato

- `core/release.ts` (qual è l'ultima release, `daAggiornare`) — le stesse funzioni pure
  di sempre, provate in `npm run check`.
- Il fatto che una release sia un tag, e le regole su quali tag contano
  (`docs/rilascio.md`): pre-release ignorate, tag non-versione ignorati, il confronto è
  su `package.json` e non sui commit.
- `stark up`/`stark stop`/`stark status`, il lanciatore, il fatto che STARK non parta da
  solo al boot: tutto quello che non riguarda *come arriva il codice* è rimasto com'era.

## Cosa è cambiato, esplicitamente

- La copia installata **non è più un checkout git**: niente più protezione contro
  modifiche locali tracciate, perché non c'è più un albero tracciato. Un aggiornamento
  estrae il bundle nuovo sopra quello vecchio, punto — vedi `docs/rilascio.md` per il
  dettaglio.
- `src/cli/release.ts` è sparito: esisteva solo per portare un clone appena fatto
  sull'ultima release prima di `npm install`. Non c'è più né il clone né l'`npm
  install` locale da far precedere.
- Non è più possibile puntare l'installer a un branch di sviluppo
  (`STARK_BRANCH`/`STARK_REPO` sono spariti): i bundle esistono solo per i tag
  pubblicati. Chi sviluppa STARK lavora su un checkout git vero, come sempre — non
  passa da `install.sh`.

## Verificare, invece di sperare

```sh
curl -fsSL https://starkapp.dev/install.sh | sh          # installazione pulita
curl -o v.txt https://starkapp.dev/releases/latest/version.txt && cat v.txt
```

Push anonimo rifiutato (conferma che `rrsync -wo` non lascia scrivere da fuori la CI):

```sh
echo test | ssh deploy@45.77.53.112   # deve rifiutare una shell interattiva
```

Dopo un tag di prova, la pagina delle Actions del repo mostra la matrix a schermo:
cinque piattaforme verdi (win-arm64 assente per costruzione, non per errore).
