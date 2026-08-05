import type { Browser, Page } from "playwright";
import type { ScrapedPost, ScrapeRequest } from "./types.ts";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BUYER_RE =
  /\b(hiring|looking for|need a|need an|we need|seeking|help wanted|paid project)\b/i;

export async function launchStealthBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  return chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
}

export async function newStealthPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return page;
}

async function scrapeInstagram(page: Page, query: string, max: number): Promise<ScrapedPost[]> {
  const posts: ScrapedPost[] = [];
  const tag = query.replace(/\s+/g, "").toLowerCase();
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
    const links = await page.$$eval('a[href*="/p/"]', (els) =>
      els.slice(0, 10).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: a.getAttribute("aria-label") || "",
      })),
    );
    for (const { href, text } of links) {
      if (posts.length >= max) break;
      const combined = `${text} ${query}`;
      if (!BUYER_RE.test(combined) && !combined.toLowerCase().includes(query.toLowerCase())) continue;
      posts.push({
        platform: "Instagram",
        title: text.slice(0, 120) || `#${tag} post`,
        snippet: text.slice(0, 400) || `Instagram post tagged #${tag}`,
        url: href,
      });
    }
  } catch {
    /* page may require login — return empty */
  }
  return posts;
}

async function scrapeFacebook(page: Page, query: string, max: number): Promise<ScrapedPost[]> {
  const posts: ScrapedPost[] = [];
  const url = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(`${query} hiring`)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
    const items = await page.$$eval('[role="article"]', (els) =>
      els.slice(0, 8).map((el) => ({
        text: (el.textContent || "").slice(0, 500),
        link: el.querySelector("a[href*='/posts/']")?.getAttribute("href") || "",
      })),
    );
    for (const { text, link } of items) {
      if (posts.length >= max) break;
      if (!BUYER_RE.test(text)) continue;
      posts.push({
        platform: "Facebook",
        title: text.slice(0, 120),
        snippet: text.slice(0, 400),
        url: link.startsWith("http") ? link : `https://www.facebook.com${link}`,
      });
    }
  } catch {
    /* login wall */
  }
  return posts;
}

async function scrapeLinkedInPosts(page: Page, query: string, max: number): Promise<ScrapedPost[]> {
  const posts: ScrapedPost[] = [];
  const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(`${query} hiring`)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
    const items = await page.$$eval(".update-components-text", (els) =>
      els.slice(0, 8).map((el) => (el.textContent || "").slice(0, 500)),
    );
    for (const text of items) {
      if (posts.length >= max) break;
      if (!BUYER_RE.test(text)) continue;
      posts.push({
        platform: "LinkedIn",
        title: text.slice(0, 120),
        snippet: text.slice(0, 400),
        url,
      });
    }
  } catch {
    /* login wall */
  }
  return posts;
}

export async function runScrape(req: ScrapeRequest): Promise<ScrapedPost[]> {
  const max = Math.min(req.maxResults ?? 10, 15);
  const browser = await launchStealthBrowser();
  const page = await newStealthPage(browser);
  const all: ScrapedPost[] = [];
  const errors: string[] = [];

  try {
    for (const platform of req.platforms.slice(0, 3)) {
      try {
        let batch: ScrapedPost[] = [];
        if (platform === "instagram") batch = await scrapeInstagram(page, req.query, max);
        else if (platform === "facebook") batch = await scrapeFacebook(page, req.query, max);
        else if (platform === "linkedin") batch = await scrapeLinkedInPosts(page, req.query, max);
        all.push(...batch);
      } catch (e) {
        errors.push(`${platform}: ${(e as Error).message}`);
      }
    }
  } finally {
    await browser.close();
  }

  if (errors.length) console.warn("[stealth-worker]", errors.join("; "));
  return all.slice(0, max);
}

export async function fetchPageUrl(url: string): Promise<{
  url: string;
  title: string;
  markdown: string;
  text: string;
}> {
  const browser = await launchStealthBrowser();
  const page = await newStealthPage(browser);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(1500);
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || "");
    return {
      url,
      title: title.slice(0, 200),
      markdown: text.slice(0, 3000),
      text: text.slice(0, 3000),
    };
  } finally {
    await browser.close();
  }
}
