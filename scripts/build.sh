#!/usr/bin/env bash
# VoiceFlow build script — macOS / Linux
# Usage:  ./scripts/build.sh [--dev] [--no-bundles]
#
# Requires: Rust, Node.js, Xcode CLI tools (macOS)

set -e
cd "$(dirname "$0")/.."

TAURI="node node_modules/@tauri-apps/cli/tauri.js"
DEV=false
NO_BUNDLES=false

for arg in "$@"; do
  case $arg in
    --dev)        DEV=true ;;
    --no-bundles) NO_BUNDLES=true ;;
  esac
done

# ── Warn if binaries are missing ────────────────────────────────────────────────
if [ ! -f "src-tauri/binaries/whisper-cli" ] && \
   [ ! -f "src-tauri/binaries/whisper" ] && \
   [ ! -f "src-tauri/binaries/whisper.exe" ]; then
  echo "⚠  whisper binary not found in src-tauri/binaries/ — STT won't work"
  echo "   Run: bash scripts/download-binaries-mac.sh"
fi
if [ ! -f "src-tauri/binaries/llama/llama-server" ] && \
   [ ! -f "src-tauri/binaries/llama/llama-server.exe" ]; then
  echo "⚠  llama-server not found — bundled LLM won't work"
  echo "   Run: bash scripts/download-binaries-mac.sh"
fi

# ── Build ───────────────────────────────────────────────────────────────────────
if $DEV; then
  echo "Starting dev server..."
  $TAURI dev

elif $NO_BUNDLES; then
  echo "Building release binary (no installer)..."
  $TAURI build --no-bundle

else
  # macOS: build a universal (arm64 + x86_64) .dmg and .app bundle
  echo "Building macOS universal app bundle..."
  $TAURI build --target universal-apple-darwin --bundles dmg,app

  DMG=$(find src-tauri/target/universal-apple-darwin/release/bundle/dmg \
             src-tauri/target/release/bundle/dmg \
        -name "*.dmg" 2>/dev/null | head -1)
  if [ -n "$DMG" ]; then
    echo ""
    echo "DMG ready: $DMG"
    read -rp "Open in Finder? [y/N] " ans
    if [ "$ans" = "y" ]; then open "$(dirname "$DMG")"; fi
  fi
fi
