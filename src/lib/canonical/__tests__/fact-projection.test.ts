/**
 * Canonical-facts-only projection (Workstream 4).
 * Judgments never reach canonical storage; facts + evidence survive.
 */
import { describe, expect, it } from "vitest";
import {
  CANONICAL_FACT_FIELDS,
  canonicalFactProjection,
  rejectJudgmentFields,
} from "../fact-projection";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { Evidence } from "@/lib/search/evidence";

const EVIDENCE: Evidence[] = [
  {
    source_url: "https://example.com/careers",
    source_type: "web",
    excerpt: "Now hiring plumbers",
    observed_at: "2026-09-20T00:00:00.000Z",
    evidence_type: "hiring",
    supports: "requested_role",
    confidence: 0.8,
    subject: "live-web:example.com",
  },
];

function judgmentRow(): SpecRow {
  return {
    kind: "business",
    title: "Acme Plumbing",
    detail: "Plumber in Pune",
    url: "https://acme.example.com",
    email: "info@acme.example.com",
    phone: "+91 90000 00000",
    location: "Pune",
    country: "IN",
    category: "plumber",
    // judgment layer — must never persist
    why_match: "Hiring signal",
    relevance_score: 0.91,
    intent_score: 0.7,
    disposition: "qualified",
    disposition_label: "QualifiedLead",
    fit_score: 0.88,
    outreach_angle: "open with hiring pain",
    good_prospect: true,
    evidence: EVIDENCE,
  } as SpecRow;
}

describe("canonicalFactProjection", () => {
  it("strips judgment fields, keeps facts and evidence", () => {
    const projected = canonicalFactProjection(judgmentRow()) as unknown as Record<string, unknown>;
    for (const judgment of [
      "why_match",
      "relevance_score",
      "intent_score",
      "disposition",
      "disposition_label",
      "fit_score",
      "outreach_angle",
      "good_prospect",
    ]) {
      expect(projected, judgment).not.toHaveProperty(judgment);
    }
    expect(projected.title).toBe("Acme Plumbing");
    expect(projected.email).toBe("info@acme.example.com");
    expect(projected.phone).toBe("+91 90000 00000");
    expect(projected.country).toBe("IN");
    expect(projected.evidence).toEqual(EVIDENCE); // evidence retained
  });

  it("drops unknown keys not on the allowlist", () => {
    const projected = canonicalFactProjection({
      title: "Acme",
      llm_notes: "buy more",
      scratch_pad: 123,
    } as unknown as Record<string, unknown>);
    expect(Object.keys(projected)).toEqual(["title"]);
  });

  it("allowlist covers the facts persist-live writes for idx_* rows", () => {
    for (const field of [
      "title",
      "kind",
      "entity_id",
      "email",
      "phone",
      "location",
      "country",
      "category",
      "detail",
      "role",
      "company",
      "url",
      "website_url",
      "source_url",
      "evidence",
      "field_provenance",
      "funding_event",
      "salary",
      "apply_url",
    ]) {
      expect(CANONICAL_FACT_FIELDS, field).toContain(field);
    }
  });

  it("does not mutate the input row", () => {
    const row = judgmentRow();
    const snapshot = { ...row } as Record<string, unknown>;
    canonicalFactProjection(row);
    expect(row as unknown as Record<string, unknown>).toEqual(snapshot);
  });
});

describe("rejectJudgmentFields", () => {
  it("lists explicit thesis-specific offenders", () => {
    expect(rejectJudgmentFields(judgmentRow())).toEqual([
      "why_match",
      "relevance_score",
      "intent_score",
      "disposition",
      "disposition_label",
      "fit_score",
      "outreach_angle",
      "good_prospect",
    ]);
  });

  it("catches novel judgment-style keys via token patterns", () => {
    expect(rejectJudgmentFields({ outreach_priority_sms: 1, prospect_rank_v2: 3 })).toEqual([
      "outreach_priority_sms",
      "prospect_rank_v2",
    ]);
  });

  it("returns nothing for fact-only rows", () => {
    expect(
      rejectJudgmentFields({
        title: "Acme",
        identity_confidence: 0.9,
        no_website_verification: { structured_absence: true, exact_queries: [] },
        source_page_type: "company_page",
      }),
    ).toEqual([]);
  });
});
