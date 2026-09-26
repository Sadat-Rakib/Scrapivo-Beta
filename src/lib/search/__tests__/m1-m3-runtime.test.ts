/**
 * M1–M3 runtime proof: SPEC_SEARCH path cannot bypass the QualifiedLead theorem.
 */
import { describe, expect, it } from "vitest";
import { runSpecSearchCore } from "@/lib/spec-search.functions";
import type { SpecRow } from "@/lib/spec-search.functions";
import { extractSearchSpec } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { applyWhyMatchGate, evidenceFromWebHit } from "../live-gapfill";
import { qualifyLead, applyQualificationGate } from "../qualify";
import { classifyPage, applyPageClassificationToLiveRow } from "../page-classify";
import {
  createSearchRun,
  shouldDiscardStaleResult,
  isActiveRun,
  finalizeSearchOutcome,
} from "../search-run";
import { isVerifiedForPersist, stampVerified } from "@/lib/canonical/persist-live.server";
import { mintProvisionalEntityId } from "../canonical-contract";

describe("M2 — page classification", () => {
  it("rejects TechCrunch article as article (not the company discussed)", () => {
    const c = classifyPage({
      url: "https://techcrunch.com/2024/01/acme-raises-series-a",
      title: "Acme raises $10M Series A",
      snippet: "The startup announced funding today",
    });
    expect(c.page_type).toBe("article");
    expect(c.may_extract_entity).toBe(false);
  });

  it("rejects Founder Institute as institute (not person)", () => {
    const c = classifyPage({
      url: "https://fi.co/",
      title: "Founder Institute — Startup Accelerator",
      snippet: "Join the world's largest pre-seed accelerator",
    });
    expect(c.page_type).toBe("institute");
    expect(c.may_extract_entity).toBe(false);
  });

  it("rejects Monster marketing jobs as job_board", () => {
    const c = classifyPage({
      url: "https://www.monster.com/jobs/q-marketing-jobs",
      title: "Marketing Jobs",
      snippet: "Browse marketing job openings",
    });
    expect(c.page_type).toBe("job_board");
  });

  it("rejects Seedtable list as aggregator/list", () => {
    const c = classifyPage({
      url: "https://www.seedtable.com/best-startups-berlin",
      title: "50 startups recently funded in Berlin",
      snippet: "Directory of funded startups",
    });
    expect(["list", "aggregator"]).toContain(c.page_type);
  });

  it("live row classification never sets entity_resolved", () => {
    const row = applyPageClassificationToLiveRow({
      kind: "person",
      title: "Founder Institute",
      url: "https://fi.co/",
      detail: "accelerator",
      key: "live-web:0:fi",
      entity_id: mintProvisionalEntityId("x"),
      entity_resolved: true, // hostile input — must be cleared
    });
    expect(row.entity_resolved).toBe(false);
    expect(row.page_type).toBe("institute");
  });
});

describe("M1 — SPEC_SEARCH path cannot bypass theorem", () => {
  it("directory contamination under signal_required yields 0 delivered rows", async () => {
    const fake = async () => ({
      rows: [
        {
          name: "Directory Person",
          title: "Founder",
          company_name: "X",
          country: "San Francisco",
          industry: "SaaS",
          email: "a@x.example",
          personal_linkedin: "https://linkedin.com/in/x",
        },
      ],
      meta: {
        dbHit: true,
        engine: "s3-parquet",
        partitionsRead: ["fake"],
        rowsScanned: 1,
        rowsReturned: 1,
      },
    });
    const res = await runSpecSearchCore(
      "founders needing developers in San Francisco",
      { people: fake as never, liveGapfill: null, index: null },
      25,
      { mode: "looking" },
    );
    // No claim evidence on DB directory row → not qualified → not delivered
    expect(res.rows.every((r) => r.disposition === "qualified")).toBe(true);
    expect(res.qualified_count).toBe(res.rows.length);
    expect(res.rows).toHaveLength(0);
    expect(res.outcome).toBe("NO_QUALIFIED_RESULTS");
    expect(res.search_run_id).toBeTruthy();
  });

  it("adversarial C: funding web hit cannot qualify developer need via gapfill gate", () => {
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    const entity_id = mintProvisionalEntityId("fi");
    const row: SpecRow = applyPageClassificationToLiveRow({
      kind: "person",
      title: "Founder Institute",
      detail: "announces funded startups",
      url: "https://fi.co/news",
      key: "live-web:fi",
      entity_id,
      entity_resolved: false,
      evidence: evidenceFromWebHit({
        title: "Founder Institute",
        snippet: "announces funded startups raised series",
        url: "https://fi.co/news",
        spec,
      }),
    });
    const { kept } = applyWhyMatchGate([row], spec, true);
    expect(kept).toHaveLength(0);
    const q = qualifyLead(row, spec, row.evidence);
    expect(q.disposition).not.toBe("qualified");
  });

  it("adversarial D: Monster job board cannot qualify as company needing marketing", () => {
    const spec = extractSearchSpec("companies needing marketing help");
    const row: SpecRow = applyPageClassificationToLiveRow({
      kind: "company",
      title: "Marketing Jobs on Monster",
      detail: "Browse openings",
      url: "https://www.monster.com/jobs/q-marketing-jobs",
      key: "live-web:monster",
      entity_id: mintProvisionalEntityId("monster"),
      evidence: [
        makeEvidence({
          source_url: "https://www.monster.com/jobs/q-marketing-jobs",
          source_type: "job",
          excerpt: "Marketing Jobs",
          evidence_type: "hiring",
          supports: "requested_service",
          subject: "source:monster",
        }),
      ],
    });
    expect(row.page_type).toBe("job_board");
    const { kept } = applyWhyMatchGate([row], spec, true);
    expect(kept).toHaveLength(0);
  });

  it("adversarial article: TechCrunch page is not the funded company", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const row: SpecRow = applyPageClassificationToLiveRow({
      kind: "company",
      title: "Berlin startup raises seed",
      detail: "raised $5M",
      url: "https://techcrunch.com/2024/berlin-startup-raises",
      key: "live-web:tc",
      entity_id: mintProvisionalEntityId("tc"),
      evidence: evidenceFromWebHit({
        title: "Berlin startup raises seed",
        snippet: "raised series seed venture",
        url: "https://techcrunch.com/2024/berlin-startup-raises",
        spec,
      }),
    });
    expect(row.page_type).toBe("article");
    expect(applyWhyMatchGate([row], spec, true).kept).toHaveLength(0);
  });

  it("adversarial E: list page cannot qualify as funded startup", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const row: SpecRow = applyPageClassificationToLiveRow({
      kind: "company",
      title: "50 startups recently funded in Berlin",
      detail: "Seedtable directory",
      url: "https://www.seedtable.com/best-startups-berlin",
      location: "Berlin",
      key: "live-web:seedtable",
      entity_id: mintProvisionalEntityId("seed"),
      evidence: [
        makeEvidence({
          source_url: "https://www.seedtable.com/best-startups-berlin",
          source_type: "web",
          excerpt: "50 startups recently funded",
          evidence_type: "funding",
          supports: "intent",
          subject: "list:seedtable",
          event_at: new Date().toISOString(),
        }),
      ],
    });
    expect(["list", "aggregator"]).toContain(row.page_type);
    const gated = applyQualificationGate([row], spec);
    expect(gated.qualified).toHaveLength(0);
  });

  it("rejected candidates do not stamp verified / persist", () => {
    const row: SpecRow = {
      kind: "company",
      title: "Monster",
      detail: "",
      url: "https://monster.com/jobs",
      key: "live-web:monster",
      entity_id: mintProvisionalEntityId("m"),
      entity_resolved: false,
      page_type: "job_board",
      disposition: "dropped",
      evidence: [
        makeEvidence({
          source_url: "https://monster.com/jobs",
          source_type: "job",
          excerpt: "jobs",
          evidence_type: "hiring",
          supports: "requested_role",
        }),
      ],
    };
    expect(isVerifiedForPersist(row)).toBe(false);
    expect(stampVerified([row])[0].verification_status).not.toBe("verified");
  });

  it("OSM record without a website cannot prove website absence", async () => {
    const osmRow: SpecRow = {
      kind: "business",
      title: "NoSite Cafe",
      detail: "Toronto",
      location: "Toronto",
      category: "cafe",
      key: "live-osm:nosite-cafe",
      entity_id: "live-osm:nosite-cafe",
      entity_resolved: true,
      page_type: "entity_page",
      url: null,
      phone: "+1-416-555-0199",
      opportunity: "no_website",
    };
    const res = await runSpecSearchCore(
      "cafes in Toronto without a website",
      {
        businesses: (async () => ({
          rows: [],
          meta: {
            dbHit: false,
            engine: "s3-parquet",
            partitionsRead: [],
            rowsScanned: 0,
            rowsReturned: 0,
          },
        })) as never,
        index: null,
        liveGapfill: {
          osm: async () => [osmRow],
          web: null,
          jobs: null,
        },
      },
      25,
      { mode: "selling", offer: "websites" },
    );
    expect(res.qualified_count).toBe(res.rows.length);
    expect(res.rows).toHaveLength(0);
    expect(res.outcome).toBe("NO_QUALIFIED_RESULTS");
  });
});

describe("M3 — run identity + cancellation", () => {
  it("stale run A finishing after B is discarded", () => {
    const runA = createSearchRun();
    const runB = createSearchRun();
    const active = runB.search_run_id;
    const lateA = { search_run_id: runA.search_run_id, rows: [{ title: "stale" }] };
    expect(shouldDiscardStaleResult(lateA, active)).toBe(true);
    expect(isActiveRun(runB.search_run_id, active)).toBe(true);
  });

  it("runSpecSearchCore echoes search_run_id", async () => {
    const run = createSearchRun({ search_run_id: "run_test_fixed" });
    const res = await runSpecSearchCore(
      "bro i need businesses plz asap",
      { index: null },
      25,
      {},
      { search_run_id: run.search_run_id, conversation_id: run.conversation_id },
    );
    expect(res.search_run_id).toBe("run_test_fixed");
    expect(res.conversation_id).toBe(run.conversation_id);
  });

  it("aborted signal yields SEARCH_CANCELLED and empty delivery", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await runSpecSearchCore(
      "dentists in Toronto",
      {
        signal: ctrl.signal,
        businesses: (async () => {
          throw new Error("should not run");
        }) as never,
        index: null,
        liveGapfill: null,
      },
      25,
      { mode: "looking" },
    );
    expect(res.outcome).toBe("SEARCH_CANCELLED");
    expect(res.rows).toHaveLength(0);
    expect(res.qualified_count).toBe(0);
  });

  it("mid-run abort during live gapfill yields SEARCH_CANCELLED", async () => {
    const ctrl = new AbortController();
    const res = await runSpecSearchCore(
      "founders needing developers in Berlin",
      {
        signal: ctrl.signal,
        people: (async () => ({
          rows: [],
          meta: {
            dbHit: false,
            engine: "none",
            partitionsRead: [],
            rowsScanned: 0,
            rowsReturned: 0,
          },
        })) as never,
        index: null,
        liveGapfill: {
          web: async () => {
            ctrl.abort();
            const { throwIfAborted } = await import("../search-run");
            throwIfAborted(ctrl.signal);
            return [];
          },
          signal: ctrl.signal,
        },
      },
      25,
      { mode: "looking" },
    );
    expect(res.outcome).toBe("SEARCH_CANCELLED");
    expect(res.rows).toHaveLength(0);
  });

  it("outcome precedence: CANCELLED > FAILED > UNSUPPORTED > NO_QUALIFIED", () => {
    expect(
      finalizeSearchOutcome(
        [{ code: "SOURCE_UNAVAILABLE" }, { code: "NO_QUALIFIED_RESULTS" }],
        { cancelled: true, qualifiedCount: 0 },
      ).outcome,
    ).toBe("SEARCH_CANCELLED");
    expect(
      finalizeSearchOutcome([{ code: "SOURCE_UNAVAILABLE" }], {
        qualifiedCount: 0,
      }).outcome,
    ).toBe("NO_QUALIFIED_RESULTS");
  });
});
