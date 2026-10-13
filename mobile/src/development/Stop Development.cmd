@echo off
cd /d "%~dp0..\.."
if errorlevel 1 exit /b 1
node scripts\dev.mjs stop
echo.
pause
