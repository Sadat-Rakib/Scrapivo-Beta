// QA-only profile edit/restore with the form fully loaded first, capturing the
// save toast each time. Field: "Job title / craft" (confirmed empty beforehand).
import { chromium, type Page } from "playwright-core";
import { writeFileSync } from "node:fs";

const TAG = `E2E_QA_${Date.now()}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: ".auth/qa-demo.json", viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const field = () => page.locator("div.space-y-1\\.5", { hasText: "Job title / craft" }).locator("input").first();
const load = async () => {
  await page.goto("http://localhost:8080/profile", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(15_000);
};
const saveAndToast = async (p: Page) => {
  await p.getByRole("button", { name: /Save Changes/i }).first().click();
  for (let i = 0; i < 20; i++) {
    const t = (await p.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ").trim();
    if (t) return t.slice(0, 200);
    await p.waitForTimeout(500);
  }
  return "(no toast)";
};
const out: Record<string, unknown> = { tag: TAG };
await load();
out.before = await field().inputValue();
await field().fill(TAG);
out.saveToast = await saveAndToast(page);
await load();
out.afterReload = (await field().inputValue()) === TAG ? "QA value persisted" : `not persisted (${(await field().inputValue()).slice(0, 40) || "empty"})`;
await field().fill(String(out.before ?? ""));
out.restoreToast = await saveAndToast(page);
await load();
out.restored = (await field().inputValue()) === out.before;
writeFileSync("reports/full-e2e-validation/evidence/profile-edit.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
await browser.close();
