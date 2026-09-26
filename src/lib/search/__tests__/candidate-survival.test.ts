/**
 * Candidate-survival battery (V1 funnel fix).
 *
 * Invariant under test: unknown is researchable, contradicted is rejectable,
 * verified is deliverable. Partial candidates must reach query-aware
 * enrichment; the 120s deadline must finalize accumulated qualified rows;
 * only user cancellation discards.
 */
import { describe, expect, it, vi } from "vitest";

// Official-destination resolution goes through the free-first provider ladder;
// mock the ladder so the test never needs a live SearXNG.
vi.mock("@/lib/search/provider-ladder", () => ({
  discoverWebFreeFirst: vi.fn(async (args: { queries: string[] }) => ({
    results: [
      {
        url: "https://rocketsaas.example",
        title: "Rocket SaaS — Toronto",
        content: "Rocket SaaS is a Toronto software company. Contact Rocket SaaS.",
      },
    ],
    provider_used: "searxng",
    cost_class: "self_hosted",
  })),
}));
import {
  rowCouldSatisfySpec,
  rowSatisfiesSpec,
  runSpecSearchCore,
  sanitizeSpecRow,
  type SpecRow,
} from "../../spec-search.functions";
import { extractSearchSpec } from "../search-spec-extract";
import {
  SEARCH_CANCELLED_REASON,
  SEARCH_DEADLINE_REASON,
  isDeadlineAbort,
  searchAbortCode,
  throwIfAborted,
} from "../search-run";
import { beginRegisteredSearchRun, cancelRegisteredSearchRun } from "../search-run.server";
import { enrichIncompleteRows } from "../enrich-incomplete";
import { enrichCandidateForSpec } from "../enrichment-run";
import { applyWhyMatchGate } from "../live-gapfill";
import { qualifyLead } from "../qualify";
import { projectSpecRowsToQualifiedViews } from "../qualified-lead-view";
import { makeEvidence } from "../evidence";

function businessRow(partial: Partial<SpecRow> & { title: string }): SpecRow {
  return {
    kind: "business",
    detail: partial.detail ?? "",
    key: partial.key ?? "live-osm:t1",
    entity_id: partial.entity_id ?? "business:t1",
    entity_resolved: partial.entity_resolved ?? true,
    identity_confidence: partial.identity_confidence ?? 0.9,
    page_type: partial.page_type ?? "entity_page",
    source_url: partial.source_url ?? "osm://node/1",
    location: partial.location ?? "Austin",
    country: partial.country ?? "US",
    category: partial.category ?? "plumber",
    email: null,
    phone: null,
    ...partial,
  } as SpecRow;
}

function personRow(partial: Partial<SpecRow> & { title: string }): SpecRow {
  return {
    kind: "person",
    detail: partial.detail ?? "",
    key: partial.key ?? "browser:p1",
    entity_id: partial.entity_id ?? "browser:p1",
    entity_resolved: partial.entity_resolved ?? true,
    identity_confidence: partial.identity_confidence ?? 0.85,
    page_type: partial.page_type ?? "entity_page",
    source_url: partial.source_url ?? "https://directory.example/jane",
    role: null,
    company: null,
    industry: null,
    location: null,
    email: null,
    phone: null,
    ...partial,
  } as SpecRow;
}

describe("candidate survival — pre-research gate", () => {
  it("1/6: partial company with identity but no site/category survives; strict gate rejects it pre-research", () => {
    const spec = extractSearchSpec("Find 10 SaaS companies in Toronto");
    const loc = spec.criteria.find((c) => c.field === "location")?.value ?? "Toronto";
    const row = businessRow({
      kind: "company",
      title: "Rocket Labs",
      category: null,
      industry: null,
      location: loc,
      country: "CA",
      website_url: null,
      url: null,
    });
    expect(rowCouldSatisfySpec(spec, row)).toBe(true);
    expect(rowSatisfiesSpec(spec, row)).toBe(false);
  });

  it("6: unknown industry/role kept for research; explicit contradicting role rejected", () => {
    const spec = extractSearchSpec("Find SaaS founders in New York");
    const unknown = personRow({ title: "Jane Doe", role: null, industry: null });
    expect(rowCouldSatisfySpec(spec, unknown)).toBe(true);
    expect(rowSatisfiesSpec(spec, unknown)).toBe(false);
    const contradicted = personRow({ title: "Jane Doe", role: "Accountant", industry: null });
    expect(rowCouldSatisfySpec(spec, contradicted)).toBe(false);
  });

  it("1: partial live business with no site/contact passes the could-gate", () => {
    const spec = extractSearchSpec("Find 10 plumbers in Austin with no website");
    const row = businessRow({
      title: "Bob's Plumbing",
      website_url: null,
      url: null,
      email: null,
      phone: null,
    });
    expect(rowCouldSatisfySpec(spec, row)).toBe(true);
  });
});

describe("candidate survival — enrichment entry", () => {
  it("2: incomplete-but-resolved candidate enters query-aware enrichment", async () => {
    const spec = extractSearchSpec("Find 10 SaaS companies in Toronto");
    const row = businessRow({
      kind: "company",
      title: "Rocket Labs",
      category: null,
      industry: null,
      location: "Toronto",
      country: "CA",
      website_url: null,
      url: null,
    });
    const calls: string[] = [];
    const { rows } = await import("../enrichment-run").then((m) =>
      m.enrichCandidatesForSpec([row], spec, {
        adapters: {
          "registry-identity": async ({ fields }) => {
            calls.push(fields.join(","));
            return { fields: [] };
          },
        },
        maxContactCandidates: 0,
        maxPaidCalls: 0,
      }),
    );
    expect(calls.length).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it("3/4: official-destination resolves the company site; contact-harvest runs from it", async () => {
    const spec = extractSearchSpec("Find 10 SaaS companies in Toronto");
    const row = businessRow({
      kind: "company",
      title: "Rocket SaaS",
      category: null,
      industry: null,
      location: "Toronto",
      country: "CA",
      website_url: null,
      url: null,
    });
    const res = await enrichCandidateForSpec(row, spec, {
      adapters: {
        "contact-harvest": async ({ candidate }) => {
          // Runs AFTER official-destination: the resolved site is on the row.
          expect(candidate.website_url).toBe("https://rocketsaas.example");
          return {
            fields: [
              {
                field: "email",
                value: "hi@rocketsaas.example",
                source: "contact-harvest",
                confidence: 0.6,
              },
            ],
          };
        },
      },
      budget: { maxContactHarvest: 1, maxPaidCalls: 0, maxSteps: 4 },
    });
    expect(res.row.website_url).toBe("https://rocketsaas.example");
    expect(res.row.email).toBe("hi@rocketsaas.example");
  });

  it("8: enrichIncompleteRows preserves opportunity in its completeness recheck", async () => {
    const row = businessRow({
      title: "Bob's Plumbing",
      website_url: null,
      url: null,
      email: null,
      phone: null,
      opportunity: "no_website",
    });
    const { complete, stillIncomplete } = await enrichIncompleteRows([row], {
      enrichFn: async (r) => r,
    });
    expect(complete).toHaveLength(1);
    expect(stillIncomplete).toHaveLength(0);
  });
});

describe("candidate survival — no_website opportunity", () => {
  it("7: sanitizeSpecRow stamps Spec opportunity before completeness", () => {
    const spec = extractSearchSpec("Find 10 plumbers in Austin with no website");
    expect(spec.criteria.some((c) => c.field === "opportunity" && c.value === "no_website")).toBe(true);
    const row = businessRow({
      title: "Bob's Plumbing",
      website_url: null,
      url: null,
      email: null,
      phone: "+15125550100",
    });
    const s = sanitizeSpecRow(row, spec);
    expect(s.opportunity).toBe("no_website");
    expect(s.complete).toBe(true);
  });

  it("9: no-site candidate with structured absence + 2 exact checks satisfies the isVerified composition", () => {
    const spec = extractSearchSpec("Find 10 plumbers in Austin with no website");
    const entity = "business:absent1";
    const row = businessRow({
      title: "Bob's Plumbing",
      entity_id: entity,
      key: "live-osm:absent1",
      website_url: null,
      url: null,
      phone: "+15125550100",
      no_website_verification: {
        structured_absence: true,
        structured_source_url: "osm://node/9",
        exact_queries: ["Bob's Plumbing Austin", "Bob's Plumbing Austin official site"],
        official_site_found: false,
      } as SpecRow["no_website_verification"],
      evidence: [
        makeEvidence({
          source_url: "osm://node/9",
          source_type: "osm",
          evidence_type: "no_website",
          supports: "opportunity",
          subject: entity,
          excerpt: "No official website found after structured-source and exact-name checks.",
          confidence: 0.7,
          extraction_method: "osm_absence_plus_exact_web_check",
        }),
      ],
    });
    const prepared = sanitizeSpecRow(row, spec);
    expect(prepared.complete).toBe(true);
    const verified =
      rowCouldSatisfySpec(spec, prepared) &&
      prepared.complete === true &&
      applyWhyMatchGate([prepared], spec, false).kept.length === 1;
    expect(verified).toBe(true);
  });
});

describe("candidate survival — founder qualification", () => {
  it("5: 'may need help' is not buying intent; missing optional email does not reject a valid founder", async () => {
    const fakePeople = vi.fn(async () => ({
      rows: [
        {
          name: "Jane Doe",
          title: "Founder & CEO",
          company_name: "Acme",
          website: "https://acme.example",
          email: "jane@acme.example",
          phone: null,
          country: null,
          industry: "SaaS",
        },
      ],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 1, rowsReturned: 1 },
    }));
    // Real understanding path — legacy extractSearchSpec has its own signal
    // detection and is NOT what the app runs.
    const res = await runSpecSearchCore(
      "Find 10 SaaS founders globally who may need help with AI automation",
      { people: fakePeople as never },
      25,
    );
    expect(res.spec.signal_required).toBe(false);
    const spec = res.spec;
    const row = personRow({
      title: "Jane Doe",
      role: "Founder & CEO",
      company: "Acme",
      industry: "SaaS",
      url: "https://linkedin.example/in/janedoe",
      profile_url: "https://linkedin.example/in/janedoe",
      evidence: [
        makeEvidence({
          source_url: "https://directory.example/jane",
          source_type: "web",
          evidence_type: "identity",
          supports: "identity",
          subject: "browser:p1",
          excerpt: "Jane Doe, Founder & CEO of Acme",
          confidence: 0.85,
          extraction_method: "browser_observed_text",
          claim_parameters: {
            role: "Founder & CEO",
            organization_name: "Acme",
            organization_entity_id: "company:browser:abc123",
            relationship: "founder",
            role_currentness: "current_role",
          },
        }),
      ],
    });
    const decision = qualifyLead(row, spec, row.evidence);
    expect(decision.disposition).toBe("qualified");
    expect(applyWhyMatchGate([row], spec, false).kept).toHaveLength(1);
  });
});

describe("candidate survival — deadline vs cancellation", () => {
  const fakePeople = (controller: AbortController, reason: { code: string }) =>
    vi.fn(async () => {
      controller.abort(reason);
      return {
        rows: [
          {
            name: "Jane Doe",
            title: "Founder & CEO",
            company_name: "Acme",
            website: "https://acme.example",
            email: "jane@acme.example",
            phone: null,
            country: "New York",
            industry: "SaaS",
          },
        ],
        meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"], rowsScanned: 1, rowsReturned: 1 },
      };
    });

  it("10: hard deadline finalizes already-qualified candidates instead of returning zero", async () => {
    const controller = new AbortController();
    const res = await runSpecSearchCore(
      "Find 10 SaaS founders in New York",
      { people: fakePeople(controller, SEARCH_DEADLINE_REASON) as never, signal: controller.signal },
      25,
      {},
      { force: true },
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    expect(res.outcome).toBe("QUALIFIED_RESULTS");
    expect(res.retrievalTrace?.qualified).toBeGreaterThanOrEqual(1);
  });

  it("11: explicit user cancellation still cancels and discards", async () => {
    const controller = new AbortController();
    const res = await runSpecSearchCore(
      "Find 10 SaaS founders in New York",
      { people: fakePeople(controller, SEARCH_CANCELLED_REASON) as never, signal: controller.signal },
      25,
      {},
      { force: true },
    );
    expect(res.rows).toEqual([]);
    expect(res.outcome).toBe("SEARCH_CANCELLED");
  });

  it("12: typed abort reasons — deadline distinguishable from cancellation", async () => {
    const deadline = new AbortController();
    deadline.abort(SEARCH_DEADLINE_REASON);
    expect(searchAbortCode(deadline.signal)).toBe("SEARCH_DEADLINE");
    expect(isDeadlineAbort(deadline.signal)).toBe(true);
    try {
      throwIfAborted(deadline.signal);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe("SEARCH_DEADLINE");
    }
    const cancel = new AbortController();
    cancel.abort(SEARCH_CANCELLED_REASON);
    expect(searchAbortCode(cancel.signal)).toBe("SEARCH_CANCELLED");
    // Registered run: pre-arranged user cancellation carries the cancel reason.
    cancelRegisteredSearchRun("owner-test", "run-test");
    const registered = beginRegisteredSearchRun({ ownerId: "owner-test", runId: "run-test" });
    expect(registered.signal.aborted).toBe(true);
    expect(searchAbortCode(registered.signal)).toBe("SEARCH_CANCELLED");
  });
});

describe("candidate survival — UI projection", () => {
  it("12b: projection reports reject codes so server→UI losses are visible", () => {
    const spec = extractSearchSpec("Find 10 plumbers in Austin with no website");
    const unresolved = businessRow({
      title: "Ghost Plumbing",
      entity_id: undefined,
      key: "live-osm:ghost",
    });
    const { rejected } = projectSpecRowsToQualifiedViews({ rows: [unresolved], spec });
    expect(rejected.length).toBe(1);
    expect(typeof rejected[0].reject_code).toBe("string");
    expect(rejected[0].reject_code.length).toBeGreaterThan(0);
  });
});
