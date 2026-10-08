@echo off
rem Start Emora on Windows. Pass -Lan to allow a phone on the same Wi-Fi.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
