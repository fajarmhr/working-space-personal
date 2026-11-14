. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath $script:RuangRoot
$node = Get-RuangNode
$pnpm = Get-RuangPnpm
$python = Get-RuangPython
$env:RUANG_DEBUG = '0'
Invoke-RuangNative -Executable $python -Arguments @('backend/manage.py', 'check')
Invoke-RuangNative -Executable $python -Arguments @('backend/manage.py', 'test', 'workspace', '--verbosity', '1')
$testFiles = @(Get-ChildItem -LiteralPath (Join-Path $script:RuangRoot 'frontend\tests') -Filter '*.test.mjs' | Select-Object -ExpandProperty FullName)
Invoke-RuangNative -Executable $node -Arguments (@('--test') + $testFiles)
Invoke-RuangNative -Executable $node -Arguments @($pnpm, '--dir', 'frontend', 'build')
