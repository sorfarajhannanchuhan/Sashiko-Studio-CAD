@echo off
title Sashiko Studio CAD [Localhost]
echo ========================================================
echo   Launching Sashiko Studio CAD
echo   Opening in your browser at http://localhost:5173/
echo ========================================================
cd /d "%~dp0"
start http://localhost:5173/
npm run dev
pause
