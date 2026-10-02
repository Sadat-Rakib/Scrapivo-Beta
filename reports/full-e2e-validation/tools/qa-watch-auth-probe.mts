// QA-only probe: (1) inspect Watches page, then a full watch lifecycle through
// the product UI — create one QA-prefixed watch (hero wizard), pause it, delete
// it, and assert it is gone after reload (zero unexplained artifacts);
// (2) auth failure path — ONE wrong-password attempt, expect a
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

// 1b) Watch lifecycle through the product UI: create -> pause -> delete.
// QA-prefixed query so the artifact is unambiguous; delete leaves zero residue.
const WATCH_QUERY = "QA E2E watch probe — UX designers in Toronto";
const lc: Record<string, any> = { query: WATCH_QUERY };
const toastsNow = async () => (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, " ").trim());
try {
  // Create: hero "Enter" pill (aria-label "Set up a signal watch") -> Q1 input
  // -> Next -> Q2 (daily default) -> Save Watch -> toast "Signal watch saved".
  const enter = page.getByRole("button", { name: "Set up a signal watch" });
  lc.hasCreateEntry = await enter.isVisible().catch(() => false);
  if (lc.hasCreateEntry) {
    await enter.first().click();
    const q1 = page.locator('input[placeholder^="e.g. Watch for"]').first();
    await q1.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    await q1.fill(WATCH_QUERY);
    await page.getByRole("button", { name: "Next", exact: true }).first().click();
    await page.getByRole("button", { name: "Save Watch" }).first().click();
    await page.waitForTimeout(3_500);
    lc.createdToast = (await toastsNow()).slice(-2);
    lc.createdConfirm = /Locked in\./i.test((await page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " "));
  }
  // Drawer: bell (aria-label "View saved watches") lists the watch with
  // Pause / Run controls and an icon-only Trash delete button.
  const bell = page.getByRole("button", { name: "View saved watches" });
  if (await bell.isVisible().catch(() => false)) { await bell.first().click(); await page.waitForTimeout(2_500); }
  const row = page.locator("div.liquid-glass", { hasText: "QA E2E watch probe" }).first();
  lc.rowVisible = await row.isVisible().catch(() => false);
  lc.hasPauseControl = !!(await row.getByRole("button", { name: /Pause|Resume/ }).count());
  if (lc.hasPauseControl) {
    await row.getByRole("button", { name: "Pause", exact: true }).first().click();
    await page.waitForTimeout(2_500);
    lc.pausedToast = (await toastsNow()).slice(-2);
    lc.pausedToggled = /Watch paused/.test(lc.pausedToast.join(" "))
      || !!(await row.getByRole("button", { name: "Resume", exact: true }).first().isVisible().catch(() => false));
  }
  // Delete control: Trash2 icon button has NO accessible name — it is the last
  // <button> in the row (Pause/Resume, Run, Trash).
  const delBtn = row.locator("button").last();
  lc.hasDeleteControl = await delBtn.isVisible().catch(() => false);
  if (lc.hasDeleteControl) {
    await delBtn.click();
    await page.waitForTimeout(2_500);
    lc.deletedToast = (await toastsNow()).slice(-2);
    lc.deleted = /Watch removed/.test(lc.deletedToast.join(" "))
      || !(await row.isVisible().catch(() => false));
  }
  // Gone after reload: fresh /watches, reopen the drawer, check the list.
  await page.goto(`${BASE}/watches`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(4_000);
  const bell2 = page.getByRole("button", { name: "View saved watches" });
  if (await bell2.isVisible().catch(() => false)) { await bell2.first().click(); await page.waitForTimeout(2_500); }
  lc.goneAfterReload = !/QA E2E watch probe/i.test(await page.locator("body").innerText().catch(() => ""));
  await page.screenshot({ path: "reports/full-e2e-validation/ui/watch-lifecycle-after-delete.jpg", type: "jpeg", quality: 55 }).catch(() => undefined);
} catch (e) {
  lc.error = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : String(e);
}
out.watchLifecycle = lc;

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
