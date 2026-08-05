# Scrapivo Beta

Real-time AI lead generation — find verified, active buyers without the chaos.

## Stack

- TanStack Start + React + Vite
- Supabase Auth + Postgres
- Vercel (Nitro preset)

## Local setup

```bash
npm install
cp .env.example .env
# fill MY_SUPABASE_* / VITE_MY_SUPABASE_* and other keys
npm run dev
```

App: http://localhost:8080/

Optional SearXNG:

```bash
docker compose up -d searxng
```

## Auth flow

1. **Sign up** — name, lead issue, email, password → account created (email auto-confirmed)
2. **Sign in** — same email/password → Discover

## Deploy

Pushes to `main` deploy via Vercel. Required production env vars are listed in `.env.example` (never commit `.env`).
