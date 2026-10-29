@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [Error] Please create .venv and install Python dependencies. See README.md.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\electron.cmd" (
  echo [Error] Please run npm install first.
  pause
  exit /b 1
)
call npm.cmd run start
if errorlevel 1 pause
endlocal
