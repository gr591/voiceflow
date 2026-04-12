# VoiceFlow build script — Windows
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\build.ps1 [-Dev] [-NoBundles]
#
# Flags:
#   -Dev        Run dev server instead of building installer
#   -NoBundles  Build exe only, skip NSIS installer packaging

param(
    [switch]$Dev,
    [switch]$NoBundles
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# ── Check binaries are present ─────────────────────────────────────────────────
$whisper = "src-tauri\binaries\whisper.exe"
$model   = "src-tauri\binaries\ggml-base.bin"
$llama   = "src-tauri\binaries\llama\llama-server.exe"
$gguf    = "src-tauri\binaries\models\qwen2.5-0.5b-instruct-q4_k_m.gguf"

if (-not (Test-Path $whisper) -or -not (Test-Path $model)) {
    Write-Warning "whisper.exe or ggml-base.bin missing from src-tauri\binaries\"
    Write-Warning "STT will not work without them."
}
if (-not (Test-Path $llama) -or -not (Test-Path $gguf)) {
    Write-Host ""
    Write-Host "  Bundled LLM binaries not found. Run to download them:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\download-llama.ps1" -ForegroundColor Yellow
    Write-Host ""
}

# ── Build ──────────────────────────────────────────────────────────────────────
$tauri = "node_modules\@tauri-apps\cli\tauri.js"

if ($Dev) {
    Write-Host "`nStarting dev server..." -ForegroundColor Cyan
    node $tauri dev
} elseif ($NoBundles) {
    Write-Host "`nBuilding release exe (no installer)..." -ForegroundColor Cyan
    node $tauri build --no-bundle
} else {
    Write-Host "`nBuilding NSIS installer..." -ForegroundColor Cyan
    node $tauri build --bundles nsis

    $installer = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($installer) {
        Write-Host "`nInstaller ready: $($installer.FullName)" -ForegroundColor Green
        $launch = Read-Host "Launch installer now? [y/N]"
        if ($launch -eq "y") { Start-Process $installer.FullName }
    }
}
