@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer from nodejs.org.
  pause
  exit /b 1
)
node server.cjs
pause
