@echo off
cd /d "%~dp0..\.."
if errorlevel 1 exit /b 1
title Build TrainingAi for Android
node scripts\build-mobile.mjs --platform android
set "buildResult=%errorlevel%"
echo.
pause
exit /b %buildResult%
