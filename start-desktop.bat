@echo off
setlocal

cd /d "%~dp0"
title Cyrene Desktop

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [Cyrene] Node.js is not installed or is not available in PATH.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [Cyrene] Dependencies are missing. Run npm install first.
  pause
  exit /b 1
)

if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)

where cargo.exe >nul 2>nul
if errorlevel 1 (
  echo [Cyrene] Rust/Cargo is not installed or is not available in PATH.
  echo [Cyrene] Install Rust from https://rustup.rs/ and reopen this terminal.
  pause
  exit /b 1
)

echo [Cyrene] Starting desktop pet...
call npm.cmd run dev

if errorlevel 1 (
  echo.
  echo [Cyrene] Startup failed with exit code %errorlevel%.
  pause
  exit /b 1
)

endlocal
