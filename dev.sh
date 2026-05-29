#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Kill background processes on Ctrl+C
trap 'kill 0' EXIT

echo "=== Starting backend on :7860 ==="
cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 7860 &

echo "=== Starting frontend (Vite auto-port) ==="
cd frontend && npx vite --host &

wait
