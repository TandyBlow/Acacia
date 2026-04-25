Acacia Frontend

Vue 3 + Vite client for the Acacia knowledge-node app.

## Quick Start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Data Modes

The app supports two modes:

1. `local` (default): uses `localStorage` seed data for fast MVP iteration.
2. `supabase`: uses RPC functions in Supabase.

Copy `.env.example` to `.env`:

```bash
VITE_DATA_MODE=local
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

To enable Supabase mode:

```bash
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Then run the SQL in `../supabase/schema.sql` in the Supabase SQL editor.

## Deploy (Vercel)

Deploy this app from the `frontend` directory.

Recommended settings:

- Framework Preset: `Vite`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

Required env vars in Vercel:

- `VITE_DATA_MODE=supabase`
- `VITE_SUPABASE_URL=...`
- `VITE_SUPABASE_ANON_KEY=...`
