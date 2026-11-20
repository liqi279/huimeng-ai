@echo off
setlocal
title Blueberry AI Pet Launcher
cd /d "%~dp0"

set "ROOT=%CD%"
if not exist "%ROOT%\package.json" (
  if exist "%ROOT%\Blueberry-AI-Pet\package.json" (
    set "ROOT=%ROOT%\Blueberry-AI-Pet"
  )
)

if not exist "%ROOT%\package.json" (
  echo ERROR: package.json was not found.
  echo Please extract the ZIP completely.
  echo Open the folder that contains package.json and run START-PET.bat there.
  echo.
  echo Current folder: %CD%
  pause
  exit /b 1
)

cd /d "%ROOT%"
set "LOG=%ROOT%\startup-log.txt"
echo Blueberry AI Pet startup log > "%LOG%"
echo Date: %DATE% %TIME% >> "%LOG%"
echo Project: %CD% >> "%LOG%"

where node >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install Node.js LTS from https://nodejs.org/ and restart Windows.
  echo Node.js not found >> "%LOG%"
  pause
  exit /b 1
)

node -v
node -v >> "%LOG%" 2>&1
npm -v
npm -v >> "%LOG%" 2>&1

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing Electron dependencies. Please wait...
  call npm install --no-audit --no-fund >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo ERROR: npm install failed. Send startup-log.txt to ChatGPT.
    pause
    exit /b 1
  )
)

echo Starting Blueberry AI Pet...
call npm start >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ERROR: App failed to start. Send startup-log.txt to ChatGPT.
)
echo.
echo If no pet appeared, send startup-log.txt to ChatGPT.
pause
endlocal
