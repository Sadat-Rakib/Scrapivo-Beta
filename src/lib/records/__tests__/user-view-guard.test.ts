/**
 * M1 guard — no raw ingest/verification internals reach any user view.
 *
 * The Details drawer renders `populatedFields(record)` filtered through
 * `isInternalKey`, and card stats flow through the card adapters. These
 * tests poison a record with every banned key plus marker values and assert
 * none of them survive into what the UI would actually render.
 */
import { describe, expect, it } from "vitest";
import { populatedFields } from "../populated-fields";
import { humanLabel, isInternalKey } from "../field-labels";
import { buildInvestorCardModel } from "../../investors/card-adapters";
import type { InvestorRow } from "../../investors/card-adapters";

/** Keys that must never appear as rendered rows (plan §M1). */
const BANNED_KEYS = [
  "source_file",
  "listing_url",
  "website_status",
  "email_verified",
  "fetched_at",
  "information_completeness_score",
] as const;

const MARKER = "INGEST-MARKER";

const dirtyRecord = {
  id: "firm-guard-1",
  name: "Guard Test Capital",
  record_type: "firm",
  aum: "$1.5B",
  website: "https://guard.test",
  profile_summary: "A clean, renderable summary.",
  ...Object.fromEntries(BANNED_KEYS.map((k) => [k, MARKER])),
};

/** The exact pipeline the investors page uses for Full Record rows. */
function drawerRows(rec: unknown): { label: string; value: string }[] {
  return populatedFields(rec)
    .filter((f) => !isInternalKey(f.key))
    .map((f) => ({ label: humanLabel(f.key), value: f.value }));
}

describe("user-view guard (M1)", () => {
  it("drawer rows never carry banned ingest keys", () => {
    const rows = drawerRows(dirtyRecord);
    const labels = rows.map((r) => r.label);
    for (const key of BANNED_KEYS) {
      expect(labels).not.toContain(humanLabel(key));
    }
    // And no marker value leaked through under some other label.
    for (const row of rows) {
      expect(row.value, `row ${row.label}`).not.toContain(MARKER);
    }
  });

  it("card stats never carry banned values either", () => {
    const m = buildInvestorCardModel(dirtyRecord as unknown as InvestorRow);
    const json = JSON.stringify(m.detailStats);
    expect(json).not.toContain(MARKER);
  });

  it("business records: sample_url stays a link, never a raw row", () => {
    const biz = {
      name: "Guard Plumbing",
      category: "plumber",
      phone: "+1 555 0100",
      sample_url: "https://directory.example/listing/123",
      website_status: "unreachable",
      email_verified: false,
      verify_note: MARKER,
    };
    const rows = drawerRows(biz);
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain("Listing URL");
    expect(labels).not.toContain("Website status");
    expect(labels).not.toContain("Email verified");
    expect(labels).not.toContain("Email verification note");
    for (const row of rows) expect(row.value).not.toContain(MARKER);
  });

  it("evidence renders as readable claims — no JSON blobs", () => {
    const rec = {
      name: "Evidence Firm",
      evidence: [
        {
          claim: "has public email",
          evidence: [{ source: "contact_intelligence", data: "ir@guard.test" }],
          confidence: "high",
          observedAt: "2026-08-22T00:00:00.000Z",
        },
      ],
    };
    const rows = drawerRows(rec);
    const evidenceRow = rows.find((r) => r.label === humanLabel("evidence"));
    expect(evidenceRow).toBeDefined();
    expect(evidenceRow?.value).toContain("has public email");
    expect(evidenceRow?.value).toMatch(/^[^{"[\]]*$/);
  });
});
