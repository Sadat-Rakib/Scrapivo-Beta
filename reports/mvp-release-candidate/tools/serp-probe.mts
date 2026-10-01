// Probe how DuckDuckGo html and Bing render for headless Chromium (Task 3 evidence).
import { chromium } from "playwright-core";

const query = process.argv[2] ?? "best restaurants in Calgary Alberta";
const HEADLESS = process.env.PROBE_HEADED !== "1"; const browser = await chromium.launch({ headless: HEADLESS, args: ["--disable-blink-features=AutomationControlled"] });
const context = await browser.newContext({ viewport: { width: 1366, height: 850 } });
const page = await context.newPage(); console.log(JSON.stringify({ headless: HEADLESS, ua: await page.evaluate(() => navigator.userAgent) }));
const targets = [
  ["ddg-html", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, "a.result__a"],
  ["ddg-lite", `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, "a.result-link"],
  ["bing", `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, "#b_results .b_algo h2 a"],
] as const;
for (const [name, url, selector] of targets) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForSelector(selector, { timeout: 5_000 }).catch(() => undefined);
    const title = await page.title();
    const text = (await page.locator("body").innerText({ timeout: 4_000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 220);
    const organic = await page.$$eval(selector, (as) => as.slice(0, 8).map((a) => ({ name: (a.textContent ?? "").trim().slice(0, 70), href: (a as HTMLAnchorElement).href.slice(0, 160) })));
    const anchors = await page.$$eval("a[href]", (as) => as.length);
    console.log(JSON.stringify({ name, finalUrl: page.url().slice(0, 120), title, anchors, organic: organic.length, sample: organic.slice(0, 4), text }));
  } catch (error) {
    console.log(JSON.stringify({ name, error: String(error).slice(0, 200) }));
  }
}
await browser.close();
