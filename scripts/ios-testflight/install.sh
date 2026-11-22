#!/bin/bash
# Installs (or with --uninstall, removes) a launchd agent that runs release.sh whenever the
# Release Monitor writes a git ref to the request file. Creates config.env on first install.
set -euo pipefail

LABEL="local.t3code.testflight"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/Library/Application Support/t3code-testflight"
LOG="$HOME/Library/Logs/t3code-testflight.log"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

if [[ "${1-}" == "--uninstall" ]]; then
  rm -f "$PLIST"
  echo "Removed $LABEL. Build state and config.env remain in $STATE_DIR."
  exit 0
fi

repo_url="${1:-$(git -C "$(dirname "$0")" remote get-url origin)}"
mkdir -p "$STATE_DIR" "$(dirname "$PLIST")"
# Copied so switching branches in a dev checkout never changes the running pipeline.
cp "$(dirname "$0")/release.sh" "$STATE_DIR/release.sh"
chmod +x "$STATE_DIR/release.sh"

if [[ ! -f "$STATE_DIR/config.env" ]]; then
  cat >"$STATE_DIR/config.env" <<'EOF'
# Your paid Apple Developer team and the bundle ID of the App Store Connect app.
T3CODE_IOS_TEAM_ID=
T3CODE_IOS_BUNDLE_ID=
# App Store Connect API key (Users and Access > Integrations, App Manager role). Its .p8 file is
# found in ~/.appstoreconnect/private_keys by this ID.
ASC_KEY_ID=
ASC_ISSUER_ID=
# Optional: the version shown in TestFlight (defaults to the one in app.config.ts).
# T3CODE_MOBILE_VERSION=2.3.0
# The full Xcode, when xcode-select points at the command line tools.
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
EOF
  chmod 600 "$STATE_DIR/config.env"
  echo "Created $STATE_DIR/config.env; fill it in from T3 Release Monitor's settings."
fi

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$STATE_DIR/release.sh</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/share/vite-plus/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>T3_TESTFLIGHT_REPO_URL</key><string>$repo_url</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>WatchPaths</key>
  <array><string>$STATE_DIR/request</string></array>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $LABEL watching $repo_url"
echo "Log: $LOG"
echo "Release main by hand: echo main > \"$STATE_DIR/request\""
