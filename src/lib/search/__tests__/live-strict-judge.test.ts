/**
 * Matrix finding (m07/m19): live candidates whose category was still unknown
 * were streamed as "verified" and could be delivered for a category search;
 * the final merge then filled a contradicting category and the streamed lead
 * vanished without an explanation. Unknown is researchable before research;
 * after research it is a miss. The real server core runs here; only the
 * browser and the structured live source are fixtures.
 */
import { describe, expect, it } from "vitest";
import { runSpecSearchCore, type SpecRow } from "@/lib/spec-search.functions";
import { makeEvidence } from "../evidence";

const QUERY = "Plumbers in Bristol with websites";
const none = (async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })) as never;

const row = (title: string, category: string | null, host: string): SpecRow => {
  const id = `business:test:${host}`;
  return {
    key: id, entity_id: id, entity_resolved: true, identity_confidence: 0.85,
    kind: "business", title, detail: [category, "Bristol"].filter(Boolean).join(" | "),
    category, location: "Bristol", country: "GB", phone: "+44 117 496 0000",
    source_url: `https://${host}/`, url: `https://${host}`, website_url: `https://${host}`,
    page_type: "entity_page", source_page_type: "entity_page", resolution_method: "browser_observed_subject",
    evidence: [makeEvidence({ source_url: `https://${host}/`, source_type: "web", evidence_type: "identity", supports: "identity", subject: id,
      excerpt: `${title}, ${category ?? "a company"} based in Bristol`, confidence: 0.85, extraction_method: "browser_observed_text", observed_at: new Date().toISOString() })],
    verification_status: "discovered",
  } as SpecRow;
};
const lead = (candidate: SpecRow) => ({
  key: candidate.key ?? "", entity_id: candidate.entity_id ?? "", kind: candidate.kind, title: candidate.title, url: candidate.url ?? null,
  website_url: candidate.website_url ?? null, profile_url: null, email: null, phone: candidate.phone ?? null, location: candidate.location ?? null, why_match: null,
});

describe("live rows face the strict post-research judge", () => {
  it("never streams or delivers a business whose category is unknown or contradicting, and explains the drop", async () => {
    const unknown = row("Just Eat", null, "justeat.test");
    const contradicting = row("Matthew Clark Wholesale", "company", "matthewclark.test");
    const plumber = row("Harbourside Plumbing", "plumber", "harbourside.test");
    const streamed: string[] = [];
    const res = await runSpecSearchCore(QUERY, {
      businesses: none, index: null, providerBusinesses: null, enrichFn: null,
      browserProgress: (event) => { if (event.row) streamed.push(event.row.title); },
      liveGapfill: {
        osm: null, web: null, jobs: null,
        browser: async (_spec, options) => {
          // Same contract as browser-live: a lead streams the moment it verifies.
          for (const candidate of [unknown, contradicting, plumber]) {
            if (options.isVerified?.(candidate)) {
              (options.onProgress as ((event: Record<string, unknown>) => void) | undefined)?.({ action: "Candidate verified", row: lead(candidate) });
            }
          }
          return [unknown, contradicting, plumber];
        },
      },
    }, 10, {}, { force: true });
    expect(res.rows.map((item) => item.title)).toEqual(["Harbourside Plumbing"]);
    expect(streamed).toEqual(["Harbourside Plumbing"]);
    const ledger = res.candidateLedger!;
    expect(ledger.counts.unaccounted).toBe(0);
    expect(ledger.counts.filtered).toBe(2);
    expect(ledger.counts.returned).toBe(1);
  });

  it("explains a streamed lead that a later merge contradicted", async () => {
    // Browser copy: category unknown when it verified; the structured source
    // row for the same entity says "company" and wins the final merge.
    const researched = row("Cookpad", null, "cookpad.test");
    const sourceCopy = { ...row("Cookpad", "company", "cookpad.test"), website_url: null, url: null, resolution_method: "osm" } as SpecRow;
    const res = await runSpecSearchCore(QUERY, {
      businesses: none, index: null, providerBusinesses: null, enrichFn: null,
      browserProgress: () => {},
      liveGapfill: {
        osm: async () => [sourceCopy], web: null, jobs: null,
        browser: async (_spec, options) => {
          (options.onProgress as ((event: Record<string, unknown>) => void) | undefined)?.({ action: "Candidate verified", row: lead(researched) });
          return [researched];
        },
      },
    }, 10, {}, { force: true });
    expect(res.rows).toEqual([]);
    expect(res.candidateLedger!.streamedNotReturned).toEqual([expect.objectContaining({ title: "Cookpad", fate: "filtered" })]);
  });

  it("does not spend browser research on seeds that already contradict the request", async () => {
    const seeds: string[] = [];
    await runSpecSearchCore(QUERY, {
      businesses: none, index: null, providerBusinesses: null, enrichFn: null,
      liveGapfill: {
        osm: async () => [row("Cookpad", "company", "cookpad.test"), row("Brightside Plumbing", null, "brightside.test")],
        web: null, jobs: null,
        browser: async (_spec, options) => { seeds.push(...(options.initialCandidates ?? []).map((item) => item.title)); return []; },
      },
    }, 10, {}, { force: true });
    expect(seeds).not.toContain("Cookpad");
    expect(seeds).toContain("Brightside Plumbing");
  });
});
