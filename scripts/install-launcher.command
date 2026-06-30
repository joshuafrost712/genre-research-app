#!/bin/bash
# Build (or rebuild) the "Genre App" desktop launcher on the Desktop.
#
# Why this exists: the launcher is a hand-built macOS .app bundle that lives on
# the Desktop, outside git. macOS Sequoia Gatekeeper will reject an unsigned
# bundle that tries to *execute* a second unsigned script, which silently broke
# the browser auto-open once. This script is the single, idempotent source of
# truth for the bundle: re-run it any time the launcher is lost, deleted, or
# re-quarantined. Safe to run repeatedly.
#
# Usage: double-click this file in Finder, or:  bash scripts/install-launcher.command
set -euo pipefail

APP_DIR="$HOME/Documents/GitHub/genre-research-app"
LAUNCH_SCRIPT="$APP_DIR/scripts/launch-local.sh"
APP="$HOME/Desktop/Genre App.app"

# launch-local.sh is the real launch logic and must exist (it is committed to the repo).
if [ ! -f "$LAUNCH_SCRIPT" ]; then
  echo "ERROR: missing $LAUNCH_SCRIPT — cannot build the launcher." >&2
  exit 1
fi
chmod +x "$LAUNCH_SCRIPT"

# (Re)create the bundle structure.
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Genre App</string>
  <key>CFBundleDisplayName</key><string>Genre App</string>
  <key>CFBundleIdentifier</key><string>com.joshfrost.genreapp.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# The bundle executable. It INTERPRETS launch-local.sh (/bin/bash "$SCRIPT") rather
# than executing it directly: passing the script as an argument to bash is a file
# read, not an execve of an unsigned executable, so Gatekeeper does not block it.
cat > "$APP/Contents/MacOS/launch" <<'LAUNCH'
#!/bin/bash
SCRIPT="$HOME/Documents/GitHub/genre-research-app/scripts/launch-local.sh"
osascript -e 'display notification "Starting the Local Genres app..." with title "Genre App"' 2>/dev/null
/bin/bash "$SCRIPT" >> "$HOME/Documents/GitHub/genre-research-app/launcher.log" 2>&1
LAUNCH
chmod +x "$APP/Contents/MacOS/launch"

# Clear stale quarantine/provenance attributes and ad-hoc self-sign the bundle so
# Gatekeeper does not reject the app itself on future launches.
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"

echo "Rebuilt + signed: $APP"
echo "Double-click it on the Desktop to start the app and open http://localhost:5173/"
