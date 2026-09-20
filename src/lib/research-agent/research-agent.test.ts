import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildSpec } from "@/lib/search/search-spec";
import type { SpecEntity } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { AgentBrowserCliAdapter } from "./agent-browser-cli.server";
import type { AgentBrowser, BrowserSession, PageSnapshot } from "./browser";
import { researchCandidatesWithBrowser } from "./browser-research.server";
import { detectOperationalStatus, operationalStatusAccepted } from "./operational-status";
import { ResearchOrchestrator, assertStoredPathUsesNoAI } from "./orchestrator.server";
import { retrievalPlanFromInputs } from "./plan";
import { ResearchSessionRegistry } from "./session.server";
import type { ResearchCandidate, RetrievalPlan, SignalEvidence } from "./types";

function spec(args: {
  entity?: SpecEntity;
  query?: string;
  quantity?: number;
  signal?: string;
  required?: string[];
  category?: string;
} = {}) {
  const entity = args.entity ?? "person";
  return buildSpec({
    entity,
    raw_query: args.query ?? "find founders in Canada",
    signal_required: !!args.signal,
    signal_types: args.signal ? [args.signal] : [],
    signal_recency: args.signal ? "7d" : null,
    criteria: [
      ...(entity === "person" ? [{ field: "role", value: "founder", stated: true, confidence: 1 }] : []),
      ...(entity === "business" ? [{ field: "category", value: args.category ?? "HVAC", stated: true, confidence: 1 }] : []),
      ...(entity === "investor" ? [
        { field: "investor_stage", value: "seed", stated: true, confidence: 1 },
        { field: "investor_sector", value: "SaaS", stated: true, confidence: 1 },
        { field: "investor_check", value: "$10k-$100k", stated: true, confidence: 1 },
      ] : []),
      { field: "location", value: entity === "business" ? "Toronto" : "Canada", stated: true, confidence: 1 },
      ...(args.quantity ? [{ field: "quantity", value: String(args.quantity), stated: true, confidence: 1 }] : []),
      ...(args.required ?? []).map((value) => ({ field: "required_field", value, stated: true, confidence: 1 })),
    ],
  });
}

function row(id: number, kind: SpecRow["kind"] = "person", over: Partial<SpecRow> = {}): SpecRow {
  return {
    kind,
    key: `${kind}:${id}`,
    entity_id: `${kind}:${id}`,
    entity_resolved: true,
    page_type: kind === "person" ? "person_page" : kind === "job" ? "job_posting" : "entity_page",
    title: kind === "person" ? `Founder ${id} — Founder @ Acme ${id}` : `${kind} ${id}`,
    detail: kind === "business" ? "Toronto · Open now · business hours" : "Canada · verified profile",
    location: kind === "business" || kind === "job" ? "Toronto" : "Canada",
    country: "CA",
    category: kind === "business" ? "HVAC" : kind === "company" ? "AI" : null,
    sector: kind === "investor" ? "SaaS" : null,
    stage: kind === "investor" ? "seed" : null,
    check: kind === "investor" ? "$10k-$100k" : null,
    email: `public${id}@example.com`,
    url: `https://entity${id}.example.com`,
    complete: true,
    verification_status: "verified",
    ...over,
  };
}

function currentSignal(type: SignalEvidence["type"]): SignalEvidence {
  return {
    type,
    claim: `${type} verified`,
    sourceUrl: "https://evidence.example.com/current",
    sourceType: "fixture",
    observedAt: "2026-09-20T12:00:00.000Z",
    eventAt: "2026-09-19T12:00:00.000Z",
    freshness: "CURRENT",
    confidence: 0.9,
    evidenceGrade: "A",
    snippetOrObservation: `${type} now`,
  };
}

function browserVerifier(type: SignalEvidence["type"] = "HIRING") {
  return vi.fn(async (_plan: RetrievalPlan, candidates: ResearchCandidate[]) => ({
    candidates: candidates.map((candidate) => ({
      ...candidate,
      state: "VERIFIED" as const,
      signals: [...candidate.signals, currentSignal(type)],
      operationalStatus: candidate.row.kind === "business" ? "ACTIVE" as const : candidate.operationalStatus,
    })),
    pages: candidates.length,
    actions: candidates.length,
    screenshots: candidates.length,
    reasoningCalls: 0,
  }));
}

describe("retrieval plan", () => {
  it("defaults to 10 and preserves rich frame semantics", () => {
    const frame = {
      quantity: { requested: 50, minimum: null, maximum: null, unlimited: false, approximate: false, raw: "50" },
      location: { value: "Calgary", raw: "within 50 km", scope: "within_radius", radius: 50, radius_unit: "km", country_code: "CA", canonical: "Calgary", confidence: 1 },
      target: { role: { value: "founder" }, job_title: null, industry: null, category: null, niche: null, technologies: [{ value: "React" }] },
      organization_context: { company: null },
      relation: { type: { value: "hiring" } },
      evidence: { intent_signal_required: true },
      temporal: { relation: "within_last", window: "7d" },
      constraints: [{ field: "location", negated: true, value: "Edmonton" }],
      required_fields: [{ value: "email" }],
      preferred_fields: [{ value: "phone" }],
      compound: { subgoals: [{ raw: "find founders" }] },
      output: [{ label: null, kind: "table" }],
    } as never;
    const plan = retrievalPlanFromInputs({ spec: spec(), frame });
    expect(plan).toMatchObject({ targetQuantity: 50, explicitQuantity: true, radiusKm: 50, signalRequired: true });
    expect(plan.excludedLocations).toContain("Edmonton");
    expect(plan.requiredFields).toEqual(["email"]);
    expect(plan.technology).toEqual(["React"]);
  });

  it("uses 10 when no quantity is explicit", () => {
    expect(retrievalPlanFromInputs({ spec: spec() }).targetQuantity).toBe(10);
  });
});

describe("operational status", () => {
  it.each([
    ["Open now and accepting customers", "ACTIVE", true],
    ["Temporarily closed", "TEMPORARILY_CLOSED", false],
    ["Permanently closed", "PERMANENTLY_CLOSED", false],
    ["Company dissolved", "INACTIVE", false],
    ["No status shown", "UNKNOWN", true],
  ] as const)("classifies %s", (text, expected, accepted) => {
    const status = detectOperationalStatus([text]);
    expect(status).toBe(expected);
    expect(operationalStatusAccepted(status)).toBe(accepted);
  });
});

describe("research orchestrator quantity and lifecycle", () => {
  it("returns first 10 of 15 static stored rows without live or browser work", async () => {
    const liveSearch = vi.fn();
    const browserResearch = vi.fn();
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: Array.from({ length: 15 }, (_, index) => row(index)), hasMore: false, source: "fixture-index" }),
      liveSearch,
      browserResearch,
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: spec() }) });
    expect(result.candidates).toHaveLength(10);
    expect(result.needsMore).toBe(true);
    expect(liveSearch).not.toHaveBeenCalled();
    expect(browserResearch).not.toHaveBeenCalled();
    assertStoredPathUsesNoAI(result.metrics);
  });

  it("continues live when stored has only 6", async () => {
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: Array.from({ length: 6 }, (_, index) => row(index)), hasMore: false, source: "fixture-index" }),
      liveSearch: async () => ({ rows: Array.from({ length: 4 }, (_, index) => row(100 + index)), exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: spec() }) });
    expect(result.candidates).toHaveLength(10);
    expect(result.metrics.liveDiscovered).toBe(4);
  });

  it("respects explicit quantity 50", async () => {
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: Array.from({ length: 50 }, (_, index) => row(index)), hasMore: false, source: "fixture-index" }),
      liveSearch: vi.fn(),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: spec({ quantity: 50 }) }) });
    expect(result.candidates).toHaveLength(50);
    expect(result.plan.explicitQuantity).toBe(true);
  });

  it("enriches only missing required fields", async () => {
    const seen: string[][] = [];
    const plan = retrievalPlanFromInputs({ spec: spec({ required: ["email"] }) });
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [row(1, "person", { email: null })], hasMore: false, source: "fixture-index" }),
      enrich: async (candidate, _plan, args) => {
        seen.push(args.missingFields);
        return { ...candidate, email: "published@example.com" };
      },
      liveSearch: async () => ({ rows: Array.from({ length: 9 }, (_, index) => row(10 + index)), exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan });
    expect(seen).toEqual([["email"]]);
    expect(result.candidates.some((candidate) => candidate.row.email === "published@example.com")).toBe(true);
  });

  it("runs current verification even when stored supply is high", async () => {
    const browserResearch = browserVerifier("HIRING");
    const searchSpec = spec({ signal: "hiring" });
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: Array.from({ length: 12 }, (_, index) => row(index)), hasMore: false, source: "fixture-index" }),
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch,
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: searchSpec }) });
    expect(browserResearch).toHaveBeenCalled();
    expect(result.candidates).toHaveLength(10);
    expect(result.candidates.every((candidate) => candidate.signals.some((signal) => signal.type === "HIRING"))).toBe(true);
  });

  it("rejects closed local businesses", async () => {
    const plan = retrievalPlanFromInputs({ spec: spec({ entity: "business" }) });
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [row(1, "business", { detail: "Toronto · Permanently closed" })], hasMore: false, source: "fixture-index" }),
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan });
    expect(result.candidates).toHaveLength(0);
    expect(result.metrics.rejected).toBe(1);
  });

  it.each([
    ["wrong role", spec(), row(1, "person", { title: "Copywriter — Copywriter @ Acme", detail: "Canada" })],
    ["wrong country", spec(), row(1, "person", { location: "United States", country: "US", detail: "United States" })],
    ["wrong category", spec({ entity: "business" }), row(1, "business", { category: "Plumber" })],
  ])("rejects %s false positives", async (_label, searchSpec, candidate) => {
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [candidate as SpecRow], hasMore: false, source: "fixture-index" }),
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: searchSpec as ReturnType<typeof spec> }) });
    expect(result.candidates).toHaveLength(0);
    expect(result.metrics.rejected).toBe(1);
  });

  it("applies structured excluded-location filters", async () => {
    const searchSpec = spec();
    searchSpec.criteria.push({ field: "excluded_location", value: "Toronto", stated: true, confidence: 1 });
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [row(1, "person", { location: "Toronto", detail: "Founder · Toronto · Canada" })], hasMore: false, source: "fixture-index" }),
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: searchSpec }) });
    expect(result.candidates).toHaveLength(0);
  });

  it("does not deliver a candidate missing an explicitly required contact", async () => {
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [row(1, "person", { email: null, phone: null, url: null })], hasMore: false, source: "fixture-index" }),
      enrich: async (candidate) => candidate,
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: spec({ required: ["email"] }) }) });
    expect(result.candidates).toHaveLength(0);
  });

  it("continues without returning duplicates", async () => {
    const all = Array.from({ length: 15 }, (_, index) => row(index));
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async (_plan, args) => ({ rows: all.slice(args.offset, args.offset + 20), hasMore: args.offset + 20 < all.length, source: "fixture-index" }),
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const plan = retrievalPlanFromInputs({ spec: spec() });
    const first = await orchestrator.run({ plan });
    const second = await orchestrator.run({ plan, continuationToken: first.continuationToken });
    expect(first.candidates).toHaveLength(10);
    expect(second.candidates).toHaveLength(5);
    expect(second.candidates.some((candidate) => first.candidates.some((prior) => prior.id === candidate.id))).toBe(false);
  });

  it("cancellation preserves already-ready candidates", async () => {
    const controller = new AbortController();
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [row(1), row(2)], hasMore: false, source: "fixture-index" }),
      liveSearch: async () => {
        controller.abort();
        throw new Error("SEARCH_CANCELLED");
      },
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan: retrievalPlanFromInputs({ spec: spec() }), signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.candidates).toHaveLength(2);
    expect(result.events.some((event) => event.type === "CANCELLED")).toBe(true);
  });
});

describe("research session event stream", () => {
  it("runs same orchestrator library and exposes truthful SSE events", async () => {
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: Array.from({ length: 10 }, (_, index) => row(index)), hasMore: false, source: "fixture-index" }),
      liveSearch: vi.fn(),
      browserResearch: vi.fn(),
    });
    const registry = new ResearchSessionRegistry(orchestrator);
    const started = registry.start({ ownerId: "user-1", scopeId: "chat-1", plan: retrievalPlanFromInputs({ spec: spec() }) });
    for (let attempt = 0; attempt < 20 && registry.get(started.id, "user-1").status === "running"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const done = registry.get(started.id, "user-1");
    expect(done.status).toBe("done");
    expect(done.events.map((event) => event.type)).toEqual(expect.arrayContaining(["KNOWN_SOURCE_SEARCH_STARTED", "RESULTS_READY", "DONE"]));
    const reader = registry.stream(started.id, "user-1").getReader();
    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toContain("event: UNDERSTANDING_READY");
  });
});

describe("entity vertical slices", () => {
  it.each([
    ["people", "person", "HIRING"],
    ["intent people", "person", "SEEKING_JOB"],
    ["companies", "company", "HIRING"],
    ["no-website", "business", "NO_WEBSITE"],
  ] as const)("qualifies %s with current evidence", async (_label, entity, signal) => {
    const plan = retrievalPlanFromInputs({ spec: spec({ entity, signal: signal.toLowerCase(), category: "HVAC" }) });
    const candidateRow = row(1, entity, entity === "business" ? { url: null, detail: "Toronto · Open now" } : {});
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [candidateRow], hasMore: false, source: "fixture-index" }),
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch: browserVerifier(signal),
    });
    const result = await orchestrator.run({ plan });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.signals[0]?.type).toBe(signal);
  });

  it.each([
    ["businesses", "business"],
    ["investors", "investor"],
  ] as const)("qualifies static %s", async (_label, entity) => {
    const plan = retrievalPlanFromInputs({ spec: spec({ entity }) });
    const orchestrator = new ResearchOrchestrator({
      storedSearch: async () => ({ rows: [row(1, entity)], hasMore: false, source: "fixture-index" }),
      liveSearch: async () => ({ rows: [], exhausted: true, source: "fixture-live" }),
      browserResearch: vi.fn(),
    });
    const result = await orchestrator.run({ plan });
    expect(result.candidates).toHaveLength(1);
  });

  it("starts jobs at live and preserves posted evidence", async () => {
    const job = row(1, "job", {
      title: "Frontend Developer — Acme",
      detail: "Toronto · posted 2 days ago",
      employer: "Acme",
    });
    const orchestrator = new ResearchOrchestrator({
      storedSearch: vi.fn(),
      liveSearch: async () => ({ rows: [job], exhausted: true, source: "fixture-jobs" }),
      browserResearch: vi.fn(),
    });
    const plan = retrievalPlanFromInputs({ spec: spec({ entity: "job", query: "frontend developer jobs in Toronto" }) });
    const result = await orchestrator.run({ plan });
    expect(result.metrics.storedCandidates).toBe(0);
    expect(result.metrics.liveDiscovered).toBe(1);
    expect(result.candidates[0]?.row.kind).toBe("job");
  });
});

describe("AgentBrowserCliAdapter", () => {
  it("supports the full action contract and re-observes after actions", async () => {
    const commands: string[][] = [];
    const runner = vi.fn(async (args: string[]) => {
      commands.push(args);
      const command = args.find((value) => ["open", "snapshot", "click", "fill", "select", "scroll", "scrollintoview", "get", "screenshot", "close"].includes(value));
      if (command === "snapshot") return JSON.stringify({ success: true, data: { origin: "https://fixture.test", title: "Fixture", refs: { e1: { role: "button", name: "Next" }, e2: { role: "textbox", name: "Search" } }, snapshot: '- heading "Fixture"\n- button "Next" [ref=e1]\n- textbox "Search" [ref=e2]' } });
      if (command === "get") return JSON.stringify({ success: true, data: { text: "value" } });
      if (command === "screenshot") return JSON.stringify({ success: true, data: { path: "fixture.png" } });
      return JSON.stringify({ success: true, data: {} });
    });
    const browser = new AgentBrowserCliAdapter(runner);
    const session = await browser.createSession({ visible: false, screenshotDirectory: path.join(os.tmpdir(), "scrapivo-browser-test") });
    await browser.navigate(session, "https://fixture.test");
    await browser.observe(session);
    await browser.click(session, "@e1");
    await browser.type(session, "@e2", "query");
    await browser.select(session, "@e2", "value");
    await browser.scroll(session, null, "down");
    expect((await browser.waitFor(session, { text: "Fixture", timeoutMs: 50 })).verified).toBe(true);
    expect((await browser.extract(session, { fields: { heading: { selector: "h1" } } })).values.heading).toBe("value");
    expect(await browser.screenshot(session)).toBe("fixture.png");
    await browser.close(session);
    const actionCommands = commands.filter((args) => args.some((value) => ["open", "click", "fill", "select", "scroll"].includes(value)));
    expect(actionCommands).toHaveLength(5);
    expect(commands.filter((args) => args.includes("snapshot")).length).toBeGreaterThanOrEqual(6);
  });
});

function page(text: string, friction: PageSnapshot["friction"] = [], links: PageSnapshot["links"] = []): PageSnapshot {
  return {
    url: "https://candidate.example.com",
    title: "Candidate",
    pageType: "entity_detail",
    headings: ["Candidate"],
    visibleRelevantText: text,
    interactiveElements: [],
    links,
    selectedFilters: [],
    loadingState: "complete",
    friction,
    screenshotRef: null,
  };
}

function fakeBrowser(snapshots: PageSnapshot[]): AgentBrowser {
  let index = 0;
  const next = () => snapshots[Math.min(index++, snapshots.length - 1)]!;
  return {
    createSession: async () => ({
      id: "browser-fixture", visible: false, createdAt: new Date().toISOString(), screenshotDirectory: os.tmpdir(),
      counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 },
      limits: { actions: 20, pages: 10, scrolls: 5, screenshots: 5, reasoningCalls: 0 }, lastSnapshot: null,
    }),
    navigate: async (session: BrowserSession) => {
      session.counters.pages += 1;
      const snapshot = next();
      return { snapshot, action: "navigate", verified: true };
    },
    search: async (session: BrowserSession) => {
      session.counters.pages += 1;
      const snapshot = next();
      return { snapshot, action: "search", verified: true };
    },
    observe: async () => next(),
    click: async () => ({ snapshot: next(), action: "click", verified: true }),
    type: async () => ({ snapshot: next(), action: "type", verified: true }),
    select: async () => ({ snapshot: next(), action: "select", verified: true }),
    scroll: async () => ({ snapshot: next(), action: "scroll", verified: true }),
    waitFor: async () => ({ snapshot: next(), action: "wait", verified: true }),
    extract: async () => ({ values: {}, sourceUrl: "https://candidate.example.com", observedAt: new Date().toISOString(), errors: [] }),
    screenshot: async (session: BrowserSession) => {
      session.counters.screenshots += 1;
      return "fixture.png";
    },
    close: async () => undefined,
  };
}

describe("deterministic browser research", () => {
  it("extracts public contact and current hiring evidence", async () => {
    const plan = retrievalPlanFromInputs({ spec: spec({ entity: "company", signal: "hiring" }) });
    const candidate = row(1, "company", { email: null });
    const base: ResearchCandidate = {
      id: candidate.entity_id!, row: candidate, state: "READY_FOR_VERIFICATION", origin: "stored", evidence: [],
      fieldEvidence: [], signals: [], operationalStatus: "UNKNOWN", operationalStatusEvidence: [], missingFields: [], rejectionReason: null, whyMatch: null,
    };
    const result = await researchCandidatesWithBrowser({
      browser: fakeBrowser([page("We are hiring now. Apply today. Contact careers@candidate.example.com. Currently operating.")]),
      sessionId: "fixture", plan, candidates: [base], visible: false,
    });
    expect(result.candidates[0]?.row.email).toBe("careers@candidate.example.com");
    expect(result.candidates[0]?.signals[0]?.type).toBe("HIRING");
    expect(result.reasoningCalls).toBe(0);
  });

  it.each([
    ["Temporarily closed", "TEMPORARILY_CLOSED"],
    ["Permanently closed", "PERMANENTLY_CLOSED"],
  ] as const)("rejects %s", async (text, status) => {
    const plan = retrievalPlanFromInputs({ spec: spec({ entity: "business" }) });
    const candidate = row(1, "business");
    const base: ResearchCandidate = {
      id: candidate.entity_id!, row: candidate, state: "READY_FOR_VERIFICATION", origin: "stored", evidence: [],
      fieldEvidence: [], signals: [], operationalStatus: "UNKNOWN", operationalStatusEvidence: [], missingFields: [], rejectionReason: null, whyMatch: null,
    };
    const result = await researchCandidatesWithBrowser({ browser: fakeBrowser([page(text)]), sessionId: "fixture", plan, candidates: [base], visible: false });
    expect(result.candidates[0]).toMatchObject({ state: "REJECTED", operationalStatus: status });
  });

  it("detects CAPTCHA and requests safe handoff", async () => {
    const plan = retrievalPlanFromInputs({ spec: spec({ entity: "company" }) });
    const candidate = row(1, "company");
    const base: ResearchCandidate = {
      id: candidate.entity_id!, row: candidate, state: "READY_FOR_VERIFICATION", origin: "stored", evidence: [],
      fieldEvidence: [], signals: [], operationalStatus: "UNKNOWN", operationalStatusEvidence: [], missingFields: [], rejectionReason: null, whyMatch: null,
    };
    const result = await researchCandidatesWithBrowser({ browser: fakeBrowser([page("Verify you are human", ["CAPTCHA"])]), sessionId: "fixture", plan, candidates: [base], visible: false });
    expect(result.candidates[0]).toMatchObject({ state: "UNRESOLVED", rejectionReason: "captcha" });
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining(["CAPTCHA_DETECTED", "HUMAN_ACTION_REQUIRED"]));
  });

  it("verifies no-website only after two exact-name searches", async () => {
    const plan = retrievalPlanFromInputs({ spec: spec({ entity: "business", signal: "no_website" }) });
    const candidate = row(1, "business", { url: null });
    const base: ResearchCandidate = {
      id: candidate.entity_id!, row: candidate, state: "READY_FOR_VERIFICATION", origin: "stored", evidence: [],
      fieldEvidence: [], signals: [], operationalStatus: "ACTIVE", operationalStatusEvidence: [], missingFields: [], rejectionReason: null, whyMatch: null,
    };
    const searchPage = page("Directory result", [], [{ ref: "@e1", name: "Directory", url: "https://yelp.example/listing" }]);
    const result = await researchCandidatesWithBrowser({ browser: fakeBrowser([searchPage, searchPage]), sessionId: "fixture", plan, candidates: [base], visible: false });
    expect(result.candidates[0]?.signals[0]).toMatchObject({ type: "NO_WEBSITE", evidenceGrade: "B", freshness: "CURRENT" });
  });
});
