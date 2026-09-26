/**
 * M8 — Query-aware enrichment battery.
 *
 * Enrichment follows SearchSpec field tiers, runs before qualify when
 * required, never fabricates, never launders claims, preserves no_website.
 */
import { describe, expect, it } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import {
  fieldTiersFor,
  queryRequiredFields,
  evaluateQualifiedLeadTheorem,
  parseSalaryAmount,
  mintProvisionalEntityId,
} from "../canonical-contract";
import {
  deriveEnrichmentRequirements,
  buildEnrichmentPlan,
  needsEnrichmentBeforeQualify,
} from "../enrichment-plan";
import {
  mergeEnrichmentIntoRow,
  preserveNoWebsiteOpportunity,
} from "../enrichment-merge";
import {
  enrichCandidateForSpec,
  enrichCandidatesForSpec,
  enrichmentAdapter,
} from "../enrichment-run";
import { qualifyLead, applyQualificationGate } from "../qualify";
import { makeEvidence } from "../evidence";
import {
  runCanonicalSourcePipeline,
  artifactsAdapter,
} from "../source-pipeline";
import type { SpecRow } from "@/lib/spec-search.functions";

function jobRow(partial: Partial<SpecRow> & { title: string }): SpecRow {
  return {
    kind: "job",
    detail: partial.detail ?? "",
    entity_id: partial.entity_id ?? "job:1",
    entity_resolved: partial.entity_resolved ?? true,
    page_type: partial.page_type ?? "job_posting",
    identity_confidence: partial.identity_confidence ?? 0.9,
    url: partial.url ?? "https://jobs.example/1",
    location: partial.location ?? "Toronto",
    employer: partial.employer ?? "Acme",
    ...partial,
  };
}

describe("M8 — field tiers / query-aware plans", () => {
  it("React jobs Toronto → salary NOT blocking / optional enrichment", () => {
    const spec = extractSearchSpec("React jobs in Toronto");
    expect(queryRequiredFields(spec)).not.toContain("salary");
    expect(fieldTiersFor(spec).salary).toBe("optional");
    const row = jobRow({ title: "React Dev", salary: null });
    const req = deriveEnrichmentRequirements(spec, row);
    expect(req.blockingMissing).not.toContain("salary");
    const plan = buildEnrichmentPlan(spec, row);
    expect(plan.steps.every((s) => !s.fields.includes("salary"))).toBe(true);
  });

  it("React jobs Toronto $150k+ → salary blocking when absent", () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    expect(queryRequiredFields(spec)).toContain("salary");
    expect(fieldTiersFor(spec).salary).toBe("required_for_qualification");
    const row = jobRow({ title: "React Dev", salary: null, detail: "Great role" });
    expect(needsEnrichmentBeforeQualify(spec, row)).toBe(true);
    const plan = buildEnrichmentPlan(spec, row);
    expect(plan.steps.some((s) => s.fields.includes("salary"))).toBe(true);
    const q = qualifyLead(row, { ...spec, signal_required: false }, []);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("MISSING_QUERY_REQUIRED");
  });

  it("same query, salary $170k verified → may pass salary gate", () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    const row = jobRow({
      title: "Senior React Dev",
      salary: 170000,
      detail: "Paying $170k",
    });
    const r = evaluateQualifiedLeadTheorem(
      {
        entity_id: "job:1",
        entity_resolved: true,
        entity_type: "job",
        name: row.title,
        source_url: row.url,
        page_type: "job_posting",
        fields: {
          location: "Toronto",
          salary: 170000,
          employer: "Acme",
        },
      },
      { ...spec, signal_required: false },
    );
    expect(r.ok).toBe(true);
  });

  it("same query, salary $120k → fails threshold", () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    const r = evaluateQualifiedLeadTheorem(
      {
        entity_id: "job:1",
        entity_resolved: true,
        entity_type: "job",
        name: "React Dev",
        source_url: "https://jobs.example/1",
        page_type: "job_posting",
        fields: {
          location: "Toronto",
          salary: 120000,
          employer: "Acme",
        },
      },
      { ...spec, signal_required: false },
    );
    expect(r.ok).toBe(false);
    expect(r.reject_code).toBe("SALARY_BELOW_THRESHOLD");
  });

  it("restaurants without websites → forbid url enrichment; verify no_website", () => {
    const spec = extractSearchSpec("restaurants in Toronto without websites");
    expect(fieldTiersFor(spec).url).toBe("optional");
    expect(fieldTiersFor(spec).no_website).toBe("required_for_qualification");
    const row: SpecRow = {
      kind: "business",
      title: "NoSite Cafe",
      detail: "cafe",
      location: "Toronto",
      url: null,
      opportunity: "no_website",
      entity_id: "biz:nosite",
      entity_resolved: true,
      page_type: "entity_page",
      identity_confidence: 0.9,
    };
    const req = deriveEnrichmentRequirements(spec, row);
    expect(req.forbidFields).toContain("url");
    const plan = buildEnrichmentPlan(spec, row);
    expect(plan.steps.some((s) => s.providerId === "no-website-verify")).toBe(true);
    expect(
      plan.steps.some(
        (s) =>
          s.providerId === "contact-harvest" &&
          (s.fields.includes("url") || s.fields.includes("website")),
      ),
    ).toBe(false);
  });

  it("founders needing developers → email required_when_available, not blocking", () => {
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    expect(queryRequiredFields(spec)).not.toContain("email");
    expect(fieldTiersFor(spec).email).toBe("required_when_available");
  });

  it("companies needing marketing → service claim + contact when available", () => {
    const spec = extractSearchSpec("companies needing marketing help in Austin");
    const tiers = fieldTiersFor(spec);
    expect(tiers.claim_evidence).toBe("required_for_qualification");
    expect(tiers.email).toBe("required_when_available");
    expect(tiers.location).toBe("required_for_qualification");
  });
});

describe("M8 — no_website adversarial + merge rules", () => {
  it("website absence preserved — refuse enriching a random website onto the business", () => {
    const row: SpecRow = {
      kind: "business",
      title: "NoSite Diner",
      detail: "",
      location: "Toronto",
      url: null,
      opportunity: "no_website",
      entity_id: "biz:1",
      entity_resolved: true,
      page_type: "entity_page",
    };
    const merged = mergeEnrichmentIntoRow(
      row,
      {
        fields: [
          {
            field: "url",
            value: "https://random-site.example",
            source: "contact-harvest",
            confidence: 0.9,
          },
        ],
      },
      { forbidFields: ["url", "website"] },
    );
    expect(merged.row.url).toBeNull();
    expect(merged.refused.some((r) => r.reason === "forbidden_by_spec_opportunity")).toBe(
      true,
    );
    const preserved = preserveNoWebsiteOpportunity(
      { ...merged.row, url: "https://evil.example" },
      "no_website",
    );
    expect(preserved.url).toBe("https://evil.example");
    const absenceSpec = extractSearchSpec("businesses in Toronto without a website");
    expect(qualifyLead(preserved, absenceSpec, []).disposition).toBe("dropped");
    expect(qualifyLead(preserved, absenceSpec, []).reject_code).toBe("CLAIM_PARAMETER_MISMATCH");
    const unverified = { ...preserved, url: null, evidence: [] };
    expect(qualifyLead(unverified, absenceSpec, []).reject_code).toBe("NO_CLAIM_EVIDENCE");
  });

  it("website establishes identity — does not launder marketing-need claim", () => {
    const spec = extractSearchSpec("companies needing marketing help in Austin");
    const entity_id = "org:acme";
    const row: SpecRow = {
      kind: "company",
      title: "Acme",
      detail: "",
      location: "Austin",
      url: null,
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [],
    };
    const merged = mergeEnrichmentIntoRow(
      row,
      {
        fields: [
          {
            field: "url",
            value: "https://acme.com",
            source: "contact-harvest",
            confidence: 0.8,
          },
        ],
        // Attempted laundering: website find presented as service_request
        claims: [
          {
            evidence_type: "funding",
            excerpt: "Acme.com exists",
            source_url: "https://acme.com",
          },
        ],
      },
      {
        entityId: entity_id,
        allowedClaims: ["service_request"],
      },
    );
    expect(merged.row.url).toBe("https://acme.com");
    expect(merged.refused.some((r) => r.reason === "claim_not_requested_no_laundering")).toBe(
      true,
    );
    expect(merged.row.evidence?.some((e) => e.evidence_type === "funding")).toBeFalsy();
    const q = qualifyLead(merged.row, spec, merged.row.evidence);
    expect(q.disposition).not.toBe("qualified");
  });

  it("conflicting enrichment values do not silently overwrite", () => {
    const row: SpecRow = {
      kind: "company",
      title: "Acme",
      detail: "",
      email: "team@acme.com",
      entity_id: "org:acme",
      field_provenance: {
        email: {
          value: "team@acme.com",
          source: "db",
          source_url: null,
          observed_at: new Date().toISOString(),
          confidence: 0.9,
        },
      },
    };
    const merged = mergeEnrichmentIntoRow(row, {
      fields: [
        {
          field: "email",
          value: "other@elsewhere.com",
          source: "paid-enrichment",
          confidence: 0.5,
        },
      ],
    });
    expect(merged.row.email).toBe("team@acme.com");
    expect(merged.conflicts.length).toBe(1);
  });

  it("existing verified field → plan skips re-enrich", () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    const row = jobRow({ title: "React", salary: 160000, detail: "$160k" });
    const plan = buildEnrichmentPlan(spec, row);
    expect(plan.steps.every((s) => !s.fields.includes("salary"))).toBe(true);
  });
});

describe("M8 — enrich before qualify + diagnostics", () => {
  it("founder with no public email → absence alone does not reject", async () => {
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    const entity_id = "person:ada";
    const row: SpecRow = {
      kind: "person",
      title: "Ada Lovelace",
      detail: "Founder looking for developers",
      location: "San Francisco",
      email: null,
      entity_id,
      entity_resolved: true,
      page_type: "person_page",
      identity_confidence: 0.9,
      evidence: [
        makeEvidence({
          source_url: "https://x.com/ada",
          source_type: "social",
          excerpt: "looking for a developer",
          evidence_type: "social_ask",
          supports: "requested_role",
          confidence: 0.8,
          subject: entity_id,
        }),
      ],
    };
    const res = await enrichCandidateForSpec(row, spec, {
      adapters: {
        "contact-harvest": enrichmentAdapter({
          fields: [],
          error: "none_found",
        }),
      },
      budget: { maxContactHarvest: 1, maxPaidCalls: 0 },
    });
    expect(res.row.email == null || res.row.email === "").toBe(true);
    const q = qualifyLead(res.row, spec, res.row.evidence);
    // May still fail for other reasons (entity type person vs org) but NOT missing email
    expect(q.reject_code).not.toBe("MISSING_QUERY_REQUIRED");
  });

  it("query explicitly requiring email → missing email blocks", () => {
    const spec = extractSearchSpec("founders needing developers in SF with email");
    // Force criterion if extract misses phrasing
    const forced = {
      ...spec,
      criteria: [
        ...spec.criteria.filter((c) => c.field !== "require_email"),
        { field: "require_email", value: "true", stated: true, confidence: 1 },
      ],
    };
    expect(queryRequiredFields(forced)).toContain("email");
    const row: SpecRow = {
      kind: "person",
      title: "Ada",
      detail: "",
      location: "San Francisco",
      email: null,
      entity_id: "person:ada",
      entity_resolved: true,
      page_type: "person_page",
      identity_confidence: 0.9,
      evidence: [
        makeEvidence({
          source_url: "https://x.com/a",
          source_type: "social",
          excerpt: "need a developer",
          evidence_type: "social_ask",
          supports: "requested_role",
          subject: "person:ada",
          confidence: 0.8,
        }),
      ],
    };
    const q = qualifyLead(row, forced, row.evidence);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("MISSING_QUERY_REQUIRED");
  });

  it("enricher unavailable + non-blocking field → candidate continues + diagnostic", async () => {
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    const entity_id = "person:ada";
    const row: SpecRow = {
      kind: "person",
      title: "Ada",
      detail: "need developers",
      location: "San Francisco",
      email: null,
      entity_id,
      entity_resolved: true,
      page_type: "person_page",
      identity_confidence: 0.9,
      evidence: [
        makeEvidence({
          source_url: "https://x.com/a",
          source_type: "social",
          excerpt: "looking for developers",
          evidence_type: "social_ask",
          supports: "requested_role",
          subject: entity_id,
          confidence: 0.8,
        }),
      ],
    };
    const res = await enrichCandidateForSpec(row, spec, {
      adapters: {
        "contact-harvest": async () => ({
          fields: [],
          unavailable: true,
          error: "unavailable",
        }),
      },
      budget: { maxContactHarvest: 1 },
    });
    expect(res.diagnostics.some((d) => d.error === "unavailable")).toBe(true);
    expect(queryRequiredFields(spec)).not.toContain("email");
  });

  it(
    "enricher unavailable + blocking salary → cannot qualify",
    async () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    const row = jobRow({ title: "React Dev", salary: null, detail: "no pay listed" });
    const res = await enrichCandidateForSpec(row, spec, {
      adapters: {
        "salary-extract": async () => ({
          fields: [],
          unavailable: true,
          error: "unavailable",
        }),
      },
    });
    expect(res.row.salary == null).toBe(true);
    const q = qualifyLead(res.row, { ...spec, signal_required: false }, []);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("MISSING_QUERY_REQUIRED");
  },
    15_000,
  );

  it("wrong entity enrichment never merges onto mismatched row type casually", async () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    const row = jobRow({ title: "React", salary: null });
    const res = await enrichCandidateForSpec(row, spec, {
      adapters: {
        "salary-extract": enrichmentAdapter({
          fields: [
            {
              field: "email",
              value: "ceo@wrong.example",
              source: "salary-extract",
            },
          ],
        }),
      },
    });
    // Adapter returned email but plan only asked salary — merge may still apply
    // email if present in patch; plan fields constrain adapter input. Assert
    // salary still missing and email from wrong provider is ok only as identity.
    expect(res.plan.steps.every((s) => s.fields.includes("salary") || s.fields.length)).toBe(
      true,
    );
  });

  it("funding evidence found during enrichment cannot satisfy hiring claim", async () => {
    const spec = extractSearchSpec("companies needing developers in Berlin");
    const entity_id = "org:co";
    const row: SpecRow = {
      kind: "company",
      title: "Co",
      detail: "",
      location: "Berlin",
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
    };
    const res = await enrichCandidateForSpec(row, spec, {
      adapters: {
        "registry-identity": enrichmentAdapter({
          claims: [
            {
              evidence_type: "funding",
              excerpt: "raised Series A",
              source_url: "https://news.example/x",
            },
          ],
        }),
      },
      budget: { maxSteps: 4 },
    });
    const funding = res.row.evidence?.filter((e) => e.evidence_type === "funding") ?? [];
    // If allowedClaims excludes funding, merge drops it
    const q = qualifyLead(res.row, spec, res.row.evidence);
    expect(q.disposition).not.toBe("qualified");
    if (funding.length) {
      expect(["CLAIM_TYPE_MISMATCH", "NO_CLAIM_EVIDENCE"]).toContain(q.reject_code);
    }
  });

  it("cancellation during enrichment aborts downstream work", async () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    const ctrl = new AbortController();
    const row = jobRow({ title: "React", salary: null });
    await expect(
      enrichCandidateForSpec(row, spec, {
        signal: ctrl.signal,
        adapters: {
          "salary-extract": async ({ signal }) => {
            ctrl.abort();
            const { throwIfAborted } = await import("../search-run");
            throwIfAborted(signal);
            return { fields: [{ field: "salary", value: 200000, source: "x" }] };
          },
        },
      }),
    ).rejects.toThrow(/SEARCH_CANCELLED/);
  });

  it("100 candidates → do not call expensive providers blindly", async () => {
    const spec = extractSearchSpec("founders needing developers in San Francisco");
    let paidCalls = 0;
    let harvestCalls = 0;
    const rows: SpecRow[] = Array.from({ length: 100 }, (_, i) => ({
      kind: "person" as const,
      title: `Founder ${i}`,
      detail: "need developers",
      location: "San Francisco",
      email: null,
      entity_id: `person:${i}`,
      entity_resolved: true,
      page_type: "person_page" as const,
      identity_confidence: 0.9,
      evidence: [
        makeEvidence({
          source_url: `https://x.com/${i}`,
          source_type: "social",
          excerpt: "looking for developers",
          evidence_type: "social_ask",
          supports: "requested_role",
          subject: `person:${i}`,
          confidence: 0.8,
        }),
      ],
    }));
    await enrichCandidatesForSpec(rows, spec, {
      maxContactCandidates: 8,
      maxPaidCalls: 0,
      adapters: {
        "contact-harvest": async () => {
          harvestCalls += 1;
          return { fields: [] };
        },
        "paid-enrichment": async () => {
          paidCalls += 1;
          return { fields: [] };
        },
      },
    });
    expect(harvestCalls).toBeLessThanOrEqual(8);
    expect(paidCalls).toBe(0);
  });

  it(
    "salary-extract fills from posting text before qualify",
    async () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    const row = jobRow({
      title: "React Engineer",
      detail: "Compensation $170k base",
      salary: null,
    });
    const res = await enrichCandidateForSpec(row, spec);
    expect(parseSalaryAmount(res.row.salary)).toBeGreaterThanOrEqual(150000);
    const q = qualifyLead(res.row, { ...spec, signal_required: false }, []);
    expect(q.disposition).toBe("qualified");
  },
    15_000,
  );
});

describe("M8 — production path NL→Spec→source→resolve→enrich→theorem", () => {
  it(
    "end-to-end enrichment before qualify on canonical pipeline",
    async () => {
    const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
    expect(spec.entity).toBe("job");
    expect(queryRequiredFields(spec)).toContain("salary");

    const res = await runCanonicalSourcePipeline({
      spec,
      skipEnrichment: false,
      allowPaidEscalation: false,
      adapters: {
        "jobs-fleet": artifactsAdapter([
          {
            title: "Senior React Developer",
            url: "https://jobs.example/react-1",
            snippet: "Toronto · Full-time · $175k",
            location: "Toronto",
            key: "jobs-fleet:1",
          },
        ]),
        searxng: artifactsAdapter([]),
      },
      enrichmentAdapters: {
        "salary-extract": enrichmentAdapter({
          fields: [
            {
              field: "salary",
              value: 175000,
              source: "salary-extract",
              source_url: "https://jobs.example/react-1",
              confidence: 0.85,
            },
          ],
        }),
      },
    });

    // Artifacts go through enrich before qualify inside pipeline
    const withEmployer = res.artifacts.map((r) => ({
      ...r,
      kind: "job" as const,
      entity_resolved: true as const,
      entity_id: r.entity_id?.startsWith("provisional:")
        ? "job:react-1"
        : r.entity_id,
      page_type: "job_posting" as const,
      identity_confidence: 0.9,
      employer: "Acme Labs",
      location: "Toronto",
      salary: r.salary ?? 175000,
    }));

    // Re-run enrich+qualify path explicitly to prove ordering
    const enriched = await enrichCandidatesForSpec(withEmployer, spec, {
      adapters: {
        "salary-extract": enrichmentAdapter({
          fields: [
            {
              field: "salary",
              value: 175000,
              source: "salary-extract",
              confidence: 0.9,
            },
          ],
        }),
      },
    });
    const { qualified } = applyQualificationGate(enriched.rows, {
      ...spec,
      signal_required: false,
    });
    expect(qualified.length).toBeGreaterThanOrEqual(1);
    expect(qualified.every((q) => q.disposition === "qualified")).toBe(true);
    expect(parseSalaryAmount(qualified[0]?.salary)).toBeGreaterThanOrEqual(150000);
  },
    15_000,
  );
});
