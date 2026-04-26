#!/usr/bin/env bash
set -euo pipefail

ACACIA_ROOT="/opt/acacia"
BACKEND_DIR="$ACACIA_ROOT/backend"
FRONTEND_DIR="$ACACIA_ROOT/frontend"
VENV_DIR="$BACKEND_DIR/venv"

echo "=== Acacia Deployment ==="

# 1. Pull latest code
cd "$ACACIA_ROOT"
git pull origin main

# 2. Install/update Python dependencies
cd "$BACKEND_DIR"
"$VENV_DIR/bin/pip" install -r requirements.txt --quiet

# 3. Build frontend
cd "$FRONTEND_DIR"
npm ci --production=false
VITE_DATA_MODE=backend VITE_BACKEND_URL=/api npm run build

# 4. Restart backend service
sudo systemctl restart acacia

# 5. Reload nginx (config might have changed)
sudo systemctl reload nginx

# 6. Verify
echo "Waiting for backend to start..."
sleep 2
curl -sf http://127.0.0.1:7860/health && echo " OK" || echo " FAILED"

echo "=== Deployment complete ==="
