#!/usr/bin/env bash
# One-command local dev setup for VoiceFlow on macOS.
#
# Usage (from the voiceflow/ directory):
#   bash scripts/dev-mac.sh          # start dev server (hot-reload)
#   bash scripts/dev-mac.sh --build  # produce a release DMG instead
#
# What it does:
#   1. Checks Homebrew, Rust, Node are installed
#   2. Installs npm deps if missing
#   3. Downloads whisper/piper/llama/model binaries (skips if already present)
#   4. Runs `cargo tauri dev`  (or `cargo tauri build` with --build)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_MODE=false

# ── Parse args ────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --build) BUILD_MODE=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

cd "$ROOT"

# ── 1. Prerequisites ──────────────────────────────────────────────────────────

echo ""
echo "=== VoiceFlow dev setup ==="
echo ""

if ! command -v brew &>/dev/null; then
  echo "ERROR: Homebrew not found."
  echo "Install it first: https://brew.sh"
  exit 1
fi

if ! command -v rustup &>/dev/null && ! command -v cargo &>/dev/null; then
  echo "Rust not found — installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --quiet
  source "$HOME/.cargo/env"
fi

if ! command -v node &>/dev/null; then
  echo "Node.js not found — installing via Homebrew..."
  brew install --quiet node
fi

# ── 2. npm install ────────────────────────────────────────────────────────────

if [ ! -d node_modules ]; then
  echo "[npm] Installing dependencies..."
  npm install --silent
else
  echo "[npm] node_modules already present, skipping."
fi

# ── 3. Download binaries ──────────────────────────────────────────────────────

echo ""
echo "[binaries] Checking bundled binaries..."
bash scripts/download-binaries-mac.sh

# ── 4. Rust targets (for universal build) ────────────────────────────────────

if $BUILD_MODE; then
  echo ""
  echo "[rust] Adding universal build targets..."
  rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true
fi

# ── 5. Build or Dev ───────────────────────────────────────────────────────────

echo ""
if $BUILD_MODE; then
  echo "=== Building release DMG (universal) ==="
  echo "    This will take a few minutes..."
  echo ""
  node node_modules/@tauri-apps/cli/tauri.js build \
    --bundles dmg \
    --target universal-apple-darwin
  echo ""
  echo "Done! Find your DMG in:"
  echo "  src-tauri/target/universal-apple-darwin/release/bundle/dmg/"
else
  echo "=== Starting dev server (hot-reload) ==="
  echo "    Press Ctrl+C to stop."
  echo ""
  node node_modules/@tauri-apps/cli/tauri.js dev
fi
