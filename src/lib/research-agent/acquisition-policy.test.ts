import { describe, expect, it, vi } from "vitest";
import { buildSpec } from "@/lib/search/search-spec";
import type { SpecEntity } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { AgentBrowser, BrowserSession, PageSnapshot } from "./browser";
import { researchCandidatesWithBrowser } from "./browser-research.server";
import { retrievalPlanFromInputs } from "./plan";
import type { ResearchCandidate, RetrievalPlan } from "./types";

function spec(args: { entity?: SpecEntity; signal?: string } = {}) {
  return buildSpec({
    entity: args.entity ?? "business",
    raw_query: args.entity === "person" ? "find founders" : "find local businesses",
    signal_required: !!args.signal,
    signal_types: args.signal ? [args.signal] : [],
    signal_recency: args.signal ? "7d" : null,
    criteria: [
      ...(args.signal ? [{ field: "opportunity", value: args.signal, stated: true, confidence: 1 }] : []),
      { field: "location", value: "Austin", stated: true, confidence: 1 },
    ],
  });
}

function row(id: number, over: Partial<SpecRow> = {}): SpecRow {
  return {
    kind: "business",
    key: `business:${id}`,
    entity_id: `business:${id}`,
    entity_resolved: true,
    page_type: "entity_page",
    title: `Acme ${id}`,
    detail: "Austin · plumbing",
    location: "Austin",
    url: `https://acme${id}.test`,
    complete: true,
    verification_status: "verified",
    ...over,
  };
}

function candidate(rowValue: SpecRow, over: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    id: rowValue.entity_id ?? rowValue.key ?? String(Math.random()),
    row: rowValue,
    state: "READY_FOR_VERIFICATION",
    origin: "stored",
    evidence: [],
    fieldEvidence: [],
    signals: [],
    operationalStatus: "UNKNOWN",
    operationalStatusEvidence: [],
    missingFields: [],
    rejectionReason: null,
    whyMatch: null,
    ...over,
  };
}

function page(text: string, friction: PageSnapshot["friction"] = [], links: PageSnapshot["links"] = []): PageSnapshot {
  return {
    url: "https://acme1.example.test",
    title: "Acme 1",
    pageType: "entity_detail",
    headings: ["Acme 1"],
    visibleRelevantText: text,
    interactiveElements: [],
    links,
    selectedFilters: [],
    loadingState: "complete",
    friction,
    screenshotRef: null,
  };
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const RICH_HTML = `<!doctype html><html><head><title>Acme 1</title></head>
<body><h1>Acme 1</h1><p>Currently operating. Email sales@acme1.example.test.</p></body></html>`;

function fakeBrowser(args: {
  navigate?: (session: BrowserSession, url: string) => Promise<PageSnapshot>;
  search?: (session: BrowserSession, query: string) => Promise<PageSnapshot>;
} = {}): AgentBrowser {
  let sessions = 0;
  const newSession = (): BrowserSession => ({
    id: `s${sessions++}`, visible: false, createdAt: new Date().toISOString(), screenshotDirectory: "/tmp",
    counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 },
    limits: { actions: 20, pages: 10, scrolls: 5, screenshots: 5, reasoningCalls: 0 }, lastSnapshot: null,
  });
  return {
    createSession: async () => newSession(),
    navigate: async (session, url) => {
      session.counters.pages += 1;
      const snapshot = args.navigate ? await args.navigate(session, url) : page("Currently operating. Contact support@acme1.example.test.");
      return { snapshot, action: "navigate", verified: true };
    },
    search: async (session, query) => {
      session.counters.pages += 1;
      return { snapshot: args.search ? await args.search(session, query) : page("Directory results", [], []), action: "search", verified: true };
    },
    observe: async () => page("Currently operating."),
    click: async () => ({ snapshot: page(""), action: "click", verified: true }),
    type: async () => ({ snapshot: page(""), action: "type", verified: true }),
    select: async () => ({ snapshot: page(""), action: "select", verified: true }),
    scroll: async () => ({ snapshot: page(""), action: "scroll", verified: true }),
    waitFor: async () => ({ snapshot: page(""), action: "wait", verified: true }),
    extract: async () => ({ values: {}, sourceUrl: "https://acme1.example.test", observedAt: new Date().toISOString(), errors: [] }),
    screenshot: async (session) => {
      session.counters.screenshots += 1;
      return "/tmp/fixture.jpg";
    },
    close: async () => undefined,
  };
}

async function run(args: {
  browser: AgentBrowser;
  candidates: ResearchCandidate[];
  fetchPage?: (url: string, init?: { signal?: AbortSignal | null }) => Promise<Response>;
  concurrency?: number;
  plan?: RetrievalPlan;
}) {
  return researchCandidatesWithBrowser({
    browser: args.browser,
    sessionId: "fixture",
    plan: args.plan ?? retrievalPlanFromInputs({ spec: spec() }),
    candidates: args.candidates,
    visible: false,
    fetchPage: args.fetchPage,
    concurrency: args.concurrency,
  });
}

describe("HTTP-first acquisition policy", () => {
  it("never calls the browser when HTTP yields sufficient evidence", async () => {
    const fetchPage = vi.fn(async () => htmlResponse(RICH_HTML));
    const browser = fakeBrowser();
    const navigate = vi.spyOn(browser, "navigate");
    const createSession = vi.spyOn(browser, "createSession");
    const result = await run({ browser, fetchPage, candidates: [candidate(row(1))] });
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(result.candidates[0]?.state).toBe("VERIFIED");
    expect(result.candidates[0]?.operationalStatus).toBe("ACTIVE");
    expect(result.candidates[0]?.row.email).toBe("sales@acme1.example.test");
    const decided = result.events.find((event) => event.type === "ACQUISITION_DECIDED");
    expect(decided?.internal.decision).toBe("static_used");
  });

  it("escalates to the browser when HTTP evidence is insufficient", async () => {
    const fetchPage = vi.fn(async () => htmlResponse("<html><body><p>Welcome</p></body></html>"));
    const browser = fakeBrowser();
    const navigate = vi.spyOn(browser, "navigate");
    const result = await run({ browser, fetchPage, candidates: [candidate(row(1))] });
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(result.candidates[0]?.state).toBe("VERIFIED");
    expect(result.candidates[0]?.operationalStatus).toBe("ACTIVE");
  });

  it("goes straight to the browser for rendering-required page classes", async () => {
    const fetchPage = vi.fn(async () => htmlResponse(RICH_HTML));
    const browser = fakeBrowser();
    const navigate = vi.spyOn(browser, "navigate");
    const result = await run({
      browser, fetchPage,
      candidates: [candidate(row(1, { url: "https://www.linkedin.com/company/acme-1" }))],
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(result.candidates[0]?.state).toBe("VERIFIED");
  });
});

describe("read-failure ladder", () => {
  it("retries the browser exactly once, then succeeds via HTTP fallback", async () => {
    let navigateCalls = 0;
    const browser = fakeBrowser({
      navigate: async () => {
        navigateCalls += 1;
        throw new Error("Read page:1");
      },
    });
    // First HTTP read (policy) is insufficient → browser; fallback read succeeds.
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(htmlResponse("<html><body><p>Welcome</p></body></html>"))
      .mockResolvedValueOnce(htmlResponse(RICH_HTML));
    const result = await run({ browser, fetchPage, candidates: [candidate(row(1))] });
    expect(navigateCalls).toBe(2); // first attempt + exactly one retry
    expect(fetchPage).toHaveBeenCalledTimes(2); // policy read + ladder fallback
    expect(result.candidates[0]?.state).toBe("VERIFIED");
    expect(result.candidates[0]?.rejectionReason).toBeNull();
    expect(result.events.some((event) => event.type === "READ_RETRY")).toBe(true);
    expect(result.events.some((event) => event.type === "SOURCE_DEGRADED")).toBe(false);
  });

  it("marks the source degraded and continues with other candidates when both fail", async () => {
    const browser = fakeBrowser({
      navigate: async () => { throw new Error("Read page:1"); },
    });
    const fetchPage = vi.fn(async (url: string) =>
      url.includes("acme1") ? htmlResponse("nope", 500) : htmlResponse(RICH_HTML));
    const result = await run({
      browser, fetchPage,
      candidates: [candidate(row(1)), candidate(row(2))],
    });
    const degraded = result.candidates[0];
    expect(degraded?.state).toBe("UNRESOLVED");
    expect(degraded?.rejectionReason).toBe("source_degraded");
    expect(result.candidates[1]?.state).toBe("VERIFIED");
    const event = result.events.find((eventItem) => eventItem.type === "SOURCE_DEGRADED");
    expect(event?.internal.code).toBe("SOURCE_DEGRADED");
    expect(event?.internal.candidateId).toBe("business:1");
  });

  it("does not retry a degraded source later in the same run", async () => {
    const browser = fakeBrowser({
      navigate: async () => { throw new Error("Read page:1"); },
    });
    const fetchPage = vi.fn(async () => htmlResponse("nope", 500));
    // Two candidates on the SAME registrable domain.
    const result = await run({
      browser, fetchPage,
      candidates: [
        candidate(row(1)),
        candidate(row(2, { entity_id: "business:1b", key: "business:1b", url: "https://www.acme1.test/team" })),
      ],
      concurrency: 1,
    });
    expect(fetchPage).toHaveBeenCalledTimes(2); // ladder fallback for #1, degraded short-circuit (no fetch) for #2
    expect(result.candidates.every((c) => c.rejectionReason === "source_degraded")).toBe(true);
  });
});

describe("candidate concurrency", () => {
  it("caps in-flight work and serializes same-domain candidates", async () => {
    const domainActive = new Map<string, number>();
    const overlaps: string[] = [];
    let totalActive = 0;
    let peak = 0;
    const browser = fakeBrowser({
      navigate: async (session, url) => {
        const domain = new URL(url).hostname.replace(/^www\./, "");
        domainActive.set(domain, (domainActive.get(domain) ?? 0) + 1);
        if ((domainActive.get(domain) ?? 0) > 1) overlaps.push(domain);
        totalActive += 1;
        peak = Math.max(peak, totalActive);
        await new Promise((r) => setTimeout(r, 10));
        totalActive -= 1;
        domainActive.set(domain, (domainActive.get(domain) ?? 1) - 1);
        return page("Currently operating.");
      },
    });
    const fetchPage = async () => htmlResponse("nope", 500); // force browser path for all
    const result = await run({
      browser, fetchPage,
      candidates: [
        candidate(row(1)),
        candidate(row(2, { entity_id: "business:2", key: "business:2", url: "https://www.acme1.test" })),
        candidate(row(3, { entity_id: "business:3", key: "business:3", url: "https://acme1.test/contact" })),
        candidate(row(4, { entity_id: "business:4", key: "business:4", url: "https://beta.test" })),
      ],
      concurrency: 2,
    });
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.every((c) => c.state === "VERIFIED")).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(overlaps).toEqual([]);
  });
});

describe("H14 absence rule in the no_website candidate path", () => {
  const searchPage = page("Directory result", [], [
    { ref: "@e1", name: "Directory", url: "https://yelp.example/listing" },
  ]);

  function noWebsiteBrowser() {
    return fakeBrowser({ search: async () => searchPage });
  }

  it("mints the claim only with all four components present", async () => {
    const browser = noWebsiteBrowser();
    const structured = candidate(row(1, {
      url: null,
      no_website_verification: {
        structured_source_url: "osm:live-osm:1",
        structured_absence: true,
        exact_queries: [],
        official_site_found: null,
      },
    }));
    const result = await run({
      browser,
      candidates: [structured],
      plan: retrievalPlanFromInputs({ spec: spec({ signal: "no_website" }) }),
    });
    const signal = result.candidates[0]?.signals.find((s) => s.type === "NO_WEBSITE");
    expect(signal).toMatchObject({ claim: "website not found after verification", evidenceGrade: "B" });
    expect(result.candidates[0]?.evidence.some((e) => e.evidence_type === "no_website" && e.subject === "business:1")).toBe(true);
    expect(result.events.some((e) => e.type === "ACQUISITION_DECIDED" && e.internal.decision === "absence_verified")).toBe(true);
  });

  it("refuses the claim when the structured listing component is missing", async () => {
    const browser = noWebsiteBrowser();
    const noStructured = candidate(row(1, { url: null }));
    const result = await run({
      browser,
      candidates: [noStructured],
      plan: retrievalPlanFromInputs({ spec: spec({ signal: "no_website" }) }),
    });
    expect(result.candidates[0]?.signals.some((s) => s.type === "NO_WEBSITE")).toBe(false);
    expect(result.events.some((e) => e.type === "ACQUISITION_DECIDED" && e.internal.decision === "absence_unverified")).toBe(true);
  });

  it("refuses the claim when searches reveal a first-party site", async () => {
    const browser = fakeBrowser({
      search: async () => page("Found it", [], [
        { ref: "@e1", name: "Acme 1 official", url: "https://acme1-own.example.test" },
      ]),
    });
    const structured = candidate(row(1, {
      url: null,
      no_website_verification: {
        structured_source_url: "osm:live-osm:1",
        structured_absence: true,
        exact_queries: [],
        official_site_found: null,
      },
    }));
    const result = await run({
      browser,
      candidates: [structured],
      plan: retrievalPlanFromInputs({ spec: spec({ signal: "no_website" }) }),
    });
    expect(result.candidates[0]?.signals.some((s) => s.type === "NO_WEBSITE")).toBe(false);
  });
});
