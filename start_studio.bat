@echo off
title OTTV 3D Parametric Studio v3.0 (SNI 6389:2020)
echo ============================================================================
echo   OTTV 3D PARAMETRIC STUDIO v3.0 - 5-STAGE UNIVERSAL PIPELINE (SNI 6389:2020)
echo   Frontend : http://127.0.0.1:5173
echo   Backend  : http://127.0.0.1:8000
echo ============================================================================
start "" "http://127.0.0.1:5173"
"e:\PROJECT\ottv-3d-sni6389\backend\.venv\Scripts\python.exe" "e:\PROJECT\ottv-3d-sni6389\backend\run_studio_servers.py"
pause
