#!/usr/bin/env bash
set -euo pipefail

ACACIA_ROOT="/opt/acacia"

echo "=== Acacia Initial Server Setup ==="

# 1. Install system packages
sudo apt update && sudo apt install -y python3-venv python3-pip nodejs npm nginx certbot python3-certbot-nginx

# 2. Create service user and data directory
sudo useradd -r -s /bin/false acacia 2>/dev/null || true
sudo mkdir -p "$ACACIA_ROOT/data"
sudo chown acacia:acacia "$ACACIA_ROOT/data"

# 3. Create Python venv and install dependencies
cd "$ACACIA_ROOT/backend"
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# 4. Initialize database
DB_PATH="$ACACIA_ROOT/data/acacia.db" venv/bin/python -c "from database import init_db; init_db()"
sudo chown acacia:acacia "$ACACIA_ROOT/data/acacia.db"

# 5. Install systemd service
sudo cp "$ACACIA_ROOT/deploy/acacia.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable acacia

# 6. Install nginx config
sudo cp "$ACACIA_ROOT/deploy/nginx.conf" /etc/nginx/sites-available/acacia
sudo ln -sf /etc/nginx/sites-available/acacia /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# 7. Build frontend
cd "$ACACIA_ROOT/frontend"
npm ci
VITE_DATA_MODE=backend VITE_BACKEND_URL=/api npm run build

echo ""
echo "=== Setup complete ==="
echo ""
echo "IMPORTANT: Edit /etc/systemd/system/acacia.service to set:"
echo "  - JWT_SECRET (change from default)"
echo "  - SILICONFLOW_API_KEY (your LLM API key)"
echo ""
echo "Then run:"
echo "  sudo systemctl restart acacia"
echo "  sudo systemctl status acacia"
echo ""
echo "For HTTPS, run:"
echo "  sudo certbot --nginx -d your-domain.com"
