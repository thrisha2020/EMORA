@echo off
rem Emora setup for Windows - double-click this file, or run it from a terminal.
rem Everything happens in setup.ps1; this wrapper only bypasses the PowerShell
rem script-execution policy for this one run.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
if errorlevel 1 pause
