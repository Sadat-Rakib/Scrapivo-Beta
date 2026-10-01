// QA-only probe: (1) inspect Watches page for a delete/disable control without
// creating anything; (2) auth failure path — ONE wrong-password attempt, expect a
// useful error state, no sensitive internals. Never prints credentials.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const STATE = process.env.QA_STATE ?? ".auth/qa-demo.json";
const out: Record<string, any> = { startedAt: new Date().toISOString() };
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();

// 1) Watches page: does a delete/disable path exist?
await page.goto(`${BASE}/watches`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
await page.waitForTimeout(4_000);
const watchesBody = await page.locator("body").innerText().catch(() => "");
out.watches = {
  url: page.url().replace(BASE, ""),
  hasWatchUI: /watch/i.test(watchesBody),
  hasNewWatch: /new watch|create watch|watch signal/i.test(watchesBody),
  hasDeleteControl: !!(await page.getByRole("button", { name: /delete|remove|disable|pause|turn off/i }).count()),
  deleteLabels: await page.getByRole("button", { name: /delete|remove|disable|pause|turn off/i }).allInnerTexts().catch(() => []),
  sample: watchesBody.slice(0, 600).replace(/\n+/g, " | "),
};
await page.screenshot({ path: "reports/full-e2e-validation/ui/watches-probe.jpg", type: "jpeg", quality: 55 }).catch(() => undefined);

// 2) Auth failure path: exactly one wrong-password attempt.
await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
await page.waitForTimeout(3_000);
out.authPageUrl = page.url().replace(BASE, "");
const email = process.env.QA_EMAIL ?? (await import("node:fs")).readFileSync("e2e/ship-it.spec.ts", "utf8").match(/E2E_EMAIL\s*\?\?\s*["'`]([^"'`]+)["'`]/)?.[1] ?? "";
const emailBox = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first();
const passBox = page.locator('input[type="password"]').first();
if (await emailBox.isVisible().catch(() => false)) {
  await emailBox.fill(email);
  await passBox.fill("definitely-wrong-password-e2e-probe");
  await page.getByRole("button", { name: /sign in|log in|login/i }).first().click().catch(() => undefined);
  await page.waitForTimeout(6_000);
  const after = await page.locator("body").innerText().catch(() => "");
  out.authFailure = {
    stillOnAuth: /\/auth/.test(page.url()),
    errorShown: !!(await page.locator('[role="alert"], .text-destructive, [class*="error"]').first().isVisible().catch(() => false)),
    errorText: ((await page.locator('[role="alert"], .text-destructive, [class*="error"]').first().innerText().catch(() => "")) || "").slice(0, 200),
    leakCheck: /supabase|service_role|anon key|stack|NullPointerException|JWT|api[_-]?key/i.test(after),
  };
  await page.screenshot({ path: "reports/full-e2e-validation/ui/auth-failure-probe.jpg", type: "jpeg", quality: 55 }).catch(() => undefined);
} else out.authFailure = { skipped: "no login form found", url: page.url().replace(BASE, "") };

writeFileSync("reports/full-e2e-validation/evidence/watch-auth-probe.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
