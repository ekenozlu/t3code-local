#!/bin/bash
# Installs (or with --uninstall, removes) a launchd agent that runs updater.sh every 15 minutes.
set -euo pipefail

LABEL="local.t3code.self-update"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/Library/Application Support/t3code-self-update"
LOG="$HOME/Library/Logs/t3code-self-update.log"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

if [[ "${1-}" == "--uninstall" ]]; then
  rm -f "$PLIST"
  echo "Removed $LABEL. Build state remains in $STATE_DIR; delete it to reclaim disk space."
  exit 0
fi

repo_url="${1:-$(git -C "$(dirname "$0")" remote get-url origin)}"
mkdir -p "$STATE_DIR" "$(dirname "$PLIST")"
# Copied so switching branches in a dev checkout never changes the running updater.
cp "$(dirname "$0")/updater.sh" "$STATE_DIR/updater.sh"
chmod +x "$STATE_DIR/updater.sh"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$STATE_DIR/updater.sh</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/share/vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>T3_UPDATE_REPO_URL</key><string>$repo_url</string>
  </dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $LABEL watching $repo_url"
echo "Log: $LOG"
echo "Check now: launchctl kickstart $DOMAIN/$LABEL"
