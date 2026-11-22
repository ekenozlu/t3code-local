#!/bin/bash
# Builds this fork's iOS app at a git ref and uploads it to TestFlight.
# Run by the launchd agent from install.sh when the Release Monitor writes a ref to the request
# file; safe to run by hand: release.sh [ref]   (default: main)
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
if [[ -z "$REF" ]]; then
  [[ -f "$REQUEST" ]] || exit 0
  REF="$(tr -d '[:space:]' <"$REQUEST")"
  # Removing it changes the watched path once more; that run finds no request and exits.
  rm -f "$REQUEST"
  REF="${REF:-main}"
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
notify() { osascript -e "display notification \"$1\" with title \"T3 Code TestFlight\"" >/dev/null 2>&1 || true; }

commit=""
build=""
version=""
# state: preparing | installing | prebuilding | archiving | uploading | uploaded | failed.
# Values never contain quotes.
status() {
  printf '{"state":"%s","ref":"%s","commit":"%s","version":"%s","build":"%s","at":%s,"message":"%s"}\n' \
    "$1" "$REF" "$commit" "$version" "$build" "$(($(date +%s) * 1000))" "${2:-}" >"$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}

mkdir -p "$STATE_DIR"
if ! mkdir "$STATE_DIR/lock" 2>/dev/null; then
  log "another release holds $STATE_DIR/lock; skipping $REF"
  exit 0
fi
trap 'rmdir "$STATE_DIR/lock"' EXIT
trap 'status failed "The release failed. See $LOG_PATH."; notify "Release of $REF failed."' ERR

if [[ ! -f "$CONFIG" ]]; then
  status failed "Fill in $CONFIG first."
  log "missing $CONFIG; run install.sh to create it"
  exit 1
fi
# shellcheck source=/dev/null
source "$CONFIG"
for name in T3CODE_IOS_TEAM_ID T3CODE_IOS_BUNDLE_ID ASC_KEY_ID ASC_ISSUER_ID; do
  if [[ -z "${!name:-}" ]]; then
    status failed "Set $name in config.env."
    log "$name is not set in $CONFIG"
    exit 1
  fi
done
KEY_DIR="$HOME/.appstoreconnect/private_keys"
ASC_KEY_PATH="$(find "$KEY_DIR" -maxdepth 1 -name "*$ASC_KEY_ID*.p8" 2>/dev/null | head -n1)"
if [[ -z "$ASC_KEY_PATH" ]]; then
  status failed "No .p8 key file for $ASC_KEY_ID in ~/.appstoreconnect/private_keys."
  log "no *$ASC_KEY_ID*.p8 in $KEY_DIR"
  exit 1
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
: "${T3_TESTFLIGHT_REPO_URL:?T3_TESTFLIGHT_REPO_URL is not set}"
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
notify "Uploaded $version ($build). It reaches TestFlight after processing."
