@echo off
setlocal
title Saba tool setup
set "DIR=%USERPROFILE%\SabaSeha"
if not exist "%DIR%" mkdir "%DIR%"
echo Downloading Saba tool...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://anasabdullahme-sudo.github.io/saba-leave/update.ps1' -OutFile (Join-Path $env:USERPROFILE 'SabaSeha\update.ps1') -UseBasicParsing"
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%\update.ps1" -Force
if not exist "%DIR%\manifest.json" (
  echo.
  echo ERROR: could not download the tool. Check the internet and run this file again.
  pause
  exit /b 1
)
schtasks /Create /TN "SabaSehaUpdate" /TR "wscript.exe \"%DIR%\run.vbs\"" /SC MINUTE /MO 15 /F >nul
schtasks /Create /TN "SabaSehaUpdateLogon" /TR "wscript.exe \"%DIR%\run.vbs\"" /SC ONLOGON /F >nul 2>&1
echo %DIR%| clip
start "" "%DIR%"
echo.
echo ============================================================
echo  Saba tool is installed in:  %DIR%
echo  (the folder path is copied - just paste it)
echo.
echo  ONE TIME ONLY in Chrome:
echo   1. open  chrome://extensions
echo   2. remove the old Saba tool (if any)
echo   3. Developer mode ON  -  Load unpacked  -  paste the path
echo.
echo  After that it updates itself automatically.
echo ============================================================
pause
