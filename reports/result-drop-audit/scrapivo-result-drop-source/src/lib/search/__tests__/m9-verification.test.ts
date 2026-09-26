/**
 * M9 — Verification / provenance / freshness battery.
 *
 * observed_at ≠ event_at. Subject binding is adversarial. Claim parameters
 * must align. Provenance is a chain, not a boolean.
 *
 * Status target: TESTED (not VERIFIED).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { makeEvidence } from "../evidence";
import { qualifyLead, applyQualificationGate, theoremCandidateFromRow } from "../qualify";
import {
  evaluateQualifiedLeadTheorem,
  asClaimEvidence,
} from "../canonical-contract";
import {
  evaluateTemporalValidity,
  deriveTemporalConstraint,
  deriveRequiredClaimParameters,
  claimParametersMatch,
  provenanceComplete,
  mergeEvidencePreservingEventAt,
  evaluateRoleCurrentness,
  verifyClaimEvidence,
  verifyCandidateClaims,
} from "../verification";
import {
  runCanonicalSourcePipeline,
  artifactsAdapter,
} from "../source-pipeline";
import { enrichCandidatesForSpec, enrichmentAdapter } from "../enrichment-run";
import { clearRegisteredEntities } from "../entity-registry";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "../evidence";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString();
}

function yearsAgo(n: number): string {
  return new Date(NOW - n * 365.25 * 86_400_000).toISOString();
}

function fundingRow(args: {
  entity_id: string;
  event_at?: string | null;
  observed_at?: string;
  excerpt?: string;
  subject?: string;
  location?: string;
}): SpecRow {
  const entity_id = args.entity_id;
  const ev = makeEvidence({
    source_url: "https://techcrunch.example/acme-raises",
    source_type: "news",
    excerpt: args.excerpt ?? "Acme raises Series A",
    evidence_type: "funding",
    supports: "intent",
    subject: args.subject ?? entity_id,
    observed_at: args.observed_at ?? new Date(NOW).toISOString(),
    event_at: args.event_at === undefined ? daysAgo(1) : args.event_at,
  });
  return {
    kind: "company",
    title: "Acme",
    detail: args.location ?? "Berlin",
    location: args.location ?? "Berlin",
    url: "https://acme.example",
    entity_id,
    entity_resolved: true,
    page_type: "company_page",
    identity_confidence: 0.9,
    evidence: [ev],
  };
}

describe("M9 — temporal validity (observed_at ≠ event_at)", () => {
  it("funding event yesterday + recently funded → fresh / pass", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    expect(deriveTemporalConstraint(spec).required).toBe(true);
    const row = fundingRow({ entity_id: "company:acme", event_at: daysAgo(1) });
    const t = evaluateTemporalValidity(row.evidence![0], spec, NOW);
    expect(t.ok).toBe(true);
    expect(t.freshness).toBe("fresh");
    expect(qualifyLead(row, spec, row.evidence).disposition).toBe("qualified");
  });

  it("article observed today, event 2 years ago → stale / fail", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const row = fundingRow({
      entity_id: "company:acme",
      event_at: yearsAgo(2),
      observed_at: new Date(NOW).toISOString(),
    });
    const t = evaluateTemporalValidity(row.evidence![0], spec, NOW);
    expect(t.ok).toBe(false);
    expect(t.freshness).toBe("stale");
    // Never used observed_at as the event clock
    expect(t.reason).not.toMatch(/observed/);
    const q = qualifyLead(row, spec, row.evidence);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("TEMPORAL_STALE");
  });

  it("recent page but event_at unknown when Spec requires recency → fail closed", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const row = fundingRow({
      entity_id: "company:acme",
      event_at: null,
      observed_at: new Date(NOW).toISOString(),
    });
    const t = evaluateTemporalValidity(row.evidence![0], spec, NOW);
    expect(t.ok).toBe(false);
    expect(t.freshness).toBe("unknown");
    expect(t.reason).toMatch(/observed_at_is_not_a_substitute/);
    const q = qualifyLead(row, spec, row.evidence);
    expect(q.reject_code).toBe("TEMPORAL_UNKNOWN");
  });

  it("observed_at present but event_at required and absent → TEMPORAL_UNKNOWN", () => {
    const spec = extractSearchSpec("startups funded in the last 30 days");
    const constraint = deriveTemporalConstraint(spec);
    expect(constraint.required).toBe(true);
    const ev = makeEvidence({
      source_url: "https://news.example/x",
      source_type: "news",
      excerpt: "Acme was funded",
      evidence_type: "funding",
      supports: "intent",
      subject: "company:acme",
      observed_at: new Date(NOW).toISOString(),
      // no event_at
    });
    delete (ev as { event_at?: string | null }).event_at;
    const t = evaluateTemporalValidity(ev, spec, NOW);
    expect(t.ok).toBe(false);
    expect(t.freshness).toBe("unknown");
  });
});

describe("M9 — claim type + parameter alignment", () => {
  it("funding evidence + hiring query → CLAIM_TYPE_MISMATCH", () => {
    const spec = extractSearchSpec("companies hiring senior React developers in Austin");
    const row = fundingRow({
      entity_id: "company:acme",
      event_at: daysAgo(1),
      location: "Austin",
    });
    const q = qualifyLead(row, spec, row.evidence);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("CLAIM_TYPE_MISMATCH");
  });

  it("hiring accountant + hiring React developer query → parameter mismatch", () => {
    const spec = extractSearchSpec("companies hiring senior React developers in Austin");
    const params = deriveRequiredClaimParameters(spec);
    expect(params.technology?.toLowerCase()).toBe("react");
    expect(params.seniority).toBe("senior");
    expect(params.role?.toLowerCase()).toMatch(/developer/);

    const entity_id = "company:acme";
    const ev = makeEvidence({
      source_url: "https://acme.example/jobs/accountant",
      source_type: "job",
      excerpt: "Hiring accountant — Austin office",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: entity_id,
      claim_parameters: { role: "accountant", location: "Austin" },
    } as Evidence & { claim_parameters: Record<string, string> });
    const match = claimParametersMatch(ev, params);
    expect(match.ok).toBe(false);
    expect(match.mismatched.length).toBeGreaterThan(0);

    const row: SpecRow = {
      kind: "company",
      title: "Acme",
      detail: "Austin",
      location: "Austin",
      url: "https://acme.example",
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [ev],
    };
    expect(qualifyLead(row, spec, [ev]).reject_code).toBe("CLAIM_PARAMETER_MISMATCH");
  });

  it("junior React + senior React query → seniority mismatch", () => {
    const spec = extractSearchSpec("companies hiring senior React developers in Austin");
    const entity_id = "company:acme";
    const ev = makeEvidence({
      source_url: "https://acme.example/jobs/junior-react",
      source_type: "job",
      excerpt: "Junior React developer",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: entity_id,
      claim_parameters: {
        role: "developer",
        technology: "React",
        seniority: "junior",
      },
    } as Evidence & { claim_parameters: Record<string, string> });
    expect(claimParametersMatch(ev, deriveRequiredClaimParameters(spec)).ok).toBe(
      false,
    );
    const row: SpecRow = {
      kind: "company",
      title: "Acme",
      detail: "Austin",
      location: "Austin",
      url: "https://acme.example",
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [ev],
    };
    expect(qualifyLead(row, spec, [ev]).reject_code).toBe("CLAIM_PARAMETER_MISMATCH");
  });

  it("correct role+tech+seniority may qualify", () => {
    const spec = extractSearchSpec("companies hiring senior React developers in Austin");
    const entity_id = "company:acme";
    const ev = makeEvidence({
      source_url: "https://acme.example/jobs/senior-react",
      source_type: "job",
      excerpt: "Senior React developer — Austin",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: entity_id,
      claim_parameters: {
        role: "developer",
        technology: "React",
        seniority: "senior",
      },
    } as Evidence & { claim_parameters: Record<string, string> });
    const row: SpecRow = {
      kind: "company",
      title: "Acme",
      detail: "Austin",
      location: "Austin",
      url: "https://acme.example",
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [ev],
    };
    expect(qualifyLead(row, spec, [ev]).disposition).toBe("qualified");
  });
});

describe("M9 — subject binding", () => {
  it("Austin Spec + Dallas entity → LOCATION_MISMATCH (M6 gate)", () => {
    const spec = extractSearchSpec("companies hiring React developers in Austin");
    const entity_id = "company:dallas";
    const ev = makeEvidence({
      source_url: "https://dallas.example/jobs",
      source_type: "job",
      excerpt: "Hiring React developers",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: entity_id,
    });
    const row: SpecRow = {
      kind: "company",
      title: "Dallas Co",
      detail: "Dallas",
      location: "Dallas",
      url: "https://dallas.example",
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [ev],
    };
    expect(qualifyLead(row, spec, [ev]).reject_code).toBe("LOCATION_MISMATCH");
  });

  it("article mentions two companies + one funding event → do not bind blindly", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    // Evidence subject is Beta, candidate is Acme — wrong binding
    const row = fundingRow({
      entity_id: "company:acme",
      subject: "company:beta",
      event_at: daysAgo(1),
      excerpt: "Acme and Beta announced funding; Beta closed a round",
    });
    const q = qualifyLead(row, spec, row.evidence);
    expect(q.disposition).not.toBe("qualified");
    expect(q.reject_code).toBe("CLAIM_NOT_SUBJECT_BOUND");
  });

  it("correct claim but wrong resolved entity → subject-binding failure", () => {
    const spec = extractSearchSpec("companies hiring copywriters in Toronto");
    const ev = makeEvidence({
      source_url: "https://other.example/jobs",
      source_type: "job",
      excerpt: "Hiring copywriters in Toronto",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: "company:other",
    });
    const row: SpecRow = {
      kind: "company",
      title: "Acme",
      detail: "Toronto",
      location: "Toronto",
      url: "https://acme.example",
      entity_id: "company:acme",
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [ev],
    };
    expect(qualifyLead(row, spec, [ev]).reject_code).toBe("CLAIM_NOT_SUBJECT_BOUND");
  });
});

describe("M9 — provenance + event_at freeze + currentness", () => {
  it("evidence URL missing → PROVENANCE_INCOMPLETE", () => {
    const spec = extractSearchSpec("companies hiring copywriters in Toronto");
    const entity_id = "company:acme";
    const ev = makeEvidence({
      source_url: "https://acme.example/jobs",
      source_type: "job",
      excerpt: "Hiring copywriters",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: entity_id,
    });
    (ev as { source_url: string }).source_url = "";
    expect(provenanceComplete(ev)).toBe(false);
    const row: SpecRow = {
      kind: "company",
      title: "Acme",
      detail: "Toronto",
      location: "Toronto",
      url: "https://acme.example",
      entity_id,
      entity_resolved: true,
      page_type: "company_page",
      identity_confidence: 0.9,
      evidence: [ev],
    };
    expect(qualifyLead(row, spec, [ev]).reject_code).toBe("PROVENANCE_INCOMPLETE");
  });

  it("crawl performed twice → newer crawl must not rewrite historical event_at", () => {
    const existing = makeEvidence({
      source_url: "https://news.example/a",
      source_type: "news",
      excerpt: "Acme raises",
      evidence_type: "funding",
      supports: "intent",
      subject: "company:acme",
      observed_at: "2024-01-01T00:00:00.000Z",
      event_at: "2023-06-01T00:00:00.000Z",
    });
    const incoming = makeEvidence({
      source_url: "https://news.example/a",
      source_type: "news",
      excerpt: "Acme raises (recrawl)",
      evidence_type: "funding",
      supports: "intent",
      subject: "company:acme",
      observed_at: "2026-09-15T00:00:00.000Z",
      event_at: "2026-09-14T00:00:00.000Z", // convenient wrong date
    });
    const merged = mergeEvidencePreservingEventAt(existing, incoming);
    expect(merged.event_at).toBe("2023-06-01T00:00:00.000Z");
    expect(merged.observed_at).toBe("2026-09-15T00:00:00.000Z");
  });

  it("conflicting event dates → do not silently choose convenient date", () => {
    const a = makeEvidence({
      source_url: "https://news.example/a",
      source_type: "news",
      excerpt: "funded",
      evidence_type: "funding",
      supports: "intent",
      subject: "company:acme",
      event_at: "2023-01-01T00:00:00.000Z",
    });
    const b = makeEvidence({
      source_url: "https://news.example/a",
      source_type: "news",
      excerpt: "funded",
      evidence_type: "funding",
      supports: "intent",
      subject: "company:acme",
      event_at: daysAgo(1),
    });
    expect(mergeEvidencePreservingEventAt(a, b).event_at).toBe(
      "2023-01-01T00:00:00.000Z",
    );
  });

  it("old founder evidence for current-founder request → cannot silently claim current", () => {
    const spec = extractSearchSpec("current founders needing developers in SF");
    // Force role_currentness if extract misses phrasing
    const forced = {
      ...spec,
      criteria: [
        ...spec.criteria,
        {
          field: "role_currentness",
          value: "current_role",
          stated: true,
          confidence: 1,
        },
      ],
    };
    const entity_id = "person:ada";
    const ev = makeEvidence({
      source_url: "https://x.com/ada",
      source_type: "social",
      excerpt: "looking for a developer",
      evidence_type: "social_ask",
      supports: "requested_role",
      subject: entity_id,
      claim_parameters: { role: "developer", role_currentness: "former_role" },
    } as Evidence & { claim_parameters: Record<string, string> });
    const cur = evaluateRoleCurrentness(ev, forced);
    expect(cur.ok).toBe(false);
    const row: SpecRow = {
      kind: "person",
      title: "Ada",
      detail: "Former founder",
      location: "San Francisco",
      url: "https://x.com/ada",
      entity_id,
      entity_resolved: true,
      page_type: "person_page",
      identity_confidence: 0.9,
      evidence: [ev],
    };
    expect(qualifyLead(row, forced, [ev]).reject_code).toBe("CURRENTNESS_MISMATCH");
  });

  it("ClaimEvidence chain carries subject/claim/type/params/url/times/freshness", () => {
    const entity_id = "company:acme";
    const ev = makeEvidence({
      source_url: "https://acme.example/jobs",
      source_type: "job",
      excerpt: "Senior React developer",
      evidence_type: "hiring",
      supports: "requested_role",
      subject: entity_id,
      event_at: daysAgo(5),
      claim_parameters: { role: "developer", technology: "React", seniority: "senior" },
    } as Evidence & { claim_parameters: Record<string, string> });
    const claim = asClaimEvidence(ev, entity_id)!;
    expect(claim.subject).toBe(entity_id);
    expect(claim.claim_type).toBe("hiring");
    expect(claim.evidence_url).toBeTruthy();
    expect(claim.observed_at).toBeTruthy();
    expect(claim.event_at).toBeTruthy();
    expect(claim.confidence).toBeGreaterThan(0);
    // Not a boolean "verified: true"
    expect(claim).not.toHaveProperty("verified");
  });
});

describe("M9 — production path NL→…→verify→qualify", () => {
  beforeEach(() => clearRegisteredEntities());

  it("happy path: NL→Spec→geo→source→resolve→claim→enrich→verify→qualify delivers", async () => {
    const spec = extractSearchSpec(
      "companies hiring senior React developers in Austin",
    );
    expect(spec.entity).toBe("company");
    expect(spec.signal_required).toBe(true);

    const entity_id = "company:acme-austin";
    const res = await runCanonicalSourcePipeline({
      spec,
      allowPaidEscalation: false,
      skipEnrichment: false,
      adapters: {
        searxng: artifactsAdapter([
          {
            title: "Acme — Careers",
            url: "https://acme-austin.example/careers",
            snippet: "Senior React developer openings in Austin",
            location: "Austin",
            key: entity_id,
            evidence: [
              makeEvidence({
                source_url: "https://acme-austin.example/careers/senior-react",
                source_type: "job",
                excerpt: "Senior React developer — Austin HQ",
                evidence_type: "hiring",
                supports: "requested_role",
                subject: entity_id,
                claim_parameters: {
                  role: "developer",
                  technology: "React",
                  seniority: "senior",
                },
              } as Evidence & { claim_parameters: Record<string, string> }),
            ],
          },
        ]),
      },
      enrichmentAdapters: {
        "contact-harvest": enrichmentAdapter({ fields: [] }),
      },
    });

    const withResolved = res.artifacts.map((r) => ({
      ...r,
      kind: "company" as const,
      entity_id,
      entity_resolved: true as const,
      page_type: "company_page" as const,
      identity_confidence: 0.92,
      location: "Austin",
      evidence: (r.evidence ?? []).map((e) => ({ ...e, subject: entity_id })),
    }));

    const enriched = await enrichCandidatesForSpec(withResolved, spec, {
      adapters: { "contact-harvest": enrichmentAdapter({ fields: [] }) },
    });

    for (const row of enriched.rows) {
      // Enrichment must not invent claims — verification still required
      const v = verifyCandidateClaims({
        evidence: row.evidence ?? [],
        entityId: entity_id,
        spec,
        nowMs: NOW,
      });
      expect(v.ok).toBe(true);
      expect(v.claim?.subject).toBe(entity_id);
      expect(v.claim?.claim_type).toBe("hiring");
    }

    const { qualified } = applyQualificationGate(enriched.rows, spec);
    expect(qualified.length).toBeGreaterThanOrEqual(1);
    expect(qualified.every((q) => q.entity_resolved === true)).toBe(true);
  });

  it("inverse: everything succeeds except temporal verification → qualified_count 0", async () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const entity_id = "company:old-fund";
    const res = await runCanonicalSourcePipeline({
      spec,
      allowPaidEscalation: false,
      skipEnrichment: true,
      adapters: {
        searxng: artifactsAdapter([
          {
            title: "OldFund raises Series A",
            url: "https://techcrunch.example/2023/oldfund",
            snippet: "Berlin startup raised in 2023",
            location: "Berlin",
            key: entity_id,
            evidence: [
              makeEvidence({
                source_url: "https://techcrunch.example/2023/oldfund",
                source_type: "news",
                excerpt: "OldFund raises Series A in Berlin",
                evidence_type: "funding",
                supports: "intent",
                subject: entity_id,
                observed_at: new Date(NOW).toISOString(),
                event_at: yearsAgo(2),
              }),
            ],
          },
        ]),
      },
    });

    const withResolved = res.artifacts.map((r) => ({
      ...r,
      kind: "company" as const,
      entity_id,
      entity_resolved: true as const,
      page_type: "company_page" as const,
      identity_confidence: 0.9,
      location: "Berlin",
      evidence: (r.evidence ?? []).map((e) => ({
        ...e,
        subject: entity_id,
        event_at: yearsAgo(2),
        observed_at: new Date(NOW).toISOString(),
      })),
    }));

    // Identity + claim type OK; temporal fails
    for (const row of withResolved) {
      const th = evaluateQualifiedLeadTheorem(
        theoremCandidateFromRow(row, row.evidence),
        spec,
      );
      expect(th.ok).toBe(false);
      expect(th.reject_code).toBe("TEMPORAL_STALE");
    }

    const { qualified } = applyQualificationGate(withResolved, spec);
    expect(qualified).toHaveLength(0);
  });
});

describe("M9 — verifyClaimEvidence unit surface", () => {
  it("correct entity/claim/date may verify", () => {
    const spec = extractSearchSpec("recently funded startups in Berlin");
    const entity_id = "company:acme";
    const ev = makeEvidence({
      source_url: "https://news.example/a",
      source_type: "news",
      excerpt: "Acme raises Series A",
      evidence_type: "funding",
      supports: "intent",
      subject: entity_id,
      event_at: daysAgo(2),
      observed_at: new Date(NOW).toISOString(),
    });
    const r = verifyClaimEvidence({
      evidence: ev,
      entityId: entity_id,
      spec,
      nowMs: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.freshness).toBe("fresh");
    expect(r.claim?.event_at).toBeTruthy();
    expect(r.claim?.observed_at).toBeTruthy();
    expect(r.claim?.event_at).not.toBe(r.claim?.observed_at);
  });
});
