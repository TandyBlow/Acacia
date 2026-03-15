# Deploy Guide (Vercel)

## 1) Import Repository
1. Open Vercel dashboard and click **Add New Project**.
2. Import `TandyBlow/SeeWhat`.
3. Set **Root Directory** to `frontend`.

## 2) Build Settings
- Framework Preset: `Vite`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

## 3) Environment Variables
Add these in Vercel project settings:

- `VITE_DATA_MODE` = `supabase`
- `VITE_SUPABASE_URL` = your Supabase URL
- `VITE_SUPABASE_ANON_KEY` = your Supabase anon key

Apply variables to `Production`, `Preview`, and `Development`.

## 4) Deploy
Click **Deploy**.  
After deploy, open the generated `*.vercel.app` URL.

## 5) Verify
1. Enter app home page successfully.
2. Create a node and refresh page.
3. Confirm node still exists (data persisted in Supabase).
4. Edit content and verify save.
5. Move/delete node and verify tree updates.

## Notes
- `frontend/.env` is local only and not committed.
- If deploy fails, confirm root directory is `frontend`.
