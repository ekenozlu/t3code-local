#!/bin/bash
# Builds the newest stable v* tag of this fork and installs it into /Applications.
# Run by the launchd agent from install.sh; safe to run by hand.
set -euo pipefail

: "${T3_UPDATE_REPO_URL:?T3_UPDATE_REPO_URL is not set}"
STATE_DIR="${T3_UPDATE_STATE_DIR:-$HOME/Library/Application Support/t3code-self-update}"
SRC_DIR="$STATE_DIR/src"
BUNDLE_ID="com.t3tools.t3code"
ARCH="$(uname -m)"
[[ "$ARCH" == "arm64" ]] || ARCH="x64"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
notify() { osascript -e "display notification \"$1\" with title \"T3 Code updater\"" >/dev/null 2>&1 || true; }

mkdir -p "$STATE_DIR"
if ! mkdir "$STATE_DIR/lock" 2>/dev/null; then
  log "another run holds $STATE_DIR/lock; skipping"
  exit 0
fi
trap 'rmdir "$STATE_DIR/lock"' EXIT

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
  exit 0
fi

installed="$(cat "$STATE_DIR/installed-tag" 2>/dev/null || true)"
if [[ "$latest" == "$installed" ]]; then
  exit 0
fi

built="$(cat "$STATE_DIR/built-tag" 2>/dev/null || true)"
dmg="$(ls -t release/*.dmg 2>/dev/null | head -n1 || true)"
if [[ "$built" != "$latest" || -z "$dmg" ]]; then
  log "building $latest ($ARCH)"
  rm -f "$STATE_DIR/built-tag"
  git checkout --quiet --force "$latest"
  rm -rf release
  vp i
  T3CODE_DESKTOP_VERSION="${latest#v}" vp run "dist:desktop:dmg:$ARCH"
  dmg="$(ls -t release/*.dmg | head -n1)"
  echo "$latest" >"$STATE_DIR/built-tag"
  log "built $dmg"
fi

if [[ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" == "true" ]]; then
  log "$latest is ready; waiting for the app to quit"
  notify "$latest is ready. Quit T3 Code to install it."
  exit 0
fi

mount="$(mktemp -d)"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mount" "$dmg"
app="$(find "$mount" -maxdepth 1 -name '*.app' | head -n1)"
name="$(basename "$app")"
rm -rf "/Applications/.$name.new"
ditto "$app" "/Applications/.$name.new"
hdiutil detach -quiet "$mount"
rm -rf "/Applications/$name"
mv "/Applications/.$name.new" "/Applications/$name"

echo "$latest" >"$STATE_DIR/installed-tag"
log "installed $latest to /Applications/$name"
notify "Installed $latest."
