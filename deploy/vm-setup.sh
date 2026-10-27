#!/usr/bin/env bash
# One-shot setup for an Ubuntu VM (tested target: Ubuntu 22.04/24.04).
# Installs Docker + git, clones/updates the repo, builds the image (Next.js app + TeX Live + git)
# and starts it with docker compose. Safe to re-run: it pulls the latest branch and rebuilds.
#
# Run from your laptop (the VM must be reachable from your network):
#   ssh ubuntu@<vm-ip> 'bash -s' < deploy/vm-setup.sh
# or with options:
#   ssh ubuntu@<vm-ip> 'APP_USER=me APP_PASSWORD=secret PANGRAM_API_KEY=... bash -s' < deploy/vm-setup.sh
#
# Environment variables (all optional):
#   REPO           git URL                       (default https://github.com/murtazahr/Document-Editor)
#   BRANCH         branch to deploy              (default main)
#   APP_DIR        checkout location             (default /opt/rewrite-studio)
#   APP_USER / APP_PASSWORD   if both set, the app is served on port 80 behind Caddy with basic auth;
#                             otherwise it listens directly on port 3000 with no authentication.
#   APP_PASSWORD_B64          base64 of the password; use this instead of APP_PASSWORD when the
#                             password contains $ ' " or other shell-special characters, e.g.
#                               PW=$(printf '%s' 'my$pass' | base64)
#                               ssh ubuntu@<vm-ip> "APP_USER=me APP_PASSWORD_B64=$PW bash -s" < deploy/vm-setup.sh
#   PANGRAM_API_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET   written to .env (can also be set later in the app)
#   AUTO_UPDATE    1 (default) installs a systemd timer that checks BRANCH every 5 minutes and
#                  redeploys when it has new commits (pull-based continuous deployment); 0 skips it.
#   UPDATE_INTERVAL  timer interval, systemd time span (default 5min)
set -euo pipefail

if [ -n "${APP_PASSWORD_B64:-}" ]; then
  APP_PASSWORD=$(printf '%s' "$APP_PASSWORD_B64" | base64 -d) || { echo "APP_PASSWORD_B64 is not valid base64" >&2; exit 1; }
  export APP_PASSWORD
fi

REPO="${REPO:-https://github.com/murtazahr/Document-Editor}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/rewrite-studio}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

log "Installing prerequisites"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git gnupg >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine from Docker's apt repository"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="sudo docker"

if [ ! -d "$APP_DIR/.git" ]; then
  log "Cloning $REPO ($BRANCH) into $APP_DIR"
  sudo mkdir -p "$APP_DIR" && sudo chown "$USER" "$APP_DIR"
  git clone -q -b "$BRANCH" "$REPO" "$APP_DIR"
else
  log "Updating $APP_DIR to latest $BRANCH"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
fi
cd "$APP_DIR"

# The script is usually streamed from a laptop checkout that may be older than the one just
# pulled. Re-run the freshly checked-out copy so script and compose files always match.
if [ -z "${RS_REEXEC:-}" ]; then
  log "Continuing with the script from the updated checkout"
  RS_REEXEC=1 exec bash "$APP_DIR/deploy/vm-setup.sh"
fi
mkdir -p data

log "Writing .env"
touch .env
# Earlier versions stored the basic-auth hash here; its "$" signs make docker compose emit
# "variable is not set" warnings. The hash now lives in deploy/Caddyfile.generated.
sed -i '/^APP_PASSWORD_HASH=/d;/^APP_USER=/d' .env
setenv() { # setenv KEY VALUE  (only when VALUE non-empty; replaces existing line)
  [ -n "$2" ] || return 0
  grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env
}
setenv PANGRAM_API_KEY "${PANGRAM_API_KEY:-}"
setenv GITHUB_CLIENT_ID "${GITHUB_CLIENT_ID:-}"
setenv GITHUB_CLIENT_SECRET "${GITHUB_CLIENT_SECRET:-}"

COMPOSE_FILES=(-f docker-compose.yml)
AUTH_ON=0
if [ -n "${APP_USER:-}" ] && [ -n "${APP_PASSWORD:-}" ]; then
  AUTH_ON=1
  log "Enabling basic auth via Caddy on port 80 (user: $APP_USER)"
  HASH=$($DOCKER run --rm caddy:2 caddy hash-password --plaintext "$APP_PASSWORD")
  # Write the hash straight into the Caddyfile: passing it through .env would let docker compose
  # interpolate the "$" signs in the bcrypt hash and silently break authentication.
  # a directory can be left here if an older run mounted the path before it existed
  [ -d deploy/Caddyfile.generated ] && sudo rm -rf deploy/Caddyfile.generated
  python3 - "$APP_USER" "$HASH" <<'PYEOF'
import sys
user, h = sys.argv[1], sys.argv[2]
t = open("deploy/Caddyfile").read().replace("__APP_USER__", user).replace("__APP_PASSWORD_HASH__", h)
open("deploy/Caddyfile.generated", "w").write(t)
PYEOF
  COMPOSE_FILES+=(-f deploy/compose.auth.yml)
elif [ -f deploy/Caddyfile.generated ]; then
  AUTH_ON=1
  log "Keeping existing basic-auth configuration (deploy/Caddyfile.generated)"
  COMPOSE_FILES+=(-f deploy/compose.auth.yml)
else
  log "No APP_USER/APP_PASSWORD given: the app will listen on port 3000 WITHOUT authentication"
fi

log "Building image and starting (first build downloads TeX Live; this takes a while)"
$DOCKER compose "${COMPOSE_FILES[@]}" up -d --build --remove-orphans
if [ -n "${APP_USER:-}" ] && [ -n "${APP_PASSWORD:-}" ]; then
  # Caddy only reads its config at startup and compose does not notice content changes in a
  # bind-mounted file, so restart it to pick up the regenerated credentials.
  $DOCKER compose "${COMPOSE_FILES[@]}" restart caddy
  sleep 2
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -u "$APP_USER:$APP_PASSWORD" http://127.0.0.1/ || echo 000)
  if [ "$CODE" = "200" ]; then
    echo "Basic auth check: OK (HTTP 200 with the supplied credentials)"
  else
    echo "Basic auth check FAILED (HTTP $CODE). Caddy logs:" >&2
    $DOCKER compose "${COMPOSE_FILES[@]}" logs --tail=30 caddy >&2
    exit 1
  fi
fi

if [ "${AUTO_UPDATE:-1}" = "1" ]; then
  log "Installing auto-update timer (every ${UPDATE_INTERVAL:-5min}, branch $BRANCH)"
  sudo tee /etc/systemd/system/rewrite-studio-update.service >/dev/null <<UNIT
[Unit]
Description=Rewrite Studio: redeploy when branch $BRANCH has new commits
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=$USER
Environment=APP_DIR=$APP_DIR
Environment=BRANCH=$BRANCH
ExecStart=/usr/bin/bash $APP_DIR/deploy/auto-update.sh
UNIT
  sudo tee /etc/systemd/system/rewrite-studio-update.timer >/dev/null <<UNIT
[Unit]
Description=Rewrite Studio: check for new commits

[Timer]
OnBootSec=2min
OnUnitActiveSec=${UPDATE_INTERVAL:-5min}
RandomizedDelaySec=30
Unit=rewrite-studio-update.service

[Install]
WantedBy=timers.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now rewrite-studio-update.timer >/dev/null
fi

IP=$(hostname -I | awk '{print $1}')
log "Done."
if [ "$AUTH_ON" = "1" ]; then
  echo "Open: http://$IP/   (basic auth${APP_USER:+ user: $APP_USER}; port 3000 is not exposed)"
else
  echo "Open: http://$IP:3000/   (no authentication)"
fi
echo "Logs:    sudo docker compose ${COMPOSE_FILES[*]} logs -f"
if [ "${AUTO_UPDATE:-1}" = "1" ] || systemctl is-enabled -q rewrite-studio-update.timer 2>/dev/null; then
  echo "Updates: automatic; every push to '$BRANCH' is deployed within ~${UPDATE_INTERVAL:-5min}."
  echo "         Status: systemctl list-timers rewrite-studio-update.timer; logs: journalctl -u rewrite-studio-update -n 50"
else
  echo "Update:  re-run this script"
fi
