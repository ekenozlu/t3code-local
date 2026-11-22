#!/bin/bash
# Builds "T3 Release Monitor.app" into ~/Applications (or the directory given) and opens it.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
dest="${1:-$HOME/Applications}"
app="$dest/T3 Release Monitor.app"
export DEVELOPER_DIR="${DEVELOPER_DIR:-$(ls -d /Applications/Xcode*.app/Contents/Developer 2>/dev/null | head -n1)}"

swift build --package-path "$here" -c release
bin="$(swift build --package-path "$here" -c release --show-bin-path)/ReleaseMonitor"

mkdir -p "$dest"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$bin" "$app/Contents/MacOS/ReleaseMonitor"
cat >"$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>T3 Release Monitor</string>
  <key>CFBundleIdentifier</key><string>local.t3code.release-monitor</string>
  <key>CFBundleExecutable</key><string>ReleaseMonitor</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>T3RepoPath</key><string>$repo</string>
</dict>
</plist>
EOF
codesign --force --sign - "$app"
echo "Built $app"
open "$app"
