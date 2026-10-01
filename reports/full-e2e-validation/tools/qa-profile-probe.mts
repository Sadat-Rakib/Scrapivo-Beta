// QA-only, read-only: profile field values after the form has loaded, and which
// input the persistence check's locator actually targeted. Values of personal
// fields are reported as empty/non-empty only.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: ".auth/qa-demo.json", viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
await page.goto("http://localhost:8080/profile", { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(15_000);
const fields = await page.evaluate(() => [...document.querySelectorAll("label")].map((label) => {
  const input = label.parentElement?.querySelector("input, textarea") as HTMLInputElement | null;
  return { label: (label.textContent ?? "").trim(), value: input ? input.value : null };
}));
const field = page.locator("label", { hasText: "Job title / craft" }).locator("xpath=following-sibling::*[1]").locator("input").first();
const fallback = page.locator("div.space-y-1\\.5", { hasText: "Job title / craft" }).locator("input").first();
const usedFallback = (await field.count()) === 0;
const targetedPlaceholder = await (usedFallback ? fallback : field).getAttribute("placeholder").catch(() => null);
const targetedLabel = await (usedFallback ? fallback : field).evaluate((el) => {
  const label = el.parentElement?.querySelector("label") ?? el.closest("div")?.querySelector("label");
  return label?.textContent?.trim() ?? null;
}).catch(() => null);
const out = {
  usedFallback, targetedLabel, targetedPlaceholder,
  fields: fields.filter((f) => f.value !== null).map((f) => ({ label: f.label, state: f.value ? (/E2E_QA_/.test(f.value) ? "QA_VALUE" : "non-empty") : "empty" })),
};
writeFileSync("reports/full-e2e-validation/evidence/profile-probe.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
await browser.close();
