/**
 * Real-browser E2E: spec-first Discover flow (SPEC_SEARCH_ENABLED=true).
 * Logs in with the synthetic test user, runs the locked prompt battery,
 * and asserts rendered DOM — never unit internals.
 */
import { expect, test } from "@playwright/test";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";

test.beforeEach(async ({ page }) => {
  // Skip onboarding deterministically (legacy browser-wide key + tour keys).
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
  await page.goto("/discover");
  // Fresh users get the onboarding wizard — skip it to reach the composer.
  const skip = page.locator("text=Skip for now").first();
  if (await skip.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await skip.click();
  }
  await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
});

async function ask(page, text: string) {
  // Target the main composer explicitly — when the clarifier is open its
  // "Something else…" field is also a textbox.
  const box = page.locator("textarea").last();
  await box.fill(text);
  await box.press("Enter");
}

test("P2: bare businesses asks exactly category + location", async ({ page }) => {
  await ask(page, "bro i need businesses plz asap");
  // Q1 of 2 proves two missing-slot questions queued (category + location).
  await expect(page.locator("text=What type of businesses").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("text=Question 1 of 2").first()).toBeVisible();
  // No seller defaults.
  await expect(page.locator("text=What do you do?").first()).toHaveCount(0);
});

test("P1: SaaS founders NY searches with zero questions", async ({ page }) => {
  await ask(page, "I need SaaS founders in New York");
  // No clarifier: results or honest empty state appear instead.
  await expect(page.locator("text=Narrow this down").first()).toHaveCount(0, { timeout: 60_000 });
});

test("investors: neutral missing-field questions", async ({ page }) => {
  await ask(page, "I need investors");
  const panel = page.locator("text=Narrow this down").first();
  await expect(panel).toBeVisible({ timeout: 60_000 });
  // Must not assume raising.
  await expect(page.locator("text=your startup").first()).toHaveCount(0);
});

test("bare companies ask industry + location (dynamic count)", async ({ page }) => {
  await ask(page, "yo need companies rn");
  await expect(page.locator("text=Narrow this down").first()).toBeVisible({ timeout: 60_000 });
  // Dropdown header shows the question count (Phase B attached dropdown).
  await expect(page.locator("text=2 questions").first()).toBeVisible({ timeout: 30_000 });
  // Q1 of 2: industry first (panel pages one at a time); location is queued.
  await expect(page.locator("text=Any particular industry").first()).toBeVisible({ timeout: 30_000 });
});

test("answers persist: Q1 answer + Q2 Search runs search, never re-asks", async ({ page }) => {
  await ask(page, "yo find me businesses rn");
  await expect(page.locator("text=What type of businesses").first()).toBeVisible({ timeout: 60_000 });
  // Answer Q1 with an option click, then force-search from Q2.
  await page.locator("button:has-text('Plumbers')").first().click();
  await expect(page.locator("text=Which location").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("button:has-text('Search')").first().click();
  // Must run the search (results or honest empty), never the same questions.
  await expect(page.locator("text=What type of businesses").first()).toHaveCount(0, { timeout: 120_000 });
});

test("build stamp logs to console (footer tag removed in Phase B)", async ({ page }) => {
  const stamps: string[] = [];
  page.on("console", (m) => {
    if (/^\[build\]/.test(m.text())) stamps.push(m.text());
  });
  await page.reload();
  await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => stamps.length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  // No visible build tag anywhere in the UI.
  await expect(page.locator("text=/^build [0-9a-f+]+/")).toHaveCount(0);
});

test("transcript: two turns keep their own outputs", async ({ page }) => {
  await ask(page, "bro i need businesses plz asap");
  await expect(page.locator("text=What type of businesses").first()).toBeVisible({ timeout: 60_000 });
  // Role-known founders hunt: searches canonical DB immediately.
  await ask(page, "yo need founders i can reach out to rn");
  await expect(page.locator("text=Person").first()).toBeVisible({ timeout: 120_000 });
  // First turn persists (append-only transcript) with its bubble intact.
  await expect(page.locator("text=bro i need businesses plz asap").first()).toBeVisible();
});
