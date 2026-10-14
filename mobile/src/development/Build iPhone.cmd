@echo off
cd /d "%~dp0..\.."
if errorlevel 1 exit /b 1
title Build TrainingAi for iPhone
node scripts\build-ios.mjs
set "buildResult=%errorlevel%"
if "%buildResult%"=="0" goto finished
echo.
echo If Expo asks you to log in or update Apple signing, press S for setup prompts.
echo For other build errors, press X and share the error with Codex.
choice /c SX /n /m "Signing setup or exit? [S/X] "
if errorlevel 2 goto finished
if not errorlevel 1 goto finished
node scripts\build-ios.mjs --interactive
set "buildResult=%errorlevel%"
:finished
echo.
pause
exit /b %buildResult%
