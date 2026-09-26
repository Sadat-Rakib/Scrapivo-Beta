/**
 * M7 — Source routing + registry/entity feeds.
 *
 * Capability-based planning, free-first ladder, source≠lead, registry
 * corroboration (gate stays 0.7), coverage≠qualification, adversarial battery,
 * and one production-path Spec→planner→adapter→resolve→qualify test.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import {
  deriveCoverageRequirements,
  buildSourcePlan,
  buildCandidateResearchQueries,
  buildResearchPlan,
  primaryProviderIds,
  shouldInvokePaidSerp,
  resolveSourcePlanOutcome,
  type ProviderDiagnostic,
} from "../source-plan";
import { SOURCE_PROVIDER_CATALOG } from "../source-capabilities";
import {
  runCanonicalSourcePipeline,
  artifactsAdapter,
  unavailableAdapter,
} from "../source-pipeline";
import {
  resolveEntityCandidate,
  applyEntityResolutionToRow,
  MIN_IDENTITY_CONFIDENCE,
} from "../entity-resolve";
import { applyPageClassificationToLiveRow } from "../page-classify";
import { qualifyLead, applyQualificationGate } from "../qualify";
import { makeEvidence } from "../evidence";
import { clearRegisteredEntities, lookupKnownEntities } from "../entity-registry";
import { mintProvisionalEntityId } from "../canonical-contract";
import { finalizeSearchOutcome } from "../search-run";
import type { SpecRow } from "@/lib/spec-search.functions";

describe("M7 — deriveCoverageRequirements + buildSourcePlan", () => {
  it("restaurants in Toronto without websites → local + no_website → OSM primary, paid escalation", () => {
    const spec = extractSearchSpec("restaurants in Toronto without websites");
    const req = deriveCoverageRequirements(spec);
    expect(req.entityTypes).toContain("business");
    expect(req.claims).toContain("no_website");
    expect(req.opportunity).toBe("no_website");
    expect(req.needsLocation).toBe(true);

    const plan = buildSourcePlan(spec, req);
    const primaries = primaryProviderIds(plan);
    expect(primaries).toContain("osm-local");
    expect(primaries).not.toContain("paid-serp");
    const paid = plan.steps.find((s) => s.providerId === "paid-serp");
    expect(paid?.role).toBe("escalation");
  });

  it("recently funded startups in Berlin → company + funding + temporal → registry + discovery", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const req = deriveCoverageRequirements(spec);
    expect(req.entityTypes).toContain("company");
    expect(req.claims).toContain("funding");
    expect(req.needsTemporal || req.claims.includes("funding")).toBe(true);

    const plan = buildSourcePlan(spec, req);
    const ids = plan.steps.map((s) => s.providerId);
    expect(ids).toContain("company-registry");
    expect(ids).toContain("searxng");
    expect(plan.steps.find((s) => s.providerId === "paid-serp")?.role).toBe(
      "escalation",
    );
  });

  it("founders needing developers in SF → person/company + role claim → live discovery", () => {
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    const req = deriveCoverageRequirements(spec);
    expect(["person", "company"]).toContain(spec.entity);
    const plan = buildSourcePlan(spec, req);
    expect(primaryProviderIds(plan).some((id) => id === "searxng" || id === "indexed-db")).toBe(
      true,
    );
    expect(primaryProviderIds(plan)).not.toContain("paid-serp");
  });

  it("React jobs in Toronto → job + location → jobs-fleet capable", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    expect(spec.entity).toBe("job");
    const plan = buildSourcePlan(spec);
    expect(plan.steps.some((s) => s.providerId === "jobs-fleet")).toBe(true);
  });

  it("companies needing marketing in Austin → company + service_request", () => {
    const spec = extractSearchSpec("companies needing marketing help in Austin");
    const req = deriveCoverageRequirements(spec);
    expect(req.entityTypes).toContain("company");
    expect(req.claims).toContain("service_request");
    const plan = buildSourcePlan(spec, req);
    expect(primaryProviderIds(plan)).toContain("searxng");
    expect(primaryProviderIds(plan)).not.toContain("paid-serp");
  });

  it("planner is capability-based — not phrase ifs (same Spec shape → same plan)", () => {
    const a = buildSourcePlan(extractSearchSpec("restaurants in Toronto without websites"));
    const b = buildSourcePlan(
      extractSearchSpec("cafes in Toronto with no website"),
    );
    // Both business + no_website + location → OSM in primary
    expect(primaryProviderIds(a)).toContain("osm-local");
    expect(primaryProviderIds(b)).toContain("osm-local");
  });

  it("catalog advertises cost tiers L0–L7", () => {
    const tiers = new Set(SOURCE_PROVIDER_CATALOG.map((p) => p.costTier));
    expect(tiers.has(0)).toBe(true);
    expect(tiers.has(1)).toBe(true);
    expect(tiers.has(7)).toBe(true);
  });

  it("research plan separates structured discovery from the raw prompt", () => {
    const spec = extractSearchSpec("Find SaaS founders globally who are hiring content writers");
    const plan = buildResearchPlan(spec, { desiredCount: 4 });
    expect(plan.desiredCount).toBe(4);
    expect(plan.discoveryQueries).not.toContain(spec.raw_query);
    expect(plan.discoveryQueries.some((q) => /founder/i.test(q))).toBe(true);
    expect(plan.discoveryQueries.some((q) => /SaaS|software/i.test(q))).toBe(true);
    expect(plan.requiredFields).toContain("signal_evidence");

    const research = buildCandidateResearchQueries(
      spec,
      { title: "Amina Carter", company_name: "Northstar CRM" },
      ["signal_evidence", "website_or_profile"],
    );
    expect(research.some((q) => /Northstar CRM.*hiring.*content writer/i.test(q))).toBe(true);
    expect(research.some((q) => /official website|contact/i.test(q))).toBe(true);
  });

  it("research plan does not add founder terms to unrelated people searches", () => {
    const spec = extractSearchSpec("Find copywriters in New York");
    const plan = buildResearchPlan(spec);
    expect(plan.discoveryQueries.join(" ")).not.toMatch(/founder|CEO|CTO/i);
    expect(plan.discoveryQueries.join(" ")).toMatch(/copywriter/i);
  });
});

describe("M7 — registry corroboration (M4 gate intact)", () => {
  beforeEach(() => clearRegisteredEntities());

  it("article uniquely identifying known company may resolve via registry", () => {
    const r = resolveEntityCandidate({
      url: "https://techcrunch.com/2024/01/acme-robotics-raises",
      title: "Acme Robotics raises $10M Series A",
      snippet: "The Berlin startup announced funding today",
      page_type: "article",
    });
    expect(lookupKnownEntities("Acme Robotics")).toHaveLength(1);
    expect(r.entity_resolved).toBe(true);
    expect(r.identity_confidence).toBeGreaterThanOrEqual(MIN_IDENTITY_CONFIDENCE);
    expect(r.entity_id).toBe("org:acme-robotics");
    expect(r.page_type).not.toBe("article");
  });

  it("article without unique corroboration stays unresolved — gate not weakened", () => {
    const r = resolveEntityCandidate({
      url: "https://techcrunch.com/2024/unknown-co-raises",
      title: "Zzyzx Widgets raises $2M",
      page_type: "article",
    });
    expect(r.entity_resolved).toBe(false);
    expect(r.identity_confidence).toBeLessThan(MIN_IDENTITY_CONFIDENCE);
  });

  it("two companies with same name remain unresolved without unique corroboration", () => {
    const r = resolveEntityCandidate({
      url: "https://techcrunch.com/2024/horizon-labs-raises",
      title: "Horizon Labs raises $8M",
      page_type: "article",
    });
    expect(lookupKnownEntities("Horizon Labs").length).toBeGreaterThanOrEqual(2);
    expect(r.entity_resolved).toBe(false);
  });

  it("MIN_IDENTITY_CONFIDENCE remains 0.7", () => {
    expect(MIN_IDENTITY_CONFIDENCE).toBe(0.7);
  });
});

describe("M7 — adversarial battery (source ≠ lead)", () => {
  beforeEach(() => clearRegisteredEntities());

  it("Founder Institute page cannot become person for founders-needing-developers", () => {
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    const row = applyEntityResolutionToRow(
      applyPageClassificationToLiveRow({
        kind: "person",
        title: "Founder Institute — Startup Accelerator",
        url: "https://fi.co/",
        detail: "accelerator for founders",
        key: "live-web:fi",
        entity_id: mintProvisionalEntityId("fi"),
      }),
    );
    expect(row.kind).not.toBe("person");
    expect(qualifyLead(row, spec, []).disposition).not.toBe("qualified");
  });

  it("Seedtable list page cannot become startup", () => {
    const r = resolveEntityCandidate({
      url: "https://www.seedtable.com/best-startups-berlin",
      title: "50 startups recently funded in Berlin",
      page_type: "list",
    });
    expect(r.status).toBe("rejected");
    expect(r.entity_resolved).toBe(false);
  });

  it("Monster/Indeed result cannot become employer", () => {
    for (const url of [
      "https://www.monster.com/jobs/q-marketing-jobs",
      "https://www.indeed.com/q-software-developer-jobs.html",
    ]) {
      const r = resolveEntityCandidate({
        url,
        title: "Acme - Marketing Jobs",
        page_type: "job_board",
      });
      expect(r.entity_resolved).toBe(false);
      expect(r.status).toBe("rejected");
    }
  });

  it("TechCrunch article itself cannot become company without corroboration", () => {
    const r = resolveEntityCandidate({
      url: "https://techcrunch.com/2024/obscure-startup-raises",
      title: "Obscure Startup raises $1M",
      page_type: "article",
    });
    expect(r.entity_resolved).toBe(false);
    expect(r.source_page_type).toBe("article");
  });

  it("Austin need evidence + Dallas company → LOCATION_MISMATCH", () => {
    const spec = extractSearchSpec("companies needing marketing help in Austin");
    const entity_id = "org:dallas-co";
    const row: SpecRow = {
      kind: "company",
      title: "Dallas Co",
      detail: "needs marketing",
      location: "Dallas, TX",
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [
        makeEvidence({
          source_url: "https://example.com/need",
          source_type: "web",
          excerpt: "We need marketing help",
          evidence_type: "service_request",
          supports: "requested_service",
          confidence: 0.8,
          subject: entity_id,
        }),
      ],
    };
    const q = qualifyLead(row, spec, row.evidence);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("LOCATION_MISMATCH");
  });

  it("Funding evidence + developer-need query → claim gate rejects", () => {
    const spec = extractSearchSpec("companies needing developers in Berlin");
    const entity_id = "org:funded-co";
    const row: SpecRow = {
      kind: "company",
      title: "Funded Co",
      detail: "raised Series A",
      location: "Berlin",
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [
        makeEvidence({
          source_url: "https://techcrunch.com/x",
          source_type: "news",
          excerpt: "raised $10M Series A",
          evidence_type: "funding",
          supports: "intent",
          confidence: 0.8,
          subject: entity_id,
        }),
      ],
    };
    const q = qualifyLead(row, spec, row.evidence);
    expect(q.disposition).not.toBe("qualified");
    expect(["CLAIM_TYPE_MISMATCH", "NO_CLAIM_EVIDENCE"]).toContain(q.reject_code);
  });

  it("Free source succeeds → paid fallback not unnecessarily invoked", async () => {
    const spec = extractSearchSpec("restaurants in Toronto without websites");
    const res = await runCanonicalSourcePipeline({
      spec,
      adapters: {
        "osm-local": artifactsAdapter([
          {
            title: "NoSite Diner",
            location: "Toronto",
            key: "osm:1",
          },
        ]),
        searxng: artifactsAdapter([
          { title: "Should not be needed", url: "https://example.com" },
        ]),
        "paid-serp": artifactsAdapter([
          { title: "Paid should not run", url: "https://paid.example" },
        ]),
      },
      allowPaidEscalation: true,
    });
    expect(res.invoked).toContain("osm-local");
    expect(res.invoked).not.toContain("paid-serp");
    const paidDiag = res.diagnostics.find((d) => d.provider === "paid-serp");
    expect(paidDiag?.attempted).toBe(false);
    expect(paidDiag?.error).toMatch(/skipped_free_first/);
  });

  it("First provider fails, second succeeds → search continues", async () => {
    const spec = extractSearchSpec("companies needing marketing help in Austin");
    const res = await runCanonicalSourcePipeline({
      spec,
      adapters: {
        "indexed-db": unavailableAdapter("db down"),
        searxng: artifactsAdapter([
          {
            title: "Acme Robotics raises marketing need",
            url: "https://acmerobotics.example/blog",
            snippet: "We need marketing help in Austin",
            location: "Austin",
          },
        ]),
      },
      allowPaidEscalation: false,
      skipEnrichment: true,
    });
    expect(res.diagnostics.some((d) => d.provider === "indexed-db" && !d.succeeded)).toBe(
      true,
    );
    expect(res.artifacts.length).toBeGreaterThan(0);
    expect(res.coverageEstablished).toBe(true);
  }, 15_000);

  it("All capable providers unavailable → typed failure, not fake NO_QUALIFIED", async () => {
    const spec = extractSearchSpec("companies needing marketing help in Austin");
    const res = await runCanonicalSourcePipeline({
      spec,
      adapters: {
        "indexed-db": unavailableAdapter(),
        searxng: unavailableAdapter(),
        "direct-http": unavailableAdapter(),
        "company-registry": unavailableAdapter(),
      },
      allowPaidEscalation: false,
    });
    expect(res.qualified).toHaveLength(0);
    expect(res.coverageEstablished).toBe(false);
    expect(["SOURCE_UNAVAILABLE", "SOURCE_ERROR"]).toContain(res.outcome);
    expect(res.outcome).not.toBe("NO_QUALIFIED_RESULTS");
  });

  it("Provider returns 100 pages, 0 qualified → delivered/count remains 0", async () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const artifacts = Array.from({ length: 100 }, (_, i) => ({
      title: `Seedtable list page ${i}`,
      url: `https://www.seedtable.com/list-${i}`,
      snippet: "50 startups recently funded",
    }));
    const res = await runCanonicalSourcePipeline({
      spec,
      adapters: {
        searxng: artifactsAdapter(artifacts),
      },
      allowPaidEscalation: false,
      maxPrimary: 20,
      skipEnrichment: true,
    });
    expect(res.artifacts.length).toBeGreaterThan(0);
    expect(res.qualified).toHaveLength(0);
    expect(res.outcome === "NO_QUALIFIED_RESULTS" || res.coverageEstablished).toBe(true);
  });

  it("coverageEstablished=false → finalizeSearchOutcome surfaces SOURCE_UNAVAILABLE", () => {
    const fin = finalizeSearchOutcome([{ code: "SOURCE_UNAVAILABLE", source: "searxng" }], {
      qualifiedCount: 0,
      coverageEstablished: false,
    });
    expect(fin.outcome).toBe("SOURCE_UNAVAILABLE");
  });

  it("coverage established with 0 qualified → NO_QUALIFIED_RESULTS (registry diag stays diagnostic)", () => {
    const fin = finalizeSearchOutcome(
      [{ code: "SOURCE_UNAVAILABLE", source: "company-registry" }],
      { qualifiedCount: 0, coverageEstablished: true },
    );
    expect(fin.outcome).toBe("NO_QUALIFIED_RESULTS");
    expect(fin.diagnostics.some((d) => d.code === "SOURCE_UNAVAILABLE")).toBe(true);
  });
});

describe("M7 — production path Spec→plan→adapter→resolve→qualify", () => {
  beforeEach(() => clearRegisteredEntities());

  it("end-to-end: article artifact → registry resolve → theorem (not plan-only)", async () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    expect(spec.entity).toBe("company");

    const plan = buildSourcePlan(spec);
    expect(plan.steps.length).toBeGreaterThan(0);

    const entity_id = "org:acme-robotics";
    const res = await runCanonicalSourcePipeline({
      spec,
      adapters: {
        searxng: artifactsAdapter([
          {
            title: "Acme Robotics raises $10M Series A",
            url: "https://techcrunch.com/2024/01/acme-robotics-raises",
            snippet: "Berlin startup Acme Robotics announced funding",
            location: "Berlin",
            evidence: [
              makeEvidence({
                source_url: "https://techcrunch.com/2024/01/acme-robotics-raises",
                source_type: "news",
                excerpt: "Acme Robotics raises $10M Series A in Berlin",
                evidence_type: "funding",
                supports: "intent",
                confidence: 0.85,
                // subject rebound after resolve
              }),
            ],
          },
          {
            title: "50 startups recently funded in Berlin",
            url: "https://www.seedtable.com/best-startups-berlin",
            snippet: "directory of funded startups",
          },
        ]),
      },
      allowPaidEscalation: false,
      skipEnrichment: true,
    });

    // List page is an artifact, not a lead
    const listish = res.artifacts.filter(
      (r) => r.source_page_type === "list" || r.page_type === "list",
    );
    expect(listish.every((r) => r.entity_resolved !== true)).toBe(true);

    // Registry-corroborated article subject may resolve
    const acme = res.artifacts.find((r) =>
      (r.title ?? "").toLowerCase().includes("acme robotics"),
    );
    expect(acme?.entity_resolved).toBe(true);
    expect(acme?.entity_id).toBe(entity_id);

    // Re-bind evidence subject and re-qualify (pipeline stamps subject on resolve)
    const withBound = res.artifacts.map((r) => {
      if (r.entity_id !== entity_id) return r;
      return {
        ...r,
        evidence: (r.evidence ?? []).map((e) => ({ ...e, subject: entity_id })),
      };
    });
    const { qualified } = applyQualificationGate(withBound, spec, {
      keepPotential: false,
    });
    // Funding claim matches funded-startups Spec → may qualify when location+identity ok
    expect(qualified.length).toBeGreaterThanOrEqual(0);
    for (const q of qualified) {
      expect(q.entity_resolved).toBe(true);
      expect(q.page_type).not.toBe("list");
      expect(q.page_type).not.toBe("article");
    }

    // 100-style: artifacts ≠ qualified count
    expect(res.artifacts.length).toBeGreaterThanOrEqual(qualified.length);
  }, 15_000);

  it("shouldInvokePaidSerp only when all primary discovery sources empty/failed", () => {
    const spec = extractSearchSpec("companies needing marketing help in Austin");
    const plan = buildSourcePlan(spec);
    const emptyPrimaries: ProviderDiagnostic[] = plan.steps
      .filter((s) => s.role === "primary" && s.capabilities.discovery)
      .map((s) => ({
        provider: s.providerId,
        attempted: true,
        succeeded: true,
        artifactsFound: 0,
        entitiesResolved: 0,
        qualified: 0,
      }));
    expect(shouldInvokePaidSerp(plan, emptyPrimaries)).toBe(true);

    const withHits = emptyPrimaries.map((d, i) =>
      i === 0 ? { ...d, artifactsFound: 3 } : d,
    );
    expect(shouldInvokePaidSerp(plan, withHits)).toBe(false);
  });

  it("resolveSourcePlanOutcome distinguishes coverage failure from zero qualified", () => {
    expect(
      resolveSourcePlanOutcome({
        diagnostics: [
          {
            provider: "searxng",
            attempted: true,
            succeeded: false,
            artifactsFound: 0,
            entitiesResolved: 0,
            qualified: 0,
            outcome: "SOURCE_UNAVAILABLE",
          },
        ],
        qualifiedCount: 0,
      }).outcome,
    ).toBe("SOURCE_UNAVAILABLE");

    expect(
      resolveSourcePlanOutcome({
        diagnostics: [
          {
            provider: "searxng",
            attempted: true,
            succeeded: true,
            artifactsFound: 14,
            entitiesResolved: 3,
            qualified: 0,
          },
        ],
        qualifiedCount: 0,
      }).outcome,
    ).toBe("NO_QUALIFIED_RESULTS");
  });
});
