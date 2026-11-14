param([switch]$SkipBuild)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath $script:RuangRoot

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'uv belum terpasang. Pasang dari https://docs.astral.sh/uv/getting-started/installation/ lalu jalankan setup.cmd lagi.'
}

$runtimePath = Join-Path $script:RuangRoot '.runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
$release = $releases | Where-Object { $_.version -match '^v26\.' -and $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
if (-not $release) { throw 'Node 26 LTS tidak ditemukan pada registry resmi.' }
$archiveName = "node-$($release.version)-win-x64.zip"
$nodeDirectory = Join-Path $runtimePath "node-$($release.version)-win-x64"
if (-not (Test-Path -LiteralPath (Join-Path $nodeDirectory 'node.exe'))) {
    Write-Host "Mengunduh Node $($release.version) LTS..."
    $archivePath = Join-Path $runtimePath $archiveName
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$($release.version)/$archiveName" -OutFile $archivePath
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt").Content
    if ($checksums -is [byte[]]) { $checksums = [Text.Encoding]::UTF8.GetString($checksums) }
    $line = ($checksums -split "`n" | Where-Object { $_.Trim().EndsWith(" $archiveName") } | Select-Object -First 1)
    if (-not $line) { throw 'Checksum Node tidak ditemukan.' }
    $expected = ($line.Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expected) { throw 'Checksum arsip Node tidak cocok.' }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimePath -Force
}

$node = Get-RuangNode
$npm = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
$toolingPath = Join-Path $runtimePath 'tooling'
if (-not (Test-Path -LiteralPath (Join-Path $toolingPath 'node_modules\pnpm\bin\pnpm.mjs'))) {
    Invoke-RuangNative -Executable $node -Arguments @($npm, 'install', '--prefix', $toolingPath, '--ignore-scripts', '--no-audit', '--no-fund', 'pnpm@12.18.0')
}
Invoke-RuangNative -Executable 'uv' -Arguments @('python', 'install', '3.14')
Invoke-RuangNative -Executable 'uv' -Arguments @('sync', '--project', 'backend', '--frozen')
$pnpm = Get-RuangPnpm
Invoke-RuangNative -Executable $node -Arguments @($pnpm, '--dir', 'frontend', 'install', '--frozen-lockfile', '--ignore-scripts')
$python = Get-RuangPython
Invoke-RuangNative -Executable $python -Arguments @('backend/manage.py', 'migrate', '--noinput')
if (-not $SkipBuild) {
    Invoke-RuangNative -Executable $node -Arguments @($pnpm, '--dir', 'frontend', 'build')
}
Write-Host 'Ruang siap. Jalankan start.cmd untuk membuka workspace.'
