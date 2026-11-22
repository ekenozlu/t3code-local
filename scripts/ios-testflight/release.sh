#!/bin/bash
# Builds this fork's iOS app at a git ref and uploads it to TestFlight.
# Run by the launchd agent from install.sh when Release Monitor (~/Development/release-monitor)
# writes a ref to the request file; safe to run by hand: release.sh [ref]   (default: main)
# A mobile-vX.Y.Z tag sets the version to X.Y.Z; any other ref uses T3CODE_MOBILE_VERSION or the
# version in app.config.ts.
# Signing and upload use the App Store Connect API key whose ID is in config.env; its .p8 file
# is found in ~/.appstoreconnect/private_keys by that ID (Apple names it AuthKey_<id>.p8).
set -Eeuo pipefail

STATE_DIR="${T3_TESTFLIGHT_STATE_DIR:-$HOME/Library/Application Support/t3code-testflight}"
REQUEST="$STATE_DIR/request"
CONFIG="$STATE_DIR/config.env"
STATUS="$STATE_DIR/status.json"
SRC_DIR="$STATE_DIR/src"
BUILD_DIR="$STATE_DIR/build"
LOG_PATH="$HOME/Library/Logs/t3code-testflight.log"

REF="${1:-}"
TRIGGER="manual"
RM_REQUEST_ID=""
if [[ -z "$REF" ]]; then
  [[ -f "$REQUEST" ]] || exit 0
  REF="$(tr -d '[:space:]' <"$REQUEST")"
  # Release Monitor writes request.id before the request, so it can follow exactly this run.
  RM_REQUEST_ID="$(tr -d '[:space:]' 2>/dev/null <"$REQUEST.id" || true)"
  # Removing it changes the watched path once more; that run finds no request and exits.
  rm -f "$REQUEST" "$REQUEST.id"
  REF="${REF:-main}"
  TRIGGER="request"
fi

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
RM_RUNNER="release.sh"

# The launchd log keeps these lines; everything else goes to the run's own log when recorded.
log() {
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line"
  rm_summary "$line"
}
notify() { osascript -e "display notification \"$1\" with title \"T3 Code TestFlight\"" >/dev/null 2>&1 || true; }

commit=""
build=""
version=""
# The stage the run is in (or stopped at): preflight, then the busy states below.
stage="preflight"
failure_reported=""
# state: preparing | installing | prebuilding | archiving | uploading | uploaded | failed.
# Values never contain quotes.
status() {
  case "$1" in
  preparing | installing | prebuilding | archiving | uploading)
    stage="$1"
    rm_stage "$1"
    ;;
  esac
  printf '{"state":"%s","stage":"%s","run_id":"%s","ref":"%s","commit":"%s","version":"%s","build":"%s","at":%s,"message":"%s"}\n' \
    "$1" "$stage" "${RM_RUN_ID:-}" "$REF" "$commit" "$version" "$build" "$(($(date +%s) * 1000))" "${2:-}" >"$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}

# What the run was doing in a stage, for failure messages.
doing() {
  case "$1" in
  preparing) echo "fetching the source" ;;
  installing) echo "installing dependencies" ;;
  prebuilding) echo "generating the iOS project" ;;
  archiving) echo "archiving" ;;
  uploading) echo "uploading" ;;
  *) echo "checking the settings" ;;
  esac
}

# A failure the script detected itself: its message is kept, never replaced by the ERR trap's.
fail() {
  failure_reported=1
  status failed "$1"
  log "failed: ${2:-$1}"
  rm_run_fail 1 "$1"
  notify "Release of $REF failed."
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
  status failed "$message See the log."
  log "failed: $message"
  rm_run_fail "$code" "$message"
  notify "Release of $REF failed."
}

on_stop() {
  failure_reported=1
  status failed "The release was stopped while $(doing "$stage")."
  log "stopped while $(doing "$stage")"
  rm_run_end cancelled "" "Stopped by a signal while $(doing "$stage")."
  exit 143
}

on_exit() {
  local code=$?
  if [[ $code -ne 0 && -z "$failure_reported" ]]; then
    status failed "The release stopped with exit code $code while $(doing "$stage")."
  fi
  rm_run_close "$code"
  rm -f "$STATE_DIR/lock/pid"
  rmdir "$STATE_DIR/lock" 2>/dev/null || true
}

mkdir -p "$STATE_DIR"
if ! mkdir "$STATE_DIR/lock" 2>/dev/null; then
  log "another release holds $STATE_DIR/lock; skipping $REF"
  exit 0
fi
# The pid tells Release Monitor whether a run without an end is still alive.
echo $$ >"$STATE_DIR/lock/pid" || true
trap on_exit EXIT
trap 'on_error "$?" "$BASH_COMMAND"' ERR
trap on_stop TERM INT HUP

rm_run_begin "$TRIGGER" "$REF"
rm_stage preflight
rm_meta "ref=$REF"

if [[ ! -f "$CONFIG" ]]; then
  fail "Fill in $CONFIG first." "missing $CONFIG; run install.sh to create it"
fi
# shellcheck source=/dev/null
source "$CONFIG"
for name in T3CODE_IOS_TEAM_ID T3CODE_IOS_BUNDLE_ID ASC_KEY_ID ASC_ISSUER_ID; do
  if [[ -z "${!name:-}" ]]; then
    fail "Set $name in config.env." "$name is not set in $CONFIG"
  fi
done
KEY_DIR="$HOME/.appstoreconnect/private_keys"
ASC_KEY_PATH="$(find "$KEY_DIR" -maxdepth 1 -name "*$ASC_KEY_ID*.p8" 2>/dev/null | head -n1 || true)"
if [[ -z "$ASC_KEY_PATH" ]]; then
  fail "No .p8 key file for $ASC_KEY_ID in ~/.appstoreconnect/private_keys." "no *$ASC_KEY_ID*.p8 in $KEY_DIR"
fi
export DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}"
auth=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$ASC_KEY_PATH"
  -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"
)

status preparing
log "releasing $REF to TestFlight"
if [[ -z "${T3_TESTFLIGHT_REPO_URL:-}" ]]; then
  fail "T3_TESTFLIGHT_REPO_URL is not set. Reinstall the agent with install.sh."
fi
if [[ ! -d "$SRC_DIR/.git" ]]; then
  log "cloning $T3_TESTFLIGHT_REPO_URL"
  git clone --quiet "$T3_TESTFLIGHT_REPO_URL" "$SRC_DIR"
fi
cd "$SRC_DIR"
git fetch --quiet --tags --force --prune origin
if git rev-parse --verify --quiet "origin/$REF^{commit}" >/dev/null; then
  git checkout --quiet --force --detach "origin/$REF"
else
  git checkout --quiet --force --detach "$REF"
fi
commit="$(git rev-parse --short HEAD)"
# Each upload needs a higher build number than every earlier one of the same version.
build="$(date +%Y%m%d%H%M)"
if [[ "$REF" =~ ^mobile-v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  version="${BASH_REMATCH[1]}"
else
  version="${T3CODE_MOBILE_VERSION:-$(sed -nE 's/.*T3CODE_MOBILE_VERSION \?\? "([^"]+)".*/\1/p' apps/mobile/app.config.ts)}"
fi
rm_meta "commit=$commit" "version=$version" "build=$build"

status installing
vp i

status prebuilding
cd apps/mobile
APP_VARIANT=production \
  T3CODE_MOBILE_UPDATES_ENABLED=0 \
  T3CODE_MOBILE_VERSION="$version" \
  T3CODE_IOS_TEAM_ID="$T3CODE_IOS_TEAM_ID" \
  T3CODE_IOS_BUNDLE_ID="$T3CODE_IOS_BUNDLE_ID" \
  EXPO_NO_GIT_STATUS=1 \
  ./node_modules/.bin/expo prebuild --clean --platform ios

status archiving
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
workspace="$(ls -d ios/*.xcworkspace | head -n1)"
scheme="$(basename "$workspace" .xcworkspace)"
APP_VARIANT=production T3CODE_MOBILE_UPDATES_ENABLED=0 \
  xcodebuild archive \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration Release \
  -destination generic/platform=iOS \
  -archivePath "$BUILD_DIR/app.xcarchive" \
  "${auth[@]}" \
  DEVELOPMENT_TEAM="$T3CODE_IOS_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$build" \
  MARKETING_VERSION="$version"

status uploading
cat >"$BUILD_DIR/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$T3CODE_IOS_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
EOF
xcodebuild -exportArchive \
  -archivePath "$BUILD_DIR/app.xcarchive" \
  -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -exportPath "$BUILD_DIR/export" \
  "${auth[@]}"

echo "$version ($build) $commit" >"$STATE_DIR/uploaded-build"
status uploaded "App Store Connect is processing it; TestFlight shows it in a few minutes."
log "uploaded $version ($build) from $REF at $commit"
rm_run_end succeeded uploaded "Uploaded $version ($build)."
notify "Uploaded $version ($build). It reaches TestFlight after processing."
