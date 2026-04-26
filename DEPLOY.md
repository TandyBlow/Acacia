# Deploy Guide (VPS)

## Prerequisites
- A VPS with Python 3.10+, Node.js 18+, and Nginx installed
- Domain name (optional, for HTTPS)

## 1) Initial Setup

SSH into your server and clone the repo:
```bash
git clone https://github.com/TandyBlow/Acacia.git /opt/acacia
cd /opt/acacia
```

Run the setup script:
```bash
sudo bash deploy/setup.sh
```

Edit the systemd service to set your secrets:
```bash
sudo nano /etc/systemd/system/acacia.service
# Set JWT_SECRET and SILICONFLOW_API_KEY
sudo systemctl daemon-reload
sudo systemctl restart acacia
```

## 2) Verify

1. Check backend health: `curl http://localhost:7860/health`
2. Open your server's IP in a browser
3. Register a new account
4. Create a node, refresh page, confirm it persists
5. Edit content and verify save
6. Move/delete node and verify tree updates

## 3) HTTPS (Optional)

```bash
sudo certbot --nginx -d your-domain.com
```

## 4) Update Deployment

After pushing code to main, run on the server:
```bash
bash deploy/deploy.sh
```

## Environment Variables

### Backend (in `/etc/systemd/system/acacia.service`)
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Secret key for JWT signing |
| `DB_PATH` | No | `acacia.db` | Path to SQLite database |
| `SILICONFLOW_API_KEY` | For AI | - | LLM API key |
| `SILICONFLOW_MODEL` | No | `Qwen/Qwen2.5-7B-Instruct` | LLM model name |
| `LLM_API_URL` | No | SiliconFlow URL | LLM API endpoint |

### Frontend (build-time, in `.env.production`)
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_DATA_MODE` | `backend` | Adapter mode |
| `VITE_BACKEND_URL` | `/api` | Backend URL (relative path for Nginx proxy) |
