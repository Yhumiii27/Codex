#!/bin/bash
# Builds Codex.app — a native macOS window around the Codex server —, installs it in ~/Applications and puts an alias
# on the Desktop (the app itself stays out of the Desktop, which iCloud may sync and evict).
# The app runs this project's production build (rebuilt automatically when the code changes), stores its data in
# ~/Library/Application Support/Codex and its server log in ~/Library/Logs/Codex. Usage: npm run app
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="$(pwd)"

NODE="$(command -v node || true)"
for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do [[ -z "$NODE" && -x "$candidate" ]] && NODE="$candidate"; done
[[ -x "$NODE" ]] || { echo "Node.js introuvable" >&2; exit 1; }
NODE="$(cd "$(dirname "$NODE")" && pwd -P)/$(basename "$NODE")" # resolve symlinks once, at build time
VERSION="$("$NODE" -p "require('./package.json').version")"
ARCH="$(uname -m)"
APP="$HOME/Applications/Codex.app"
if pgrep -f "$APP/Contents/MacOS/Codex" >/dev/null || curl -s -o /dev/null --max-time 1 http://127.0.0.1:3110/; then
  echo "Codex est ouvert (ou son serveur tourne sur le port 3110) : quittez-le puis relancez npm run app." >&2
  exit 1
fi
# Only ever delete bundles that are this app.
ours() { [[ "$(plutil -extract CFBundleIdentifier raw "$1/Contents/Info.plist" 2>/dev/null)" == "com.epc2i.codex" ]]; }
OUT="desktop/dist/Codex.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "› Compilation de l'application (Swift, $ARCH)…"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
swiftc -O -swift-version 5 -target "$ARCH-apple-macos13" desktop/CodexApp.swift -o "$OUT/Contents/MacOS/Codex"

echo "› Icône…"
swiftc -O -swift-version 5 desktop/make-icon.swift -o "$TMP/make-icon"
"$TMP/make-icon" "$TMP/icon.png"
mkdir "$TMP/Codex.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$TMP/Codex.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$TMP/icon.png" --out "$TMP/Codex.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/Codex.iconset" -o "$OUT/Contents/Resources/Codex.icns"

PLIST="$OUT/Contents/Info.plist"
plutil -create xml1 "$PLIST"
plutil -insert CFBundleName -string "Codex" "$PLIST"
plutil -insert CFBundleDisplayName -string "Codex" "$PLIST"
plutil -insert CFBundleIdentifier -string "com.epc2i.codex" "$PLIST"
plutil -insert CFBundleExecutable -string "Codex" "$PLIST"
plutil -insert CFBundleIconFile -string "Codex" "$PLIST"
plutil -insert CFBundlePackageType -string "APPL" "$PLIST"
plutil -insert CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -insert CFBundleVersion -string "$(date +%Y%m%d%H%M)" "$PLIST"
plutil -insert LSMinimumSystemVersion -string "13.0" "$PLIST"
plutil -insert LSApplicationCategoryType -string "public.app-category.productivity" "$PLIST"
plutil -insert NSHighResolutionCapable -bool true "$PLIST"
plutil -insert NSHumanReadableCopyright -string "Système EPC2i — GED Groupe" "$PLIST"
plutil -insert NSAppTransportSecurity -dictionary "$PLIST"
plutil -insert NSAppTransportSecurity.NSAllowsLocalNetworking -bool true "$PLIST"
plutil -insert CodexProjectDir -string "$PROJECT" "$PLIST"
plutil -insert CodexNodePath -string "$NODE" "$PLIST"

echo "› Build de production de Codex (évite l'attente à la première ouverture)…"
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 "$NODE" node_modules/next/dist/bin/next build >/dev/null

xattr -cr "$OUT"
codesign --force --deep --sign - "$OUT" >/dev/null
codesign --verify --deep --strict "$OUT"

mkdir -p "$HOME/Applications"
if [[ -e "$APP" ]]; then ours "$APP" || { echo "$APP existe et n'est pas Codex : abandon." >&2; exit 1; }; rm -rf "$APP"; fi
ditto "$OUT" "$APP"

swiftc -O -swift-version 5 desktop/make-alias.swift -o "$TMP/make-alias"
# An earlier version copied the app itself onto the Desktop: replace it with the alias.
if [[ -d "$HOME/Desktop/Codex.app" ]] && ours "$HOME/Desktop/Codex.app"; then rm -rf "$HOME/Desktop/Codex.app"; fi
"$TMP/make-alias" "$APP" "$HOME/Desktop/Codex"
echo "✓ Codex installée dans ~/Applications, alias « Codex » sur le bureau"
