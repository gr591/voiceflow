#!/usr/bin/env bash
# Download bundled binaries for VoiceFlow on macOS (used by CI and local dev).
#
# Downloads:
#   - whisper-cli binary   → src-tauri/binaries/  (via Homebrew or source build)
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

ARCH="$(uname -m)"  # arm64 or x86_64
echo "Host architecture: $ARCH"

# ── Helpers ────────────────────────────────────────────────────────────────────

gh_latest_asset() {
    # Prints the browser_download_url of the first asset matching <pattern> in the latest release.
    local repo="$1" pattern="$2"
    curl -fsSL \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
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
    curl -fsSL --retry 3 -o "$dest" "$url"
}

# ── 1. whisper-cli ────────────────────────────────────────────────────────────
# whisper.cpp doesn't publish macOS pre-built binaries in GitHub releases.
# Install via Homebrew (available on all macOS CI runners and most dev Macs).

echo ""
echo "[1/6] Installing whisper-cli via Homebrew..."

if [ -f "$BIN/whisper-cli" ]; then
    echo "  Already exists, skipping."
else
    if command -v brew &>/dev/null; then
        brew install --quiet whisper-cpp || true

        # Find the installed binary — Homebrew puts it in its bin dir
        BREW_BIN="$(brew --prefix)/bin"
        WHISPER_BIN=""
        for name in whisper-cli whisper main; do
            if [ -f "$BREW_BIN/$name" ]; then
                WHISPER_BIN="$BREW_BIN/$name"
                break
            fi
        done

        if [ -n "$WHISPER_BIN" ]; then
            cp -f "$WHISPER_BIN" "$BIN/whisper-cli"
            chmod +x "$BIN/whisper-cli"
            # Copy whisper.cpp runtime dylibs from Homebrew.
            # Modern whisper.cpp (v1.6+) splits ggml into separate dylibs:
            #   libggml.dylib, libggml-base.dylib, libggml-cpu.dylib,
            #   libggml-metal.dylib, libggml-blas.dylib, libopenblas.dylib
            # Without them in the bundle, whisper-cli crashes at dylib load
            # time, producing zero output and a dyld error in stderr.
            find "$(brew --prefix)/lib" -maxdepth 1 \
                \( -name "libwhisper*" -o -name "libggml*" -o -name "libopenblas*" \) 2>/dev/null \
                | while read -r f; do cp -f "$f" "$BIN/"; done
            echo "  whisper-cli installed from Homebrew."
        else
            echo "  WARNING: brew installed whisper-cpp but binary not found — STT will use cloud."
        fi
    else
        echo "  WARNING: Homebrew not found — whisper not installed. STT will use cloud."
    fi
fi

# ── 2. ggml-base.bin ─────────────────────────────────────────────────────────

echo ""
echo "[2/6] Downloading ggml-base.bin..."
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
# Asset names: piper_macos_aarch64.tar.gz  or  piper_macos_x64.tar.gz

echo ""
echo "[3/6] Fetching piper release..."

if [ "$ARCH" = "arm64" ]; then
    PIPER_PATTERN="piper_macos_aarch64"
else
    PIPER_PATTERN="piper_macos_x64"
fi

PIPER_URL="$(gh_latest_asset "rhasspy/piper" "$PIPER_PATTERN" || true)"

if [ -n "$PIPER_URL" ]; then
    TMP_DIR="$(mktemp -d)"
    TMP_TGZ="$TMP_DIR/piper.tar.gz"
    TMP_EXT="$TMP_DIR/extract"
    mkdir -p "$TMP_EXT"

    download "$PIPER_URL" "$TMP_TGZ"
    echo "  Extracting..."
    tar -xzf "$TMP_TGZ" -C "$TMP_EXT"

    # The tarball extracts to a piper/ subdirectory.
    # Copy only regular files (not directories) from anywhere inside.
    while IFS= read -r f; do
        cp -f "$f" "$BIN/"
    done < <(find "$TMP_EXT" -type f \( -name "piper" -o -name "*.dylib" -o -name "*.so" -o -name "*.ort" \))

    # Copy espeak-ng-data directory tree
    ESPEAK_SRC="$(find "$TMP_EXT" -type d -name "espeak-ng-data" | head -1)"
    if [ -n "$ESPEAK_SRC" ]; then
        cp -rf "$ESPEAK_SRC" "$BIN/"
        echo "  Copied espeak-ng-data."
    fi

    chmod +x "$BIN/piper" 2>/dev/null || true
    rm -rf "$TMP_DIR"
    echo "  piper installed."
else
    echo "  WARNING: Could not find piper macOS asset — local TTS unavailable."
fi

# ── 4. piper voice model ──────────────────────────────────────────────────────

echo ""
echo "[4/6] Downloading piper voice model..."
VOICE_ONNX="$VOICES_DIR/en_US-ryan-high.onnx"
VOICE_JSON="$VOICES_DIR/en_US-ryan-high.onnx.json"
HF_VOICE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high"

if [ -f "$VOICE_ONNX" ]; then
    echo "  Already exists, skipping."
else
    download "$HF_VOICE/en_US-ryan-high.onnx"      "$VOICE_ONNX"
    download "$HF_VOICE/en_US-ryan-high.onnx.json"  "$VOICE_JSON"
    echo "  Voice model saved."
fi

# ── 5. llama-server ───────────────────────────────────────────────────────────
# Asset names: llama-bXXXX-bin-macos-arm64.tar.gz  or  llama-bXXXX-bin-macos-x64.tar.gz

echo ""
echo "[5/6] Fetching llama-server..."

if [ "$ARCH" = "arm64" ]; then
    LLAMA_PATTERN="bin-macos-arm64\.tar\.gz$"
else
    LLAMA_PATTERN="bin-macos-x64\.tar\.gz$"
fi

LLAMA_URL="$(gh_latest_asset "ggml-org/llama.cpp" "$LLAMA_PATTERN" || true)"

if [ -n "$LLAMA_URL" ]; then
    TMP_DIR="$(mktemp -d)"
    TMP_TGZ="$TMP_DIR/llama.tar.gz"
    TMP_EXT="$TMP_DIR/extract"
    mkdir -p "$TMP_EXT"

    download "$LLAMA_URL" "$TMP_TGZ"
    echo "  Extracting..."
    tar -xzf "$TMP_TGZ" -C "$TMP_EXT"

    while IFS= read -r f; do
        cp -f "$f" "$LLAMA_DIR/"
    done < <(find "$TMP_EXT" -type f \( -name "llama-server" -o -name "*.dylib" \))

    chmod +x "$LLAMA_DIR/llama-server" 2>/dev/null || true
    rm -rf "$TMP_DIR"
    echo "  llama-server installed."
else
    echo "  WARNING: Could not find macOS llama.cpp release asset — bundled LLM unavailable."
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
echo "Build: node node_modules/@tauri-apps/cli/tauri.js build --bundles dmg --target universal-apple-darwin"
echo ""
