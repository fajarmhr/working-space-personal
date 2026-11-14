. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath $script:RuangRoot
$node = Get-RuangNode
$pnpm = Get-RuangPnpm
$python = Get-RuangPython
$env:RUANG_DEBUG = '1'
Invoke-RuangNative -Executable $python -Arguments @('backend/manage.py', 'migrate', '--noinput')
$serverScript = Join-Path $script:RuangRoot 'backend\manage.py'
$backendProcess = Start-Process -FilePath $python -ArgumentList @('"' + $serverScript + '"', 'runserver', '127.0.0.1:8000', '--noreload') -WorkingDirectory $script:RuangRoot -WindowStyle Hidden -PassThru
try {
    Invoke-RuangNative -Executable $node -Arguments @($pnpm, '--dir', 'frontend', 'dev')
} finally {
    if (-not $backendProcess.HasExited) { Stop-Process -Id $backendProcess.Id }
}
