/**
 * Workstream 4 — persist-live write-back drops judgment fields before
 * anything reaches idx_* / canonical storage.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isVerifiedForPersist, prepareVerifiedRowForPersist } from "../persist-live.server";
import type { SpecRow } from "@/lib/spec-search.functions";

function verifiedRow(): SpecRow {
  return {
    kind: "business",
    title: "Acme Plumbing",
    detail: "Plumber in Pune",
    url: "https://acme.example.com",
    website_url: "https://acme.example.com",
    email: "info@acme.example.com",
    phone: "+91 90000 00000",
    location: "Pune",
    country: "IN",
    category: "plumber",
    entity_id: "live-web:acme.example.com",
    entity_resolved: true,
    page_type: "entity_page",
    key: "live-web:acme.example.com",
    disposition: "qualified",
    verification_status: "verified",
    evidence: [
      {
        source_url: "https://acme.example.com/careers",
        source_type: "web",
        excerpt: "Hiring two plumbers",
        observed_at: "2026-09-20T00:00:00.000Z",
        evidence_type: "hiring",
        supports: "requested_role",
        confidence: 0.8,
        subject: "live-web:acme.example.com",
      },
    ],
  };
}

describe("persist-live canonical-facts-only gate", () => {
  it("write path strips judgment fields, keeps facts + evidence", () => {
    const row: SpecRow = {
      ...verifiedRow(),
      why_match: "Great fit for the request",
      relevance_score: 0.95,
      intent_score: 0.8,
      fit_score: 0.9,
      outreach_angle: "lead with hiring",
      good_prospect: true,
    } as SpecRow;
    const { row: safe, rejected } = prepareVerifiedRowForPersist(row);
    expect(rejected).toEqual([
      "disposition",
      "why_match",
      "relevance_score",
      "intent_score",
      "fit_score",
      "outreach_angle",
      "good_prospect",
    ]);
    const projected = safe as unknown as Record<string, unknown>;
    for (const judgment of rejected) {
      expect(projected, judgment).not.toHaveProperty(judgment);
    }
    // Facts survive.
    expect(projected.title).toBe("Acme Plumbing");
    expect(projected.email).toBe("info@acme.example.com");
    expect(projected.website_url).toBe("https://acme.example.com");
    // Evidence retained (timestamps ride with the facts).
    expect(Array.isArray(projected.evidence)).toBe(true);
    expect((projected.evidence as unknown[]).length).toBe(1);
  });

  it("disposition (gate state) is stripped from the storage row too", () => {
    // isVerifiedForPersist needs disposition on the RAW row, but the
    // projected storage row must not carry thesis dispositions.
    const row = verifiedRow();
    expect(isVerifiedForPersist(row)).toBe(true);
    const { row: safe, rejected } = prepareVerifiedRowForPersist(row);
    expect(rejected).toEqual(["disposition"]);
    expect((safe as unknown as Record<string, unknown>).disposition).toBeUndefined();
    expect((safe as unknown as Record<string, unknown>).title).toBe("Acme Plumbing");
  });

  it("verification gate still runs on the raw row (judgments don't break it)", () => {
    const judged: SpecRow = {
      ...verifiedRow(),
      why_match: "fit",
      intent_score: 0.9,
    } as SpecRow;
    // Gate semantics unchanged: qualified + resolved + bound evidence => ok.
    expect(isVerifiedForPersist(judged)).toBe(true);
    expect(isVerifiedForPersist({ ...judged, disposition: "dropped" })).toBe(false);
  });

  it("persistVerifiedLiveRows routes candidates through the projection (wiring)", () => {
    // Structural check, same pattern as the migration-hardening test: the
    // write path must map candidates through prepareVerifiedRowForPersist.
    const src = readFileSync(
      fileURLToPath(new URL("../persist-live.server.ts", import.meta.url)),
      "utf8",
    );
    expect(src).toMatch(
      /\.filter\(isVerifiedForPersist\)\s*\n\s*\.map\(\(r\) => prepareVerifiedRowForPersist\(r\)\.row\)/,
    );
    expect(src).toContain("canonicalFactProjection");
    expect(src).toContain("rejectJudgmentFields");
  });
});
