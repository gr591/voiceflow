#!/usr/bin/env bash
# Download bundled binaries for VoiceFlow on macOS (used by CI and local dev).
#
# Downloads (arm64 preferred; falls back to x86_64 if no arm64 release exists):
#   - whisper binary       → src-tauri/binaries/
#   - ggml-base.bin model  → src-tauri/binaries/
#   - piper binary + libs  → src-tauri/binaries/
#   - piper voice model    → src-tauri/binaries/voices/
#   - llama-server binary  → src-tauri/binaries/llama/
#   - LFM2.5-350M GGUF     → src-tauri/binaries/models/
#
# Usage (from the voiceflow/ directory):
#   bash scripts/download-binaries-mac.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT/src-tauri/binaries"
LLAMA_DIR="$BIN/llama"
MODELS_DIR="$BIN/models"
VOICES_DIR="$BIN/voices"

mkdir -p "$BIN" "$LLAMA_DIR" "$MODELS_DIR" "$VOICES_DIR"

# Detect arch
ARCH="$(uname -m)"  # arm64 or x86_64
echo "Host architecture: $ARCH"

# ── Helpers ────────────────────────────────────────────────────────────────────

gh_latest_asset() {
    # Usage: gh_latest_asset <owner/repo> <pattern>
    # Prints the browser_download_url of the first matching asset in the latest release.
    local repo="$1" pattern="$2"
    curl -fsSL \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        "https://api.github.com/repos/$repo/releases/latest" \
    | python3 -c "
import sys, json, re
data = json.load(sys.stdin)
pat = re.compile(sys.argv[1])
for a in data.get('assets', []):
    if pat.search(a['name']):
        print(a['browser_download_url'])
        break
" "$pattern"
}

download() {
    local url="$1" dest="$2"
    echo "  Downloading $(basename "$dest") ..."
    curl -fsSL -o "$dest" "$url"
}

# ── 1. whisper.cpp ────────────────────────────────────────────────────────────

echo ""
echo "[1/5] Fetching whisper.cpp release..."

if [ "$ARCH" = "arm64" ]; then
    WHISPER_PATTERN="macos.*arm64|arm64.*macos"
else
    WHISPER_PATTERN="macos.*x64|x64.*macos|macos.*x86_64|x86_64.*macos"
fi

WHISPER_URL="$(gh_latest_asset "ggml-org/whisper.cpp" "$WHISPER_PATTERN" || true)"

if [ -z "$WHISPER_URL" ]; then
    # Some releases only have a single macOS build; try generic "macos"
    WHISPER_URL="$(gh_latest_asset "ggml-org/whisper.cpp" "macos" || true)"
fi

if [ -n "$WHISPER_URL" ]; then
    TMP_ZIP="$(mktemp -d)/whisper.zip"
    TMP_EXT="$(mktemp -d)"
    download "$WHISPER_URL" "$TMP_ZIP"
    echo "  Extracting..."
    unzip -q "$TMP_ZIP" -d "$TMP_EXT"
    # Copy all files flat into binaries/
    find "$TMP_EXT" -maxdepth 3 \( -name "whisper-cli" -o -name "whisper" -o -name "main" -o -name "*.dylib" \) | while read -r f; do
        cp -f "$f" "$BIN/"
    done
    # Rename 'main' to 'whisper' if that's what shipped
    if [ -f "$BIN/main" ] && [ ! -f "$BIN/whisper-cli" ]; then
        mv "$BIN/main" "$BIN/whisper-cli"
    fi
    chmod +x "$BIN"/whisper-cli "$BIN"/whisper 2>/dev/null || true
    rm -rf "$TMP_ZIP" "$TMP_EXT"
    echo "  whisper binary installed."
else
    echo "  WARNING: Could not find a macOS whisper.cpp release asset. STT will fall back to cloud."
fi

# ── 2. ggml-base.bin ─────────────────────────────────────────────────────────

echo ""
echo "[2/5] Downloading ggml-base.bin..."
MODEL_PATH="$BIN/ggml-base.bin"
if [ -f "$MODEL_PATH" ]; then
    echo "  Already exists, skipping."
else
    download \
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin" \
        "$MODEL_PATH"
    echo "  Saved to binaries/ggml-base.bin"
fi

# ── 3. piper ─────────────────────────────────────────────────────────────────

echo ""
echo "[3/5] Fetching piper release..."

if [ "$ARCH" = "arm64" ]; then
    PIPER_PATTERN="macos_aarch64|macos.*arm64|arm64.*macos"
else
    PIPER_PATTERN="macos_x86_64|macos_amd64|macos.*x64|x64.*macos"
fi

PIPER_URL="$(gh_latest_asset "rhasspy/piper" "$PIPER_PATTERN" || true)"

if [ -n "$PIPER_URL" ]; then
    TMP_ZIP="$(mktemp -d)/piper.tar.gz"
    TMP_EXT="$(mktemp -d)"
    download "$PIPER_URL" "$TMP_ZIP"
    echo "  Extracting..."
    tar -xzf "$TMP_ZIP" -C "$TMP_EXT" 2>/dev/null || unzip -q "$TMP_ZIP" -d "$TMP_EXT"
    # Copy piper binary and dylibs
    find "$TMP_EXT" \( -name "piper" -o -name "*.dylib" -o -name "*.ort" \) | while read -r f; do
        cp -f "$f" "$BIN/"
    done
    # Copy espeak-ng-data if present
    ESPEAK_SRC="$(find "$TMP_EXT" -type d -name "espeak-ng-data" | head -1)"
    if [ -n "$ESPEAK_SRC" ]; then
        cp -rf "$ESPEAK_SRC" "$BIN/"
        echo "  Copied espeak-ng-data."
    fi
    chmod +x "$BIN/piper" 2>/dev/null || true
    rm -rf "$TMP_ZIP" "$TMP_EXT"
    echo "  piper binary installed."
else
    echo "  WARNING: Could not find a macOS piper release asset. Local TTS unavailable."
fi

# ── 4. piper voice model ──────────────────────────────────────────────────────

echo ""
echo "[4/5] Downloading piper voice model..."
VOICE_ONNX="$VOICES_DIR/en_US-ryan-high.onnx"
VOICE_JSON="$VOICES_DIR/en_US-ryan-high.onnx.json"
HF_VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high"

if [ -f "$VOICE_ONNX" ]; then
    echo "  Voice model already exists, skipping."
else
    download "$HF_VOICE_BASE/en_US-ryan-high.onnx"      "$VOICE_ONNX"
    download "$HF_VOICE_BASE/en_US-ryan-high.onnx.json"  "$VOICE_JSON"
    echo "  Voice model saved."
fi

# ── 5. llama-server ───────────────────────────────────────────────────────────

echo ""
echo "[5/6] Fetching llama.cpp release..."

if [ "$ARCH" = "arm64" ]; then
    LLAMA_PATTERN="macos.*arm64|arm64.*macos|macos-arm"
else
    LLAMA_PATTERN="macos.*x64|x64.*macos|macos.*x86"
fi

LLAMA_URL="$(gh_latest_asset "ggml-org/llama.cpp" "$LLAMA_PATTERN" || true)"

if [ -n "$LLAMA_URL" ]; then
    TMP_ZIP="$(mktemp -d)/llama.zip"
    TMP_EXT="$(mktemp -d)"
    download "$LLAMA_URL" "$TMP_ZIP"
    echo "  Extracting..."
    unzip -q "$TMP_ZIP" -d "$TMP_EXT" 2>/dev/null || tar -xzf "$TMP_ZIP" -C "$TMP_EXT"
    find "$TMP_EXT" -type f \( -name "llama-server" -o -name "*.dylib" \) | while read -r f; do
        cp -f "$f" "$LLAMA_DIR/"
    done
    chmod +x "$LLAMA_DIR/llama-server" 2>/dev/null || true
    rm -rf "$TMP_ZIP" "$TMP_EXT"
    echo "  llama-server installed."
else
    echo "  WARNING: Could not find a macOS llama.cpp release asset. Bundled LLM unavailable."
fi

# ── 6. LFM2.5-350M model ─────────────────────────────────────────────────────

echo ""
echo "[6/6] Downloading LFM2.5-350M-Q8_0.gguf (~370 MB)..."
LFM_MODEL="$MODELS_DIR/LFM2.5-350M-Q8_0.gguf"
if [ -f "$LFM_MODEL" ]; then
    echo "  Model already exists, skipping."
else
    download \
        "https://huggingface.co/LiquidAI/LFM2.5-350M-GGUF/resolve/main/LFM2.5-350M-Q8_0.gguf" \
        "$LFM_MODEL"
    echo "  Saved to binaries/models/LFM2.5-350M-Q8_0.gguf"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "Done! macOS binaries are ready."
echo "Now build: node node_modules/@tauri-apps/cli/tauri.js build --bundles dmg --target universal-apple-darwin"
echo ""
