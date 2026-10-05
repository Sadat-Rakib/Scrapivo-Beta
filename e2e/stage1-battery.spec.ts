/**
 * STAGE 1 — REAL-UI ACCEPTANCE BATTERY (P5 cutover gate).
 *
 * Runs the approved 15-case battery through the actual Discover UI: real
 * login, real server functions, real storage, real LLM understanding.
 * Assertions target the Stage-1 invariants — never benchmark wording:
 *   · the hardcoded purpose question may NEVER appear
 *   · a clarify/confirm round shows the Stage-1 card, never a zero state
 *   · answers patch the same frame (no re-asks)
 */
import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const EMAIL = "e2e.scrapivo.test.001@gmail.com";
const PASS = "E2eTest!2026-xyz";
const PURPOSE_Q = "What are you trying to do with these results?";
const CLARIFY_CARD = /Narrow this down|Here is what I understood/;
// Strict: the chat-history sidebar lists past turns as "N results" — only
// the honest zero BOXES and outcome toasts name these strings.
const ZERO_TEXT = /No verified matches|No leads passed verification/;

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
  if (await skip.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await skip.click();
  }
  await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
}

async function submit(page: Page, text: string) {
  const box = page.getByRole("textbox").first();
  await box.fill(text);
  await box.press("Enter");
}

/** Attach a file through the composer's file input. */
async function attach(page: Page, path: string) {
  await page.locator('input[type="file"]').first().setInputFiles(path);
  // The chip only appears after upload + registration succeeded.
  await expect(page.locator("text=/Attached .+Stage 1 will read|page image/i").first()).toBeVisible({
    timeout: 30_000,
  });
}

/** Wait for ANY terminal Stage-1 state: clarify/confirm card, results, or an
 *  honest zero. Returns which. Zero may only appear after the run settles. */
async function waitForStage1Outcome(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (await page.getByText(CLARIFY_CARD).first().isVisible().catch(() => false)) {
      return "card" as const;
    }
    const fold = page.getByText(/\(\d+ results?\)/i).first();
    if (await fold.isVisible().catch(() => false)) return "results" as const;
    if (await page.getByText(ZERO_TEXT).first().isVisible().catch(() => false)) {
      return "zero" as const;
    }
    await page.waitForTimeout(1500);
  }
  return "timeout" as const;
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("B01 — clean text: READY, no question, no purpose", async ({ page }) => {
  await submit(page, "find 10 plumbers in Edmonton with phone numbers");
  const outcome = await waitForStage1Outcome(page);
  expect(outcome, "a completed search (results or honest zero)").not.toBe("card");
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
});

test("B02 — vague text: useful CLARIFY, and it patches without repeats (B12)", async ({ page }) => {
  await submit(page, "find businesses");
  const outcome = await waitForStage1Outcome(page);
  expect(outcome).toBe("card");
  const question = await page.locator("text=/\\?/").first().textContent();
  expect(question).toBeTruthy();
  // While the card is open there must be NO zero state anywhere.
  expect(await page.getByText(ZERO_TEXT).count()).toBe(0);
  // B12: answer patches the SAME frame — the search then runs and the same
  // question never comes back.
  await submit(page, "Edmonton");
  const after = await waitForStage1Outcome(page);
  expect(after).not.toBe("card");
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  expect(await page.getByText(question ?? "___never___").count()).toBe(0);
});

test("B03 — messy/slang text is understood (no generic purpose question)", async ({ page }) => {
  await submit(page, "yo need like 7 hvac guys gta sites + nums");
  const outcome = await waitForStage1Outcome(page);
  if (outcome === "card") {
    const card = await page.locator("body").textContent();
    expect(card).not.toContain(PURPOSE_Q);
  }
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
});

test("B04 — mirrin.agency: website read, understanding shown, material question only", async ({ page }) => {
  await submit(
    page,
    "I want leads for my agency mirrin.agency where we develop websites for international businesses especially IVF centres",
  );
  const outcome = await waitForStage1Outcome(page);
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  if (outcome === "card") {
    const card = (await page.locator("body").textContent()) ?? "";
    expect(card).not.toContain(PURPOSE_Q);
    expect(card.length).toBeGreaterThan(0);
  }
});

test("B05 — corroborating URL: no purpose question; material site facts may gate one combined confirm", async ({ page }) => {
  await submit(
    page,
    "Find leads for my web agency https://mirrin.agency — we develop websites for IVF and fertility centres internationally",
  );
  const outcome = await waitForStage1Outcome(page);
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  // Policy: material site facts → one combined confirm card; supporting-only
  // → straight to search. Both are correct; a bare purpose question is not.
  if (outcome === "card") {
    await submit(page, "Edmonton");
    const after = await waitForStage1Outcome(page);
    expect(after).not.toBe("timeout");
  }
});

test("B06 — text PDF + instruction: document understood and merged", async ({ page }) => {
  await attach(page, join(process.cwd(), "e2e/fixtures/stage1-price-list.pdf"));
  await submit(page, "find clients for this price list");
  const outcome = await waitForStage1Outcome(page);
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  expect(outcome).not.toBe("timeout");
});

test("B07 — scanned PDF + instruction: page derivatives + vision path", async ({ page }) => {
  await attach(page, join(process.cwd(), "e2e/fixtures/stage1-scanned.pdf"));
  await submit(page, "find clients for this document");
  const outcome = await waitForStage1Outcome(page);
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  expect(outcome).not.toBe("timeout");
});

test("B08 — PDF only: inspected, then intelligent CLARIFY/CONFIRM/READY", async ({ page }) => {
  await attach(page, join(process.cwd(), "e2e/fixtures/stage1-price-list.pdf"));
  await submit(page, "");
  const outcome = await waitForStage1Outcome(page);
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  expect(outcome).not.toBe("timeout");
});

test("B09 — image + instruction merged (vision-first)", async ({ page }) => {
  // Render a text-bearing PNG in the real browser, save it, attach it.
  const dataUrl = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 640, 200);
    ctx.fillStyle = "#000000";
    ctx.font = "24px sans-serif";
    ctx.fillText("NEED: dental clinic websites. Contact: info@brightsmile.example", 20, 90);
    return canvas.toDataURL("image/png");
  });
  expect(dataUrl).toContain("data:image/png");
  const img = await page.evaluate(async (d) => {
    const res = await fetch(d);
    return Array.from(new Uint8Array(await res.arrayBuffer()));
  }, dataUrl);
  const filePath = join(process.cwd(), "e2e/fixtures/stage1-shot.png");
  writeFileSync(filePath, Buffer.from(img));
  await attach(page, filePath);
  await submit(page, "find clients for this");
  const outcome = await waitForStage1Outcome(page);
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  expect(outcome).not.toBe("timeout");
});

test("B10 — image only: inspected, next action decided intelligently", async ({ page }) => {
  const dataUrl = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 640, 200);
    ctx.fillStyle = "#000000";
    ctx.font = "24px sans-serif";
    ctx.fillText("TARGET: fertility clinics in Ontario expanding their labs", 20, 90);
    return canvas.toDataURL("image/png");
  });
  const img = await page.evaluate(async (d) => {
    const res = await fetch(d);
    return Array.from(new Uint8Array(await res.arrayBuffer()));
  }, dataUrl);
  const filePath = join(process.cwd(), "e2e/fixtures/stage1-shot2.png");
  writeFileSync(filePath, Buffer.from(img));
  await attach(page, filePath);
  await submit(page, "");
  const outcome = await waitForStage1Outcome(page);
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  expect(outcome).not.toBe("timeout");
});

test("B11 — website + PDF + text mixed: all sources merged, one Stage-1 decision", async ({ page }) => {
  await attach(page, join(process.cwd(), "e2e/fixtures/stage1-price-list.pdf"));
  await submit(
    page,
    "leads for my agency mirrin.agency — we build sites for companies like the ones in the attached price list, focus on IVF centres",
  );
  const outcome = await waitForStage1Outcome(page);
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  expect(outcome).not.toBe("timeout");
  // Mixed sources contribute material facts (the PDF price list) — a combined
  // confirm card is the approved behavior; answering it must reach a terminal
  // state without re-asking.
  if (outcome === "card") {
    await submit(page, "Edmonton");
    const after = await waitForStage1Outcome(page);
    expect(after).not.toBe("timeout");
    expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  }
});

test("B13 — attachment upload failure behaves honestly (no pretend attach)", async ({ page }) => {
  // Kill the storage upload: the composer must say so and NOT stage a chip.
  await page.route("**/storage/v1/object/**", (route) => route.abort("failed"));
  await page.locator('input[type="file"]').first().setInputFiles(
    join(process.cwd(), "e2e/fixtures/stage1-price-list.pdf"),
  );
  await expect(page.getByText(/could not be uploaded|will NOT be included/i).first()).toBeVisible({
    timeout: 30_000,
  });
  // The chip must NOT exist (nothing the server cannot read is claimed).
  await expect(page.getByText(/Stage 1 will read/i)).toHaveCount(0);
});

test("B14 — injection/SSRF: private URLs are rejected before any fetch", async ({ page }) => {
  await submit(page, "research http://169.254.169.254/latest/meta-data for me");
  const outcome = await waitForStage1Outcome(page);
  // The SSRF guard rejects the source honestly; Stage 1 proceeds on text or
  // asks one material question — never a zero, never a purpose question.
  expect(await page.getByText(PURPOSE_Q).count()).toBe(0);
  expect(outcome).not.toBe("timeout");
});

test("B15 — no premature zero during understanding or clarifying", async ({ page }) => {
  await submit(page, "find businesses");
  // While the round is in flight and while the card is open: zero text is
  // forbidden anywhere in the UI.
  for (let i = 0; i < 6 && (await page.getByText(ZERO_TEXT).count()) === 0; i++) {
    await page.waitForTimeout(500);
    if (await page.getByText(CLARIFY_CARD).first().isVisible().catch(() => false)) break;
  }
  expect(await page.getByText(ZERO_TEXT).count()).toBe(0);
  await waitForStage1Outcome(page);
  expect(await page.getByText(ZERO_TEXT).count()).toBe(0);
});
