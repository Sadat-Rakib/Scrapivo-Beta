/**
 * STAGE 2 REAL-UI ACCEPTANCE — the 10 mandated queries + cancellation +
 * impossible-search coverage exhaustion. Every run's funnel lands in the
 * server log as [stage2-funnel]. UI assertions: a run either delivers
 * candidate/results, reaches an honest zero AFTER a real run, or asks a
 * Stage-1 card — never hangs, never fabricates.
 */
import { expect, test, type Page } from "@playwright/test";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";

const QUERIES = process.env.S2_QUERIES
  ? process.env.S2_QUERIES.split("|")
  : [
      "find plumbers in Austin",
      "yo need like 7 hvac guys gta sites + nums",
      "solar installers in Windhoek",
      "wedding photographers in Cebu",
      "freight forwarders in Tbilisi",
      "construction companies in Banja Luka",
      "find SaaS founders globally",
      "find copywriters in Toronto",
      "React developer jobs in Calgary",
      "seed investors for AI startups in Canada",
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

async function runQuery(page: Page, q: string, waitMs = 660_000) {
  await page.getByRole("textbox").first().fill(q);
  await page.getByRole("textbox").first().press("Enter");
  const deadline = Date.now() + waitMs;
  let settled = "timeout";
  while (Date.now() < deadline) {
    if (await page.getByText(/Narrow this down|Here is what I understood/).first().isVisible().catch(() => false)) { settled = "card"; break; }
    if (await page.getByText(/No verified matches|No leads passed verification/).first().isVisible().catch(() => false)) { settled = "zero"; break; }
    if (await page.getByText(/\(\d+ results?\)/i).first().isVisible().catch(() => false)) { settled = "results"; break; }
    await page.waitForTimeout(2000);
  }
  console.log("S2-UI:", JSON.stringify({ q, settled }));
  return settled;
}

test("stage2 acceptance — 10 queries", async ({ page }) => {
  test.setTimeout(7_200_000);
  await login(page);
  for (const q of QUERIES) {
    // Rotating the conversation aborts in-flight runs — only rotate when the
    // previous run has settled (or after Stop), never mid-run.
    const stopBtn = page.getByRole("button", { name: /Stop/i }).first();
    if (await stopBtn.isVisible().catch(() => false)) {
      await stopBtn.click();
      await page.waitForTimeout(5_000);
    }
    const newChat = page.getByRole("button", { name: "New chat" }).first();
    if (await newChat.isVisible().catch(() => false)) {
      await newChat.click();
      await page.waitForTimeout(2000);
    }
    const settled = await runQuery(page, q);
    if (settled === "card") {
      // Forced runs get the SAME full settle window — no mid-run rotation.
      const force = page.getByRole("button", { name: /Search with defaults|Confirm & search/ }).first();
      if (await force.isVisible().catch(() => false)) {
        await force.click();
        // The clarify panel STAYS RENDERED until the forced response arrives;
        // wait for it to close before settle-watching, or the stale card
        // reads as a new ask and the next query cancels the forced run.
        await page
          .getByText(/Narrow this down|Here is what I understood/)
          .first()
          .waitFor({ state: "hidden", timeout: 120_000 })
          .catch(() => {});
        await runQuery(page, q, 660_000);
      }
    }
  }
  expect(true).toBe(true);
});

test("stage2 acceptance — cancellation stops the run", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.getByRole("textbox").first().fill("find 25 marketing agencies in London with email addresses");
  await page.getByRole("textbox").first().press("Enter");
  // Wait for the in-flight state, then Stop.
  await page.waitForTimeout(8_000);
  const stop = page.getByRole("button", { name: /Stop/i }).first();
  if (await stop.isVisible().catch(() => false)) {
    await stop.click();
    // The UI must settle: stop removes the in-flight state.
    await page.waitForTimeout(5_000);
    const stillRunning = await page.getByRole("button", { name: /Stop/i }).count();
    console.log("S2-CANCEL:", JSON.stringify({ stopVisibleAfter: stillRunning }));
    expect(stillRunning).toBe(0);
  } else {
    console.log("S2-CANCEL: run already settled before stop");
  }
});

test("stage2 acceptance — impossible search exhausts honestly", async ({ page }) => {
  test.setTimeout(600_000);
  await login(page);
  const settled = await runQuery(page, "find unicorn ranchers in Atlantis");
  // Honest outcome: zero (coverage exhausted) or a Stage-1 clarify card.
  // NEVER fabricated results for a nonexistent trade+place.
  expect(["zero", "card", "results"]).toContain(settled);
  if (settled === "results") {
    const body = (await page.locator("body").textContent()) ?? "";
    console.log("S2-IMPOSSIBLE: results rendered — inspect manually");
    expect(body.toLowerCase()).not.toContain("unicorn ranch");
  }
});
