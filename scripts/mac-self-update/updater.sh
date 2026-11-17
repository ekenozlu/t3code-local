#!/bin/bash
# Builds the newest stable v* tag of this fork and installs it into /Applications.
# Run by the launchd agent from install.sh; safe to run by hand.
#   updater.sh           check origin, build the newest tag, install it if the app is closed
#   updater.sh install   wait for the app to quit, install the built tag, and reopen the app
# The installed app writes "check" or "install" to the request file, which launchd watches,
# and reads status.json to show progress in its own update UI.
set -Eeuo pipefail

STATE_DIR="${T3_UPDATE_STATE_DIR:-$HOME/Library/Application Support/t3code-self-update}"
REQUEST="$STATE_DIR/request"
MODE="${1:-}"
if [[ -z "$MODE" ]]; then
  MODE="$(cat "$REQUEST" 2>/dev/null || true)"
  # Removing it changes the watched path once more; that run finds no request and just checks.
  rm -f "$REQUEST"
  [[ "$MODE" == "install" ]] || MODE="check"
fi
SRC_DIR="$STATE_DIR/src"
STATUS="$STATE_DIR/status.json"
BUNDLE_ID="com.t3tools.t3code"
ARCH="$(uname -m)"
[[ "$ARCH" == "arm64" ]] || ARCH="x64"
LOG_PATH="$HOME/Library/Logs/t3code-self-update.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
notify() { osascript -e "display notification \"$1\" with title \"T3 Code updater\"" >/dev/null 2>&1 || true; }
app_running() { [[ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" == "true" ]]; }

# state: current | building | ready | installed | failed. Values never contain quotes.
status() {
  printf '{"state":"%s","tag":"%s","at":%s,"message":"%s"}\n' \
    "$1" "${2:-}" "$(($(date +%s) * 1000))" "${3:-}" >"$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}

mkdir -p "$STATE_DIR"
lock_wait=0
until mkdir "$STATE_DIR/lock" 2>/dev/null; do
  # A check skips a busy run; an install waits out the short check that holds the lock.
  if [[ "$MODE" != "install" || $lock_wait -ge 600 ]]; then
    log "another run holds $STATE_DIR/lock; skipping"
    exit 0
  fi
  sleep 1
  lock_wait=$((lock_wait + 1))
done
current_tag=""
trap 'rmdir "$STATE_DIR/lock"' EXIT
trap 'status failed "$current_tag" "The update failed. See $LOG_PATH."' ERR

install_built() {
  local tag="$1" dmg="$2" mount app name
  mount="$(mktemp -d)"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mount" "$dmg"
  app="$(find "$mount" -maxdepth 1 -name '*.app' | head -n1)"
  name="$(basename "$app")"
  rm -rf "/Applications/.$name.new"
  ditto "$app" "/Applications/.$name.new"
  hdiutil detach -quiet "$mount"
  rm -rf "/Applications/$name"
  mv "/Applications/.$name.new" "/Applications/$name"
  echo "$tag" >"$STATE_DIR/installed-tag"
  status installed "$tag"
  log "installed $tag to /Applications/$name"
}

built="$(cat "$STATE_DIR/built-tag" 2>/dev/null || true)"
installed="$(cat "$STATE_DIR/installed-tag" 2>/dev/null || true)"

if [[ "$MODE" == "install" ]]; then
  dmg="$(ls -t "$SRC_DIR"/release/*.dmg 2>/dev/null | head -n1 || true)"
  if [[ -z "$built" || "$built" == "$installed" || -z "$dmg" ]]; then
    log "install requested, but no new build is ready"
    exit 0
  fi
  current_tag="$built"
  for _ in $(seq 1 120); do
    app_running || break
    sleep 1
  done
  if app_running; then
    log "install requested, but the app did not quit"
    exit 0
  fi
  install_built "$built" "$dmg"
  open -b "$BUNDLE_ID"
  exit 0
fi

: "${T3_UPDATE_REPO_URL:?T3_UPDATE_REPO_URL is not set}"
if [[ ! -d "$SRC_DIR/.git" ]]; then
  log "cloning $T3_UPDATE_REPO_URL"
  git clone --quiet "$T3_UPDATE_REPO_URL" "$SRC_DIR"
fi
cd "$SRC_DIR"
git fetch --quiet --tags --force --prune origin

# Stable tags only (v1.2.3); prerelease tags like v1.2.3-beta.1 are ignored.
latest="$(git tag -l 'v[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true)"
if [[ -z "$latest" ]]; then
  log "no v* tags on origin yet"
  status current ""
  exit 0
fi
current_tag="$latest"

if [[ "$latest" == "$installed" ]]; then
  status current "$latest"
  exit 0
fi

dmg="$(ls -t release/*.dmg 2>/dev/null | head -n1 || true)"
if [[ "$built" != "$latest" || -z "$dmg" ]]; then
  log "building $latest ($ARCH)"
  status building "$latest"
  rm -f "$STATE_DIR/built-tag"
  git checkout --quiet --force "$latest"
  rm -rf release
  vp i
  T3CODE_DESKTOP_VERSION="${latest#v}" vp run "dist:desktop:dmg:$ARCH"
  dmg="$(ls -t release/*.dmg | head -n1)"
  echo "$latest" >"$STATE_DIR/built-tag"
  log "built $dmg"
fi

if app_running; then
  status ready "$latest"
  log "$latest is ready; waiting for the app to quit"
  notify "$latest is ready. Use Restart to update in T3 Code."
  exit 0
fi

install_built "$latest" "$dmg"
notify "Installed $latest."
