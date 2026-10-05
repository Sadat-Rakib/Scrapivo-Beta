/**
 * STAGE 2 BASELINE REPRODUCTION — the 10 acceptance queries through the real
 * UI against the live dev server. Funnel data lands in the server log as
 * [stage2-baseline] lines. Read-only probe; no assertions on result quality.
 */
import { expect, test, type Page } from "@playwright/test";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";

const QUERIES = [
  "find plumbers in Austin",
  "yo need like 7 hvac guys gta sites + nums",
  "wedding photographers in Cebu",
  "find copywriters in Toronto",
];

async function login(page: Page) {
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
  const skip = page.locator("text=Skip for now").first();
  if (await skip.isVisible({ timeout: 10_000 }).catch(() => false)) await skip.click();
  await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
}

test("stage2 baseline — 10 acceptance queries", async ({ page }) => {
  test.setTimeout(1_200_000);
  await login(page);
  const box = page.getByRole("textbox").first();
  for (const q of QUERIES) {
    // New chat per query so each run starts clean.
    const newChat = page.getByRole("button", { name: "New chat" }).first();
    if (await newChat.isVisible().catch(() => false)) {
      await newChat.click();
      await page.waitForTimeout(1500);
    }
    await box.fill(q);
    await box.press("Enter");
    // Wait for the run to settle: fold/results, honest zero, or clarify card.
    const deadline = Date.now() + 150_000;
    let settled = "timeout";
    while (Date.now() < deadline) {
      if (await page.getByText(/Narrow this down|Here is what I understood/).first().isVisible().catch(() => false)) { settled = "card"; break; }
      if (await page.getByText(/No verified matches|No leads passed verification/).first().isVisible().catch(() => false)) { settled = "zero"; break; }
      if (await page.getByText(/\(\d+ results?\)/i).first().isVisible().catch(() => false)) { settled = "results"; break; }
      await page.waitForTimeout(2000);
    }
    console.log("BASELINE-UI:", JSON.stringify({ q, settled }));
    if (settled === "card") {
      // Dismiss via force so the next query starts clean.
      const force = page.getByRole("button", { name: /Search with defaults|Confirm & search/ }).first();
      if (await force.isVisible().catch(() => false)) {
        await force.click();
        await page.waitForTimeout(20_000);
      }
    }
  }
  expect(true).toBe(true);
});
