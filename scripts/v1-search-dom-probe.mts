import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
try {
  for (const url of [
    "https://duckduckgo.com/?q=saas%20founders",
    "https://www.bing.com/search?q=saas%20founders",
  ]) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.locator('[data-testid="result-title-a"], .result__a, #b_results .b_algo h2 a').first()
        .waitFor({ state: "attached", timeout: 8000 }).catch(() => undefined);
      console.log(JSON.stringify(await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        text: document.body.innerText.slice(0, 1800),
        links: [...document.querySelectorAll("a")].slice(0, 35).map((a) => ({ text: a.innerText.slice(0, 90), href: a.href, testid: a.dataset.testid, class: a.className })),
      }))));
    } catch (error) {
      console.log(JSON.stringify({ url, error: error instanceof Error ? error.message : "failed" }));
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
