# 部署环境变量配置指南

## Vercel 前端环境变量

在 Vercel 项目设置中添加以下环境变量：

```
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=https://uqblmypxkljuqwtzsrzy.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxYmxteXB4a2xqdXF3dHpzcnp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NDAwNjIsImV4cCI6MjA4NDMxNjA2Mn0.LQLkurTkUxVyUFLd0MEgmKCoLhq6NW0RIJuLxKUMTMs
VITE_BACKEND_URL=https://TandyBlow-seewhat.hf.space
```

## Hugging Face Spaces 后端环境变量

在 HF Spaces 项目设置的 Secrets 中添加：

```
SUPABASE_URL=https://uqblmypxkljuqwtzsrzy.supabase.co
SUPABASE_SERVICE_KEY=<你的 Supabase Service Key>
```

注意：SUPABASE_SERVICE_KEY 是服务端密钥，不是 ANON_KEY，需要从 Supabase 项目设置中获取。

## 本地开发环境变量

`frontend/.env` 已更新为使用 HF Spaces 后端地址。

如果需要本地后端开发，创建 `frontend/.env.local`：

```
VITE_BACKEND_URL=http://localhost:7860
```

`.env.local` 会覆盖 `.env` 的设置，且不会被提交到 git。
