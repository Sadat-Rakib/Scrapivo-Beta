/**
 * PlaywrightBrowserAdapter — persistent Chromium behind the AgentBrowser
 * interface (research-agent/browser.ts).
 *
 * Why: the CLI adapter spawns one process per action (~1–3s each); a real
 * research run performs dozens of actions. One long-lived browser + one
 * context per session removes that tax, enables in-product screenshots for
 * the Scrapy mini-browser, and keeps the AgentBrowser contract identical.
 * The CLI adapter remains available (SCRAPIVO_BROWSER_ADAPTER=cli).
 *
 * One search run owns one session/context. No anti-bot evasion: blocked or
 * challenged pages surface as friction and the caller moves on.
 */
import {
  EXTRACT_ALL_SEPARATOR,
  type AgentBrowser,
  type BrowserObservation,
  type BrowserSession,
  type ExtractionSchema,
  type ExtractionResult,
  type PageSnapshot,
  type WaitCondition,
} from "./browser";
import { scrapySessionAction, scrapySessionChallenge, scrapySessionFinished, scrapySessionScreenshot, scrapySessionStarted } from "@/lib/search/scrapy-browser.server";
import { frictionOf } from "./page-friction";
import { throwIfAborted } from "@/lib/search/search-run";

const TEXT_SLICE = 18_000;
const LINK_CAP = 80;
const NAV_TIMEOUT_MS = 20_000;

type PlaywrightPage = import("playwright-core").Page;

type AdapterMeta = {
  runId?: string;
  ownerId?: string;
  visible?: boolean;
};

// One browser per process; contexts are per session.
let browserPromise: Promise<import("playwright-core").Browser> | null = null;

async function getBrowser(headless: boolean): Promise<import("playwright-core").Browser> {
  if (!browserPromise) {
    browserPromise = import("playwright-core")
      .then((pw) =>
        pw.chromium
          .launch({ headless, args: ["--disable-blink-features=AutomationControlled"] })
          .then((browser) => {
            // A crashed/closed browser must never stay cached: later rounds
            // would hit "Target page, context or browser has been closed"
            // forever. Reset the promise so the next call relaunches.
            browser.on("disconnected", () => {
              browserPromise = null;
            });
            return browser;
          }),
      )
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export class PlaywrightBrowserAdapter implements AgentBrowser {
  private signal: AbortSignal | null;
  private meta: AdapterMeta;
  private contexts = new Map<string, import("playwright-core").BrowserContext>();
  private pages = new Map<string, PlaywrightPage>();
  private screenshotDirs = new Map<string, string>();
  private screenshotCounts = new Map<string, number>();
  private headless = true;

  constructor(signal?: AbortSignal | null, meta: AdapterMeta = {}) {
    this.signal = signal ?? null;
    this.meta = meta;
    const visibleEnv = process.env.RESEARCH_BROWSER_VISIBLE?.toLowerCase();
    this.headless = !(meta.visible ?? visibleEnv !== "false");
    if (this.signal) {
      this.signal.addEventListener("abort", () => {
        void this.closeAll().catch(() => undefined);
      }, { once: true });
    }
  }

  private check(): void {
    throwIfAborted(this.signal);
  }

  private page(session: BrowserSession): PlaywrightPage {
    const page = this.pages.get(session.id);
    if (!page) throw new Error(`browser session ${session.id} is closed`);
    return page;
  }

  private async buildSnapshot(session: BrowserSession, action: string): Promise<BrowserObservation> {
    this.check();
    const page = this.page(session);
    const url = page.url();
    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText({ timeout: 5_000 })
      .catch(() => page.locator("body").textContent({ timeout: 5_000 }).catch(() => ""));
    const text = (bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_SLICE);
    const links = await page.$$eval("a[href]", (as) =>
      as.slice(0, 400).map((a, i) => {
        const href = (a as HTMLAnchorElement).href;
        const name = (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
        return { i, href, name };
      }).filter((l) => /^https?:\/\//.test(l.href)).slice(0, 80)
        .map((l) => ({ ref: `l${l.i}`, name: l.name || new URL(l.href).hostname, url: l.href })),
    ).catch(() => [] as PageSnapshot["links"]);
    const headings = await page.$$eval("h1, h2, h3", (hs) =>
      hs.slice(0, 12).map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160)).filter(Boolean),
    ).catch(() => [] as string[]);
    const snapshot: PageSnapshot = {
      url,
      title,
      pageType: /error|not found|404/.test(title) ? "error" : "unknown",
      headings,
      visibleRelevantText: text,
      interactiveElements: links.map((l) => ({ ref: l.ref, role: "link", name: l.name, state: [] })),
      links,
      selectedFilters: [],
      loadingState: "complete",
      friction: frictionOf(title, text),
    };
    session.lastSnapshot = snapshot;
    session.counters.pages += 1;
    scrapySessionAction(session.id, { action, url, title, newPage: action !== "Observing" });
    // Workstream F: a challenge on the current page is surfaced to the UI for
    // human takeover — never bypassed.
    scrapySessionChallenge(session.id, snapshot.friction);
    // Scrapy viewer: capture after every meaningful page change. JPEG q45
    // keeps payloads ~30-80KB; failures never block research.
    if (action !== "Observing" && process.env.SCRAPIVO_BROWSER_SCREENSHOTS !== "false") {
      await this.screenshot(session).catch(() => undefined);
    }
    return { snapshot, action, expectedState: null, verified: true };
  }

  async createSession(options?: {
    id?: string;
    visible?: boolean;
    screenshotDirectory?: string;
    limits?: Partial<BrowserSession["limits"]>;
  }): Promise<BrowserSession> {
    this.check();
    const visible = options?.visible ?? !this.headless;
    if (visible) this.headless = false;
    let browser = await getBrowser(this.headless);
    const newContext = () =>
      browser.newContext({
        viewport: { width: 1366, height: 850 },
        userAgent: undefined, // default Playwright UA — no fingerprint spoofing
      });
    let context: import("playwright-core").BrowserContext;
    try {
      context = await newContext();
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      if (!/has been closed|Target page, context/i.test(message)) throw e;
      // The cached browser process died between rounds — relaunch once.
      browserPromise = null;
      browser = await getBrowser(this.headless);
      context = await newContext();
    }
    const id = options?.id ?? `pw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    this.contexts.set(id, context);
    this.pages.set(id, page);
    this.screenshotDirs.set(id, options?.screenshotDirectory ?? `reports/gate2/browser-sessions/${id}`);
    this.screenshotCounts.set(id, 0);
    const session: BrowserSession = {
      id,
      visible,
      createdAt: new Date().toISOString(),
      screenshotDirectory: this.screenshotDirs.get(id)!,
      counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 },
      limits: {
        actions: options?.limits?.actions ?? 400,
        pages: options?.limits?.pages ?? 120,
        scrolls: options?.limits?.scrolls ?? 20,
        screenshots: options?.limits?.screenshots ?? 60,
        reasoningCalls: 0,
      },
      lastSnapshot: null,
    };
    scrapySessionStarted({
      sessionId: id,
      runId: this.meta.runId ?? "",
      ownerId: this.meta.ownerId ?? "",
      adapter: "playwright",
    });
    return session;
  }

  async navigate(session: BrowserSession, url: string): Promise<BrowserObservation> {
    this.check();
    const page = this.page(session);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await page.waitForLoadState("domcontentloaded", { timeout: 4_000 }).catch(() => undefined);
    } catch (e) {
      if (this.signal?.aborted) throw e;
      // A failed navigation is an observation too — the caller degrades.
      return this.buildSnapshot(session, "Navigate failed");
    }
    return this.buildSnapshot(session, "Navigating to result");
  }

  async search(session: BrowserSession, query: string): Promise<BrowserObservation> {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    return this.navigate(session, url);
  }

  /**
   * Organic result links only (e.g. `#b_results .b_algo h2 a`). Refs use the
   * same `l<index>` numbering as snapshots, so `click(ref)` works on them.
   */
  async extractLinks(session: BrowserSession, selector: string, timeoutMs = 5000): Promise<PageSnapshot["links"]> {
    this.check();
    const page = this.page(session);
    await page.waitForSelector(selector, { timeout: Math.max(0, Math.min(timeoutMs, 8_000)) }).catch(() => undefined);
    return page.$$eval("a[href]", (anchors, sel) => anchors
      .map((anchor, index) => ({ anchor: anchor as HTMLAnchorElement, index }))
      .filter(({ anchor }) => { try { return anchor.matches(sel); } catch { return false; } })
      .slice(0, 15)
      .map(({ anchor, index }) => ({ ref: `l${index}`, name: (anchor.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300), url: anchor.href }))
      .filter((link) => /^https?:\/\//.test(link.url)), selector).catch(() => [] as PageSnapshot["links"]);
  }

  async observe(session: BrowserSession): Promise<PageSnapshot> {
    return (await this.buildSnapshot(session, "Observing")).snapshot;
  }

  async click(session: BrowserSession, ref: string): Promise<BrowserObservation> {
    this.check();
    const page = this.page(session);
    const index = Number(/^l(\d+)$/.exec(ref)?.[1] ?? NaN);
    if (!Number.isFinite(index)) throw new Error(`unknown element ref ${ref}`);
    const anchors = await page.$$("a[href]").catch(() => []);
    const anchor = anchors[index];
    if (!anchor) throw new Error(`element ref ${ref} no longer on page`);
    await anchor.click({ timeout: 8_000 }).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded", { timeout: 6_000 }).catch(() => undefined);
    session.counters.actions += 1;
    return this.buildSnapshot(session, "Clicking result");
  }

  async type(session: BrowserSession, ref: string, text: string): Promise<BrowserObservation> {
    this.check();
    const page = this.page(session);
    const index = Number(/^l(\d+)$/.exec(ref)?.[1] ?? NaN);
    const handle = Number.isFinite(index) ? (await page.$$("input, textarea"))[index] : null;
    if (!handle) throw new Error(`input ref ${ref} not found`);
    await handle.fill(text, { timeout: 5_000 }).catch(() => undefined);
    session.counters.actions += 1;
    scrapySessionAction(session.id, { action: "Typing" });
    return this.buildSnapshot(session, "Typing");
  }

  async select(session: BrowserSession, ref: string, value: string): Promise<BrowserObservation> {
    this.check();
    const page = this.page(session);
    const index = Number(/^l(\d+)$/.exec(ref)?.[1] ?? NaN);
    const handle = Number.isFinite(index) ? (await page.$$("select"))[index] : null;
    if (!handle) throw new Error(`select ref ${ref} not found`);
    await handle.selectOption(value).catch(() => undefined);
    session.counters.actions += 1;
    return this.buildSnapshot(session, "Selecting option");
  }

  async scroll(session: BrowserSession, _target: string | null, direction: "up" | "down" | "left" | "right"): Promise<BrowserObservation> {
    this.check();
    const page = this.page(session);
    const dx = direction === "left" ? -600 : direction === "right" ? 600 : 0;
    const dy = direction === "down" ? 600 : direction === "up" ? -600 : 0;
    await page.mouse.wheel(dx, dy).catch(() => undefined);
    await page.waitForTimeout(400);
    session.counters.scrolls += 1;
    return this.buildSnapshot(session, "Scrolling");
  }

  async waitFor(session: BrowserSession, condition: WaitCondition): Promise<BrowserObservation> {
    const page = this.page(session);
    if (condition.selector) await page.waitForSelector(condition.selector, { timeout: condition.timeoutMs ?? 8_000 }).catch(() => undefined);
    else if (condition.text) await page.waitForSelector(`text=${condition.text}`, { timeout: condition.timeoutMs ?? 8_000 }).catch(() => undefined);
    else if (condition.urlIncludes) await page.waitForURL(`**${condition.urlIncludes}**`, { timeout: condition.timeoutMs ?? 10_000 }).catch(() => undefined);
    else await page.waitForTimeout(condition.timeoutMs ?? 1_000);
    return this.buildSnapshot(session, "Waiting");
  }

  async extract(session: BrowserSession, schema: ExtractionSchema): Promise<ExtractionResult> {
    this.check();
    const page = this.page(session);
    const values: Record<string, string | null> = {};
    const errors: string[] = [];
    for (const [name, field] of Object.entries(schema.fields)) {
      try {
        const cap = Math.max(1, Math.min(field.maxChars ?? TEXT_SLICE, 500_000));
        if (field.all && !field.attribute) {
          // Every match (e.g. all JSON-LD blocks), joined by the separator.
          const texts = await page.locator(field.selector).allTextContents().catch(() => [] as string[]);
          const joined = texts.map((text) => text.trim()).filter(Boolean).join(EXTRACT_ALL_SEPARATOR);
          values[name] = joined ? joined.slice(0, cap) : null;
          continue;
        }
        const locator = page.locator(field.selector).first();
        // innerText for visible text; script tags need textContent.
        let value = (await locator.innerText({ timeout: 4_000 }).catch(() => "")) ?? "";
        if (!value) value = (await locator.textContent({ timeout: 2_000 }).catch(() => "")) ?? "";
        if (field.attribute) {
          value = (await locator.getAttribute(field.attribute, { timeout: 2_000 })) ?? "";
        }
        values[name] = value ? value.slice(0, cap) : null;
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        values[name] = null;
      }
    }
    scrapySessionAction(session.id, { action: "Extracting" });
    return { values, sourceUrl: page.url(), observedAt: new Date().toISOString(), errors };
  }

  async screenshot(session: BrowserSession): Promise<string> {
    this.check();
    const page = this.page(session);
    const dir = this.screenshotDirs.get(session.id) ?? `reports/gate2/browser-sessions/${session.id}`;
    const n = (this.screenshotCounts.get(session.id) ?? 0) + 1;
    this.screenshotCounts.set(session.id, n);
    const path = `${dir}/scrapy-${n}.jpg`;
    const { mkdir, writeFile } = await import("node:fs/promises");
    const pathModule = await import("node:path");
    await mkdir(pathModule.dirname(path), { recursive: true }).catch(() => undefined);
    const buffer = await page.screenshot({ type: "jpeg", quality: 45, timeout: 8_000 });
    await writeFile(path, buffer).catch(() => undefined);
    session.counters.screenshots += 1;
    scrapySessionScreenshot(session.id, path);
    return path;
  }

  async close(session: BrowserSession): Promise<void> {
    const context = this.contexts.get(session.id);
    this.contexts.delete(session.id);
    this.pages.delete(session.id);
    await context?.close().catch(() => undefined);
    scrapySessionFinished(session.id, this.signal?.aborted ? "cancelled" : "completed");
  }

  async closeAll(): Promise<void> {
    for (const [, context] of this.contexts) {
      await context.close().catch(() => undefined);
    }
    this.contexts.clear();
    this.pages.clear();
    if (browserPromise) {
      const browser = await browserPromise.catch(() => null);
      await browser?.close().catch(() => undefined);
      browserPromise = null;
    }
  }
}
