/**
 * Scrapivo Stealth Worker
 *
 * Headless browser service for gated social platforms when public APIs
 * and SearXNG boolean search return thin results.
 *
 * Architecture:
 *   Scrapivo (sources.server.ts searchStealthWorker)
 *     POST /scrape { query, role, platforms[], maxResults }
 *       → Playwright with stealth patches (inspired by obscura patterns)
 *       → returns normalized posts[]
 *
 * Supported platforms (public search/post pages only — no profile scraping):
 *   - instagram: hashtag + keyword search pages
 *   - facebook:  public group search (where accessible without login)
 *   - linkedin:  post search when guest API + SearXNG are insufficient
 *
 * Deployment:
 *   cd workers/stealth-worker
 *   npm install
 *   npx playwright install chromium
 *   STEALTH_WORKER_PORT=3099 npm start
 *
 * Then set STEALTH_WORKER_URL=http://localhost:3099 in Scrapivo .env
 *
 * Security:
 *   - Bind to localhost in dev; use auth token in production (STEALTH_WORKER_TOKEN)
 *   - Rate limit: max 3 platform searches per request, 30s timeout per page
 *   - Do NOT use for connection requests, DMs, or profile harvesting
 */

export type ScrapeRequest = {
  query: string;
  role?: string;
  platforms: Array<"instagram" | "facebook" | "linkedin">;
  maxResults?: number;
  urls?: string[];
};

export type ScrapedPost = {
  platform: string;
  title: string;
  snippet: string;
  url: string;
  author?: string;
  posted_at?: string;
};

export type ScrapeResponse = {
  posts: ScrapedPost[];
  errors?: string[];
};
