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
PUBLIC="${PUBLIC:-80.211.239.109}"

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
scp $SCP_OPTS "$TAR" "$HOST:/tmp/stark-cloud.tar.gz" || muori "scp fallito."

titolo "4/5 — load sul server"
ssh $SSH_OPTS "$HOST" 'docker load < /tmp/stark-cloud.tar.gz' || muori "docker load fallito."

titolo "5/5 — compose sul server"
# Il compose server-side non builda: dichiara solo come gira il container, usando
# l'immagine appena caricata. I dati stanno in /opt/stark-cloud/data (bind mount).
scp $SCP_OPTS cloud/docker-compose.server.yml "$HOST:/opt/stark-cloud/docker-compose.dev.yml" \
  || muori "scp del compose fallito."
ssh $SSH_OPTS "$HOST" "
  mkdir -p /opt/stark-cloud/data
  cd /opt/stark-cloud
  docker compose -f docker-compose.dev.yml up -d
" || muori "docker compose up fallito."

titolo "Fatto."
echo "Il server cloud è su:"
echo "   http://$PUBLIC:$PORTA"
echo ""
echo "Verifica che risponde (401 = vivo, ma serve il login):"
echo "   curl http://$PUBLIC:$PORTA/api/me"
echo ""
grigio "Sul daemon locale, per puntare qui:  STARK_CLOUD_URL=http://$PUBLIC:$PORTA"
grigio "Dati sul server:  /opt/stark-cloud/data (DB Postgres in pgdata/)"
