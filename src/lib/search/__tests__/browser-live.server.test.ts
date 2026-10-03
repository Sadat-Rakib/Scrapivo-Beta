import { describe, expect, it, vi } from "vitest";
import type { AgentBrowser, PageSnapshot } from "@/lib/research-agent/browser";
import type { SearchSpec } from "../search-spec";
import { discoverWithBrowser, type BrowserExtractedEntity, type BrowserQueryFunnel } from "../browser-live.server";

const spec: SearchSpec = { entity: "person", raw_query: "SaaS founders", criteria: [{ field: "role", value: "founder", stated: true, confidence: 1 }],
  missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "ready_to_search" };
const url = "https://publisher.test/founders";
const text = "SaaS founders. Amina Carter is the founder of Acme, a software-as-a-service company in Toronto. Ben Okafor is the founder of Ledgerly, a software-as-a-service company in Lagos.";

function browser(): AgentBrowser {
  const snap: PageSnapshot = { url, title: "SaaS founders", pageType: "entity_detail", headings: [], visibleRelevantText: text, links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] };
  const observation = () => ({ snapshot: snap, action: "navigate", verified: true });
  return {
    createSession: vi.fn(async () => ({ id: "t", visible: false, createdAt: "", screenshotDirectory: "", counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 1, reasoningCalls: 0 }, limits: { actions: 60, pages: 20, scrolls: 2, screenshots: 1, reasoningCalls: 0 }, lastSnapshot: null })),
    search: vi.fn(async () => ({ snapshot: { ...snap, url: "https://duckduckgo.com/html/?q=x", links: [{ ref: "l0", name: "SaaS founders", url }] }, action: "search", verified: true })),
    navigate: vi.fn(async () => observation()), observe: vi.fn(async () => snap),
    click: vi.fn(async () => observation()), type: vi.fn(async () => observation()), select: vi.fn(async () => observation()),
    scroll: vi.fn(async () => observation()), waitFor: vi.fn(async () => observation()),
    extract: vi.fn(async () => ({ values: { body: text }, sourceUrl: url, observedAt: "", errors: [] })),
    screenshot: vi.fn(async () => ""), close: vi.fn(async () => undefined),
  };
}
const person = (name: string, company: string): BrowserExtractedEntity => {
  const quote = `${name} is the founder of ${company}, a software-as-a-service company`;
  return { page: 0, kind: "person", name, identityQuote: quote, fields: { role: { value: "founder", quote }, company: { value: company, quote } } };
};

describe("progressive row streaming stages", () => {
  it("announces the provisional sighting before any verified claim", async () => {
    const events: Array<{ action: string; rowStatus?: string; title?: string }> = [];
    const rows = await discoverWithBrowser(spec, { browser: browser(), discoveryQueries: ["SaaS founders"], isVerified: (row) => !!row.company,
      extractEntities: async () => [person("Amina Carter", "Acme"), person("Ben Okafor", "Ledgerly")],
      onProgress: (event) => { if (event.row) events.push({ action: event.action, rowStatus: event.row.rowStatus, title: event.row.title }); } });
    expect(rows).toHaveLength(2);
    const found = events.filter((event) => event.action === "Candidate found");
    const verified = events.filter((event) => event.action === "Candidate verified");
    expect(found.map((event) => event.title).sort()).toEqual(["Amina Carter", "Ben Okafor"]);
    expect(found.every((event) => event.rowStatus === "provisional")).toBe(true);
    expect(verified.map((event) => event.title).sort()).toEqual(["Amina Carter", "Ben Okafor"]);
    expect(verified.every((event) => event.rowStatus === "verified")).toBe(true);
    // Each lead's provisional sighting precedes its verified claim.
    for (const title of ["Amina Carter", "Ben Okafor"]) {
      expect(events.findIndex((event) => event.title === title && event.action === "Candidate found"))
        .toBeLessThan(events.findIndex((event) => event.title === title && event.action === "Candidate verified"));
    }
  });

  it("streams only the provisional stage for a lead that never verifies", async () => {
    const events: Array<{ action: string; title?: string }> = [];
    await discoverWithBrowser(spec, { browser: browser(), discoveryQueries: ["SaaS founders"], isVerified: () => false,
      extractEntities: async () => [person("Amina Carter", "Acme")],
      onProgress: (event) => { if (event.row) events.push({ action: event.action, title: event.row.title }); } });
    expect(events).toEqual([{ action: "Candidate found", title: "Amina Carter" }]);
  });
});

describe("per-query discovery funnel (WS1 instrumentation)", () => {
  it("counts every stage for a productive query: serp, links, navigation, extraction, emission", async () => {
    const funnels: BrowserQueryFunnel[] = [];
    const progressFunnels: Array<string | undefined> = [];
    const rows = await discoverWithBrowser(spec, { browser: browser(), discoveryQueries: ["SaaS founders"], isVerified: (row) => !!row.company,
      extractEntities: async () => [person("Amina Carter", "Acme"), person("Ben Okafor", "Ledgerly")],
      onQueryFunnel: (funnel) => funnels.push(funnel),
      onProgress: (event) => { if (event.funnel) progressFunnels.push(event.funnel.stage); } });
    expect(rows).toHaveLength(2);
    // One closed funnel per discovery query, carried on both channels.
    expect(funnels).toHaveLength(1);
    expect(progressFunnels).toEqual(["OK"]);
    const f = funnels[0];
    expect(f.query).toBe("SaaS founders");
    expect(f.passNumber).toBe(1);
    expect(f.engine).toBe("duckduckgo");
    expect(f.serpOk).toBe(1);
    expect(f.serpBlocked).toBe(0);
    expect(f.linksObserved).toBe(1);
    expect(f.linksAccepted).toBe(1);
    expect(f.linksRejected).toBe(0);
    expect(f.pagesScheduled).toBe(1);
    expect(f.pagesNavigated).toBe(1);
    expect(f.navFailed).toBe(0);
    expect(f.pagesExtractable).toBe(1);
    expect(f.extractionEmpty).toBe(0);
    expect(f.entitiesExtracted).toBe(2);
    expect(f.normalizedRows).toBe(2);
    expect(f.emittedRows).toBe(2);
    expect(f.stage).toBe("OK");
    expect(f.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("classifies an empty SERP as SEARCH_EMPTY with serpEmpty counted", async () => {
    const funnels: BrowserQueryFunnel[] = [];
    const b = browser();
    const emptySerp: PageSnapshot = { url: "https://duckduckgo.com/html/?q=x", title: "SaaS founders", pageType: "search_results", headings: [], visibleRelevantText: "No results", links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] };
    b.search = vi.fn(async () => ({ snapshot: emptySerp, action: "search", verified: true }));
    b.navigate = vi.fn(async () => { throw new Error("BING_UNREACHABLE"); });
    const rows = await discoverWithBrowser(spec, { browser: b, discoveryQueries: ["SaaS founders"], extractEntities: async () => [],
      onQueryFunnel: (funnel) => funnels.push(funnel) });
    expect(rows).toHaveLength(0);
    expect(funnels).toHaveLength(1);
    const f = funnels[0];
    expect(f.serpEmpty).toBe(1);
    expect(f.serpOk).toBe(0);
    expect(f.serpBlocked).toBe(0);
    expect(f.linksObserved).toBe(0);
    expect(f.emittedRows).toBe(0);
    expect(f.stage).toBe("SEARCH_EMPTY");
  });
});

describe("staged page allocation (PRD Phase 3 — cap starvation fix)", () => {
  it("prefers direct sites over directories and visits 4 links, not 2", async () => {
    const funnels: BrowserQueryFunnel[] = [];
    const navigated: string[] = [];
    const hosts = ["yelp.com", "publisher1.test", "publisher2.test", "publisher3.test", "publisher4.test", "publisher5.test", "publisher6.test", "publisher7.test", "publisher8.test", "publisher9.test"];
    const pageFor = (host: string, i: number): PageSnapshot => ({
      url: `https://${host}/list-${i}`, title: `SaaS founders ${i}`, pageType: "entity_detail", headings: [],
      visibleRelevantText: `SaaS founders directory ${i}. Dana Vance is the founder of Acme ${i}, a software-as-a-service company in Toronto.`,
      links: [], interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [],
    });
    const b = browser();
    const serp: PageSnapshot = { url: "https://duckduckgo.com/html/?q=x", title: "SaaS founders", pageType: "search_results", headings: [], visibleRelevantText: "results", links: hosts.map((h, i) => ({ ref: `l${i}`, name: `SaaS founders — result ${i}`, url: `https://${h}/list-${i}` })), interactiveElements: [], selectedFilters: [], loadingState: "complete", friction: [] };
    b.search = vi.fn(async () => ({ snapshot: serp, action: "search", verified: true }));
    let lastHostIndex = 0;
    b.navigate = vi.fn(async (...args: unknown[]) => {
      const u = args.map((a) => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object" && "url" in (a as Record<string, unknown>)) return String((a as Record<string, unknown>).url);
        return "";
      }).find((v) => v && !v.includes("duckduckgo")) ?? "";
      lastHostIndex = Math.max(0, hosts.findIndex((h) => u.includes(h)));
      navigated.push(hosts[lastHostIndex]);
      return { snapshot: pageFor(hosts[lastHostIndex], lastHostIndex), action: "navigate", verified: true };
    });
    b.extract = vi.fn(async () => {
      const i = lastHostIndex;
      const name = `Dana Vance ${i}`;
      const quote = `SaaS founders directory ${i}. ${name} is the founder of Acme, a software-as-a-service company in Toronto.`;
      return { values: { body: quote }, sourceUrl: `https://${hosts[i]}/list-${i}`, observedAt: "", errors: [] };
    });
    const rows = await discoverWithBrowser(spec, { browser: b, discoveryQueries: ["SaaS founders"], isVerified: (row) => !!row.company,
      extractEntities: async (pages) => pages.map((p, i) => {
        const name = `Dana Vance ${hosts.findIndex((h) => p.url.includes(h))}`;
        const quote = `SaaS founders directory ${hosts.findIndex((h) => p.url.includes(h))}. ${name} is the founder of Acme, a software-as-a-service company in Toronto.`;
        return { page: i, kind: "person" as const, name, identityQuote: quote, fields: { role: { value: "founder", quote }, company: { value: "Acme", quote } } };
      }),
      onQueryFunnel: (funnel) => funnels.push(funnel) });
    const f = funnels[0];
    console.log("FUNNEL_DEBUG", JSON.stringify(f));
    expect(f.pagesScheduled).toBe(4);
    expect(f.pagesNavigated).toBe(4);
    expect(f.linkRejections.cap).toBe(6);
    // Direct sites fill the first three slots; the directory gets one, last.
    expect(navigated.slice(0, 3).every((h) => !h.includes("yelp"))).toBe(true);
    expect(navigated[3]).toContain("yelp");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("extraction cause telemetry (PRD Phase 1 — P1-C)", () => {
  it("a throwing extractor increments extractor_failed, distinguishable from a clean empty", async () => {
    const funnels: BrowserQueryFunnel[] = [];
    const b = browser();
    // Extraction failures propagate to the caller (evidence-boundary contract)
    // — the funnel still records the cause before the rejection.
    await expect(discoverWithBrowser(spec, { browser: b, discoveryQueries: ["SaaS founders"], isVerified: () => false,
      extractEntities: async () => { throw new Error("provider quota exhausted"); },
      onQueryFunnel: (funnel) => funnels.push(funnel) })).rejects.toThrow("provider quota exhausted");
    const f = funnels[0];
    expect(f.extractionEmpty).toBeGreaterThanOrEqual(1);
    expect(f.extractionCauses.extractor_failed).toBeGreaterThanOrEqual(1);
    expect(f.extractionCauses.model_empty_or_unparsed).toBeUndefined();
    expect(f.stage).toBe("EXTRACTION_EMPTY");
  });

  it("a clean empty extractor stays distinguishable from a failure", async () => {
    const funnels: BrowserQueryFunnel[] = [];
    const b = browser();
    const rows = await discoverWithBrowser(spec, { browser: b, discoveryQueries: ["SaaS founders"], isVerified: () => false,
      extractEntities: async () => [],
      onQueryFunnel: (funnel) => funnels.push(funnel) });
    expect(rows).toEqual([]);
    const f = funnels[0];
    expect(f.extractionEmpty).toBeGreaterThanOrEqual(1);
    expect(f.extractionCauses.extractor_failed).toBeUndefined();
    expect(f.stage).toBe("EXTRACTION_EMPTY");
  });
});
