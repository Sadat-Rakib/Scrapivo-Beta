/**
 * M11 — UI run identity / cancellation / QualifiedLead view battery.
 *
 * Status target: TESTED (not VERIFIED).
 * Race tests use deferred promises — the stale-repaint class.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { createSearchRun } from "../search-run";
import {
  ActiveSearchSession,
  isSearchAbortError,
} from "../search-run-client";
import {
  columnsForEntity,
  emptyUiSearchState,
  evidenceAccessible,
  projectSpecRowsToQualifiedViews,
  qualifiedViewCount,
  viewRowFromQualifiedLead,
  viewToLegacyLead,
  viewToLocalBusinessRow,
  type UiSearchState,
} from "../qualified-lead-view";
import { outcomeUi, shouldSurfaceOutcome } from "../outcome-ui";
import { projectQualifiedLead } from "../qualified-lead";
import { runSpecSearchCore } from "@/lib/spec-search.functions";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { SearchOutcomeCode } from "../canonical-contract";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function hiringRow(entity_id = "company:acme"): SpecRow {
  const ev = makeEvidence({
    source_url: "https://acme.example/careers/senior-react",
    source_type: "job",
    excerpt: "Senior React developer — Austin",
    evidence_type: "hiring",
    supports: "requested_role",
    subject: entity_id,
    observed_at: new Date(NOW).toISOString(),
    claim_parameters: {
      role: "developer",
      technology: "React",
      seniority: "senior",
    },
  } as Parameters<typeof makeEvidence>[0] & {
    claim_parameters: Record<string, string>;
  });
  return {
    kind: "company",
    title: "Acme",
    detail: "Austin",
    location: "Austin",
    url: "https://acme.example",
    entity_id,
    entity_resolved: true,
    page_type: "company_page",
    identity_confidence: 0.92,
    disposition: "qualified",
    evidence: [ev],
    email: "jobs@acme.example",
  };
}

/**
 * Minimal UI reducer: only ActiveSearchSession.accept may mutate state.
 * Mirrors Discover's required gate without mounting React.
 */
function createUiHarness(session: ActiveSearchSession) {
  let state: UiSearchState = emptyUiSearchState();
  const history: UiSearchState[] = [];

  const snapshot = () => ({ ...state, views: [...state.views] });

  const applyResponse = (res: {
    search_run_id: string;
    outcome: SearchOutcomeCode;
    views?: ReturnType<typeof projectSpecRowsToQualifiedViews>["views"];
    qualified_count?: number;
    error?: string | null;
  }) => {
    const decision = session.accept(res);
    if (!decision.ok) return { applied: false as const, decision, state: snapshot() };

    state = {
      ...state,
      loading: false,
      outcome: res.outcome,
      views: res.views ?? state.views,
      qualified_count:
        res.qualified_count ??
        qualifiedViewCount(res.views ?? state.views),
      error: res.error ?? null,
      diagnostics: [],
    };
    session.settle(res);
    history.push(snapshot());
    return { applied: true as const, decision, state: snapshot() };
  };

  const applyError = (res: {
    search_run_id: string;
    error: string;
    outcome?: SearchOutcomeCode;
  }) => {
    const decision = session.accept(res);
    if (!decision.ok) return { applied: false as const, decision, state: snapshot() };
    const outcome = res.outcome ?? "SEARCH_FAILED";
    const ui = outcomeUi(outcome, {
      superseded: session.wasSuperseded(res.search_run_id),
    });
    if (ui.silent) {
      state = { ...state, loading: false };
    } else {
      state = {
        ...state,
        loading: false,
        outcome,
        error: res.error,
        views: [],
        qualified_count: 0,
      };
    }
    session.settle(res);
    history.push(snapshot());
    return { applied: true as const, decision, state: snapshot() };
  };

  const setLoading = (search_run_id: string, loading: boolean) => {
    return session.applyIfActive({ search_run_id }, () => {
      state = { ...state, loading };
      return snapshot();
    });
  };

  return {
    get state() {
      return snapshot();
    },
    history,
    applyResponse,
    applyError,
    setLoading,
  };
}

describe("M11 — ActiveSearchSession abort + identity", () => {
  it("A starts → B starts → A aborted", () => {
    const session = new ActiveSearchSession("conv_m11");
    const a = session.begin({ search_run_id: "run_a" });
    expect(a.signal.aborted).toBe(false);
    const b = session.begin({ search_run_id: "run_b" });
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(session.activeRunId).toBe("run_b");
    expect(session.wasSuperseded("run_a")).toBe(true);
  });

  it("carry locked identity — no remint mid-pipeline", () => {
    const session = new ActiveSearchSession("conv_stable");
    const { run } = session.begin({
      search_run_id: "run_fixed",
      turn_id: "turn_fixed",
      request_id: "req_fixed",
    });
    expect(run).toEqual({
      search_run_id: "run_fixed",
      conversation_id: "conv_stable",
      turn_id: "turn_fixed",
      request_id: "req_fixed",
    });
    expect(session.accept({ search_run_id: "run_fixed" }).ok).toBe(true);
  });

  it("navigation/unmount aborts active request", () => {
    const session = new ActiveSearchSession();
    const { signal } = session.begin({ search_run_id: "run_nav" });
    session.dispose();
    expect(signal.aborted).toBe(true);
    expect(session.activeRunId).toBeNull();
  });

  it("isSearchAbortError recognizes cancel shapes", () => {
    expect(isSearchAbortError(new Error("SEARCH_CANCELLED"))).toBe(true);
    expect(isSearchAbortError(new DOMException("Aborted", "AbortError"))).toBe(
      true,
    );
    expect(isSearchAbortError(new Error("boom"))).toBe(false);
  });
});

describe("M11 — deferred race: only active run mutates UI", () => {
  let session: ActiveSearchSession;
  let ui: ReturnType<typeof createUiHarness>;

  beforeEach(() => {
    session = new ActiveSearchSession("conv_race");
    ui = createUiHarness(session);
  });

  it("start A → start B → resolve B → resolve A → UI equals B", async () => {
    const a = defer<{
      search_run_id: string;
      outcome: SearchOutcomeCode;
      views: ReturnType<typeof projectSpecRowsToQualifiedViews>["views"];
      qualified_count: number;
    }>();
    const b = defer<typeof a extends { promise: Promise<infer T> } ? T : never>();

    const runA = session.begin({ search_run_id: "run_a" });
    ui.setLoading(runA.run.search_run_id, true);
    const runB = session.begin({ search_run_id: "run_b" });
    ui.setLoading(runB.run.search_run_id, true);

    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const bViews = projectSpecRowsToQualifiedViews({
      rows: [hiringRow("company:beta")],
      spec,
      run: runB.run,
      nowMs: NOW,
    }).views;

    // Resolve B first
    b.resolve({
      search_run_id: "run_b",
      outcome: "QUALIFIED_RESULTS",
      views: bViews,
      qualified_count: bViews.length,
    });
    const bRes = await b.promise;
    const bApply = ui.applyResponse(bRes);
    expect(bApply.applied).toBe(true);
    expect(ui.state.views[0]?.lead.entity_id).toBe("company:beta");

    // Late A must not mutate
    const aViews = projectSpecRowsToQualifiedViews({
      rows: [hiringRow("company:alpha")],
      spec,
      run: runA.run,
      nowMs: NOW,
    }).views;
    a.resolve({
      search_run_id: "run_a",
      outcome: "NO_QUALIFIED_RESULTS",
      views: aViews,
      qualified_count: 0,
    });
    const aRes = await a.promise;
    const aApply = ui.applyResponse(aRes);
    expect(aApply.applied).toBe(false);
    expect(ui.state.views[0]?.lead.entity_id).toBe("company:beta");
    expect(ui.state.outcome).toBe("QUALIFIED_RESULTS");
    expect(ui.state.qualified_count).toBe(1);
  });

  it("start A → start B → reject A → resolve B → UI equals B", async () => {
    const a = defer<never>();
    const b = defer<{
      search_run_id: string;
      outcome: SearchOutcomeCode;
      views: ReturnType<typeof projectSpecRowsToQualifiedViews>["views"];
      qualified_count: number;
    }>();

    session.begin({ search_run_id: "run_a" });
    const runB = session.begin({ search_run_id: "run_b" });

    a.reject(new Error("SOURCE_ERROR: provider down"));
    try {
      await a.promise;
    } catch (err) {
      const applied = ui.applyError({
        search_run_id: "run_a",
        error: String(err),
        outcome: "SOURCE_ERROR",
      });
      expect(applied.applied).toBe(false);
    }

    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const views = projectSpecRowsToQualifiedViews({
      rows: [hiringRow()],
      spec,
      run: runB.run,
      nowMs: NOW,
    }).views;
    b.resolve({
      search_run_id: "run_b",
      outcome: "QUALIFIED_RESULTS",
      views,
      qualified_count: views.length,
    });
    expect(ui.applyResponse(await b.promise).applied).toBe(true);
    expect(ui.state.outcome).toBe("QUALIFIED_RESULTS");
    expect(ui.state.error).toBeNull();
    expect(ui.state.views).toHaveLength(1);
  });

  it("A NO_QUALIFIED_RESULTS after B results → B remains intact", () => {
    const runB = session.begin({ search_run_id: "run_b" });
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const views = projectSpecRowsToQualifiedViews({
      rows: [hiringRow()],
      spec,
      run: runB.run,
      nowMs: NOW,
    }).views;
    ui.applyResponse({
      search_run_id: "run_b",
      outcome: "QUALIFIED_RESULTS",
      views,
      qualified_count: 1,
    });

    // Simulate late empty from older run — recreate session history:
    // begin A was before B; accept checks active = B.
    const late = ui.applyResponse({
      search_run_id: "run_a",
      outcome: "NO_QUALIFIED_RESULTS",
      views: [],
      qualified_count: 0,
    });
    expect(late.applied).toBe(false);
    expect(ui.state.qualified_count).toBe(1);
    expect(ui.state.outcome).toBe("QUALIFIED_RESULTS");
  });

  it("rapid A→B→C — only C mutates final state", () => {
    session.begin({ search_run_id: "run_a" });
    session.begin({ search_run_id: "run_b" });
    const c = session.begin({ search_run_id: "run_c" });
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const views = projectSpecRowsToQualifiedViews({
      rows: [hiringRow("company:cee")],
      spec,
      run: c.run,
      nowMs: NOW,
    }).views;

    expect(
      ui.applyResponse({
        search_run_id: "run_a",
        outcome: "QUALIFIED_RESULTS",
        views: [],
        qualified_count: 0,
      }).applied,
    ).toBe(false);
    expect(
      ui.applyResponse({
        search_run_id: "run_b",
        outcome: "NO_QUALIFIED_RESULTS",
        views: [],
        qualified_count: 0,
      }).applied,
    ).toBe(false);
    expect(
      ui.applyResponse({
        search_run_id: "run_c",
        outcome: "QUALIFIED_RESULTS",
        views,
        qualified_count: 1,
      }).applied,
    ).toBe(true);
    expect(ui.state.views[0]?.lead.entity_id).toBe("company:cee");
  });

  it("stale loading/error cannot clear active results", () => {
    const runB = session.begin({ search_run_id: "run_b" });
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    const views = projectSpecRowsToQualifiedViews({
      rows: [hiringRow()],
      spec,
      run: runB.run,
      nowMs: NOW,
    }).views;
    ui.applyResponse({
      search_run_id: "run_b",
      outcome: "QUALIFIED_RESULTS",
      views,
      qualified_count: 1,
    });

    expect(ui.setLoading("run_a", true).applied).toBe(false);
    expect(ui.state.loading).toBe(false);
    expect(
      ui.applyError({
        search_run_id: "run_a",
        error: "boom",
        outcome: "SEARCH_FAILED",
      }).applied,
    ).toBe(false);
    expect(ui.state.views).toHaveLength(1);
  });
});

describe("M11 — typed outcomes in UI", () => {
  it("preserves outcome distinctions", () => {
    const codes: SearchOutcomeCode[] = [
      "NO_QUALIFIED_RESULTS",
      "SOURCE_UNAVAILABLE",
      "SOURCE_ERROR",
      "UNSUPPORTED_CAPABILITY",
      "SEARCH_CANCELLED",
      "SEARCH_FAILED",
    ];
    const labels = new Set(codes.map((c) => outcomeUi(c).label));
    expect(labels.size).toBe(codes.length);
    expect(outcomeUi("NO_QUALIFIED_RESULTS").message).not.toMatch(
      /^No results found\.?$/i,
    );
  });

  it("superseded cancellation is silent — no false failure UI", () => {
    const session = new ActiveSearchSession();
    session.begin({ search_run_id: "run_a" });
    session.begin({ search_run_id: "run_b" });
    const model = outcomeUi("SEARCH_CANCELLED", {
      superseded: session.wasSuperseded("run_a"),
    });
    expect(model.silent).toBe(true);
    expect(shouldSurfaceOutcome(model)).toBe(false);
  });
});

describe("M11 — QualifiedLead view contract (no lossy projection)", () => {
  const spec = () =>
    extractSearchSpec("companies hiring senior React developers in Austin");

  it("table columns derive from entity type", () => {
    expect(columnsForEntity("company").map((c) => c.id)).toEqual([
      "name",
      "location",
      "website",
      "contact",
      "evidence",
    ]);
    expect(columnsForEntity("person").map((c) => c.id)).toContain(
      "current_role",
    );
    expect(columnsForEntity("job").map((c) => c.id)).toEqual([
      "title",
      "employer",
      "location",
      "salary",
      "apply",
      "evidence",
    ]);
  });

  it("qualified count counts QualifiedLead only", () => {
    const run = createSearchRun();
    const good = hiringRow();
    const unresolved: SpecRow = {
      ...hiringRow("provisional:serp:1"),
      entity_id: "provisional:serp:1",
      entity_resolved: false,
      disposition: "potential_match",
    };
    const out = projectSpecRowsToQualifiedViews({
      rows: [good, unresolved],
      spec: spec(),
      run,
      nowMs: NOW,
    });
    expect(out.views).toHaveLength(1);
    expect(out.rejected.length).toBeGreaterThanOrEqual(1);
    expect(qualifiedViewCount(out.views)).toBe(1);
  });

  it("unresolved candidate never rendered as lead", () => {
    const out = projectSpecRowsToQualifiedViews({
      rows: [
        {
          ...hiringRow(),
          entity_resolved: false,
          disposition: "potential_match",
        },
      ],
      spec: spec(),
      nowMs: NOW,
    });
    expect(out.views).toHaveLength(0);
  });

  it("canonical evidence remains accessible (not why_match only)", () => {
    const projected = projectQualifiedLead({
      row: hiringRow(),
      spec: spec(),
      run: createSearchRun(),
      nowMs: NOW,
    });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const view = viewRowFromQualifiedLead(projected.lead, "company");
    expect(evidenceAccessible(view)).toBe(true);
    expect(view.evidence[0].claim_type).toBe("hiring");
    expect(view.evidence[0].evidence_url).toContain("acme.example");
    expect(view.evidence[0].claim_parameters?.technology).toBe("React");
    expect(view.lead).not.toHaveProperty("verified");

    const legacy = viewToLegacyLead(view, 0);
    expect(legacy.claim_evidence[0].subject).toBe("company:acme");
    expect(legacy.qualified.entity_id).toBe("company:acme");

    const biz = viewToLocalBusinessRow(view, 0);
    expect(biz.claim_evidence.length).toBeGreaterThan(0);
    expect(biz.qualified.disposition).toBe("qualified");
  });
});

describe("M11 — production-path acceptance (run identity through pipeline)", () => {
  it("client run id → runSpecSearchCore echo → accept → QualifiedLead views", async () => {
    const session = new ActiveSearchSession("conv_prod");
    const { run } = session.begin({
      search_run_id: "run_prod_path",
      turn_id: "turn_prod",
      request_id: "req_prod",
    });

    const res = await runSpecSearchCore(
      "bro i need businesses plz asap",
      { index: null },
      25,
      {},
      {
        search_run_id: run.search_run_id,
        conversation_id: run.conversation_id,
        turn_id: run.turn_id,
        request_id: run.request_id,
      },
    );

    expect(res.search_run_id).toBe("run_prod_path");
    expect(res.conversation_id).toBe("conv_prod");
    expect(res.turn_id).toBe("turn_prod");
    expect(res.request_id).toBe("req_prod");
    expect(typeof res.outcome).toBe("string");

    const ui = createUiHarness(session);
    const decision = session.accept(res);
    expect(decision.ok).toBe(true);

    // Only project theorem-qualified rows into the UI model.
    const projected = projectSpecRowsToQualifiedViews({
      rows: res.rows,
      spec: res.spec,
      run,
      nowMs: NOW,
    });
    // Unresolved / non-qualified must never appear
    for (const v of projected.views) {
      expect(v.lead.disposition).toBe("qualified");
      expect(v.lead.entity_id).not.toMatch(/^provisional:/);
    }

    ui.applyResponse({
      search_run_id: res.search_run_id,
      outcome: res.outcome,
      views: projected.views,
      qualified_count: projected.qualified_count,
    });
    expect(ui.state.outcome).toBe(res.outcome);
    expect(ui.state.qualified_count).toBe(projected.qualified_count);
  });

  it("overlapping searches: late core response discarded", async () => {
    const session = new ActiveSearchSession("conv_overlap");
    const a = session.begin({ search_run_id: "run_overlap_a" });
    const b = session.begin({ search_run_id: "run_overlap_b" });

    const resA = await runSpecSearchCore(
      "bro i need businesses plz asap",
      { index: null },
      10,
      {},
      { search_run_id: a.run.search_run_id, conversation_id: a.run.conversation_id },
    );
    const resB = await runSpecSearchCore(
      "bro i need businesses plz asap",
      { index: null },
      10,
      {},
      { search_run_id: b.run.search_run_id, conversation_id: b.run.conversation_id },
    );

    const ui = createUiHarness(session);
    // B first (active)
    expect(
      ui.applyResponse({
        search_run_id: resB.search_run_id,
        outcome: resB.outcome,
        views: [],
        qualified_count: resB.qualified_count,
      }).applied,
    ).toBe(true);
    // Late A discarded
    expect(
      ui.applyResponse({
        search_run_id: resA.search_run_id,
        outcome: "NO_QUALIFIED_RESULTS",
        views: [],
        qualified_count: 0,
      }).applied,
    ).toBe(false);
    expect(ui.state.outcome).toBe(resB.outcome);
  });
});
