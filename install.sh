#!/bin/sh
# Installa STARK con un comando solo, su Linux, WSL2 e macOS.
#
#   curl -fsSL https://starkapp.dev/install.sh | sh
#
# Cosa fa, in ordine, e cosa NON fa.
#
# Fa: mette tutto sotto ~/.local/share/stark — un bundle già pronto (codice, dipendenze
# e interfaccia già compilata: niente `npm install` né build in locale), e un Node suo
# se quello di sistema è troppo vecchio — e poi un lanciatore `stark` in ~/.local/bin.
#
# NON usa sudo, e non è una comodità: `sudo` servirebbe solo a *scrivere* il file del
# lanciatore, che non ha il bit setuid — quindi non darebbe all'agent nessun permesso in
# più. A decidere cosa l'agent può fare è **chi digita `stark`**, esattamente come chi
# digita `claude` da terminale. Installare da root invece inviterebbe a lanciarlo da
# root, che non è «lo stesso STARK con più poteri» ma **un altro STARK**: `~/.claude` e
# `~/.stark` sono per utente, quindi cambierebbero login, journal, token e impostazioni
# tutti insieme.
#
# NON tocca il Node di sistema, né il PATH globale: se serve, il Node ufficiale finisce
# dentro la cartella di STARK e ci punta solo il lanciatore, con percorso assoluto.
#
# NON registra niente per l'avvio automatico: STARK si accende quando digiti `stark`, e
# a macchina spenta resta spento. È una scelta, non una dimenticanza — il daemon tiene
# in piedi processi di agent, e uno che riparte da solo al boot è uno che lavora senza
# che nessuno gliel'abbia chiesto.

set -eu

# ── dove va cosa ────────────────────────────────────────────────────────────
# Sovrascrivibili dall'ambiente, per installare una seconda copia senza toccare la prima.
STARK_DIR="${STARK_DIR:-$HOME/.local/share/stark}"
APP="$STARK_DIR/app"
NODE_DIR="$STARK_DIR/node"
# Da dove si scarica il bundle già pronto per questa piattaforma — non un repo da
# clonare: vedi la sezione «Codice» più sotto, e docs/distribuzione.md per il perché.
RELEASE_BASE="${STARK_RELEASE_BASE:-https://starkapp.dev/releases/latest}"

# Il Node che si scarica quando quello della macchina non basta. Fissato invece di
# «l'ultimo»: un installer che prende ogni volta una versione diversa è un installer che
# funziona finché non smette, senza che nessuno abbia cambiato niente. Si alza qui.
NODE_VERSIONE="${STARK_NODE_VERSION:-v24.13.1}"
# La soglia vera, da package.json: sotto la 22.18 Node non esegue i `.ts` senza compilarli.
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=18

rosso()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
verde()  { printf '\033[32m%s\033[0m\n' "$*"; }
grigio() { printf '\033[2m%s\033[0m\n' "$*"; }
titolo() { printf '\n\033[1m%s\033[0m\n' "$*"; }

muori() { rosso "$@"; exit 1; }

esiste() { command -v "$1" >/dev/null 2>&1; }

# ── che macchina è ──────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux)  SO=linux ;;
  Darwin) SO=darwin ;;
  *) muori "Sistema non supportato da questo script: $(uname -s).
Su Windows usa invece, in PowerShell:
  irm https://starkapp.dev/install.ps1 | iex" ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) muori "Architettura non supportata: $(uname -m). STARK gira su x64 e arm64." ;;
esac

# Alpine e le altre distribuzioni musl: i binari ufficiali di nodejs.org sono compilati
# contro glibc e lì non partono. Va detto adesso invece di lasciare che fallisca dopo il
# download, con un errore sul linker che non nomina la causa vera.
if [ "$SO" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  muori "Questa macchina usa musl (Alpine o simile) e i binari Node ufficiali vogliono glibc.
Installa Node >= $NODE_MIN_MAJOR.$NODE_MIN_MINOR dal gestore di pacchetti (apk add nodejs npm) e rilancia:
lo script usa il Node che trova, se è abbastanza nuovo, e ne scarica uno solo quando non lo è."
fi

# ── come si scarica ─────────────────────────────────────────────────────────
if esiste curl;   then scarica() { curl -fsSL "$1" -o "$2"; }
elif esiste wget; then scarica() { wget -qO "$2" "$1"; }
else muori "Serve curl o wget, e non ne trovo nessuno dei due."
fi

esiste tar || muori "Serve tar, e non lo trovo."

# ── il Node giusto ──────────────────────────────────────────────────────────
# Restituisce 0 se il node passato come argomento è abbastanza nuovo.
node_va_bene() {
  _n="$1"
  [ -x "$_n" ] || esiste "$_n" || return 1
  _v="$("$_n" -v 2>/dev/null | sed 's/^v//')" || return 1
  _maj="${_v%%.*}"
  _resto="${_v#*.}"
  _min="${_resto%%.*}"
  case "$_maj" in ''|*[!0-9]*) return 1 ;; esac
  case "$_min" in ''|*[!0-9]*) return 1 ;; esac
  [ "$_maj" -gt "$NODE_MIN_MAJOR" ] && return 0
  [ "$_maj" -eq "$NODE_MIN_MAJOR" ] && [ "$_min" -ge "$NODE_MIN_MINOR" ] && return 0
  return 1
}

titolo "STARK — installazione"
grigio "cartella:  $STARK_DIR"

NODE=""
# Prima quello che STARK si è già scaricato in un giro precedente, poi quello di sistema.
# In quest'ordine perché il secondo può essere cambiato sotto i piedi (nvm, un aggiornamento
# di distribuzione) e la copia di STARK è l'unica di cui sappiamo la versione con certezza.
if node_va_bene "$NODE_DIR/bin/node"; then
  NODE="$NODE_DIR/bin/node"
  grigio "Node:      $("$NODE" -v) (già scaricato da STARK)"
elif node_va_bene node; then
  NODE="$(command -v node)"
  grigio "Node:      $("$NODE" -v) (di sistema)"
else
  if esiste node; then
    grigio "Node:      $(node -v) di sistema, troppo vecchio (serve >= $NODE_MIN_MAJOR.$NODE_MIN_MINOR)"
  else
    grigio "Node:      assente"
  fi
  echo "           scarico $NODE_VERSIONE solo per STARK, senza toccare il tuo"

  PACCO="node-$NODE_VERSIONE-$SO-$ARCH"
  TMP="$(mktemp -d)"
  # `trap` e non un `rm` alla fine: se il download fallisce a metà, la cartella
  # temporanea sparisce lo stesso invece di restare in /tmp per sempre.
  trap 'rm -rf "$TMP"' EXIT INT TERM
  scarica "https://nodejs.org/dist/$NODE_VERSIONE/$PACCO.tar.gz" "$TMP/node.tar.gz" \
    || muori "Non sono riuscito a scaricare Node $NODE_VERSIONE per $SO-$ARCH."
  tar -xzf "$TMP/node.tar.gz" -C "$TMP"
  rm -rf "$NODE_DIR"
  mkdir -p "$(dirname "$NODE_DIR")"
  mv "$TMP/$PACCO" "$NODE_DIR"
  NODE="$NODE_DIR/bin/node"
  node_va_bene "$NODE" || muori "Il Node scaricato non parte. Contenuto in $NODE_DIR"
  verde "           Node $("$NODE" -v) pronto"
fi

# ── kanban-md, il motore della board ─────────────────────────────────────────
# La board di progetto (kanban.md) è un binario Go: STARK lo scarica qui, dentro la
# cartella di STARK, e il daemon lo chiama con **percorso assoluto** — la lezione di
# Tailscale su macOS, dove il `PATH` non è affidabile. Uno per piattaforma.
KANBAN_VERSIONE="${STARK_KANBAN_VERSION:-v0.38.0}"
KANBAN_BIN="$STARK_DIR/bin/kanban-md"
case "$ARCH" in
  x64)  KANBAN_ARCH=amd64 ;;
  arm64) KANBAN_ARCH=arm64 ;;
esac
if [ -x "$KANBAN_BIN" ] && "$KANBAN_BIN" --version >/dev/null 2>&1; then
  grigio "kanban-md:  già scaricato"
else
  grigio "kanban-md:  scarico $KANBAN_VERSIONE ($SO-$KANBAN_ARCH)"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT INT TERM
  scarica "https://github.com/antopolskiy/kanban-md/releases/download/$KANBAN_VERSIONE/kanban-md_${KANBAN_VERSIONE#v}_${SO}_${KANBAN_ARCH}.tar.gz" "$TMP/kb.tar.gz" \
    || muori "Non sono riuscito a scaricare kanban-md $KANBAN_VERSIONE."
  tar -xzf "$TMP/kb.tar.gz" -C "$TMP"
  mkdir -p "$STARK_DIR/bin"
  mv "$TMP/kanban-md" "$KANBAN_BIN"
  chmod +x "$KANBAN_BIN"
  verde "           kanban-md pronto"
fi

# ── il codice ───────────────────────────────────────────────────────────────
# Non un `git clone`: un bundle già pronto (codice, `node_modules` e interfaccia già
# compilata) per l'ultima **release** e per questa piattaforma esatta. Lo stesso bundle
# lo scarica anche `stark update` (`daemon/aggiornamenti.ts`) — è la ragione per cui qui
# non c'è compilazione né `npm install`: quel lavoro l'ha già fatto la CI una volta sola,
# non ogni macchina che installa. Perché non più un repo da clonare, e cosa c'è dentro
# un bundle: docs/distribuzione.md.
titolo "Codice"
if [ -f "$APP/package.json" ]; then
  echo "c'è già: aggiorno ($APP)"
else
  mkdir -p "$APP"
fi

BUNDLE="stark-$SO-$ARCH.tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM
scarica "$RELEASE_BASE/$BUNDLE" "$TMP/stark.tar.gz" \
  || muori "Non sono riuscito a scaricare $RELEASE_BASE/$BUNDLE.
Se questa piattaforma ($SO-$ARCH) non è ancora fra quelle pubblicate, dillo — si aggiunge."
tar -xzf "$TMP/stark.tar.gz" -C "$APP" \
  || muori "Il bundle scaricato non si è estratto correttamente."
grigio "versione $("$NODE" -p "require('$APP/package.json').version" 2>/dev/null || echo '?')"

# ── il comando ──────────────────────────────────────────────────────────────
titolo "Comando \`stark\`"
# Lo scrive il CLI stesso e non questo script: il lanciatore contiene il percorso di
# **questo** Node e di **questo** repo, e chi li conosce per certo è il processo che sta
# girando adesso. Una seconda copia di quella logica qui in `sh` sarebbe la stessa
# regola in due lingue, cioè la prima che resta indietro.
"$NODE" "$APP/src/cli/stark.ts" install

titolo "Fatto."
echo "Adesso, da qualunque cartella:"
echo ""
echo "  stark          accende STARK e lo apre nel browser"
echo "  stark status   come sta"
echo "  stark stop     lo ferma"
echo "  stark update   prende l'ultima versione"
echo ""
grigio "STARK resta acceso anche se chiudi il terminale, e si spegne quando spegni il PC:"
grigio "al riavvio digita di nuovo \`stark\`. Niente parte da solo."
echo ""
grigio "Se \`stark\` non lo trova, apri un terminale nuovo (il PATH è appena cambiato)."
echo ""
echo "Serve un login di Claude Code: la prima chat te lo dirà, o falla adesso con \`claude\`."
