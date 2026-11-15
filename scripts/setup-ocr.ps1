$ErrorActionPreference = 'Stop'
$ocrProjectRoot = Split-Path -Parent $PSScriptRoot
$ocrManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ocr-models.json') -Raw | ConvertFrom-Json
$ocrDirectory = Join-Path $ocrProjectRoot '.runtime\ocr\tessdata'
New-Item -ItemType Directory -Path $ocrDirectory -Force | Out-Null
if ($ocrManifest.revision -notmatch '^[a-f0-9]{40}$') { throw 'Revisi model OCR tidak valid.' }
foreach ($ocrModel in $ocrManifest.models) {
    if ($ocrModel.file -notin @('eng.traineddata', 'ind.traineddata') -or $ocrModel.sha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Manifest model OCR tidak valid.'
    }
    $ocrTarget = Join-Path $ocrDirectory $ocrModel.file
    if ((Test-Path -LiteralPath $ocrTarget) -and (Get-FileHash -LiteralPath $ocrTarget -Algorithm SHA256).Hash -eq $ocrModel.sha256) {
        continue
    }
    $ocrTemporary = "$ocrTarget.download"
    try {
        Write-Host "Mengunduh model OCR $($ocrModel.language)..."
        $ocrUrl = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/$($ocrManifest.revision)/$($ocrModel.file)"
        Invoke-WebRequest -Uri $ocrUrl -OutFile $ocrTemporary
        if ((Get-FileHash -LiteralPath $ocrTemporary -Algorithm SHA256).Hash -ne $ocrModel.sha256) {
            throw "Checksum model OCR $($ocrModel.language) tidak cocok."
        }
        Move-Item -LiteralPath $ocrTemporary -Destination $ocrTarget -Force
    } finally {
        if (Test-Path -LiteralPath $ocrTemporary) { Remove-Item -LiteralPath $ocrTemporary }
    }
}
Write-Host 'Model OCR Bahasa Indonesia dan Inggris siap untuk pemakaian offline.'
