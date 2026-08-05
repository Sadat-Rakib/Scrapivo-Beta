# Scrapivo Workers

Optional sidecar services for social platform discovery and page enrichment.

## 1. SearXNG (web discovery)

```bash
docker compose up -d searxng
```

Set in `.env`:

```
SEARXNG_URL=http://localhost:8080
```

Powers `searchWebBoolean()` — finds LinkedIn posts, X/Twitter URLs, Reddit threads via boolean queries.

## 2. Stealth worker (Playwright — LinkedIn / Instagram / Facebook)

```bash
cd workers/stealth-worker
npm install
npx playwright install chromium
npm start
```

Set in `.env`:

```
STEALTH_WORKER_URL=http://localhost:3099
STEALTH_WORKER_TOKEN=optional-secret
```

Endpoints:
- `POST /scrape` — platform search (`linkedin`, `instagram`, `facebook`)
- `POST /fetch` — extract page text from a single URL

## 3. Scrape worker (Crawl4AI — page enrichment)

```bash
docker compose up -d scrape-worker
```

Or locally:

```bash
cd workers/scrape-worker
pip install -r requirements.txt
playwright install chromium
uvicorn main:app --host 0.0.0.0 --port 3098
```

Set in `.env`:

```
SCRAPE_WORKER_URL=http://localhost:3098
```

Enriches thin SearXNG snippets with full post text.

## 4. curl-impersonate (optional HTTP layer)

Install [curl-impersonate](https://github.com/lwthiker/curl-impersonate) and set:

```
CURL_IMPERSONATE_BIN=C:\path\to\curl_chrome120.exe
```

Used by `http-fetch.server.ts` for Reddit and public APIs when sites return 403.

## 5. Paid fallback (optional)

```
USE_PAID_SOURCES=true
SERPAPI_KEY=...
TAVILY_API_KEY=...
```

## Recommended startup order

1. `docker compose up -d searxng`
2. `cd workers/stealth-worker && npm start`
3. Main app: `bun run dev`
