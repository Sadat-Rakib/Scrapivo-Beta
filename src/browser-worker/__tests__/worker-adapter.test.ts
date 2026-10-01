/**
 * WorkerBrowserAdapter over real HTTP against the real worker routes and real
 * Chromium (addendum 5A-5C). Fixture sites are served on loopback under
 * public-looking hostnames; the test-only guard allowlist is the only way the
 * worker's egress proxy reaches them. Discovery code runs unchanged: it sees
 * the AgentBrowser interface only.
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentBrowser, BrowserSession } from "@/lib/research-agent/browser";
import { WorkerBrowserAdapter } from "@/lib/research-agent/worker-browser.server";
import { WorkerWithFallback, buildAgentBrowserRuntime, type RuntimeInfo } from "@/lib/research-agent/browser-runtime.server";
import { PlaywrightBrowserAdapter } from "@/lib/research-agent/playwright-browser.server";
import { readScrapyBrowserState } from "@/lib/search/scrapy-browser.server";
import { controlScrapyBrowser } from "@/lib/search/scrapy-browser-control.server";
import { discoverWithBrowser, type BrowserExtractedEntity, type BrowserTraceEvent } from "@/lib/search/browser-live.server";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { createUrlGuard } from "../network-guard";
import { createSessionManager, type SessionManager } from "../session-manager";
import { createBrowserRoutes } from "../routes";

const chromiumInstalled = existsSync(join(process.env.LOCALAPPDATA ?? process.env.HOME ?? "", "ms-playwright"));
const TOKEN = "w".repeat(24) + "0123456789abcdefghij";
const OWNER = "owner-adapter";
const html = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const spec: SearchSpec = { entity: "person", raw_query: "B2B SaaS founders with public contact details",
  criteria: [{ field: "role", value: "founder", stated: true, confidence: 1 }],
  missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };

let fixture: Server;
let port = 0;
const hostsSeen = new Set<string>();
let routesServer: Server;
let manager: SessionManager;
let dataDir = "";
const savedEnv: Record<string, string | undefined> = {};
const site = (host: string, path = "/") => `http://${host}:${port}${path}`;

function startFixture(): Promise<void> {
  fixture = createServer((req, res) => {
    const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
    hostsSeen.add(host);
    const path = new URL(req.url ?? "/", "http://fixture").pathname;
    const send = (status: number, body: string) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8" }); res.end(body); };
    if (host === "publisher.test" && path === "/top-saas-founders") {
      return send(200, html("Top 25 B2B SaaS Founder List", `<h1>Top 25 B2B SaaS Founder List</h1>
        <p>Amina Carter is the founder of Acme, a software-as-a-service company in Toronto.</p>
        <p>Read more about <a href="${site("acme.test")}">Acme</a>.</p>`));
    }
    if (host === "publisher.test" && (path === "/slow-list" || path === "/slower-list")) {
      setTimeout(() => send(200, html("Slow list", "<p>Amina Carter is the founder of Acme, a software-as-a-service company.</p>")), path === "/slow-list" ? 4000 : 12_000);
      return;
    }
    if (host === "acme.test" && path === "/") {
      return send(200, html("Acme — reporting software for finance teams", `<h1>Acme</h1>
        <p>Acme builds reporting software for finance teams. Acme is a B2B SaaS company based in Toronto, Ontario.</p>
        <a href="${site("acme.test", "/contact")}">Contact</a>`));
    }
    if (host === "acme.test" && path === "/contact") {
      return send(200, html("Contact Acme", "<h1>Contact Acme</h1><p>Get in touch with our team about pricing, onboarding or support. Offices in Toronto, Ontario.</p>"));
    }
    return send(404, html("Not found", "<p>404</p>"));
  });
  return new Promise((resolve) => fixture.listen(0, "127.0.0.1", () => {
    const address = fixture.address();
    port = typeof address === "object" && address ? address.port : 0;
    resolve();
  }));
}

const founder = (pages: Array<{ text: string }>): BrowserExtractedEntity[] => pages.flatMap((page, index) => {
  const quote = /Amina Carter is the founder of Acme, a software-as-a-service company/.exec(page.text)?.[0];
  return quote ? [{ page: index, kind: "person" as const, name: "Amina Carter", identityQuote: quote,
    fields: { role: { value: "founder", quote }, company: { value: "Acme", quote } } }] : [];
});

describe.skipIf(!chromiumInstalled)("WorkerBrowserAdapter over the real worker (real Chromium)", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    await startFixture();
    dataDir = mkdtempSync(join(tmpdir(), "scrapivo-adapter-test-"));
    // Only the fixture authorities are reachable; every other host fails DNS.
    const guard = createUrlGuard({ resolve: async () => { throw new Error("offline test"); },
      testAllow: new Set([`publisher.test:${port}`, `acme.test:${port}`]) });
    manager = await createSessionManager({ dataDir, maxActive: 2, guard, sweepMs: 60_000 });
    const handle = createBrowserRoutes(manager, TOKEN);
    routesServer = createServer(async (req, res) => { if (!(await handle(req, res))) { res.writeHead(404); res.end(); } });
    await new Promise<void>((resolve) => routesServer.listen(0, "127.0.0.1", () => resolve()));
    for (const key of ["SCRAPIVO_BROWSER_WORKER_URL", "SCRAPIVO_BROWSER_WORKER_TOKEN", "SCRAPIVO_BROWSER_SCREENSHOTS"]) savedEnv[key] = process.env[key];
    process.env.SCRAPIVO_BROWSER_WORKER_URL = `http://127.0.0.1:${(routesServer.address() as { port: number }).port}`;
    process.env.SCRAPIVO_BROWSER_WORKER_TOKEN = TOKEN;
    delete process.env.SCRAPIVO_BROWSER_SCREENSHOTS;
  });
  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await manager?.shutdown();
    routesServer.closeAllConnections();
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => routesServer.close(() => resolve()));
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("runs unchanged discovery through the worker: list page -> company site -> contact page, one retained session", async () => {
    const runId = "run-worker-e2e";
    const rows = await discoverWithBrowser(spec, {
      browser: new WorkerBrowserAdapter(null, { runId, ownerId: OWNER }),
      searchRunId: runId, ownerId: OWNER, visible: false, desiredCount: 1, timeoutMs: 120_000, discoveryQueries: [],
      initialCandidates: [{ kind: "person", title: "Top 25 B2B SaaS Founder List", detail: "Source article", source_url: site("publisher.test", "/top-saas-founders"), source_page_type: "list", entity_resolved: false }],
      isVerified: (row) => row.title === "Amina Carter" && !!row.contact_page_url,
      extractEntities: async (pages) => founder(pages),
    });
    const row = rows.find((item) => item.title === "Amina Carter");
    expect(row, rows.map((item) => item.title).join(",")).toBeDefined();
    expect(row).toMatchObject({ company: "Acme", website_url: site("acme.test").replace(/\/$/, ""), contact_page_url: site("acme.test", "/contact") });
    // Every page was fetched by the worker's Chromium through its egress proxy.
    expect([...hostsSeen]).toEqual(expect.arrayContaining(["publisher.test", "acme.test"]));

    const state = readScrapyBrowserState(runId, OWNER);
    expect(state).toMatchObject({ adapter: "worker", retained: true, status: "completed", controller: "agent" });
    expect(state!.pagesVisited).toBeGreaterThanOrEqual(3);
    expect(state!.lastScreenshotData?.length ?? 0).toBeGreaterThan(1000);
    // One worker session for the whole run, kept open for viewing/takeover.
    expect(manager.list(OWNER)).toHaveLength(1);
    expect(manager.get(state!.sessionId, OWNER).status).toBe("retained");
    // The same session id is the provenance of every browser-observed item.
    const identity = row!.evidence!.find((item) => item.evidence_type === "identity");
    expect(identity?.provenance).toMatchObject({ acquisition: "browser", browser_session_id: state!.sessionId, search_run_id: runId,
      requested_url: site("publisher.test", "/top-saas-founders") });
  });

  it("lets the owner take over the kept-open browser, act in the real page, give it back, and close it", async () => {
    const runId = "run-worker-e2e";
    const { sessionId, lastScreenshotAt } = readScrapyBrowserState(runId, OWNER)!;
    // Another user cannot address it.
    expect(await controlScrapyBrowser(runId, "someone-else", { type: "take" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await controlScrapyBrowser(runId, OWNER, { type: "take" })).toMatchObject({ ok: true, controller: "human", retained: true });
    // The agent is locked out while the person drives.
    await expect(manager.snapshot(sessionId, OWNER)).rejects.toMatchObject({ code: "HUMAN_CONTROL" });
    expect(await controlScrapyBrowser(runId, OWNER, { type: "scroll", deltaY: 300 })).toMatchObject({ ok: true });
    expect(await controlScrapyBrowser(runId, OWNER, { type: "click", x: 640, y: 400 })).toMatchObject({ ok: true });
    const during = readScrapyBrowserState(runId, OWNER)!;
    expect(during.controller).toBe("human");
    expect(during.lastScreenshotAt ?? 0).toBeGreaterThanOrEqual(lastScreenshotAt ?? 0);
    expect(await controlScrapyBrowser(runId, OWNER, { type: "release" })).toMatchObject({ ok: true, controller: "agent" });
    expect((await manager.snapshot(sessionId, OWNER)).url).toContain("acme.test");
    expect(await controlScrapyBrowser(runId, OWNER, { type: "close" })).toMatchObject({ ok: true, closed: true });
    expect(manager.get(sessionId, OWNER).status).toBe("closed");
    expect(readScrapyBrowserState(runId, OWNER)).toMatchObject({ retained: false });
  });

  it("selects the worker through the runtime seam; a run stopped by its time budget keeps results and the browser", async () => {
    const runId = "run-worker-budget";
    const events: BrowserTraceEvent[] = [];
    const previous = process.env.SCRAPIVO_BROWSER_ADAPTER;
    process.env.SCRAPIVO_BROWSER_ADAPTER = "worker";
    let rows: SpecRow[] = [];
    try {
      rows = await discoverWithBrowser(spec, {
        searchRunId: runId, ownerId: OWNER, visible: false, desiredCount: 5, timeoutMs: 6_000, discoveryQueries: [],
        initialCandidates: [{ kind: "person", title: "Top 25 B2B SaaS Founder List", detail: "Source article", source_url: site("publisher.test", "/top-saas-founders"), source_page_type: "list", entity_resolved: false },
          { kind: "person", title: "Slower list", detail: "Source article", source_url: site("publisher.test", "/slower-list"), source_page_type: "list", entity_resolved: false }],
        isVerified: () => false,
        extractEntities: async (pages) => founder(pages),
        onTrace: (event) => events.push(event),
      });
    } finally { if (previous === undefined) delete process.env.SCRAPIVO_BROWSER_ADAPTER; else process.env.SCRAPIVO_BROWSER_ADAPTER = previous; }
    expect(events).toContainEqual({ kind: "runtime", requested: "worker", used: "worker" });
    expect(events.find((event) => event.kind === "done")).toMatchObject({ status: "timeout" });
    expect(rows.some((row) => row.title === "Amina Carter")).toBe(true);
    const state = readScrapyBrowserState(runId, OWNER);
    expect(state).toMatchObject({ adapter: "worker", retained: true, status: "completed" });
    expect(manager.get(state!.sessionId, OWNER).status).toBe("retained");
  });

  it("a cancelled run stops mid-navigation, reads nothing more, and closes (not retains) its session", async () => {
    const runId = "run-worker-cancel";
    const abort = new AbortController();
    const streamed: string[] = [];
    let abortedAt = 0;
    const extractor = vi.fn(async (pages: Array<{ text: string }>) => founder(pages));
    await discoverWithBrowser(spec, {
      browser: new WorkerBrowserAdapter(abort.signal, { runId, ownerId: OWNER }),
      signal: abort.signal, searchRunId: runId, ownerId: OWNER, visible: false, desiredCount: 1, timeoutMs: 60_000, discoveryQueries: [],
      initialCandidates: [{ kind: "person", title: "Slow list", detail: "Source article", source_url: site("publisher.test", "/slow-list"), source_page_type: "list", entity_resolved: false }],
      isVerified: (row) => row.title === "Amina Carter",
      extractEntities: extractor,
      onProgress: (event) => {
        if (event.row) streamed.push(event.row.title);
        // Cancel while the 4-second page is loading in the worker.
        if (event.action === "Navigating to result" && !abortedAt) setTimeout(() => { abortedAt = Date.now(); abort.abort(); }, 300);
      },
    }).catch(() => undefined);
    expect(abortedAt).toBeGreaterThan(0);
    expect(Date.now() - abortedAt).toBeLessThan(3000);
    expect(streamed).toEqual([]);
    expect(extractor).not.toHaveBeenCalled();
    const state = readScrapyBrowserState(runId, OWNER);
    expect(state).toMatchObject({ adapter: "worker", retained: false, status: "cancelled" });
    expect(manager.get(state!.sessionId, OWNER).status).toBe("closed");
    // The new run cleared the previous run's retained session.
    expect(manager.list(OWNER).filter((item) => item.status === "retained")).toEqual([]);
  });
});

describe("worker runtime selection and fallback", () => {
  const fakeLegacy = (): AgentBrowser => {
    const session: BrowserSession = { id: "legacy-1", visible: false, createdAt: "", screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 },
      limits: { actions: 1, pages: 1, scrolls: 1, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null };
    const observation = { snapshot: { url: "https://legacy.test/", title: "legacy", pageType: "unknown" as const, headings: [], visibleRelevantText: "", links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete" as const, friction: [] }, action: "navigate", verified: true };
    return { createSession: vi.fn(async () => session), search: vi.fn(async () => observation), navigate: vi.fn(async () => observation), observe: vi.fn(async () => observation.snapshot),
      click: vi.fn(async () => observation), type: vi.fn(async () => observation), select: vi.fn(async () => observation), scroll: vi.fn(async () => observation), waitFor: vi.fn(async () => observation),
      extract: vi.fn(async () => ({ values: {}, sourceUrl: "", observedAt: "", errors: [] })), screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined) };
  };
  const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
    const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    try { await fn(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  };

  it("falls back to the legacy runtime when the worker is unreachable, and says so", async () => {
    await withEnv({ SCRAPIVO_BROWSER_WORKER_URL: "http://127.0.0.1:9", SCRAPIVO_BROWSER_WORKER_TOKEN: TOKEN }, async () => {
      const reports: RuntimeInfo[] = [];
      const legacy = fakeLegacy();
      const browser = new WorkerWithFallback(new WorkerBrowserAdapter(null, { ownerId: OWNER }), () => legacy, (info) => reports.push(info));
      const session = await browser.createSession({ id: "x" });
      expect(session.id).toBe("legacy-1");
      expect(reports).toEqual([{ requested: "worker", used: "playwright", reason: "WORKER_UNAVAILABLE" }]);
      await browser.navigate(session, "https://legacy.test/");
      expect(legacy.navigate).toHaveBeenCalledTimes(1);
    });
  });

  it("never falls back for a cancelled run", async () => {
    await withEnv({ SCRAPIVO_BROWSER_WORKER_URL: "http://127.0.0.1:9", SCRAPIVO_BROWSER_WORKER_TOKEN: TOKEN }, async () => {
      const abort = new AbortController();
      abort.abort();
      const legacy = fakeLegacy();
      const browser = new WorkerWithFallback(new WorkerBrowserAdapter(abort.signal, { ownerId: OWNER }), () => legacy, () => undefined);
      await expect(browser.createSession({ id: "x" })).rejects.toThrow("SEARCH_CANCELLED");
      expect(legacy.createSession).not.toHaveBeenCalled();
    });
  });

  it("reports an unconfigured worker instead of silently switching runtimes", async () => {
    await withEnv({ SCRAPIVO_BROWSER_ADAPTER: "worker", SCRAPIVO_BROWSER_WORKER_URL: undefined, BROWSER_WORKER_URL: undefined, SCRAPIVO_BROWSER_WORKER_TOKEN: undefined, BROWSER_WORKER_TOKEN: undefined }, async () => {
      const reports: RuntimeInfo[] = [];
      const browser = buildAgentBrowserRuntime(null, { onRuntime: (info) => reports.push(info) });
      expect(browser).toBeInstanceOf(PlaywrightBrowserAdapter);
      expect(reports).toEqual([{ requested: "worker", used: "playwright", reason: "WORKER_UNCONFIGURED" }]);
    });
  });
});
