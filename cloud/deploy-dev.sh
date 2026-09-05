#!/bin/sh
# Distribuisce il server cloud di STARK su un server remoto, in dev.
#
#   ./cloud/deploy-dev.sh <utente@host>
#
# Il flusso è build-locale → save → load: l'immagine si costruisce QUI, si trasferisce
# come file, e sul server si solo carica. Niente build sul VPS — che è spesso più lento
# e senza il contesto giusto. È la strada che hai scelto, e lo script la tiene ferma.
#
# Cosa fa, in ordine:
#   1. build dell'immagine in locale (docker build --platform linux/amd64)
#   2. save in un tar.gz (docker save | gzip)
#   3. trasferimento sul server (scp)
#   4. load sul server (docker load)
#   5. compose: copia docker-compose.server.yml sul server e fa `docker compose up -d`
#
# Sovrascrivibili dall'ambiente, per non riempire lo script di flag:
#   IMG=stark-cloud:dev        nome immagine
#   TAR=/tmp/stark-cloud.tar.gz   dove sta il file di trasporto
#   PORTA=8787                 porta pubblicata sul server
#   SSH_PORT=65222             porta ssh, solo se passi un host nudo senza config
#   PUBLIC=203.0.113.10        indirizzo pubblico per l'URL (se diverso dall'host SSH)

set -eu

# ── default sovrascrivibili ────────────────────────────────────────────────
IMG="${IMG:-stark-cloud:dev}"
TAR="${TAR:-/tmp/stark-cloud.tar.gz}"
PORTA="${PORTA:-8787}"
# Porta ssh vuota di default: si lascia decidere a ~/.ssh/config (un alias come
# `digitizers.dev.agent` porta già la sua porta). Si forza con SSH_PORT solo se
# passi un host nudo senza config.
SSH_PORT="${SSH_PORT:-}"

HOST="${1:-}"
[ -n "$HOST" ] || {
  echo "Uso: $0 <host-ssh>"
  echo "  es. $0 digitizers.dev.agent"
  echo "  (l'host è quello che usi con ssh/scp, anche un alias di ~/.ssh/config)"
  exit 1
}

# Opzioni ssh comuni: `-P` per scp, `-p` per ssh. Vuote di default (config decide);
# presenti solo se SSH_PORT è stato impostato esplicitamente.
SSH_OPTS=""
[ -n "$SSH_PORT" ] && SSH_OPTS="-p $SSH_PORT"
SCP_OPTS=""
[ -n "$SSH_PORT" ] && SCP_OPTS="-P $SSH_PORT"

# L'indirizzo pubblico per l'URL NON è l'host SSH: un alias come
# `digitizers.dev.agent` è un nome che solo ssh conosce, non un IP raggiungibile.
# Default: l'IP pubblico del server cloud. Sovrascrivibile con PUBLIC.
PUBLIC="${PUBLIC:-45.77.53.112}"

rosso()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
verde()  { printf '\033[32m%s\033[0m\n' "$*"; }
grigio() { printf '\033[2m%s\033[0m\n' "$*"; }
titolo() { printf '\n\033[1m%s\033[0m\n' "$*"; }

muori() { rosso "$@"; exit 1; }
esiste() { command -v "$1" >/dev/null 2>&1; }

# ── prerequisiti ──────────────────────────────────────────────────────────
esiste docker || muori "Serve docker in locale."
esiste scp    || muori "Serve scp."
esiste ssh    || muori "Serve ssh."

titolo "1/5 — build in locale"
# --platform linux/amd64: qui siamo su arm (MacBook), il server è amd64. Senza, docker
# costruirebbe per l'architettura locale e l'immagine non partirebbe sul VPS.
docker build --platform linux/amd64 -f cloud/Dockerfile -t "$IMG" . || muori "Build fallita."

titolo "2/5 — save in $TAR"
docker save "$IMG" | gzip > "$TAR"
grigio "   $(du -h "$TAR" | cut -f1)"

titolo "3/5 — trasferimento su $HOST"
# Nella **home** e non in /tmp, che su un server condiviso è di tutti: se un altro
# utente ci ha già lasciato un `stark-cloud.tar.gz` (basta un deploy fatto da un'altra
# macchina, con un'altra identità), lo `scp` si ferma con «Permission denied» su un
# percorso che sembra proprio e non lo è. Successo il 5 settembre 2026: il file era di
# `digitizers_agent`, del deploy di quattro giorni prima.
#
# `-o ServerAliveInterval`: il trasferimento è di ~57 MB e una connessione ferma per
# qualche secondo viene chiusa da chi sta in mezzo. Visto cadere al 90%.
REMOTO="stark-cloud-$(id -un).tar.gz"
scp $SCP_OPTS -o ServerAliveInterval=15 -o ServerAliveCountMax=8 \
  "$TAR" "$HOST:~/$REMOTO" || muori "scp fallito."

titolo "4/5 — load sul server"
# L'impronta si confronta **prima** di caricare: un `docker load` su un file troncato è
# il modo migliore per rompere un servizio che funzionava. Il trasferimento sopra è già
# caduto una volta a 51 MB su 57, lasciando un file che sembrava esserci.
QUI="$(shasum -a 256 "$TAR" 2>/dev/null | cut -d' ' -f1 || sha256sum "$TAR" | cut -d' ' -f1)"
LA="$(ssh $SSH_OPTS "$HOST" "sha256sum ~/$REMOTO | cut -d' ' -f1")"
[ "$QUI" = "$LA" ] || muori "L'immagine è arrivata diversa da come è partita — non la carico."
ssh $SSH_OPTS "$HOST" "docker load < ~/$REMOTO && rm -f ~/$REMOTO" || muori "docker load fallito."

titolo "5/5 — compose sul server"
# Il compose server-side non builda: dichiara solo come gira il container, usando
# l'immagine appena caricata. I dati stanno in /opt/stark-cloud/data (bind mount).
# Si riscrive **solo se è cambiato**. Su un server dove /opt/stark-cloud appartiene a
# chi ha fatto il primo deploy, un altro utente non ci può scrivere — e chiedere `sudo`
# per riscrivere un file identico a quello che c'è già sarebbe pretendere un permesso
# per non fare niente. Se differisce si copia, e se non si può il messaggio dice cosa
# fare invece di lasciare un «Permission denied» nudo.
if ssh $SSH_OPTS "$HOST" 'cat /opt/stark-cloud/docker-compose.dev.yml 2>/dev/null' \
   | diff -q - cloud/docker-compose.server.yml >/dev/null 2>&1; then
  grigio "   compose già identico sul server, non lo riscrivo"
else
  scp $SCP_OPTS cloud/docker-compose.server.yml "$HOST:/opt/stark-cloud/docker-compose.dev.yml" \
    || muori "scp del compose fallito. Se è un problema di permessi, /opt/stark-cloud
appartiene a un altro utente: copialo tu con sudo, o rifai il deploy con quell'identità."
fi
ssh $SSH_OPTS "$HOST" "
  mkdir -p /opt/stark-cloud/data
  cd /opt/stark-cloud
  docker compose -f docker-compose.dev.yml up -d
" || muori "docker compose up fallito."

titolo "Fatto."
echo "Il server cloud è su:"
echo "   https://starkapp.dev  (Cloudflare → Traefik su $PUBLIC)"
echo ""
echo "Verifica che risponde (401 = vivo, ma serve il login):"
echo "   curl https://starkapp.dev/api/me"
echo "   curl http://$PUBLIC:$PORTA/api/me   # la porta nuda, finché resta pubblicata"
echo ""
grigio "Il default del daemon è già questo; per un altro deploy:  STARK_CLOUD_URL=…"
grigio "Dati sul server:  /opt/stark-cloud/data (DB Postgres in pgdata/)"
