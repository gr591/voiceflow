# Download bundled LLM binaries for VoiceFlow.
#
# Downloads:
#   - llama-server.exe (CPU build from llama.cpp GitHub releases)
#   - qwen2.5-0.5b-instruct-q4_k_m.gguf (~397 MB, from Hugging Face)
#
# Output layout:
#   src-tauri/binaries/llama/   <- llama-server.exe + sibling DLLs
#   src-tauri/binaries/models/  <- qwen2.5-0.5b-instruct-q4_k_m.gguf
#
# Usage (from the voiceflow/ directory):
#   powershell -ExecutionPolicy Bypass -File scripts\download-llama.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$llamaDir  = Join-Path $root "src-tauri\binaries\llama"
$modelsDir = Join-Path $root "src-tauri\binaries\models"

New-Item -ItemType Directory -Force -Path $llamaDir  | Out-Null
New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

# ── 1. llama-server (CPU build) ────────────────────────────────────────────────

Write-Host "`n[1/2] Fetching latest llama.cpp release tag..." -ForegroundColor Cyan
$releaseApi = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
$release = Invoke-RestMethod -Uri $releaseApi -Headers @{ "User-Agent" = "VoiceFlow" }
$tag = $release.tag_name
Write-Host "      Latest tag: $tag"

# Find the CPU-only Windows x64 zip asset
$asset = $release.assets | Where-Object {
    $_.name -match "win-cpu-x64\.zip$"
} | Select-Object -First 1

if (-not $asset) {
    Write-Error "Could not find win-cpu-x64 asset in release $tag. Check https://github.com/ggml-org/llama.cpp/releases manually."
}

$zipPath = Join-Path $env:TEMP "llama-cpu-x64.zip"
$extractPath = Join-Path $env:TEMP "llama-extract"

Write-Host "      Downloading $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing

Write-Host "      Extracting..."
Remove-Item -Recurse -Force $extractPath -ErrorAction SilentlyContinue
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
Remove-Item $zipPath

# Copy llama-server.exe + all DLLs into binaries/llama/
$serverFiles = Get-ChildItem $extractPath -Recurse | Where-Object {
    $_.Name -match "^(llama-server|llama|ggml.*|.*\.dll)$" -and -not $_.PSIsContainer
}
foreach ($f in $serverFiles) {
    Copy-Item $f.FullName -Destination $llamaDir -Force
}
Write-Host "      Copied $($serverFiles.Count) files to binaries\llama\" -ForegroundColor Green
Remove-Item -Recurse -Force $extractPath

# ── 2. Qwen2.5-0.5B-Instruct GGUF model ────────────────────────────────────────

$modelName = "LFM2.5-350M-Q8_0.gguf"
$modelDest = Join-Path $modelsDir $modelName

if (Test-Path $modelDest) {
    Write-Host "`n[2/2] Model already exists, skipping download." -ForegroundColor Yellow
} else {
    # LiquidAI LFM2.5-350M Q8_0 — ~370 MB, excellent instruction-following for its size
    $modelUrl = "https://huggingface.co/LiquidAI/LFM2.5-350M-GGUF/resolve/main/$modelName"
    Write-Host "`n[2/2] Downloading $modelName (~370 MB from Hugging Face)..." -ForegroundColor Cyan
    Write-Host "      LiquidAI LFM2.5-350M — ultra-fast, instruction-tuned, no API key needed."
    Write-Host "      This may take a few minutes on a slow connection."

    $client = New-Object System.Net.WebClient
    $client.DownloadFile($modelUrl, $modelDest)
    Write-Host "      Saved to binaries\models\$modelName" -ForegroundColor Green
}

# ── Done ──────────────────────────────────────────────────────────────────────

Write-Host "`nDone! Bundled LLM binaries are ready." -ForegroundColor Green
Write-Host "Now rebuild: node node_modules/@tauri-apps/cli/tauri.js build --bundles nsis`n"
