// One-time local sign-in (Q2=a): opens a visible browser on the local dev
// server, waits for the user to log in, saves the Playwright storage state to
// .auth/local-user.json (gitignored). Never prints tokens.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const out = ".auth/local-user.json";
const waitMs = Number(process.env.AUTH_WAIT_MS ?? 15 * 60_000);
mkdirSync(".auth", { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
await page.goto(`${base}/auth`, { waitUntil: "domcontentloaded" });
console.log(`AUTH_WINDOW_OPEN ${base}/auth — waiting up to ${Math.round(waitMs / 60000)} min for sign-in`);
const started = Date.now();
let signedIn = false;
while (Date.now() - started < waitMs) {
  await page.waitForTimeout(2_000);
  const url = page.url();
  const hasSession = await page.evaluate(() => Object.keys(localStorage).some((key) => /^sb-.*-auth-token$/.test(key))).catch(() => false);
  if (hasSession && !/\/auth(?:$|[/?#])/.test(new URL(url).pathname + "/")) { signedIn = true; break; }
  if (hasSession && /\/discover/.test(url)) { signedIn = true; break; }
}
if (signedIn) {
  await page.goto(`${base}/discover`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(2_000);
  await context.storageState({ path: out });
  console.log(`AUTH_SAVED ${out} url=${new URL(page.url()).pathname}`);
} else {
  console.log("AUTH_TIMEOUT no sign-in detected");
}
await browser.close();
