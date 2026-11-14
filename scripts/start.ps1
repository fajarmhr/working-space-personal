param([switch]$NoBrowser, [int]$Port = 8000)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath $script:RuangRoot
$python = Get-RuangPython
if (-not (Test-Path -LiteralPath (Join-Path $script:RuangRoot 'frontend\dist\index.html'))) {
    throw 'Frontend belum dibuild. Jalankan setup.cmd terlebih dahulu.'
}
$env:RUANG_DEBUG = '0'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port harus berada di antara 1 dan 65535.' }
$portProbe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
    $portProbe.Start()
} catch {
    throw "Port $Port sedang dipakai. Tutup server sebelumnya atau gunakan -Port dengan nomor lain."
} finally {
    $portProbe.Stop()
}
Invoke-RuangNative -Executable $python -Arguments @('backend/manage.py', 'migrate', '--noinput')
$dataDirectory = if ($env:RUANG_DATA_DIR) { $env:RUANG_DATA_DIR } else { Join-Path $script:RuangRoot 'data' }
$logDirectory = Join-Path $dataDirectory 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$serverScript = Join-Path $script:RuangRoot 'backend\serve.py'
$serverArguments = '"' + $serverScript + '" --port ' + $Port
$serverProcess = Start-Process -FilePath $python -ArgumentList $serverArguments -WorkingDirectory $script:RuangRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
try {
    $ready = $false
    $deadline = (Get-Date).AddSeconds(12)
    while ((Get-Date) -lt $deadline -and -not $serverProcess.HasExited) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
            if ($health.status -eq 'ok' -and $health.version -eq '0.1.0') { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 150
    }
    if (-not $ready) { throw "Server belum siap. Periksa log di $logDirectory ." }
    Write-Host "Ruang berjalan di http://127.0.0.1:$Port . Tekan Ctrl+C untuk berhenti."
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
    while (-not $serverProcess.HasExited) { Start-Sleep -Milliseconds 300 }
    if ($serverProcess.ExitCode -ne 0) { throw "Server berhenti. Periksa log di $logDirectory ." }
} finally {
    if (-not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id }
}
