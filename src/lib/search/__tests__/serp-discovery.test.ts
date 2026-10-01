import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import type { SearchSpec } from "../search-spec";

// Structured search (SearXNG) is down for every test here unless overridden.
const discoverWebFreeFirst = vi.fn(async () => { throw Object.assign(new Error("SEARXNG_UNREACHABLE: fetch failed"), { code: "SOURCE_UNAVAILABLE" }); });
vi.mock("../provider-ladder", () => ({ discoverWebFreeFirst: (...args: unknown[]) => (discoverWebFreeFirst as (...a: unknown[]) => unknown)(...args) }));

const { discoverWithBrowser, resultDestination } = await import("../browser-live.server");
type TraceEvent = import("../browser-live.server").BrowserTraceEvent;

const spec: SearchSpec = { entity: "person", raw_query: "SaaS founders", criteria: [{ field: "role", value: "founder", stated: true, confidence: 1 }, { field: "industry", value: "SaaS", stated: true, confidence: 1 }], missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };
const article = "Top SaaS Founders 2026. Amina Carter is the founder of Acme, a software-as-a-service company in Toronto. She leads a team of forty.";
const good = "https://publisher.test/top-saas-founders";

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return { url: good, title: "Top SaaS Founders", pageType: "entity_detail", headings: [], visibleRelevantText: article, links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [], ...overrides };
}
const DDG_CHALLENGE = "DuckDuckGo Unfortunately, bots use DuckDuckGo too. Please complete the following challenge to confirm this search was made by a human.";

function browserWith(opts: { ddg?: PageSnapshot; bingLinks?: PageSnapshot["links"]; extractLinks?: AgentBrowser["extractLinks"] }): AgentBrowser {
  let current = snapshot();
  const observation = (value: PageSnapshot) => ({ snapshot: value, action: "navigate", verified: true });
  const browser: AgentBrowser = {
    createSession: vi.fn(async (options = {}) => ({ id: options.id ?? "t", visible: false, createdAt: new Date().toISOString(), screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 60, pages: 20, scrolls: 2, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => observation(current = opts.ddg ?? snapshot({ url: "https://duckduckgo.com/html/?q=x", pageType: "search_results", links: [{ ref: "l0", name: "Top SaaS Founders", url: good }] }))),
    navigate: vi.fn(async (_s, url: string) => observation(current = url.includes("bing.com/search")
      ? snapshot({ url, title: "Search", pageType: "search_results", visibleRelevantText: "results", links: opts.bingLinks ?? [] })
      : snapshot({ url }))),
    observe: vi.fn(async () => current),
    click: vi.fn(async () => observation(current)), type: vi.fn(async () => observation(current)), select: vi.fn(async () => observation(current)),
    scroll: vi.fn(async () => observation(current)), waitFor: vi.fn(async () => observation(current)),
    extract: vi.fn(async () => ({ values: { body: current.visibleRelevantText }, sourceUrl: current.url, observedAt: new Date().toISOString(), errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
  if (opts.extractLinks) browser.extractLinks = opts.extractLinks;
  return browser;
}
const bingRedirect = (target: string) => `https://www.bing.com/ck/a?!&&p=abc&u=a1${Buffer.from(target).toString("base64url")}&ntb=1`;
const entity = { page: 0, kind: "person" as const, name: "Amina Carter", identityQuote: "Amina Carter is the founder of Acme, a software-as-a-service company in Toronto.",
  fields: { role: { value: "founder", quote: "Amina Carter is the founder of Acme" }, company: { value: "Acme", quote: "Amina Carter is the founder of Acme" } } };

afterEach(() => { discoverWebFreeFirst.mockClear(); });

describe("SERP result destinations", () => {
  it("drops engine-owned pages even after unwrapping an engine redirect", () => {
    expect(resultDestination(bingRedirect("https://support.microsoft.com/en-us/bing/accessibility-in-bing"), "https://www.bing.com/search?q=x")).toBeNull();
    expect(resultDestination(bingRedirect("https://copilot.cloud.microsoft/"), "https://www.bing.com/search?q=x")).toBeNull();
    expect(resultDestination("https://duckduckgo.com/l/?uddg=" + encodeURIComponent("https://duckduckgo.com/duckduckgo-help-pages/"), "https://duckduckgo.com/html/")).toBeNull();
    expect(resultDestination("https://www.bing.com/images/create/ai-image-generator?FORM=IRPGEN", "https://www.bing.com/search?q=x")).toBeNull();
    expect(resultDestination(bingRedirect("https://www.restaurantji.com/ab/calgary/"), "https://www.bing.com/search?q=x")).toBe("https://www.restaurantji.com/ab/calgary/");
  });
});

describe("browser SERP discovery", () => {
  it("detects a DuckDuckGo bot challenge without extractLinks and falls through to Bing", async () => {
    const events: TraceEvent[] = [];
    const browser = browserWith({
      ddg: snapshot({ url: "https://html.duckduckgo.com/html/?q=x", title: "DuckDuckGo", visibleRelevantText: DDG_CHALLENGE, links: [{ ref: "l0", name: "help", url: "https://duckduckgo.com/about" }] }),
      bingLinks: [{ ref: "l3", name: "Top SaaS Founders", url: bingRedirect(good) }],
    });
    const rows = await discoverWithBrowser(spec, { browser, discoveryQueries: ["\"founder\" SaaS"], onTrace: (event) => events.push(event), extractEntities: async () => [entity] });
    const searches = events.filter((event) => event.kind === "search") as Extract<TraceEvent, { kind: "search" }>[];
    expect(searches.find((event) => event.via === "duckduckgo")?.status).toBe("blocked");
    expect(searches.find((event) => event.via === "bing")?.status).toBe("ok");
    expect(rows.map((row) => row.title)).toEqual(["Amina Carter"]);
  });

  it("uses organic result links and drops results that share no query terms", async () => {
    const browser = browserWith({
      extractLinks: vi.fn(async () => [
        { ref: "l1", name: "Best Buy: Shop Online For Deals", url: "https://www.bestbuy.ca/" },
        { ref: "l2", name: "Top SaaS Founders 2026", url: good },
      ]),
    });
    await discoverWithBrowser(spec, { browser, discoveryQueries: ["\"founder\" SaaS"], extractEntities: async () => [entity] });
    const opened = [...vi.mocked(browser.navigate).mock.calls.map((call) => call[1]), ...vi.mocked(browser.click).mock.calls.map((call) => call[1])];
    expect(opened.some((target) => String(target).includes("bestbuy"))).toBe(false);
    expect(browser.extractLinks).toHaveBeenCalled();
  });

  it("records structured search unavailability once per run instead of re-probing every query", async () => {
    const browser = browserWith({ extractLinks: vi.fn(async () => [{ ref: "l2", name: "Top SaaS Founders", url: good }]) });
    await discoverWithBrowser(spec, { browser, discoveryQueries: ["\"founder\" SaaS", "\"co-founder\" SaaS", "SaaS founder startup"], extractEntities: async () => [] });
    expect(discoverWebFreeFirst).toHaveBeenCalledTimes(1);
  });

  it("allows more than two browser SERP searches per run, within a bounded budget", async () => {
    // Each discovery query surfaces a new founder, so discovery keeps making
    // progress and needs more than the old two-SERP allowance.
    let n = 0;
    const browser = browserWith({ extractLinks: vi.fn(async () => [{ ref: "", name: "SaaS founder list", url: `${good}?n=${++n}` }]) });
    vi.mocked(browser.navigate).mockImplementation(async (_s, url: string) => {
      const id = /n=(\d+)/.exec(url)?.[1] ?? "0";
      return { snapshot: snapshot({ url, visibleRelevantText: `Founder ${id} list. Person${id} Carter is the founder of Acme${id}, a software-as-a-service company in Toronto. More text follows here.` }), action: "navigate", verified: true };
    });
    vi.mocked(browser.extract).mockImplementation(async (_s) => ({ values: { body: vi.mocked(browser.navigate).mock.results.at(-1) ? (await vi.mocked(browser.navigate).mock.results.at(-1)!.value).snapshot.visibleRelevantText : article }, sourceUrl: good, observedAt: new Date().toISOString(), errors: [] }));
    const queries = ["\"founder\" SaaS", "\"co-founder\" SaaS", "SaaS founder startup", "SaaS founders list", "B2B SaaS founder", "SaaS CEO founder"];
    await discoverWithBrowser(spec, { browser, discoveryQueries: queries, isVerified: () => true,
      extractEntities: async (pages) => pages.map((page, index) => {
        const id = /n=(\d+)/.exec(page.url)?.[1] ?? "0";
        const quote = `Person${id} Carter is the founder of Acme${id}, a software-as-a-service company in Toronto.`;
        return { page: index, kind: "person" as const, name: `Person${id} Carter`, identityQuote: quote, fields: { role: { value: "founder", quote }, company: { value: `Acme${id}`, quote } } };
      }) });
    const serps = vi.mocked(browser.search).mock.calls.length;
    expect(serps).toBeGreaterThan(2);
    expect(serps).toBeLessThanOrEqual(8);
  });
});
