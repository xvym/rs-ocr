@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-desktop.ps1"
if errorlevel 1 (
    echo.
    echo RS OCR failed to start. See the message above.
    pause
    exit /b 1
)
exit /b 0
