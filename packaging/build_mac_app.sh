#!/usr/bin/env bash
# Builds ~/Applications/MYCAREERTRACKER.app - a launcher that runs this project's desktop mode.
# Re-run after moving the project folder. Safe to re-run any time.
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/MYCAREERTRACKER.app"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MYCAREERTRACKER</string>
  <key>CFBundleDisplayName</key><string>MYCAREERTRACKER</string>
  <key>CFBundleIdentifier</key><string>com.moses.mycareertracker</string>
  <key>CFBundleVersion</key><string>0.1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>MYCAREERTRACKER</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/MYCAREERTRACKER" <<LAUNCH
#!/usr/bin/env bash
cd "$PROJECT"
exec "$PROJECT/venv/bin/python" -m app.desktop
LAUNCH
chmod +x "$APP/Contents/MacOS/MYCAREERTRACKER"

# Icon: render the rocket emoji to an .icns (best effort; app works without it)
if command -v python3 >/dev/null; then
  "$PROJECT/venv/bin/python" "$PROJECT/packaging/make_icon.py" "$APP/Contents/Resources/icon.icns" || true
fi

touch "$APP"  # nudge Finder/Launchpad to pick up the bundle
echo "Built: $APP"
echo "Open it from Launchpad / Spotlight ('MYCAREERTRACKER') or: open \"$APP\""
