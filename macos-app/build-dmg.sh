#!/usr/bin/env bash
# Creates a distributable Claw Studio.dmg
# Run from the macos-app/ directory: bash build-dmg.sh

set -euo pipefail

APP_NAME="Claw Studio"
DMG_NAME="Claw Studio Installer"
OUT_DIR="$(pwd)/dist"
STAGING="$(mktemp -d)"

echo "Building $APP_NAME.dmg..."

mkdir -p "$OUT_DIR"

# Copy the .app into staging
cp -R "$APP_NAME.app" "$STAGING/"

# Ad-hoc sign the app so macOS shows a friendlier prompt instead of a hard block.
# This is not a notarized signature but removes the "damaged" / "unidentified developer"
# hard block on Apple Silicon and newer Gatekeeper versions.
echo "Ad-hoc signing $APP_NAME.app..."
codesign --sign - --force --deep --preserve-metadata=entitlements \
  "$STAGING/$APP_NAME.app" 2>/dev/null || \
  echo "  (codesign not available — skipping; users will need to run: xattr -cr \"$APP_NAME.app\")"

# Add a one-click helper that removes the macOS quarantine flag.
# Users can double-click "Open Claw Studio.command" instead of the .app
# if macOS still blocks after the first attempt.
HELPER="$STAGING/If macOS blocks the app — click here.command"
cat > "$HELPER" << 'HELPEREOF'
#!/usr/bin/env bash
# Removes the quarantine attribute macOS adds to downloaded files.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$SCRIPT_DIR/Claw Studio.app"
if [ ! -d "$APP" ]; then
  osascript -e 'display alert "Could not find Claw Studio.app next to this script." message "Make sure you ran this from the DMG or the same folder as the app." as warning'
  exit 1
fi
xattr -cr "$APP"
echo "Quarantine removed. You can now open Claw Studio.app normally."
osascript -e 'display alert "Done!" message "The macOS quarantine has been removed. You can now open Claw Studio.app by double-clicking it." as note'
HELPEREOF
chmod +x "$HELPER"

# Create a symlink to /Applications for easy drag-install feel
ln -s /Applications "$STAGING/Applications"

# Create the DMG
hdiutil create \
  -volname "$DMG_NAME" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$OUT_DIR/$APP_NAME.dmg"

rm -rf "$STAGING"

echo "Done: $OUT_DIR/$APP_NAME.dmg"
