#!/usr/bin/env bash
# Installeert (of verwijdert met --uninstall) een LaunchAgent die telefoon-monitor.sh bij het
# inloggen start, zodat de stofzuiger pauzeert als de iPhone gebeld wordt.
set -euo pipefail

LABEL="local.smarthome.telefoon"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/telefoon-monitor.sh"
LOG="$HOME/Library/Logs/smarthome-telefoon.log"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$PLIST"
  echo "✓ LaunchAgent verwijderd."
  exit 0
fi

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ Telefoon-monitor draait (log: $LOG)."
echo "  Zorg dat in FaceTime > Instellingen 'Gesprekken van iPhone' aanstaat."
