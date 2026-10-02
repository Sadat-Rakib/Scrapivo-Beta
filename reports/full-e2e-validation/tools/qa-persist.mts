// QA-only controlled persistence checks on the demo account, with cleanup.
// Saved lead (saved by suite case P04): list -> notes edit -> reload -> delete -> reload.
// Profile: one harmless field changed, verified, restored, verified.
// Projects / Watches: read-only (no delete path exists for projects; see report).
//   npx tsx reports/full-e2e-validation/tools/qa-persist.mts
import { chromium, type Page } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "reports/full-e2e-validation";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const STATE = ".auth/qa-demo.json";
const EMAIL = (readFileSync("e2e/ship-it.spec.ts", "utf8").match(/E2E_EMAIL\s*\?\?\s*["'`]([^"'`]+)["'`]/) ?? [])[1] ?? "";
const TAG = `E2E_QA_${Date.now()}`;
const p04 = JSON.parse(readFileSync(`${ROOT}/evidence/runs/P04.json`, "utf8"));
const firstCard: string = p04.main?.leadCards?.[0] ?? "";
const savedName = (firstCard.split(" | ").map((s: string) => s.trim()).find((s: string) => /^[A-Z][a-z]+ [A-Z][\w'-]+$/.test(s)) ?? "").trim();
const out: Record<string, unknown> = { tag: TAG, startedAt: new Date().toISOString(), savedName };
const steps: Array<{ step: string; ok: boolean; detail?: string }> = [];
const record = (step: string, ok: boolean, detail?: string) => { steps.push({ step, ok, detail: detail?.split(EMAIL).join("<demo-email>").slice(0, 300) }); console.log(JSON.stringify({ step, ok })); };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const shot = (name: string) => page.screenshot({ path: `${ROOT}/ui/persist-${name}.jpg`, type: "jpeg", quality: 55, mask: EMAIL ? [page.getByText(EMAIL)] : [] }).catch(() => undefined);
const go = async (path: string) => { await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 }); await page.waitForTimeout(5_000); };
const cards = async () => (await page.locator("[role=button].lead-card-hover").allInnerTexts().catch(() => [])).map((t) => t.replace(/\n+/g, " | "));
const qaCard = () => page.locator("[role=button].lead-card-hover", { hasText: savedName }).first();

try {
  // Saved lead created by P04 (one "Save lead" click on the first result).
  await go("/saved");
  const before = await cards();
  out.savedCountAtStart = before.length;
  out.savedTitlesAtStart = before.map((t) => t.slice(0, 80));
  const present = !!savedName && before.some((t) => t.includes(savedName));
  record("P04 saved lead is listed on /saved", present, savedName ? `${before.length} saved` : "no name parsed from P04 card");
  await shot("1-saved-list");
  if (present) {
    await qaCard().click();
    await page.waitForTimeout(2_500);
    const notes = page.getByPlaceholder("Private notes for this lead…");
    if (await notes.isVisible().catch(() => false)) {
      await notes.fill(`${TAG} note`);
      await page.getByText("Pipeline stage").first().click().catch(() => undefined); // blur -> save
      await page.waitForTimeout(3_000);
      await go("/saved");
      await qaCard().click();
      await page.waitForTimeout(2_500);
      const value = await page.getByPlaceholder("Private notes for this lead…").inputValue().catch(() => "");
      record("notes edit persists across reload", value.includes(TAG));
      await shot("2-notes-persisted");
    } else record("notes field visible in saved lead detail", false);
    // Cleanup: delete the QA saved lead (lead_activity rows cascade).
    await page.getByRole("button", { name: "Delete", exact: true }).first().click();
    await page.waitForTimeout(3_000);
    await go("/saved");
    const after = await cards();
    out.savedCountAfterCleanup = after.length;
    record("QA saved lead deleted (gone after reload)", !after.some((t) => t.includes(savedName)), `${after.length} saved left`);
    await shot("3-after-delete");
  }

  // Profile: harmless reversible field.
  await go("/profile");
  const field = page.locator("label", { hasText: "Job title / craft" }).locator("xpath=following-sibling::*[1]").locator("input").first();
  const fallback = page.locator("div.space-y-1\\.5", { hasText: "Job title / craft" }).locator("input").first();
  const input = (await field.count()) ? field : fallback;
  const original = await input.inputValue().catch(() => null);
  out.profileOriginalWasEmpty = original === "";
  const saveBtn = page.getByRole("button", { name: /^Save( changes| profile)?$/i }).first();
  const saveVisible = await saveBtn.isVisible().catch(() => false);
  record("profile form has a Job title field and Save control", original !== null && saveVisible);
  if (original !== null && saveVisible) {
    await input.fill(TAG);
    await saveBtn.click();
    await page.waitForTimeout(3_000);
    await go("/profile");
    const changed = await input.inputValue().catch(() => "");
    record("profile edit persists across reload", changed === TAG);
    await input.fill(original);
    await saveBtn.click();
    await page.waitForTimeout(3_000);
    await go("/profile");
    const restored = await input.inputValue().catch(() => "");
    record("profile field restored to its original value", restored === original);
    await shot("4-profile-restored");
  }

  // Projects (read-only): list + New project dialog opens and cancels; no delete control exists.
  await go("/projects");
  await shot("5-projects");
  const newBtn = page.getByRole("button", { name: /New project|Create project/i }).first();
  const canOpen = await newBtn.isVisible().catch(() => false);
  if (canOpen) { await newBtn.click(); await page.waitForTimeout(1_500); await shot("6-new-project-dialog"); await page.keyboard.press("Escape"); }
  record("Projects page loads; New project dialog opens (not submitted)", canOpen);
  out.projectsDeleteControl = await page.getByRole("button", { name: /Delete project|Delete/i }).count();

  // Watches (read-only): saved watches drawer.
  await go("/watches");
  const drawer = page.getByRole("button", { name: "View saved watches" });
  if (await drawer.isVisible().catch(() => false)) { await drawer.click(); await page.waitForTimeout(2_500); }
  await shot("7-watches");
  out.watchesText = (await page.locator('[role="dialog"]').first().innerText().catch(() => "")).split(EMAIL).join("<demo-email>").slice(0, 600);
} catch (error) {
  out.fatal = error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : String(error);
} finally {
  out.steps = steps;
  out.finishedAt = new Date().toISOString();
  writeFileSync(`${ROOT}/evidence/persistence.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ passed: steps.filter((s) => s.ok).length, total: steps.length, fatal: out.fatal ?? null }));
  await browser.close();
}
