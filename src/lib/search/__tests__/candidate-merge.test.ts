import { describe, expect, it } from "vitest";
import { mergeDuplicateCandidates, mergeReportPairs } from "../candidate-merge";
import { createCandidateLedger } from "../candidate-ledger";
import type { SpecRow } from "@/lib/spec-search.functions";

const person = (patch: Partial<SpecRow>): SpecRow => ({ kind: "person", title: "Ada Example", detail: "Founder at Example",
  company: "Example", entity_resolved: true, page_type: "entity_page", ...patch });

describe("candidate entity merging", () => {
  it("merges a DB and browser person and rebinds only their own evidence", () => {
    const rows = mergeDuplicateCandidates([
      person({ key: "db:1", entity_id: "db:1", email: "ada@example.test" }),
      person({ key: "browser:1", entity_id: "browser:1", location: "Toronto", evidence: [
        { subject: "browser:1", source_url: "https://example.test/team", source_type: "web", excerpt: "Ada Example is founder at Example", observed_at: "2026-09-24", evidence_type: "identity", supports: "identity", confidence: .9 },
        { subject: "other-company", source_url: "https://example.test/team", source_type: "web", excerpt: "Someone else is hiring", observed_at: "2026-09-24", evidence_type: "hiring", supports: "requested_role", confidence: .9 },
      ] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "ada@example.test", location: "Toronto" });
    expect(rows[0].evidence?.[0].subject).toBe(rows[0].entity_id);
    expect(rows[0].evidence?.[1].subject).toBe("other-company");
  });
  it("does not merge subjects merely sharing an article or a name", () => {
    expect(mergeDuplicateCandidates([
      person({ company: "One", url: "https://news.test/founders", source_page_type: "article" }),
      person({ company: "Two", url: "https://news.test/founders", source_page_type: "article" }),
      person({ title: "Bob Example", company: "One", url: "https://news.test/founders", source_page_type: "article" }),
    ])).toHaveLength(3);
  });
  it("merges company domains but preserves separate vacancies", () => {
    expect(mergeDuplicateCandidates([
      { kind: "company", title: "Example", detail: "", url: "https://www.example.test/?utm_source=x", page_type: "entity_page" },
      { kind: "company", title: "Example Inc", detail: "", url: "https://example.test", page_type: "entity_page", phone: "+14165550100" },
    ])).toHaveLength(1);
    expect(mergeDuplicateCandidates([
      { kind: "job", title: "Engineer", detail: "", url: "https://example.test/jobs/1" },
      { kind: "job", title: "Engineer", detail: "", url: "https://example.test/jobs/2" },
    ])).toHaveLength(2);
  });
  it("reports every dropped duplicate with the row that kept the entity", () => {
    const result = mergeDuplicateCandidates([
      person({ key: "db:1", entity_id: "db:1", email: "ada@example.test" }),
      person({ key: "browser:1", entity_id: "browser:1", location: "Toronto" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result.mergeReport).toEqual([{ mergedKey: "browser:1", keptKey: "db:1" }]);
    const unmerged = mergeDuplicateCandidates([person({ key: "solo" })]);
    expect(unmerged).toHaveLength(1);
    expect(unmerged.mergeReport).toEqual([]);
  });

  // C6: the production funnel books mergeReportPairs(...) into the ledger, so
  // a dropped duplicate stays visible as `absorbed` instead of vanishing.
  it("funnels the merge report into the ledger so absorbed duplicates stay visible", () => {
    const input: SpecRow[] = [
      { kind: "company", title: "Example", detail: "", url: "https://www.example.test/?utm_source=x", page_type: "entity_page" },
      { kind: "company", title: "Example Inc", detail: "", url: "https://example.test", page_type: "entity_page", phone: "+14165550100" },
    ];
    const merged = mergeDuplicateCandidates(input);
    expect(merged).toHaveLength(1);
    expect(merged.mergeReport).toEqual([{ mergedKey: "example", keptKey: "example-inc" }]);
    const ledger = createCandidateLedger();
    for (const { absorbed, survivor } of mergeReportPairs(input, merged.mergeReport ?? [])) ledger.merged(absorbed, survivor);
    for (const row of merged) ledger.retrieved(row);
    ledger.delivered(merged, []);
    const summary = ledger.summary();
    expect(summary.counts).toMatchObject({ returned: 1, absorbed: 1, unaccounted: 0 });
    expect(summary.accounting).toEqual({ retrieved: 2, fated: 2, unaccounted: 0, ok: true });
  });
});
