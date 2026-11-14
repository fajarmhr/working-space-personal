$ErrorActionPreference = 'Stop'
$script:RuangRoot = Split-Path -Parent $PSScriptRoot
$env:UV_CACHE_DIR = Join-Path $script:RuangRoot '.cache\uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $script:RuangRoot '.runtime\python'
$env:UV_PYTHON_BIN_DIR = Join-Path $script:RuangRoot '.runtime\bin'

function Get-RuangNode {
    $runtimePath = Join-Path $script:RuangRoot '.runtime'
    $candidate = Get-ChildItem -LiteralPath $runtimePath -Directory -Filter 'node-v26.*-win-x64' -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Name -replace '^node-v|-win-x64$', '') } -Descending |
        Select-Object -First 1
    if (-not $candidate) { throw 'Node LTS lokal belum tersedia. Jalankan setup.cmd terlebih dahulu.' }
    $env:PATH = "$($candidate.FullName);$env:PATH"
    return Join-Path $candidate.FullName 'node.exe'
}

function Get-RuangPnpm {
    $manager = Join-Path $script:RuangRoot '.runtime\tooling\node_modules\pnpm\bin\pnpm.mjs'
    if (-not (Test-Path -LiteralPath $manager)) { throw 'pnpm lokal belum tersedia. Jalankan setup.cmd terlebih dahulu.' }
    return $manager
}

function Get-RuangPython {
    $interpreter = Join-Path $script:RuangRoot 'backend\.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $interpreter)) { throw 'Environment Python belum tersedia. Jalankan setup.cmd terlebih dahulu.' }
    return $interpreter
}

function Invoke-RuangNative {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Perintah gagal dengan exit code $LASTEXITCODE : $Executable" }
}
