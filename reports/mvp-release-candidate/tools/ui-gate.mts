// Authenticated local Discover run (HARD GATE UI check). Uses the saved
// storage state from auth-capture.mts. Never prints tokens.
//   npx tsx reports/mvp-release-candidate/tools/ui-gate.mts "<query>" <tag> [--mobile] [--takeover] [--headed] [--purpose "Find prospects"]
// Headless by default so a stray window close cannot end the run. --takeover
// exercises Take control / Give control back mid-run and Close browser after.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const [query = "B2B SaaS founders with public contact details", tag = "gate", ...flags] = process.argv.slice(2);
const mobile = flags.includes("--mobile");
const takeover = flags.includes("--takeover");
const headed = flags.includes("--headed");
const purposeIndex = flags.indexOf("--purpose");
const purpose = purposeIndex >= 0 ? flags[purposeIndex + 1] : "Find prospects";
const base = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const state = ".auth/local-user.json";
const dir = "reports/mvp-release-candidate/ui";
mkdirSync(dir, { recursive: true });
if (!existsSync(state)) { console.log("NO_AUTH_STATE run tools/auth-capture.mts first"); process.exit(2); }

const FORBIDDEN = /\b(?:openstreetmap|osm|searxng|geoapify|foursquare|s3|duckdb|supabase|parquet|pg-index|hot-index|saved leads|browser-live|overpass|provider id|adapter)\b/i;
const started = Date.now();
const timeline: Array<{ t: number; event: string }> = [];
const mark = (event: string) => timeline.push({ t: Math.round((Date.now() - started) / 1000), event });
const problems: string[] = [];
const shots: string[] = [];
const activity = new Set<string>();
const streamed: string[] = [];
const control = { tookControl: false, gaveBack: false, retainedClosed: null as boolean | null };
let answered = false;
let sawPending = false;
let settled = false;
let sawMiniBrowser = false;
let scrapyPill = "";
let finalText = "";
let fatal: string | null = null;

const browser = await chromium.launch({ headless: !headed });
browser.on("disconnected", () => mark("browser disconnected"));
const context = await browser.newContext({ storageState: state, viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const page = await context.newPage();
page.on("close", () => mark("page closed"));
page.on("crash", () => mark("page crashed"));
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message.slice(0, 200)}`));
const shot = async (name: string) => { const path = `${dir}/${tag}-${name}.jpg`; await page.screenshot({ path, type: "jpeg", quality: 60, fullPage: false }).catch(() => undefined); shots.push(path); };
const visible = (selector: ReturnType<typeof page.locator>) => selector.first().isVisible().catch(() => false);
const appears = (selector: ReturnType<typeof page.locator>, timeout: number) => selector.first().waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
const scrapyPillButton = () => page.getByRole("button", { name: /Scrapy is browsing|Scrapy browser kept open|You're controlling the browser|Scrapy browser session/i });

try {
  await page.goto(`${base}/discover`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("textarea", { timeout: 90_000 });
  if (/\/auth/.test(page.url())) throw new Error("AUTH_EXPIRED");
  await shot("0-start");
  // One run searched "…founders public contact…" (a word lost before send):
  // verify the composer holds exactly the query, refill once, record it.
  await page.fill("textarea", query);
  let typed = await page.locator("textarea").first().inputValue();
  if (typed !== query) { problems.push(`composer held "${typed.slice(0, 120)}"; refilled`); await page.fill("textarea", query); typed = await page.locator("textarea").first().inputValue(); }
  if (typed !== query) throw new Error(`COMPOSER_MISMATCH ${typed.slice(0, 120)}`);
  await page.click('button[aria-label="Send"]');
  mark("submitted");
  const bubble = await appears(page.getByText(query, { exact: true }), 15_000);
  if (!bubble) problems.push("submitted text not shown verbatim in the conversation");
  let quiet = 0;
  for (let i = 0; i < 180 && !page.isClosed(); i++) {
    await page.waitForTimeout(2_000);
    const body = await page.locator("body").innerText().catch(() => "");
    if (!answered && /What are you trying to do with these results\?/i.test(body)) {
      await shot("1-clarify");
      const option = page.getByRole("button", { name: new RegExp(purpose, "i") }).first();
      if (await option.count()) { await option.click(); answered = true; mark(`answered purpose: ${purpose}`); }
      continue;
    }
    const stopVisible = await visible(page.getByRole("button", { name: /^Stop search$/i }));
    const live = await page.locator('[aria-label="Live research activity"]').innerText().catch(() => "");
    for (const line of live.split("\n").map((l) => l.trim()).filter(Boolean)) activity.add(line);
    if ((stopVisible || live) && !sawPending) { sawPending = true; mark("search running"); }
    const streamedText = await page.locator('[aria-label="Verified while researching"]').innerText().catch(() => "");
    const names = streamedText.split("\n").map((l) => l.replace(/^✓\s*/, "").trim()).filter((l) => l && !/verified while researching/i.test(l));
    if (names.length && !streamed.length) { await shot("2-streamed"); mark("streamed rows visible"); }
    for (const name of names) if (!streamed.includes(name)) streamed.push(name);
    // The mini-browser starts as a collapsed pill; expanding shows the live frame.
    if (!sawMiniBrowser && await visible(scrapyPillButton())) {
      scrapyPill = (await scrapyPillButton().first().innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 160);
      await scrapyPillButton().first().click().catch(() => undefined);
      if (await appears(page.locator('[aria-label="Hide browser"]'), 5_000)) {
        sawMiniBrowser = true;
        mark(`mini-browser expanded (${scrapyPill})`);
        await page.waitForTimeout(1_500);
        await shot("3-mini-browser");
      }
    }
    if (takeover && sawMiniBrowser && !control.tookControl && stopVisible) {
      const take = page.getByRole("button", { name: /Take control/i });
      if (await visible(take)) {
        await take.first().click();
        const giveBack = page.getByRole("button", { name: /Give control back|Stop controlling/i });
        if (await appears(giveBack, 15_000)) {
          control.tookControl = true;
          mark("took control");
          await page.waitForTimeout(1_500);
          await shot("5-takeover");
          await page.waitForTimeout(2_000);
          await giveBack.first().click();
          control.gaveBack = await appears(page.getByRole("button", { name: /Take control/i }), 15_000);
          mark(control.gaveBack ? "gave control back" : "give-back not confirmed");
        } else {
          control.tookControl = false;
          mark("take control not confirmed");
          break;
        }
      }
    }
    const pastClarify = answered || i > 10;
    if (pastClarify && sawPending && !stopVisible && !live) {
      quiet += 1;
      if (quiet >= 2) { settled = true; mark("search settled"); break; }
    } else quiet = 0;
  }
  await page.waitForTimeout(2_000);
  await shot("4-final");
  finalText = await page.locator("body").innerText().catch(() => "");
  if (takeover) {
    if (await visible(scrapyPillButton())) await scrapyPillButton().first().click().catch(() => undefined);
    const close = page.getByRole("button", { name: /Close browser/i });
    if (await appears(close, 10_000)) {
      await close.first().click();
      control.retainedClosed = await close.first().waitFor({ state: "hidden", timeout: 15_000 }).then(() => true).catch(() => false);
      mark(control.retainedClosed ? "retained browser closed" : "close not confirmed");
      await shot("6-closed");
    } else mark("no retained browser to close");
  }
} catch (error) {
  fatal = error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error);
  mark(`error: ${fatal}`);
} finally {
  const lines = [...activity, ...finalText.split("\n")];
  const leakHits = [...new Set(lines.filter((line) => FORBIDDEN.test(line)).map((line) => line.slice(0, 160)))];
  const streamedInFinal = streamed.filter((name) => finalText.includes(name));
  const result = { query, tag, mobile, headless: !headed, durationS: Math.round((Date.now() - started) / 1000), settled, answeredPurpose: answered,
    sawMiniBrowser, scrapyPill, control: takeover ? control : null, streamed, streamedInFinal, activity: [...activity].slice(0, 60), leakHits, problems: problems.slice(0, 10),
    fatal, timeline, screenshots: shots, finalTextSample: finalText.slice(0, 4000) };
  writeFileSync(`${dir}/${tag}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ tag, durationS: result.durationS, settled, answeredPurpose: answered, sawMiniBrowser, control: result.control, streamed: streamed.length,
    streamedInFinal: streamedInFinal.length, leakHits: leakHits.length, problems: problems.length, fatal }));
  await browser.close().catch(() => undefined);
}
