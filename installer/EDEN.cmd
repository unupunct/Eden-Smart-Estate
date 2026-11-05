@echo off
title EDEN Smart Estate
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\scripts\start.ps1" -DataDir "%~dp0data" %*
