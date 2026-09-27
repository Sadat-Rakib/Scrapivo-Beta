/**
 * Field-level freshness (Workstream 4) — class boundaries, event fields,
 * staleFields marking (never dropping), stamp passthrough.
 */
import { describe, expect, it } from "vitest";
import {
  FIELD_FRESHNESS,
  FRESHNESS_TTL_DAYS,
  fieldFreshnessClass,
  isFieldFresh,
  staleFields,
  stampFreshness,
} from "../freshness";

const NOW = new Date("2026-09-27T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("fieldFreshnessClass", () => {
  it("maps the canonical classes", () => {
    expect(fieldFreshnessClass("website")).toBe("stable");
    expect(fieldFreshnessClass("domain")).toBe("stable");
    expect(fieldFreshnessClass("name")).toBe("stable");
    expect(fieldFreshnessClass("description")).toBe("medium");
    expect(fieldFreshnessClass("company")).toBe("medium");
    expect(fieldFreshnessClass("phone")).toBe("medium");
    expect(fieldFreshnessClass("role")).toBe("medium");
    expect(fieldFreshnessClass("apply_url")).toBe("volatile");
    expect(fieldFreshnessClass("salary")).toBe("volatile");
    expect(fieldFreshnessClass("funding_event")).toBe("event");
    expect(fieldFreshnessClass("public_post")).toBe("event");
    expect(fieldFreshnessClass("intent_score")).toBe("very-volatile");
  });

  it("defaults unknown fields to medium", () => {
    expect(fieldFreshnessClass("some_future_field")).toBe("medium");
  });

  it("exposes the frozen TTLs", () => {
    expect(FRESHNESS_TTL_DAYS).toEqual({ stable: 90, medium: 30, volatile: 7, "very-volatile": 2 });
    expect(FIELD_FRESHNESS.event.ttlDays).toBeNull();
  });
});

describe("isFieldFresh", () => {
  it("honors each class TTL boundary (exactly-at-TTL is stale)", () => {
    expect(isFieldFresh("website", daysAgo(89.9), NOW)).toBe(true);
    expect(isFieldFresh("website", daysAgo(90), NOW)).toBe(false);
    expect(isFieldFresh("phone", daysAgo(29.9), NOW)).toBe(true);
    expect(isFieldFresh("phone", daysAgo(30), NOW)).toBe(false);
    expect(isFieldFresh("apply_url", daysAgo(6.9), NOW)).toBe(true);
    expect(isFieldFresh("apply_url", daysAgo(7), NOW)).toBe(false);
    expect(isFieldFresh("intent_score", daysAgo(1.9), NOW)).toBe(true);
    expect(isFieldFresh("intent_score", daysAgo(2), NOW)).toBe(false);
  });

  it("event-timestamped fields ignore TTL entirely", () => {
    expect(isFieldFresh("funding_event", daysAgo(400), NOW)).toBe(true);
    expect(isFieldFresh("public_post", daysAgo(3650), NOW)).toBe(true);
  });

  it("missing or invalid observation time is never fresh", () => {
    expect(isFieldFresh("website", null, NOW)).toBe(false);
    expect(isFieldFresh("website", undefined, NOW)).toBe(false);
    expect(isFieldFresh("website", "not-a-date", NOW)).toBe(false);
  });
});

describe("staleFields", () => {
  it("marks only expired fields, keeps the record intact otherwise", () => {
    const record = {
      name: "Acme",
      website: "https://acme.example.com",
      phone: "+91 90000 00000",
      description: "Plumber",
      apply_url: "https://acme.example.com/jobs",
      funding_event: { round: "seed", at: "2020-01-01" },
      field_observed_at: {
        name: daysAgo(1),
        website: daysAgo(200),
        phone: daysAgo(10),
        description: daysAgo(45),
        apply_url: daysAgo(2),
        funding_event: daysAgo(2000),
      },
    };
    expect(staleFields(record, NOW)).toEqual(["website", "description"]);
    expect(record.name).toBe("Acme"); // not dropped, not mutated
  });

  it("falls back to record-level last_seen when no per-field map exists", () => {
    const record = {
      name: "Acme",
      website: "https://acme.example.com",
      email: "a@acme.example.com",
      last_seen: daysAgo(31),
    };
    // last_seen 31d: stable fields fine (90d), medium fields stale (30d).
    expect(staleFields(record, NOW)).toEqual(["email"]);
  });

  it("returns [] for records with no observation metadata", () => {
    expect(staleFields({ name: "Acme", phone: "123" }, NOW)).toEqual([]);
  });

  it("ignores evidence/provenance bookkeeping", () => {
    const record = {
      title: "Acme",
      evidence: [{ source_url: "x", observed_at: daysAgo(400) }],
      field_provenance: { title: { observed_at: daysAgo(1) } },
      last_seen: daysAgo(400),
    };
    expect(staleFields(record, NOW)).toEqual([]);
  });

  it("treats untimestamped fields as unknowable, not stale", () => {
    const record = {
      name: "Acme",
      phone: "123",
      website: "https://acme.example.com",
      field_observed_at: { name: daysAgo(30) },
    };
    // phone/website have no timestamps — never marked; name observed 30d
    // ago is well inside the stable 90d TTL.
    expect(staleFields(record, NOW)).toEqual([]);
  });
});

describe("stampFreshness", () => {
  it("adds field_observed_at + staleFields (search-index read-back shape)", () => {
    const base = {
      title: "Acme",
      phone: "123",
      last_seen: daysAgo(40),
    };
    const stamped = stampFreshness(base, { now: NOW, observedAtFallback: base.last_seen });
    expect(stamped.field_observed_at).toEqual({
      title: daysAgo(40),
      phone: daysAgo(40),
    });
    expect(stamped.staleFields).toEqual(["phone"]); // medium 30d < 40d
    expect(stamped.title).toBe("Acme");
  });

  it("passes through an existing field_observed_at map and merges provenance", () => {
    const base = {
      title: "Acme",
      phone: "123",
      field_observed_at: { title: daysAgo(1) },
      field_provenance: { phone: { observed_at: daysAgo(200) } },
    };
    const stamped = stampFreshness(base, { now: NOW });
    expect(stamped.field_observed_at).toEqual({
      title: daysAgo(1),
      phone: daysAgo(200),
    });
    expect(stamped.staleFields).toEqual(["phone"]);
  });

  it("never marks anything stale without any timestamps", () => {
    const stamped = stampFreshness({ title: "Acme" }, { now: NOW });
    expect(stamped.staleFields).toEqual([]);
    expect(stamped.field_observed_at).toEqual({});
  });
});
