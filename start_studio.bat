@echo off
title LUXA by Alf Studio (SNI 6389:2020)
echo ============================================================================
echo   LUXA by Alf Studio (SNI 6389:2020)
echo   Aplikasi : http://127.0.0.1:8000
echo   Mode Dev : http://127.0.0.1:5173 (bila Node.js terpasang)
echo ============================================================================
start "" "http://127.0.0.1:8000"
"%~dp0backend\.venv\Scripts\python.exe" "%~dp0backend\run_studio_servers.py"
pause
