@echo off
setlocal
title Blueberry AI Pet Environment Check
cd /d "%~dp0"
set "ROOT=%CD%"
if not exist "%ROOT%\package.json" if exist "%ROOT%\Blueberry-AI-Pet\package.json" set "ROOT=%ROOT%\Blueberry-AI-Pet"
cd /d "%ROOT%"
echo Project folder: %CD%
echo.
where node
node -v
where npm
npm -v
echo.
if exist "package.json" (echo package.json: OK) else (echo package.json: MISSING)
if exist "main.js" (echo main.js: OK) else (echo main.js: MISSING)
if exist "node_modules\electron\dist\electron.exe" (echo Electron: INSTALLED) else (echo Electron: NOT INSTALLED)
echo.
pause
endlocal
