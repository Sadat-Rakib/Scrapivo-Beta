import { describe, expect, it, vi } from "vitest";
import { buildSpec, stated } from "../search-spec";
import { runLiveGapfill } from "../live-gapfill";
import { enrichCandidatesForSpec } from "../enrichment-run";
import { mergeEnrichmentIntoRow } from "../enrichment-merge";
import { createCustomSignalHunter, runDeepSignalPass } from "../../signals/deep-pass.server";
import { makeEvidence, type Evidence } from "../evidence";
import { preliminaryEligibility, runSpecSearchCore, type SpecRow } from "../../spec-search.functions";
import { createCandidateLedger, mergeCandidateLedgers } from "../candidate-ledger";
import { compileCustomSignal, deterministicFallback } from "../../signals/custom-compiler";
import { enrichIncompleteRows } from "../enrich-incomplete";
import { buildEmailDraft, buildMessageDraft } from "../../outreach-draft";
import { verifyCandidateClaims } from "../verification";
import { qualifyLead } from "../qualify";
import { runCanonicalSourcePipeline } from "../source-pipeline";
import { requestedClaimTypes } from "../claim-binding";

const row = (): SpecRow =>
  ({
    kind: "company",
    title: "Acme",
    entity_id: "acme",
    entity_resolved: true,
    page_type: "company_page",
    identity_confidence: 0.9,
    detail: "Software",
    category: "Software",
    website_url: "https://acme.com",
    url: "https://acme.com",
    email: null,
  }) as SpecRow;
const ev = (type: "hiring" | "funding") =>
  makeEvidence({
    subject: "acme",
    source_url: "https://acme.com/news",
    source_type: "web",
    evidence_type: type,
    excerpt: `Acme ${type}`,
    supports: "intent",
    event_at: new Date().toISOString(),
  });

describe("ordered universal pipeline regressions", () => {
  it("replays cached signal evidence without multiplying records or losing distinct events", async () => {
    const spec = buildSpec({
      entity: "company",
      criteria: [stated("industry", "software")],
      raw_query: "software companies hiring",
      signal_required: true,
      signal_types: ["hiring"],
    });
    const primary = {
      ...ev("hiring"),
      observed_at: "2026-10-09T00:00:00.000Z",
      event_at: "2026-10-08T00:00:00.000Z",
      extraction_method: "company_news",
      claim_parameters: { role: "engineer", current: true },
      provenance: { acquisition: "structured" as const, requested_url: "https://acme.com/news" },
    };
    const evidence = [
      primary,
      { ...primary, event_at: "2026-10-07T00:00:00.000Z" },
      { ...primary, source_url: "https://acme.com/careers" },
      { ...primary, excerpt: "Acme hiring engineers" },
      { ...primary, supports: "requested_role" as const },
      { ...primary, observed_at: "2026-10-09T01:00:00.000Z" },
    ];
    let candidate: SpecRow = { ...row(), key: "acme", email: "hello@acme.com", evidence };
    const signalResearchCache = new Map<string, Evidence[]>();
    const originalFlag = process.env.USE_INDEXED_SEARCH;
    process.env.USE_INDEXED_SEARCH = "true";
    try {
      const index = vi.fn(async () => ({
        rows: [candidate],
        meta: { dbHit: true, engine: "pg-index" as const, partitionsRead: ["test"], rowsScanned: 1, rowsReturned: 1 },
      }));
      for (let replay = 0; replay < 3; replay++) {
        const result = await runSpecSearchCore(spec.raw_query, { index, liveGapfill: null, enrichFn: null }, 1, {}, { spec, force: true, signalResearchCache });
        expect(result.rows).toHaveLength(1);
        expect(signalResearchCache.size).toBe(1);
        expect(result.rows[0].evidence).toEqual(evidence);
        candidate = {
          ...candidate, ...result.rows[0],
          evidence: result.rows[0].evidence!.map(item => ({ ...item, claim_parameters: { current: true, role: "engineer" } })),
        };
      }
    } finally {
      if (originalFlag === undefined) delete process.env.USE_INDEXED_SEARCH;
      else process.env.USE_INDEXED_SEARCH = originalFlag;
    }
  });
  it.each(["investor", "job"] as const)(
    "actually invokes advertised web adapter for %s",
    async (entity) => {
      const web = vi.fn(async (..._args: unknown[]) => []);
      await runLiveGapfill(
        buildSpec({ entity, criteria: [stated("role", "engineer")], raw_query: `find ${entity}s` }),
        { web, jobs: null, osm: null, browser: null },
      );
      expect(web).toHaveBeenCalled();
      expect(web.mock.calls[0]?.[2]).toBe(entity);
    },
  );
  it("keeps absent hard investor fields researchable", () => {
    const spec = buildSpec({
      entity: "investor",
      criteria: [stated("investor_stage", "seed")],
      raw_query: "seed investors",
    });
    expect(preliminaryEligibility(spec, { ...row(), kind: "investor", stage: null })).toBe(
      "RESEARCHABLE_UNKNOWN",
    );
    expect(preliminaryEligibility(spec, row(), true)).toBe("DUPLICATE");
  });
  it("researches wrong-signal evidence and accumulates AND evidence across probes", async () => {
    const spec = buildSpec({
      entity: "company",
      criteria: [],
      raw_query: "funded and hiring",
      signal_required: true,
      signal_types: ["funding", "hiring"],
      signal_mode: "all",
    });
    const hunter = vi.fn(async (_row, _spec, ctx) => [
      ev(ctx.probeIndex === 0 ? "funding" : "hiring"),
    ]);
    const result = await runDeepSignalPass([row()], spec, { hunter, probesPerCandidate: 2 });
    expect(result.signalReady).toHaveLength(1);
    expect(hunter).toHaveBeenCalledTimes(2);
    expect(result.signalReady[0].evidence).toHaveLength(2);
  });
  it("propagates cancellation into active hunter operations", async () => {
    const controller = new AbortController();
    let abortObserved = false;
    const spec = buildSpec({
      entity: "company",
      criteria: [],
      raw_query: "hiring",
      signal_required: true,
      signal_types: ["hiring"],
    });
    const result = await runDeepSignalPass([row()], spec, {
      signal: controller.signal,
      hunter: async (_r, _s, ctx) => {
        return new Promise((resolve) => {
          ctx.signal?.addEventListener("abort", () => {
            abortObserved = true;
            resolve(null);
          });
          controller.abort();
        });
      },
    });
    expect(abortObserved).toBe(true);
    expect(result.signalReady).toHaveLength(0);
  });
  it("never invokes contact enrichment without mandatory signal support", async () => {
    const contact = vi.fn(async () => ({ fields: [] }));
    const spec = buildSpec({
      entity: "company",
      criteria: [stated("require_email", "true")],
      raw_query: "hiring companies with email",
      signal_required: true,
      signal_types: ["hiring"],
    });
    await enrichCandidatesForSpec([row()], spec, { adapters: { "contact-harvest": contact } });
    expect(contact).not.toHaveBeenCalled();
  });
  it("treats an empty claim authorization as deny-all", () => {
    const claim = ev("hiring");
    const result = mergeEnrichmentIntoRow(
      row(),
      { fields: [], claims: [{ ...claim, excerpt: claim.excerpt! }] },
      { entityId: "acme", allowedClaims: [] },
    );
    expect(result.row.evidence ?? []).toHaveLength(0);
  });
  it("shares contact and adapter spending across separate candidate batches", async () => {
    const spec = buildSpec({
      entity: "company",
      criteria: [stated("require_email", "true")],
      raw_query: "companies with email",
    });
    const sharedBudget = { adapterCalls: 0, contactCandidates: 0, paidCalls: 0 };
    const contact = vi.fn(async () => ({ fields: [] }));
    const opts = {
      sharedBudget,
      maxContactCandidates: 1,
      adapters: { "contact-harvest": contact },
    };
    await enrichCandidatesForSpec([row()], spec, opts);
    const firstDeadline = (sharedBudget as typeof sharedBudget & { deadlineMs?: number })
      .deadlineMs;
    await enrichCandidatesForSpec([{ ...row(), entity_id: "other" }], spec, opts);
    expect(contact).toHaveBeenCalledTimes(1);
    expect(sharedBudget.contactCandidates).toBe(1);
    expect((sharedBudget as typeof sharedBudget & { deadlineMs?: number }).deadlineMs).toBe(
      firstDeadline,
    );
  });
  it("shares legacy site-contact spending and cancels active work at the root deadline", async () => {
    const sharedBudget = { adapterCalls: 0, contactCandidates: 11, paidCalls: 0 };
    let aborted = false;
    const enrichFn = vi.fn(async (candidate: SpecRow, signal?: AbortSignal | null) => {
      await new Promise((resolve) =>
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve(null);
          },
          { once: true },
        ),
      );
      return candidate;
    });
    const opts = { sharedBudget, enrichFn, deadlineMs: Date.now() + 100 };
    await enrichIncompleteRows([row()], opts);
    await enrichIncompleteRows([{ ...row(), entity_id: "next" }], opts);
    expect(aborted).toBe(true);
    expect(enrichFn).toHaveBeenCalledTimes(1);
    expect(sharedBudget.contactCandidates).toBe(12);
    expect(sharedBudget.adapterCalls).toBe(1);
  });
  it("qualifies only the actual requested arbitrary custom indicator for its subject", async () => {
    const text = "ISO 27001 certification";
    const spec = {
      ...buildSpec({ entity: "company", criteria: [], raw_query: text, signal_required: true }),
      custom_signal_text: text,
    };
    const unrelated = verifyCandidateClaims({ evidence: [ev("hiring")], entityId: "acme", spec });
    expect(unrelated.ok).toBe(false);
    const hunter = createCustomSignalHunter(deterministicFallback(text), {
      webSearch: async () => [
        {
          title: "Acme ISO 27001 certification",
          snippet: "Acme obtained ISO 27001 certification.",
          url: "https://acme.com/certification",
        },
      ],
    });
    const result = await runDeepSignalPass([row()], spec, { hunter, probesPerCandidate: 1 });
    expect(result.signalReady).toHaveLength(1);
    const evidence = result.signalReady[0]!.evidence!;
    expect(evidence.some((item) => item.evidence_type === "custom_signal")).toBe(true);
    expect(qualifyLead(result.signalReady[0]!, spec, evidence).disposition).toBe("qualified");
    expect(verifyCandidateClaims({ evidence, entityId: "other", spec }).ok).toBe(false);
    expect(
      verifyCandidateClaims({
        evidence: evidence.map((item) => ({
          ...item,
          excerpt: "Acme has ISO 9001 certification.",
          claim_parameters: { custom_signal_text: text, observable_indicator: "certification" },
        })),
        entityId: "acme",
        spec,
      }).ok,
    ).toBe(false);
    expect(
      verifyCandidateClaims({
        evidence,
        entityId: "acme",
        spec: { ...spec, custom_signal_text: "SOC 2 certification" },
      }).ok,
    ).toBe(false);
  });
  it("keeps custom no-website requests on the dedicated absence claim path", () => {
    const spec = {
      ...buildSpec({
        entity: "business",
        criteria: [stated("opportunity", "no_website")],
        raw_query: "businesses with no website",
        signal_required: true,
        signal_types: ["custom"],
        signal_mode: "all",
      }),
      custom_signal_text: "no website",
    };
    expect(requestedClaimTypes(spec)).toEqual(["no_website"]);
    expect(verifyCandidateClaims({ evidence: [ev("hiring")], entityId: "acme", spec }).ok).toBe(
      false,
    );
  });
  it.each([
    null,
    "2000-01-01",
    "2099-01-01",
    new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  ])("checks custom event dates against actual recency: %s", async (date) => {
    const text = "ISO 27001 certification";
    const spec = {
      ...buildSpec({
        entity: "company",
        criteria: [],
        raw_query: text,
        signal_required: true,
        signal_recency: "30d",
      }),
      custom_signal_text: text,
    };
    const hunter = createCustomSignalHunter(deterministicFallback(text), {
      webSearch: async () => [
        {
          title: "Acme certification",
          snippet: `Acme obtained ISO 27001 certification${date ? ` on ${date}` : ""}.`,
          url: "https://acme.com/certification",
        },
      ],
    });
    const result = await runDeepSignalPass([row()], spec, { hunter, probesPerCandidate: 1 });
    expect(result.signalReady).toHaveLength(
      date && !["2000-01-01", "2099-01-01"].includes(date) ? 1 : 0,
    );
  });
  it.each([
    "Acme has ISO 27001 certification. Updated 2026-10-08.",
    "Acme has ISO 9001 certification.",
    "Acme writes about certifications. Other Company obtained ISO 27001 certification on 2026-10-08.",
  ])(
    "does not qualify unrelated dates, certification identities, or subjects: %s",
    async (snippet) => {
      const text = "ISO 27001 certification";
      const spec = {
        ...buildSpec({
          entity: "company",
          criteria: [],
          raw_query: text,
          signal_required: true,
          signal_recency: "30d",
        }),
        custom_signal_text: text,
      };
      const hunter = createCustomSignalHunter(deterministicFallback(text), {
        webSearch: async () => [
          { title: "Certification article", snippet, url: "https://acme.com/certification" },
        ],
      });
      expect(
        (await runDeepSignalPass([row()], spec, { hunter, probesPerCandidate: 1 })).signalReady,
      ).toHaveLength(0);
    },
  );
  it("preserves stage reasons across branch merge without changing fate accounting", () => {
    const ledger = createCandidateLedger();
    ledger.retrieved(row());
    ledger.stage(row(), "RESEARCHABLE_UNKNOWN", "NOT_RESEARCHED_BUDGET", "deadline");
    ledger.gated(row(), "deadline");
    const merged = mergeCandidateLedgers([ledger.summary()], []);
    expect(merged?.stages).toContainEqual(
      expect.objectContaining({ signal: "NOT_RESEARCHED_BUDGET", reason: "deadline" }),
    );
    expect(merged?.accounting?.ok).toBe(true);
  });
  it("free-only custom compilation never invokes the AI adapter", async () => {
    const ai = vi.fn(async () => "");
    expect(
      (await compileCustomSignal("manual onboarding", { allowAI: false, signal: ai })).searchQueries
        .length,
    ).toBeGreaterThan(0);
    expect(ai).not.toHaveBeenCalled();
  });
  it("grounded drafts preserve supplied facts and omit unsupported hiring assertions", () => {
    const lead = {
      name: "Acme",
      vertical: "company" as const,
      verifiedFactsOnly: true,
      whyMatch: "Acme raised Series A.",
    };
    const email = buildEmailDraft(lead, { service: "automation" });
    expect(email.body).toContain("Acme raised Series A.");
    expect(email.body).not.toMatch(/hiring|competitors|following/);
    expect(buildMessageDraft(lead, { service: "automation" })).toContain("automation");
  });
  it("future-dated evidence cannot satisfy a current event requirement", () => {
    const evidence = {
      ...ev("funding"),
      event_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    };
    const spec = buildSpec({
      entity: "company",
      criteria: [],
      raw_query: "recently funded",
      signal_required: true,
      signal_types: ["funding"],
      signal_recency: "30d",
    });
    expect(verifyCandidateClaims({ evidence: [evidence], entityId: "acme", spec }).ok).toBe(false);
  });
  it("a supplied future event cannot prove an occurred signal without a recency window", () => {
    const evidence = {
      ...ev("hiring"),
      event_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    };
    const spec = buildSpec({
      entity: "company",
      criteria: [],
      raw_query: "hiring",
      signal_required: true,
      signal_types: ["hiring"],
    });
    expect(verifyCandidateClaims({ evidence: [evidence], entityId: "acme", spec }).reason).toBe(
      "event_at_in_future",
    );
  });
  it.each([
    ["Toronto", "CA", true],
    ["Austin", "US", true],
    ["London", "GB", false],
  ])("enforces all requested geography alternatives: %s", (location, country, pass) => {
    const spec = {
      ...buildSpec({
        entity: "company",
        criteria: [stated("location", "USA")],
        raw_query: "companies in USA or Canada",
      }),
      locations: ["USA", "Canada"],
    };
    const candidate = { ...row(), location: location as string, country: country as string };
    expect(qualifyLead(candidate, spec, []).disposition === "qualified").toBe(pass);
  });
  it.each([10, 50, 100])(
    "preserves caller requested volume %i when no numeric query is supplied",
    async (desiredCount) => {
      const spec = buildSpec({
        entity: "company",
        criteria: [stated("industry", "software")],
        raw_query: "software companies",
      });
      const result = await runCanonicalSourcePipeline({
        spec,
        desiredCount,
        adapters: {},
        skipEnrichment: true,
      });
      expect(result.plan.researchPlan.desiredCount).toBe(desiredCount);
      expect(result.qualified).toHaveLength(0);
    },
  );
});
