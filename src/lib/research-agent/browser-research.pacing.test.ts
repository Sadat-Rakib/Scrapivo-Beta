import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpec } from "@/lib/search/search-spec";
import type { SpecEntity } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { inspectHostState, resetHostState } from "@/lib/search/domain-pacer.server";
import type { AgentBrowser, BrowserSession, PageSnapshot } from "./browser";
import { researchCandidatesWithBrowser } from "./browser-research.server";
import { retrievalPlanFromInputs } from "./plan";
import type { ResearchCandidate, RetrievalPlan } from "./types";

// Fixtures mirror acquisition-policy.test.ts (kept local so this file stays
// focused on pacer + recognition wiring).

function spec(args: { entity?: SpecEntity } = {}) {
  return buildSpec({
    entity: args.entity ?? "business",
    raw_query: "find local businesses",
    signal_required: false,
    signal_types: [],
    signal_recency: null,
    criteria: [{ field: "location", value: "Austin", stated: true, confidence: 1 }],
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

function snapshot(text: string, friction: PageSnapshot["friction"] = []): PageSnapshot {
  return {
    url: "https://acme1.test/x",
    title: "Acme 1",
    pageType: "entity_detail",
    headings: ["Acme 1"],
    visibleRelevantText: text,
    interactiveElements: [],
    links: [],
    selectedFilters: [],
    loadingState: "complete",
    friction,
    screenshotRef: null,
  };
}

const RICH_HTML = `<!doctype html><html><head><title>Acme 1</title></head>
<body><h1>Acme 1</h1><p>Currently operating. Email sales@acme1.test.</p></body></html>`;
const THIN_HTML = `<!doctype html><html><head><title>Acme 1</title></head><body><p>Acme 1.</p></body></html>`;

function fakeBrowser(navigateSnapshot?: (url: string) => PageSnapshot): AgentBrowser {
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
      return { snapshot: navigateSnapshot ? navigateSnapshot(url) : snapshot("Currently operating."), action: "navigate", verified: true };
    },
    search: async (session, query) => {
      session.counters.pages += 1;
      return { snapshot: snapshot("Directory results"), action: "search", verified: true };
    },
    observe: async () => snapshot("Currently operating."),
    click: async () => ({ snapshot: snapshot(""), action: "click", verified: true }),
    type: async () => ({ snapshot: snapshot(""), action: "type", verified: true }),
    select: async () => ({ snapshot: snapshot(""), action: "select", verified: true }),
    scroll: async () => ({ snapshot: snapshot(""), action: "scroll", verified: true }),
    waitFor: async () => ({ snapshot: snapshot(""), action: "wait", verified: true }),
    extract: async () => ({ values: {}, sourceUrl: "https://acme1.test", observedAt: new Date().toISOString(), errors: [] }),
    screenshot: async () => "/tmp/fixture.jpg",
    close: async () => undefined,
  };
}

async function run(args: {
  browser: AgentBrowser;
  candidates: ResearchCandidate[];
  fetchPage?: (url: string, init?: { signal?: AbortSignal | null }) => Promise<Response>;
  plan?: RetrievalPlan;
}) {
  return researchCandidatesWithBrowser({
    browser: args.browser,
    sessionId: "fixture",
    plan: args.plan ?? retrievalPlanFromInputs({ spec: spec() }),
    candidates: args.candidates,
    visible: false,
    fetchPage: args.fetchPage,
  });
}

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

beforeEach(() => {
  resetHostState();
});

describe("browser research: source recognition wiring", () => {
  it("never contacts a host known to block automated access", async () => {
    const browser = fakeBrowser();
    const navigate = vi.spyOn(browser, "navigate");
    const createSession = vi.spyOn(browser, "createSession");
    const fetchPage = vi.fn(async () => htmlResponse(RICH_HTML));
    const result = await run({
      browser,
      fetchPage,
      candidates: [candidate(row(1, { url: "https://www.linkedin.com/company/acme-123" }))],
    });
    expect(result.candidates[0]!.state).toBe("UNRESOLVED");
    expect(result.candidates[0]!.rejectionReason).toBe("source_blocks_automated_access");
    expect(fetchPage).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    const failed = result.events.find((e) => e.type === "SOURCE_FAILED");
    expect(failed?.message).toContain("blocks automated access");
  });

  it("routes recognized ATS boards to a structured hint instead of browsing", async () => {
    const browser = fakeBrowser();
    const navigate = vi.spyOn(browser, "navigate");
    const fetchPage = vi.fn(async () => htmlResponse(RICH_HTML));
    const result = await run({
      browser,
      fetchPage,
      candidates: [
        candidate(row(1, { url: "https://jobs.lever.co/acme" })),
        candidate(row(2, { url: "https://job-boards.greenhouse.io/acme/jobs/123456" })),
      ],
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    const decided = result.events.filter((e) => e.type === "ACQUISITION_DECIDED" && e.internal.decision === "structured_source_used");
    expect(decided).toHaveLength(2);
    expect(decided[0]!.message).toContain("structured job data");

    const lever = result.candidates[0]!;
    const leverHint = lever.evidence.find((e) => e.extraction_method === "structured_job_source_recognition");
    expect(leverHint?.claim_parameters).toMatchObject({ ats: "lever", board: "acme", source_id: "ats-lever", canonical_job_key: "jobs.lever.co/acme" });

    const greenhouse = result.candidates[1]!;
    const ghHint = greenhouse.evidence.find((e) => e.extraction_method === "structured_job_source_recognition");
    expect(ghHint?.claim_parameters).toMatchObject({ ats: "greenhouse", board: "acme", job_id: "123456", canonical_job_key: "job-boards.greenhouse.io/acme/jobs/123456" });
    // Not a failure: candidates keep their state so the jobs pipeline can use the hint.
    expect(greenhouse.rejectionReason).toBeNull();
  });
});

describe("browser research: host pacing wiring", () => {
  it("fails fast on a Retry-After beyond the wait cap and degrades the host for the run", async () => {
    const browser = fakeBrowser();
    const navigate = vi.spyOn(browser, "navigate");
    const fetchPage = vi.fn(async () => htmlResponse("", 429, { "retry-after": "120" }));
    const result = await run({
      browser,
      fetchPage,
      candidates: [candidate(row(1, { url: "https://acme1.test/a" })), candidate(row(2, { url: "https://acme1.test/b" }))],
    });
    // Exactly one contact with the host; the rest was skipped, not retried.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(result.candidates.map((c) => c.rejectionReason)).toEqual(["source_degraded", "source_degraded"]);
    const degraded = result.events.filter((e) => e.type === "SOURCE_DEGRADED");
    expect(degraded.length).toBeGreaterThanOrEqual(1);
    // Not reported as zero results: candidates come back UNRESOLVED, run completes.
    expect(result.candidates.every((c) => c.state === "UNRESOLVED")).toBe(true);
  });

  it("blocks the host across runs after a captcha challenge and skips without contact", async () => {
    const browser = fakeBrowser((url) => snapshot("Verify you are human.", ["CAPTCHA"]));
    const navigate = vi.spyOn(browser, "navigate");
    const fetchPage = vi.fn(async () => htmlResponse(THIN_HTML));
    const first = await run({
      browser,
      fetchPage,
      candidates: [candidate(row(1, { url: "https://acme1.test/a" }))],
    });
    expect(first.candidates[0]!.rejectionReason).toBe("captcha");
    expect(navigate).toHaveBeenCalledTimes(1);

    // Second run, same process: the host is still blocking — skip, no contact.
    const second = await run({
      browser,
      fetchPage,
      candidates: [candidate(row(2, { url: "https://acme1.test/b" }))],
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(second.candidates[0]!.rejectionReason).toBe("source_degraded");
    const waitEvent = second.events.find((e) => e.type === "SOURCE_DEGRADED");
    expect(waitEvent?.message).toContain("research continued without it");
  });

  it("releases host slots after successful paced fetches", async () => {
    const browser = fakeBrowser();
    const fetchPage = vi.fn(async () => htmlResponse(RICH_HTML));
    const result = await run({
      browser,
      fetchPage,
      candidates: [candidate(row(1, { url: "https://acme1.test/a" })), candidate(row(2, { url: "https://acme1.test/b" }))],
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.candidates.every((c) => c.state === "VERIFIED")).toBe(true);
    expect(inspectHostState("acme1.test").activeRequests).toBe(0);
  });
});
