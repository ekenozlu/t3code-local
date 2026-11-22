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
TRIGGER="manual"
RM_REQUEST_ID=""
if [[ -z "$MODE" ]]; then
  if [[ -f "$REQUEST" ]]; then
    TRIGGER="request"
    MODE="$(tr -d '[:space:]' 2>/dev/null <"$REQUEST" || true)"
    # Release Monitor writes request.id before the request, so it can follow exactly this run.
    RM_REQUEST_ID="$(tr -d '[:space:]' 2>/dev/null <"$REQUEST.id" || true)"
  else
    TRIGGER="schedule"
  fi
  # Removing it changes the watched path once more; that run finds no request and just checks.
  rm -f "$REQUEST" "$REQUEST.id"
  [[ "$MODE" == "install" ]] || MODE="check"
fi
STARTED_MS=$(($(date +%s) * 1000))
SRC_DIR="$STATE_DIR/src"
STATUS="$STATE_DIR/status.json"
BUNDLE_ID="com.t3tools.t3code"
ARCH="$(uname -m)"
[[ "$ARCH" == "arm64" ]] || ARCH="x64"
LOG_PATH="$HOME/Library/Logs/t3code-self-update.log"

# Run history for Release Monitor: runs/<id>/events.jsonl and output.log in the state folder.
# Optional and best-effort: without rm-run.sh (or if it is broken) every rm_* call does nothing.
# A syntax error in a sourced file would end this shell, so the file is checked first.
if [[ -f "$STATE_DIR/rm-run.sh" ]] && /bin/bash -n "$STATE_DIR/rm-run.sh" 2>/dev/null; then
  # shellcheck source=/dev/null
  source "$STATE_DIR/rm-run.sh" 2>/dev/null || true
fi
for fn in rm_run_begin rm_stage rm_meta rm_run_end rm_run_fail rm_run_close rm_summary; do
  declare -F "$fn" >/dev/null || eval "$fn() { :; }"
done
RM_STATE_DIR="$STATE_DIR"
RM_RUNNER="updater.sh"

# The launchd log keeps these lines; everything else goes to the run's own log when recorded.
log() {
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line"
  rm_summary "$line"
}
notify() { osascript -e "display notification \"$1\" with title \"T3 Code updater\"" >/dev/null 2>&1 || true; }
app_running() { [[ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" == "true" ]]; }

# The stage the run is in (or stopped at): check, building, ready or installed (the install).
stage="check"
run_begun=""
failure_reported=""
# state: current | building | ready | installed | failed. Values never contain quotes.
status() {
  printf '{"state":"%s","stage":"%s","run_id":"%s","tag":"%s","at":%s,"message":"%s"}\n' \
    "$1" "$stage" "${RM_RUN_ID:-}" "${2:-}" "$(($(date +%s) * 1000))" "${3:-}" >"$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}

# A run is recorded when it was requested, or once a scheduled check finds work (a build or an
# install). Scheduled checks that find nothing new are not runs.
begin_run() {
  [[ -z "$run_begun" ]] || return 0
  run_begun=1
  rm_run_begin "$TRIGGER" "$MODE" "$STARTED_MS"
  [[ "$MODE" == "install" ]] || rm_stage check "$STARTED_MS"
}

enter_stage() {
  begin_run
  stage="$1"
  rm_stage "$1"
}

doing() {
  case "$1" in
  building) echo "building" ;;
  ready) echo "waiting for the app to quit" ;;
  installed) echo "installing" ;;
  *) echo "checking for a new tag" ;;
  esac
}

# A failure the script detected itself: its message is kept, never replaced by the ERR trap's.
fail() {
  failure_reported=1
  status failed "$current_tag" "$1"
  log "failed: $1"
  rm_run_fail 1 "$1"
  exit 1
}

# A command failed under set -e: record which command, its exit code and the stage it broke.
on_error() {
  # Bash 3.2 updates BASH_COMMAND inside the handler, so the trap passes it in.
  local code="$1" command="$2"
  # Command substitutions inherit the trap (set -E); only the main shell reports.
  [[ "${BASH_SUBSHELL:-0}" -eq 0 && -z "$failure_reported" ]] || return 0
  failure_reported=1
  command="$(printf '%s' "$command" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)*//; s/ .*//' | head -n1)"
  command="$(basename "${command:-a command}")"
  local message="$command failed with exit code $code while $(doing "$stage")."
  status failed "$current_tag" "$message See the log."
  log "failed: $message"
  # A scheduled check that fails before it finds work (offline, say) is not recorded as a run.
  rm_run_fail "$code" "$message"
}

on_stop() {
  failure_reported=1
  status failed "$current_tag" "The update was stopped while $(doing "$stage")."
  log "stopped while $(doing "$stage")"
  rm_run_end cancelled "" "Stopped by a signal while $(doing "$stage")."
  exit 143
}

on_exit() {
  local code=$?
  if [[ $code -ne 0 && -z "$failure_reported" ]]; then
    status failed "$current_tag" "The update stopped with exit code $code while $(doing "$stage")."
  fi
  rm_run_close "$code"
  rm -f "$STATE_DIR/lock/pid"
  rmdir "$STATE_DIR/lock" 2>/dev/null || true
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
# The pid tells Release Monitor whether a run without an end is still alive.
echo $$ >"$STATE_DIR/lock/pid" || true
trap on_exit EXIT
trap 'on_error "$?" "$BASH_COMMAND"' ERR
trap on_stop TERM INT HUP
# A requested run is recorded from the start, whatever it finds.
[[ "$TRIGGER" == "schedule" ]] || begin_run

install_built() {
  local tag="$1" dmg="$2" mount app name
  enter_stage installed
  rm_meta "tag=$tag"
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
  rm_run_end succeeded installed "Installed $tag."
}

built="$(cat "$STATE_DIR/built-tag" 2>/dev/null || true)"
installed="$(cat "$STATE_DIR/installed-tag" 2>/dev/null || true)"

if [[ "$MODE" == "install" ]]; then
  dmg="$(ls -t "$SRC_DIR"/release/*.dmg 2>/dev/null | head -n1 || true)"
  if [[ -z "$built" || "$built" == "$installed" || -z "$dmg" ]]; then
    log "install requested, but no new build is ready"
    rm_run_end skipped "" "No new build is ready to install."
    exit 0
  fi
  current_tag="$built"
  for _ in $(seq 1 120); do
    app_running || break
    sleep 1
  done
  if app_running; then
    log "install requested, but the app did not quit"
    rm_run_end skipped "" "The app did not quit, so nothing was installed."
    exit 0
  fi
  install_built "$built" "$dmg"
  open -b "$BUNDLE_ID"
  exit 0
fi

if [[ -z "${T3_UPDATE_REPO_URL:-}" ]]; then
  fail "T3_UPDATE_REPO_URL is not set. Reinstall the agent with install.sh."
fi
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
  rm_run_end skipped "" "There are no v* tags on origin yet."
  exit 0
fi
current_tag="$latest"
rm_meta "tag=$latest"

if [[ "$latest" == "$installed" ]]; then
  status current "$latest"
  rm_run_end succeeded current "$latest is the latest tag and is installed."
  exit 0
fi

dmg="$(ls -t release/*.dmg 2>/dev/null | head -n1 || true)"
if [[ "$built" != "$latest" || -z "$dmg" ]]; then
  enter_stage building
  rm_meta "tag=$latest"
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
  # Ready is where a run that built ends; the install is a run of its own.
  [[ -z "$run_begun" ]] || enter_stage ready
  status ready "$latest"
  log "$latest is ready; waiting for the app to quit"
  rm_run_end succeeded ready "$latest is built; it installs once the app quits."
  notify "$latest is ready. Use Restart to update in T3 Code."
  exit 0
fi

install_built "$latest" "$dmg"
notify "Installed $latest."
