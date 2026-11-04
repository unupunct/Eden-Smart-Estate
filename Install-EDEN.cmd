@echo off
title EDEN Smart Estate setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
echo.
pause
