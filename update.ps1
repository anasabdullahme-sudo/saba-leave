# Saba tool auto-updater (runs every 15 minutes, hidden). Downloads the newest extension files into %USERPROFILE%\SabaSeha
param([switch]$Force)
$ErrorActionPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir  = Join-Path $env:USERPROFILE 'SabaSeha'
$base = 'https://anasabdullahme-sudo.github.io/saba-leave'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$self = Join-Path $dir 'update.ps1'
$vbs  = Join-Path $dir 'run.vbs'
if (-not (Test-Path $vbs)) {
  Set-Content -Path $vbs -Encoding ASCII -Value ('CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""' + $self + '""", 0, False')
}
$stamp  = Get-Date -Format 'yyyyMMddHHmmss'
$remote = (Invoke-RestMethod -Uri "$base/ext-version.json?t=$stamp" -UseBasicParsing).version
if (-not $remote) { exit }
$cur = ''
$mf  = Join-Path $dir 'manifest.json'
if (Test-Path $mf) { $cur = (Get-Content $mf -Raw -Encoding UTF8 | ConvertFrom-Json).version }
if ((-not $Force) -and ($remote -eq $cur)) { exit }
$zip = Join-Path $env:TEMP 'saba-seha.zip'
$tmp = Join-Path $env:TEMP 'saba-seha-new'
Invoke-WebRequest -Uri "$base/saba-seha-extension.zip?t=$stamp" -OutFile $zip -UseBasicParsing
Remove-Item $tmp -Recurse -Force
Expand-Archive -Path $zip -DestinationPath $tmp -Force
if (Test-Path (Join-Path $tmp 'manifest.json')) {
  Copy-Item -Path (Join-Path $tmp '*') -Destination $dir -Recurse -Force
  Set-Content -Path (Join-Path $dir 'last-update.txt') -Value "$remote  $(Get-Date)"
}
# keep this updater itself up to date
$new = Join-Path $dir 'update.ps1.new'
Invoke-WebRequest -Uri "$base/update.ps1?t=$stamp" -OutFile $new -UseBasicParsing
if ((Test-Path $new) -and ((Get-Item $new).Length -gt 800)) { Move-Item -Path $new -Destination $self -Force }
