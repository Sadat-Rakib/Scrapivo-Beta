/** Phase D: spec rows feed intent candidates across all entities. */
import { describe, expect, it } from "vitest";
import { specRowsToCandidates } from "@/lib/intent/spec-candidates";
import type { SpecRow } from "@/lib/spec-search.functions";

const row = (kind: SpecRow["kind"], key: string | null, title: string): SpecRow => ({
  kind,
  key,
  title,
  detail: "",
  location: "Pune",
  country: "IN",
});

describe("specRowsToCandidates", () => {
  it("maps person/company/business rows with keys", () => {
    const out = specRowsToCandidates([
      row("person", "p1", "Ada Lovelace — Founder @ Acme"),
      row("company", "c1", "Acme — SaaS"),
      row("business", "b1", "Smile Dental"),
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ key: "p1", country: "IN" });
    expect(out.find((c) => c.key === "c1")?.company).toBe("Acme — SaaS");
  });
  it("skips keyless rows and job postings (nothing to enrich on a posting)", () => {
    const out = specRowsToCandidates([
      row("person", null, "No Key Person"),
      row("job", "j1", "Frontend Developer"),
      row("investor", "v1", "Jane VC — Partner @ Fund"),
      row("business", "b1", "Smile Dental"),
    ]);
    expect(out.map((c) => c.key).sort()).toEqual(["b1", "v1"]);
  });
  it("round-robins across kinds and caps at the limit", () => {
    const rows: SpecRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(row("person", `p${i}`, `Person ${i}`));
      rows.push(row("business", `b${i}`, `Biz ${i}`));
    }
    const out = specRowsToCandidates(rows, 6);
    expect(out).toHaveLength(6);
    // Interleaved, not 6 people in a row (T4 anti-starvation).
    expect(out.map((c) => c.key?.[0]).join("")).toBe("pbpbpb");
  });
});
