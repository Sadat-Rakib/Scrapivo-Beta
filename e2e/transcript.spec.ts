/**
 * Step 3 browser check: collapsible transcript, nothing discarded.
 * Logs in with the synthetic test user, runs two searches, asserts both
 * turns keep working Expand/Fold controls (no "run again to reload" text).
 */
import { expect, test } from "@playwright/test";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("scrapivo:onboarding-skipped", "1");
      localStorage.setItem("scrapivo:guided-tour-seen", "1");
    } catch { /* ignore */ }
  });
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/discover|home|\/$/, { timeout: 30_000 });
  await page.goto("/discover?fresh=1");
  await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
});

async function ask(page, text: string) {
  const box = page.locator("textarea").last();
  await box.fill(text);
  await box.press("Enter");
}

/** Mode gate (Phase 1.3): bare queries ask browsing-vs-selling first.
 *  Clicking an option on the single-question panel submits immediately.
 *  NOTE: locator.isVisible() does NOT wait — use waitFor first. */
async function answerJustLooking(page) {
  const looking = page.getByRole("button", { name: /just looking/i }).first();
  await looking.waitFor({ timeout: 20_000 }).catch(() => {});
  if (await looking.isVisible().catch(() => false)) {
    await looking.click();
  }
}

test("two searches keep both turns expandable, none discarded", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await ask(page, "dentists in Pune");
  await answerJustLooking(page);
  // Exact-match correctness: real Pune rows (never Mumbai leakage — the old
  // nearby-fill bug). Assert locality + full page, not a brittle row name.
  await expect(page.getByRole("button", { name: /fold \(50 results\)/i }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Pune, MH, IN", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  await ask(page, "plumbers in Austin");
  await answerJustLooking(page);
  await expect(page.getByRole("button", { name: /fold \(50 results\)/i }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Austin, TX, US", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Both user bubbles present.
  await expect(page.getByText("dentists in Pune", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("plumbers in Austin", { exact: true }).first()).toBeVisible();

  // Old turn folded with an Expand control (data retained, header-only).
  const expand = page.getByRole("button", { name: /Expand \(.*results\)/ }).first();
  await expect(expand).toBeVisible({ timeout: 15_000 });
  await expand.click();
  // After expanding, old results render again without re-searching.
  await expect(page.getByText("Pune, MH, IN", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Legacy discard notice must never appear.
  await expect(page.getByText("run the search again to reload")).toHaveCount(0);

  expect(errors).toEqual([]);
});
