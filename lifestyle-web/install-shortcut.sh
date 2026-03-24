#!/usr/bin/env bash
# Creates a double-clickable desktop icon that launches the setup GUI.
# Run once after cloning: bash lifestyle-web/install-shortcut.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUI="$SCRIPT_DIR/setup_gui.py"
DESKTOP_DIR="$HOME/Desktop"
DESKTOP_FILE="$DESKTOP_DIR/MSML-Setup.desktop"

# ── check python3 ─────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required but not found."
  exit 1
fi

# ── ensure ~/Desktop exists ───────────────────────────────────────────────────
mkdir -p "$DESKTOP_DIR"

# ── write the .desktop file ───────────────────────────────────────────────────
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=MSML Setup
Comment=Configure and deploy the MSML Lifestyle Monitor
Exec=python3 $GUI
Icon=system-software-install
Terminal=false
Categories=Utility;
StartupNotify=true
EOF

chmod +x "$DESKTOP_FILE"

# On Raspberry Pi OS (LXDE/PCManFM) mark the file as trusted so it runs without a prompt
if command -v gio &>/dev/null; then
  gio set "$DESKTOP_FILE" metadata::trusted true 2>/dev/null || true
fi

echo ""
echo "Done! An 'MSML Setup' icon has been added to your Desktop."
echo "Double-click it any time to open the setup wizard."
