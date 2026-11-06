@echo off
chcp 65001 >nul
title Chess Session Tracker
cd /d "%~dp0"

if not defined PORT set "PORT=5173"
set "URL=http://127.0.0.1:%PORT%"

set "NODE_EXE="
where node.exe >nul 2>nul && set "NODE_EXE=node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE goto no_node

if not defined OPEN_BROWSER set "OPEN_BROWSER=1"

echo.
echo   Chess Session Tracker
echo   URL: %URL%
echo   Stop: close this window or press Ctrl+C
echo.
"%NODE_EXE%" serve.mjs
if errorlevel 1 pause
exit /b 0

:no_node
echo.
echo   Node.js not found.
echo   Install LTS from https://nodejs.org and run this file again.
echo.
pause
exit /b 1
