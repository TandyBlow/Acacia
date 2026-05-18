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

# 2. Check .env exists
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "ERROR: $BACKEND_DIR/.env not found! Create it before deploying."
  echo "Template: $BACKEND_DIR/.env.example"
  exit 1
fi

# 3. Install/update Python dependencies
cd "$BACKEND_DIR"
"$VENV_DIR/bin/pip" install -r requirements.txt --quiet

# 4. Build frontend
cd "$FRONTEND_DIR"
npm ci --production=false
VITE_DATA_MODE=backend VITE_BACKEND_URL=/api npm run build

# 5. Restart backend service
sudo systemctl restart acacia

# 6. Update nginx config and reload
sudo cp "$ACACIA_ROOT/deploy/nginx.conf" /etc/nginx/nginx.conf
nginx -t
sudo systemctl reload nginx

# 7. Verify
echo "Waiting for backend to start..."
sleep 2
curl -sf http://127.0.0.1:7860/health && echo " OK" || echo " FAILED"

echo "=== Deployment complete ==="
