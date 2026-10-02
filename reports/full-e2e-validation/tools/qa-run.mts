// QA-only live Discover runner for the full E2E pass. Drives the real UI with the
// demo session (.auth/qa-demo.json) and records, per case: the UI timeline, the
// clarify answers, streamed vs final rows, mini-browser/takeover/cancel behaviour,
// toasts, the spec-search server response, and the matching dev-server log lines
// ([spec-run], [candidate-ledger], [browser-live], [qualification-rejected]).
//   npx tsx reports/full-e2e-validation/tools/qa-run.mts <suite.json> [id,id,...]
// Product code is never touched. Never prints credentials or tokens.
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";

const ROOT = "reports/full-e2e-validation";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const STATE = process.env.QA_STATE ?? ".auth/qa-demo.json";
const DEVLOG = `${ROOT}/logs/dev.log`;
const WORKERLOG = `${ROOT}/logs/worker.log`;
const RUNS = `${ROOT}/evidence/runs`;
const UI = `${ROOT}/ui`;
const PROGRESS = `${ROOT}/logs/progress.txt`;
for (const dir of [RUNS, UI, `${ROOT}/logs/runs`]) mkdirSync(dir, { recursive: true });

type Viewport = "desktop" | "mobile" | "m375" | "m360";
type Case = {
  id: string; query: string; category: string; viewport?: Viewport;
  takeover?: boolean; cancel?: "early" | "browsing" | "streaming"; followUp?: string;
  then?: string; prefer?: string; maxMin?: number; detail?: boolean; watch?: boolean; save?: boolean;
};
const suite: Case[] = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
const ACCOUNT_EMAIL = process.env.QA_EMAIL ?? (readFileSync("e2e/ship-it.spec.ts", "utf8").match(/E2E_EMAIL\s*\?\?\s*["'`]([^"'`]+)["'`]/) ?? [])[1] ?? "";
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const browser = await chromium.launch({ headless: true });
const VIEWPORTS: Record<Viewport, Record<string, unknown>> = {
  desktop: { viewport: { width: 1366, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m375: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const size = (path: string) => (existsSync(path) ? statSync(path).size : 0);
function readFrom(path: string, offset: number): string {
  const total = size(path);
  if (total <= offset) return "";
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(total - offset);
  readSync(fd, buf, 0, buf.length, offset);
  closeSync(fd);
  return buf.toString("utf8");
}
const jsonAfter = (line: string, tag: string) => { try { return JSON.parse(line.slice(line.indexOf(tag) + tag.length).trim()); } catch { return null; } };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Server-side evidence for one query from the dev log slice. */
function serverEvidence(slice: string, query: string) {
  const lines = slice.split(/\r?\n/);
  const specs = lines.filter((l) => l.includes("[spec-run]")).map((l) => jsonAfter(l, "[spec-run]")).filter(Boolean) as Array<Record<string, any>>;
  const spec = [...specs].reverse().find((s) => norm(String(s.query ?? "")) === norm(query)) ?? [...specs].reverse().find((s) => norm(String(s.query ?? "")).includes(norm(query).slice(0, 18))) ?? null;
  const runId: string | null = spec?.search_run_id ?? null;
  const mine = runId ? lines.filter((l) => l.includes(runId)) : [];
  const pick = (tag: string) => mine.filter((l) => l.includes(tag)).map((l) => jsonAfter(l, tag)).filter(Boolean) as Array<Record<string, any>>;
  const browserLive = pick("[browser-live]");
  const trace = spec?.retrievalTrace ?? {};
  return {
    runId,
    specRuns: specs.length,
    spec: spec ? {
      query: spec.query, entity: spec.entity, status: spec.status, outcome: spec.outcome,
      criteria: (spec.criteria ?? []).map((c: any) => `${c.field}=${c.value}`),
      retrieved: spec.retrieved, returned: spec.returned, qualified: spec.qualified_count, rejected: spec.rejected,
      pendingEnrichment: spec.pendingEnrichment, liveDiscovery: spec.liveDiscovery, signalRequired: spec.signal_required,
      reason: trace.reason ?? null, timings: trace.timings ?? null, sources: (trace.sources ?? []).map((s: any) => `${s.source}:${s.scanned}/${s.matched}`),
      funnel: { raw: trace.rawCandidates, postSpec: trace.postSpecFilter, researched: trace.researched, complete: trace.complete, qualRejected: trace.qualificationRejected, qualified: trace.qualified },
      sourceHealth: trace.sourceHealth ? { summary: trace.sourceHealth.summary, sources: (trace.sourceHealth.sources ?? []).map((s: any) => `${s.label}:${s.state}`) } : null,
    } : null,
    ledger: pick("[candidate-ledger]").at(-1) ?? null,
    runtime: browserLive.filter((e) => e.action === "runtime").map((e) => ({ requested: e.requested, used: e.used, reason: e.reason })),
    browserDone: browserLive.filter((e) => e.status && e.elapsedMs !== undefined).map((e) => ({ status: e.status, reason: e.reason ?? e.stoppingReason ?? null, candidates: e.candidates, researched: e.researched, verified: e.verified, visited: e.visited, elapsedMs: e.elapsedMs })),
    searches: browserLive.filter((e) => e.action === "search").length,
    qualRejected: pick("[qualification-rejected]").flatMap((e) => (e.candidates ?? []).map((c: any) => `${c.name}: ${c.code}`)).slice(0, 25),
    errors: lines.filter((l) => /\b(Error|TypeError|Unhandled|ECONNRESET|ERR_|FATAL|errno=1455|heap out of memory)\b/.test(l) && !/fallback_reason|SEARXNG_UNREACHABLE|quota exhausted|schema cache/.test(l)).map((l) => l.slice(0, 300)).slice(0, 12),
    aiRouter: [...new Set(lines.filter((l) => l.includes("[ai-router]")).map((l) => l.replace(/held until .*/, "held").slice(0, 160)))].slice(0, 8),
  };
}

async function runCase(c: Case) {
  const viewport = c.viewport ?? "desktop";
  const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms))]);
  const context: BrowserContext = await withTimeout(browser.newContext({ storageState: STATE, ...VIEWPORTS[viewport] }), 90_000, "browser.newContext");
  const page = await withTimeout(context.newPage(), 60_000, "context.newPage");
  page.setDefaultTimeout(45_000);
  const started = Date.now();
  const secs = () => Math.round((Date.now() - started) / 1000);
  const timeline: Array<{ t: number; event: string }> = [];
  const mark = (event: string) => { timeline.push({ t: secs(), event }); };
  const shots: string[] = [];
  // The account email is masked in every screenshot.
  const shot = async (name: string) => { const path = `${UI}/${c.id}-${name}.jpg`; await page.screenshot({ path, type: "jpeg", quality: 55, mask: ACCOUNT_EMAIL ? [page.getByText(ACCOUNT_EMAIL)] : [] }).catch(() => undefined); shots.push(path.replace(`${ROOT}/`, "")); };
  const visible = (loc: ReturnType<Page["locator"]>) => loc.first().isVisible().catch(() => false);
  const appears = (loc: ReturnType<Page["locator"]>, timeout: number) => loc.first().waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
  const consoleLines: string[] = [];
  const pageErrors: string[] = [];
  const toasts = new Set<string>();
  const responses: Array<{ query: string; text: string }> = [];
  page.on("console", (m) => { const t = m.text(); if (/\[ui-projection\]|\[discover\]/.test(t) || m.type() === "error") consoleLines.push(`${m.type()}: ${t.slice(0, 300)}`); });
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 300)));
  page.on("response", async (r) => {
    if (!r.url().includes("/_serverFn/") || r.request().method() !== "POST") return;
    try { await r.finished(); const text = await r.text(); if (text.includes("search_run_id") && text.includes("rows")) responses.push({ query: "", text: text.slice(0, 4_000_000) }); } catch { /* aborted */ }
  });
  const devOffset = size(DEVLOG);
  const workerOffset = size(WORKERLOG);
  const pill = () => page.getByRole("button", { name: /Scrapy is browsing|Scrapy browser kept open|You're controlling the browser|Scrapy browser session/i });
  const result: Record<string, any> = { id: c.id, query: c.query, category: c.category, viewport, startedAt: new Date().toISOString() };

  async function searchOnce(query: string, label: string, opts: { cancel?: Case["cancel"]; takeover?: boolean }) {
    const r: Record<string, any> = { query, clarify: [], streamed: [] as string[], activity: [] as string[] };
    const t0 = Date.now();
    await page.waitForSelector("textarea", { timeout: 90_000 });
    await page.fill("textarea", query);
    const typed = await page.locator("textarea").first().inputValue();
    if (typed !== query) { await page.fill("textarea", query); r.composerRefilled = true; }
    await page.click('button[aria-label="Send"]');
    mark(`${label}: submitted`);
    r.bubbleVerbatim = await appears(page.getByText(query, { exact: true }), 15_000);
    let sawPending = false, quiet = 0, firstStreamT: number | null = null, sawMini = false, answered = 0;
    const activity = new Set<string>();
    const maxIter = Math.round(((c.maxMin ?? Number(process.env.QA_MAX_MIN ?? 9)) * 60) / 2);
    const deadline = t0 + (c.maxMin ?? Number(process.env.QA_MAX_MIN ?? 9)) * 60_000;
    for (let i = 0; i < maxIter && !page.isClosed() && Date.now() < deadline; i++) {
      await page.waitForTimeout(2_000);
      for (const t of await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])) if (t.trim()) toasts.add(t.replace(/\s+/g, " ").trim().slice(0, 240));
      const body = await page.locator("body").innerText().catch(() => "");
      if (/Narrow this down/i.test(body) && answered < 6) {
        if (!answered) { await shot(`${label}-1-clarify`); r.clarifyAt = Math.round((Date.now() - t0) / 1000); }
        const question = (body.match(/Question \d+ of \d+\s*\n+([^\n]+)/) ?? [])[1] ?? "?";
        const lastAsk = r.clarify.length ? r.clarify[r.clarify.length - 1] : null;
        // The panel stays visible while the app processes the previous answer (~60-100 s).
        // A repeat of the same question within 20 s is the processing window, not a re-ask.
        if (lastAsk && question && question === lastAsk.question && Math.round((Date.now() - t0) / 1000) - lastAsk.t < 20) continue;
        const genuineRepeat = !!(lastAsk && question && question === lastAsk.question);
        if (genuineRepeat) { r.clarifyRepeats = (r.clarifyRepeats ?? 0) + 1; if (r.clarifyRepeats >= 3) { r.clarifyStuck = true; mark(`${label}: clarify dead-loop (same question re-asked 3x, no search start)`); break; } }
        else r.clarifyRepeats = 0;
        const preferRe = new RegExp(c.prefer ?? "Find prospects|Find clients|Find customers", "i");
        let target = page.getByRole("button", { name: preferRe });
        if (!(await visible(target))) target = page.getByRole("button", { name: /Recommended/ });
        if (!(await visible(target))) target = page.getByRole("button", { name: /^(Search with defaults|Search)$/ });
        if (!(await visible(target))) target = page.getByRole("button", { name: /^Skip/i });
        const chosen = ((await target.first().innerText().catch(() => "?")) || "?").split("\n")[0].slice(0, 80);
        await target.first().click().catch(() => undefined);
        if (chosen === "?") { r.clarifyUnanswerable = (r.clarifyUnanswerable ?? 0) + 1; if (r.clarifyUnanswerable >= 3) { mark(`${label}: clarify stuck (no answerable control)`); r.clarifyStuck = true; break; } }
        answered++;
        r.clarify.push({ question: question.slice(0, 160), chosen, t: Math.round((Date.now() - t0) / 1000) });
        mark(`${label}: clarify "${question.slice(0, 60)}" -> ${chosen}`);
        continue;
      }
      const stopVisible = await visible(page.getByRole("button", { name: /^Stop search$/i }));
      const live = await page.locator('[aria-label="Live research activity"]').innerText().catch(() => "");
      for (const line of live.split("\n").map((l) => l.trim()).filter(Boolean)) activity.add(line);
      if ((stopVisible || live) && !sawPending) { sawPending = true; mark(`${label}: running`); r.runningAt = Math.round((Date.now() - t0) / 1000); }
      const streamedText = await page.locator('[aria-label="Verified while researching"]').innerText().catch(() => "");
      const names = streamedText.split("\n").map((l) => l.replace(/^✓\s*/, "").trim()).filter((l) => l && !/verified while researching/i.test(l));
      if (names.length && firstStreamT === null) { firstStreamT = Math.round((Date.now() - t0) / 1000); await shot(`${label}-2-streamed`); mark(`${label}: streamed rows visible`); }
      for (const n of names) if (!r.streamed.includes(n)) r.streamed.push(n);
      if (!sawMini && await visible(pill())) {
        r.pill = (await pill().first().innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 160);
        await pill().first().click().catch(() => undefined);
        if (await appears(page.locator('[aria-label="Hide browser"]'), 5_000)) {
          sawMini = true; r.miniBrowserAt = Math.round((Date.now() - t0) / 1000);
          await page.waitForTimeout(1_500);
          await shot(`${label}-3-mini-browser`);
          r.viewingOnly = /Viewing only/i.test(await page.locator("body").innerText().catch(() => ""));
          mark(`${label}: mini-browser (${r.pill})`);
        }
      }
      // Takeover: exclusive control, a safe scroll, give back, agent continues.
      if (opts.takeover && sawMini && stopVisible && !r.takeover) {
        r.takeover = { attempted: true };
        const take = page.getByRole("button", { name: /Take control/i });
        if (await appears(take, 5_000)) {
          const before = await page.locator("body").innerText().catch(() => "");
          await take.first().click();
          const giveBack = page.getByRole("button", { name: /Give control back|Stop controlling/i });
          r.takeover.tookControl = await appears(giveBack, 20_000);
          if (r.takeover.tookControl) {
            const inControl = await page.locator("body").innerText().catch(() => "");
            r.takeover.pausedNotice = /Scrapy is paused/i.test(inControl);
            await shot(`${label}-4-takeover`);
            const scroll = page.getByRole("button", { name: "Scroll down" });
            if (await visible(scroll)) { await scroll.first().click().catch(() => undefined); await page.waitForTimeout(2_500); r.takeover.scrolled = true; }
            r.takeover.errorAfterInput = await page.locator('[role="alert"]').first().innerText().catch(() => "") || null;
            await giveBack.first().click();
            r.takeover.gaveBack = await appears(page.getByRole("button", { name: /Take control/i }), 20_000);
            const pagesBefore = Number((before.match(/(\d+) pages/) ?? [])[1] ?? NaN);
            await page.waitForTimeout(25_000);
            const after = await page.locator("body").innerText().catch(() => "");
            r.takeover.pagesBefore = pagesBefore;
            r.takeover.pagesAfter = Number((after.match(/(\d+) pages/) ?? [])[1] ?? NaN);
            r.takeover.stillRunningAfterGiveBack = await visible(page.getByRole("button", { name: /^Stop search$/i }));
            mark(`${label}: takeover took=${r.takeover.tookControl} gaveBack=${r.takeover.gaveBack}`);
          }
        } else r.takeover.unavailable = r.viewingOnly ? "viewing only" : "no Take control button";
      }
      // Cancel at the requested stage.
      const cancelNow = opts.cancel && !r.cancel && stopVisible && (
        (opts.cancel === "early" && sawPending && Date.now() - t0 > 3_000) ||
        (opts.cancel === "browsing" && sawMini && !names.length) ||
        (opts.cancel === "streaming" && names.length > 0));
      if (cancelNow) {
        const streamedAtCancel = r.streamed.length;
        // Harness fix (final-stabilization): the stop click raced the run's
        // settle — the button can unmount between the visibility probe and the
        // click, and a plain click then waits the full action timeout on a
        // vanished locator. Re-check at click time with a bounded timeout and
        // record a settle-race honestly instead of failing the case.
        const stopBtn = page.getByRole("button", { name: /^Stop search$/i }).first();
        if (await stopBtn.isVisible().catch(() => false)) {
          await stopBtn.click({ timeout: 10_000 });
          mark(`${label}: STOP clicked (${opts.cancel})`);
          r.cancel = { stage: opts.cancel, at: Math.round((Date.now() - t0) / 1000), streamedAtCancel };
        } else {
          mark(`${label}: stop raced the settle (button unmounted before click)`);
          r.cancel = { stage: opts.cancel, raced_settle: true, at: Math.round((Date.now() - t0) / 1000), streamedAtCancel };
        }
        const stopped = await page.getByRole("button", { name: /^Stop search$/i }).first().waitFor({ state: "hidden", timeout: 30_000 }).then(() => true).catch(() => false);
        r.cancel.stopButtonGoneWithin30s = stopped;
        await page.waitForTimeout(25_000);
        const later = (await page.locator('[aria-label="Verified while researching"]').innerText().catch(() => "")).split("\n").filter((l) => l.trim() && !/verified while researching/i.test(l)).length;
        r.cancel.streamedAfter25s = later;
        r.cancel.bodyAfter = (await page.locator("body").innerText().catch(() => "")).slice(0, 1500);
        await shot(`${label}-5-after-cancel`);
        break;
      }
      const past = answered > 0 || i > 10;
      if (past && sawPending && !stopVisible && !live) { if (++quiet >= 2) { mark(`${label}: settled`); r.settled = true; break; } } else quiet = 0;
    }
    r.durationS = Math.round((Date.now() - t0) / 1000);
    r.firstStreamS = firstStreamT;
    r.activity = [...activity].slice(0, 40);
    if (!r.settled && !r.cancel) { r.timedOut = true; mark(`${label}: TIMEOUT`); }
    await page.waitForTimeout(2_000);
    await shot(`${label}-6-final`);
    const finalText = await page.locator("body").innerText().catch(() => "");
    const header = finalText.match(/Results for "([^"]*)"\s*·\s*(\d+) results?/);
    r.header = header ? { query: header[1], count: Number(header[2]) } : null;
    r.leadCards = (await page.locator("[role=button].lead-card-hover").allInnerTexts().catch(() => [])).slice(0, 15).map((t) => t.replace(/\n+/g, " | ").slice(0, 400));
    r.businessCards = (await page.locator("div.w-full.p-4.rounded-xl.border-border.bg-card").allInnerTexts().catch(() => [])).slice(0, 15).map((t) => t.replace(/\n+/g, " | ").slice(0, 400));
    r.zeroText = (finalText.match(/(No (?:verified matches|local businesses) found[^\n]*\n?[^\n]*)/) ?? [])[1] ?? null;
    r.reconciliation = (finalText.match(/([^\n]*(?:streamed|verified while researching)[^\n]*didn[^\n]*|[^\n]*not in the final[^\n]*)/i) ?? [])[1] ?? null;
    r.viewingOnlyFinal = /Viewing only/i.test(finalText);
    r.finalTextSample = finalText.slice(0, 3000);
    return r;
  }

  try {
    await page.goto(`${BASE}/discover`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("textarea", { timeout: 90_000 });
    if (/\/auth/.test(page.url())) throw new Error("AUTH_EXPIRED");
    // Demo account has no project: the onboarding card (and then the guided tour)
    // overlay Discover. Both skips are localStorage-only; keep them in the state file.
    await page.waitForTimeout(2_500);
    let skipped = false;
    const skipSetup = page.getByRole("button", { name: "Skip for now", exact: true });
    if (await visible(skipSetup)) { await skipSetup.first().click(); mark("skipped project setup"); skipped = true; await page.waitForTimeout(1_500); }
    const skipTour = page.getByRole("button", { name: "Skip tour" });
    if (await visible(skipTour)) { await skipTour.first().click(); mark("skipped guided tour"); skipped = true; }
    if (skipped) await context.storageState({ path: STATE }).catch(() => undefined);
    result.main = await searchOnce(c.query, "a", { cancel: c.cancel, takeover: c.takeover });
    // Detail panel for the first result (evidence / Why match inspection).
    if (c.detail !== false && !c.cancel) {
      const card = (await page.locator("[role=button].lead-card-hover").count()) ? page.locator("[role=button].lead-card-hover").first()
        : page.locator("div.w-full.p-4.rounded-xl.border-border.bg-card > button").first();
      if (await visible(card)) {
        await card.click().catch(() => undefined);
        await page.waitForTimeout(3_000);
        await shot("a-7-detail");
        const panel = viewport === "desktop" ? page.locator("div.w-\\[420px\\]").first() : page.locator('[role="dialog"]').first();
        result.detail = ((await panel.innerText().catch(() => "")) || "").replace(/\n+/g, " | ").slice(0, 2500);
        await page.keyboard.press("Escape").catch(() => undefined);
        await page.waitForTimeout(800);
      }
    }
    // Retained browser: Close browser after a takeover case.
    if (c.takeover) {
      if (await visible(pill())) await pill().first().click().catch(() => undefined);
      const close = page.getByRole("button", { name: /Close browser/i });
      if (await appears(close, 10_000)) {
        await close.first().click();
        result.closeBrowser = await close.first().waitFor({ state: "hidden", timeout: 20_000 }).then(() => true).catch(() => false);
        await shot("a-8-closed");
      } else result.closeBrowser = "no retained browser";
      mark(`close browser: ${result.closeBrowser}`);
    }
    // Watch signal from the results header (controlled write; cleaned up by qa-persist).
    if (c.watch) {
      const w = page.getByRole("button", { name: /Watch signal/i });
      if (await visible(w)) { await w.first().click(); await page.waitForTimeout(4_000); result.watchToasts = [...toasts].slice(-3); mark("watch signal clicked"); await shot("a-9-watch"); }
      else result.watch = "no Watch signal button";
    }
    // Save the first lead (controlled write; cleaned up by qa-persist).
    if (c.save) {
      const save = page.locator('button[aria-label="Save lead"]').first();
      if (await visible(save)) {
        result.savedTitle = ((await page.locator("[role=button].lead-card-hover").first().innerText().catch(() => "")).split("\n").find((l) => l.trim().length > 2 && !/^(Person|Company|Job|hot|warm|Verified|Checked|Unverified)$/i.test(l.trim())) ?? "").slice(0, 120);
        await save.click(); await page.waitForTimeout(4_000);
        result.saveToasts = [...toasts].slice(-3);
        mark("save lead clicked");
      } else result.save = "no Save lead button";
    }
    // Follow-up after a cancel: the next query must start cleanly in the same page.
    if (c.followUp) {
      result.followUp = await searchOnce(c.followUp, "b", { cancel: "early" });
    }
    // State isolation: New chat, unrelated query in the same page, then back/refresh/second tab.
    if (c.then) {
      await page.getByRole("button", { name: "New chat" }).first().click().catch(() => undefined);
      await page.waitForTimeout(3_000);
      result.afterNewChat = { textarea: await page.locator("textarea").first().inputValue().catch(() => "?"), header: ((await page.locator("body").innerText().catch(() => "")).match(/Results for "([^"]*)"/) ?? [])[1] ?? null };
      await shot("b-0-new-chat");
      result.second = await searchOnce(c.then, "b", {});
      await page.goBack().catch(() => undefined); await page.waitForTimeout(4_000);
      result.afterBack = { url: page.url().replace(BASE, ""), header: ((await page.locator("body").innerText().catch(() => "")).match(/Results for "([^"]*)"/) ?? [])[1] ?? null };
      await shot("c-back");
      await page.goForward().catch(() => undefined); await page.waitForTimeout(3_000);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined); await page.waitForTimeout(6_000);
      result.afterReload = { url: page.url().replace(BASE, ""), header: ((await page.locator("body").innerText().catch(() => "")).match(/Results for "([^"]*)"/) ?? [])[1] ?? null, runningAgain: await visible(page.getByRole("button", { name: /^Stop search$/i })) };
      await shot("c-reload");
      const tab = await context.newPage();
      await tab.goto(`${BASE}/discover`, { waitUntil: "domcontentloaded" }); await tab.waitForTimeout(5_000);
      result.secondTab = { header: ((await tab.locator("body").innerText().catch(() => "")).match(/Results for "([^"]*)"/) ?? [])[1] ?? null };
      await tab.screenshot({ path: `${UI}/${c.id}-c-second-tab.jpg`, type: "jpeg", quality: 55, mask: ACCOUNT_EMAIL ? [tab.getByText(ACCOUNT_EMAIL)] : [] }).catch(() => undefined);
      await tab.close();
    }
  } catch (error) {
    result.fatal = error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : String(error);
    mark(`fatal: ${result.fatal}`);
    await shot("fatal");
  } finally {
    await page.waitForTimeout(4_000).catch(() => undefined);
    const slice = readFrom(DEVLOG, devOffset);
    writeFileSync(`${ROOT}/logs/runs/${c.id}.devlog.txt`, slice.split(/\r?\n/).filter((l) => /\[(spec-run|candidate-ledger|browser-live|qualification-rejected|live-gapfill|ai-router|spec-flag|persistence)\]|Error|error/.test(l)).map((l) => l.slice(0, 4000)).join("\n"));
    result.server = serverEvidence(slice, c.query);
    if (c.then) result.serverSecond = serverEvidence(slice, c.then);
    if (c.followUp) result.serverFollowUp = serverEvidence(slice, c.followUp);
    result.worker = readFrom(WORKERLOG, workerOffset).split(/\r?\n/).filter((l) => /browser_launch_failed|error|Error/.test(l)).map((l) => l.slice(0, 300)).slice(0, 10);
    result.toasts = [...toasts];
    result.console = consoleLines.slice(0, 15);
    result.pageErrors = pageErrors.slice(0, 10);
    result.timeline = timeline;
    result.screenshots = shots;
    result.durationS = secs();
    const best = responses.sort((a, b) => b.text.length - a.text.length)[0];
    if (best) { writeFileSync(`${RUNS}/${c.id}.response.txt`, best.text); result.responseBytes = best.text.length; }
    writeFileSync(`${RUNS}/${c.id}.json`, JSON.stringify(result, null, 2));
    const m = result.main ?? {};
    const s = result.server?.spec;
    appendFileSync(PROGRESS, `${new Date().toISOString().slice(11, 19)} ${c.id} ${viewport} results=${m.header?.count ?? "-"} streamed=${m.streamed?.length ?? 0} outcome=${s?.outcome ?? "-"} runtime=${(result.server?.runtime ?? []).map((x: any) => x.used).join("/") || "-"} settled=${!!m.settled} cancel=${m.cancel ? "yes" : "-"} ${m.takeover ? `takeover=${m.takeover.tookControl}/${m.takeover.gaveBack}` : ""} secs=${result.durationS}${result.fatal ? ` FATAL=${result.fatal}` : ""}\n`);
    await context.close().catch(() => undefined);
  }
}

console.error(`ONLY=${only ? [...only].join("+") : "ALL"}`);
for (const c of suite) {
  if (only && !only.has(c.id)) continue;
  if (existsSync(`${RUNS}/${c.id}.json`) && !only) continue; // resumable
  console.error(`CASE_START ${c.id}`);
  try { await runCase(c); } catch (e) { console.error(`CASE_CRASH ${c.id}: ${String(e).split("\n")[0].slice(0, 200)}`); }
}
appendFileSync(PROGRESS, `SUITE_DONE ${process.argv[2]}\n`);
await browser.close();
