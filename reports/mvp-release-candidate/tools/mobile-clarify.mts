// Task 11: mobile clarification layout evidence without sign-in.
// Renders the real ClarifyPanel (server-side) inside the same wrapper markup
// discover.tsx uses, styles it with the built app CSS, and measures it in
// headless Chromium at phone viewports. Writes PNGs + a JSON summary to
// reports/mvp-release-candidate/ui/.
// usage: npx tsx reports/mvp-release-candidate/tools/mobile-clarify.mts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClarifyPanel } from "../../../src/components/discover/clarify-panel";

const cssDir = ".vercel/output/static/assets";
const cssFile = readdirSync(cssDir).find((name) => name.startsWith("styles-") && name.endsWith(".css"));
if (!cssFile) throw new Error("no built stylesheet; run npm run build first");
const css = readFileSync(join(cssDir, cssFile), "utf8");

const questions = [
  {
    id: "entity_purpose",
    question: "What are you trying to do with these results?",
    options: [
      { id: "prospects", label: "Find prospects to sell to", hint: "Leads for outreach" },
      { id: "partners", label: "Find partners", hint: "Agencies, resellers, collaborators" },
      { id: "hire", label: "Hire or recruit", hint: "Candidates or talent" },
      { id: "research", label: "Market research", hint: "Understand the landscape" },
      { id: "invest", label: "Find companies to invest in", hint: "Deal flow" },
      { id: "suppliers", label: "Find suppliers or vendors", hint: "Providers you would buy from" },
      { id: "competitors", label: "Map competitors", hint: "Who else is in this space" },
      { id: "press", label: "Find press or creators", hint: "Media and outreach" },
    ],
    allowOther: true,
  },
  {
    id: "entity_location",
    question: "Where should I look?",
    options: [{ id: "city", label: "A city" }, { id: "country", label: "A country" }, { id: "anywhere", label: "Anywhere" }],
    allowOther: true,
  },
];
const panel = renderToStaticMarkup(createElement(ClarifyPanel, {
  questions: questions as never,
  refinement: "SaaS founders · any location",
  onApply: () => {},
  onDismiss: () => {},
}));
// Same wrapper as the attached clarification dropdown in discover.tsx, above a composer stand-in.
const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>${css}</style></head><body class="bg-background text-foreground">
<div style="min-height:100dvh;display:flex;flex-direction:column;justify-content:flex-end">
  <div class="px-4 md:px-6 pb-4 md:pb-6 pt-2"><div class="max-w-3xl mx-auto">
    <div id="dropdown" class="mb-2 rounded-2xl border border-primary/25 bg-card shadow-xl">
      <button type="button" class="flex w-full items-center justify-between gap-2 px-4 pt-3 pb-2 text-left"><span class="text-xs font-medium text-primary">Narrow this down <span class="ml-1 text-muted-foreground">2 questions</span></span></button>
      <div class="px-4 pb-4">${panel}</div>
    </div>
    <div id="composer" class="rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground" style="height:96px">Ask Scrapy…</div>
  </div></div>
</div></body></html>`;

const outDir = "reports/mvp-release-candidate/ui";
mkdirSync(outDir, { recursive: true });
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ headless: true });
const results: Record<string, unknown>[] = [];
try {
  for (const viewport of [{ width: 390, height: 844, name: "iphone-390" }, { width: 360, height: 740, name: "android-360" }, { width: 375, height: 667, name: "iphone-se-375" }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    // A string, not a function: tsx injects a __name helper into compiled
    // functions, which does not exist inside the page.
    type Box = { top: number; bottom: number; height: number } | null;
    const metrics = await page.evaluate(`(() => {
      const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
      const byText = (text) => [...document.querySelectorAll("button, p, div, span, h2, h3, label")].find((el) => (el.textContent || "").trim() === text) || null;
      const question = [...document.querySelectorAll("*")].find((el) => el.childElementCount === 0 && /What are you trying to do/.test(el.textContent || "")) || null;
      const primary = byText("Skip") || byText("Search with defaults");
      const scroller = document.querySelector(".overflow-y-auto");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        dropdown: rect(document.querySelector("#dropdown")), question: rect(question), primary: rect(primary), composer: rect(document.querySelector("#composer")),
        options: scroller ? { clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight } : null,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    })()`) as { viewport: { width: number; height: number }; dropdown: Box; question: Box; primary: Box; composer: Box; options: { clientHeight: number; scrollHeight: number } | null; horizontalOverflow: boolean };
    const vh = metrics.viewport.height;
    const inView = (r: { top: number; bottom: number } | null) => !!r && r.top >= 0 && r.bottom <= vh;
    const checks = {
      panelWithin65vh: !!metrics.dropdown && metrics.dropdown.height <= vh * 0.65 + 60, // + header row
      questionVisible: inView(metrics.question),
      primaryActionVisible: inView(metrics.primary),
      optionsScrollInside: !!metrics.options && metrics.options.scrollHeight > metrics.options.clientHeight,
      composerVisible: inView(metrics.composer),
      noHorizontalOverflow: !metrics.horizontalOverflow,
    };
    const shot = `${outDir}/mobile-clarify-${viewport.name}.png`;
    await page.screenshot({ path: shot });
    results.push({ viewport: viewport.name, checks, pass: Object.values(checks).every(Boolean), screenshot: shot, metrics });
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${outDir}/mobile-clarify.json`, JSON.stringify({ stylesheet: cssFile, results }, null, 2));
console.log(JSON.stringify(results.map((r) => ({ viewport: r.viewport, pass: r.pass, checks: r.checks }))));
