@echo off
chcp 65001 >nul
title Acacia Dev

echo [Acacia] Starting backend...
start "Acacia Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 7860"

echo [Acacia] Starting frontend...
start "Acacia Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo [Acacia] Both servers started. Close the windows to stop.
