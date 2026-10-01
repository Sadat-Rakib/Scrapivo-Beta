// QA-only freeze probe: submit one query in the real UI and measure whether the
// page renderer stays responsive (can we still evaluate JS? do clarifies appear?
// does a search start?). Diagnoses the C01 pre-submit hang. Never touches product code.
//   npx tsx reports/full-e2e-validation/tools/qa-freeze-probe.mts "<query>" [label]
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const query = process.argv[2] ?? "Fintech companies in Toronto with 50 to 200 employees";
const label = process.argv[3] ?? "probe";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const STATE = process.env.QA_STATE ?? ".auth/qa-demo.json";

const browser = await chromium.launch({ headless: true });
const out: Record<string, any> = { query, label, startedAt: new Date().toISOString(), steps: [] };
const step = (s: string, d: any) => { out.steps.push({ s, d, t: Math.round((Date.now() - t0) / 1000) }); console.log(JSON.stringify({ s, d, t: Math.round((Date.now() - t0) / 1000) })); };
const t0 = Date.now();
try {
  const ctx = await Promise.race([browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 900 } }), new Promise<never>((_, r) => setTimeout(() => r(new Error("ctx timeout")), 60_000))]);
  const page = await ctx.newPage();
  step("goto", await page.goto(`${BASE}/discover`, { waitUntil: "domcontentloaded", timeout: 90_000 }).then((r) => r?.status()).catch((e) => `ERR ${String(e).slice(0, 120)}`));
  step("textarea", await page.waitForSelector("textarea", { timeout: 60_000 }).then(() => true).catch(() => false));
  // renderer responsiveness BEFORE submit
  for (const wait of [0, 15_000, 30_000]) {
    if (wait) await page.waitForTimeout(wait);
    step("eval-alive", await Promise.race([page.evaluate(() => 1 + 1), new Promise((r) => setTimeout(() => r("EVAL_HANG"), 10_000))]));
  }
  await page.fill("textarea", query);
  step("filled", (await page.locator("textarea").first().inputValue().catch(() => "INPUTVALUE_HANG")).slice(0, 80));
  await page.click('button[aria-label="Send"]', { timeout: 20_000 }).then(() => step("clicked-send", true)).catch((e) => step("clicked-send", `ERR ${String(e).split("\n")[0].slice(0, 120)}`));
  // watch responsiveness + UI transitions for 3 minutes
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(10_000);
    const evalr = await Promise.race([page.evaluate(() => document.title.length), new Promise((r) => setTimeout(() => r("EVAL_HANG"), 8_000))]);
    const body = await Promise.race([page.locator("body").innerText({ timeout: 5_000 }).catch(() => "BODY_ERR"), new Promise((r) => setTimeout(() => r("BODY_HANG"), 8_000))]);
    const b = typeof body === "string" ? body : "";
    step("poll", {
      evalr,
      narrow: /Narrow this down/i.test(b), pending: /Stop search/i.test(b), clarify: (b.match(/Question \d+ of \d+\s*\n+([^\n]+)/) ?? [])[1]?.slice(0, 80) ?? null,
      thinking: /Thinking|researching|browsing/i.test(b) ? (b.match(/[^\n]*(?:Thinking|researching|browsing)[^\n]*/i) ?? [])[0].slice(0, 90) : null,
      zero: /0 results/i.test(b),
    });
    if (/Narrow this down/i.test(b)) break;
  }
  await page.screenshot({ path: `reports/full-e2e-validation/ui/${label}-freeze-probe.jpg`, type: "jpeg", quality: 55 }).catch(() => undefined);
  await ctx.close().catch(() => undefined);
} catch (e) {
  out.fatal = String(e).split("\n")[0].slice(0, 200);
  console.log(JSON.stringify({ fatal: out.fatal }));
}
out.finishedAt = new Date().toISOString();
writeFileSync(`reports/full-e2e-validation/evidence/${label}-freeze-probe.json`, JSON.stringify(out, null, 2));
await browser.close();
