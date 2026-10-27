#!/usr/bin/env bash
# Pull-based continuous deployment. Installed as a systemd timer by deploy/vm-setup.sh.
# Every run: fetch the deploy branch; if origin has new commits, re-run vm-setup.sh (which resets
# the checkout, rebuilds the image and restarts the containers). Overlapping runs are prevented
# with a lock. Logs go to the systemd journal: journalctl -u rewrite-studio-update
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/rewrite-studio}"
BRANCH="${BRANCH:-main}"
cd "$APP_DIR"
exec 9>"/tmp/rewrite-studio-update.lock"
flock -n 9 || { echo "another update is still running; skipping"; exit 0; }

git fetch -q origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "up to date at ${LOCAL:0:8}"
  exit 0
fi
echo "deploying ${REMOTE:0:8} (was ${LOCAL:0:8}): $(git log -1 --format=%s "origin/$BRANCH")"
AUTO_UPDATE=0 BRANCH="$BRANCH" APP_DIR="$APP_DIR" bash deploy/vm-setup.sh
echo "deployed ${REMOTE:0:8}"
