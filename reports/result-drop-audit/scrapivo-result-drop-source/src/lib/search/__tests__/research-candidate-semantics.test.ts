import { describe, expect, it } from "vitest";
import { sanitizeSpecRow, type SpecRow } from "@/lib/spec-search.functions";
import { contactSiteUrl } from "../enrich-incomplete";
import { extractSearchSpec } from "../search-spec-extract";
import { defaultEnrichmentAdapters, enrichCandidateForSpec } from "../enrichment-run";
import { qualifyLead } from "../qualify";
import { runLiveGapfill } from "../live-gapfill";
import { osmTradeCategory } from "../osm-local-businesses.server";

const business = (extra: Partial<SpecRow> = {}): SpecRow => ({
  kind: "business", title: "North Plumbing", detail: "Plumber in Austin",
  entity_id: "osm:123", entity_resolved: true, page_type: "entity_page",
  identity_confidence: 0.9, location: "Austin", category: "plumber",
  opportunity: "no_website", ...extra,
});

describe("research candidate URL and absence contracts", () => {
  it("does not label generic OSM businesses as plumbers", () => {
    expect(osmTradeCategory("plumber", "company", "Abbott")).toBeNull();
    expect(osmTradeCategory("plumber", "company", "Economy Plumbing Services")).toBe("plumber");
    expect(osmTradeCategory("plumber", "hardware", "Ferguson Plumbing Supply")).toBeNull();
    expect(osmTradeCategory("plumber", "plumber", "North Services")).toBe("plumber");
  });
  it("keeps an article as provenance while promoting a resolved official site", () => {
    const article = "https://publisher.example/founder-list";
    const row = sanitizeSpecRow({ kind: "company", title: "Acme", detail: "SaaS",
      source_page_type: "article", source_url: article, url: article });
    expect(row).toMatchObject({ source_url: article, website_url: null, url: null });
    const resolved = sanitizeSpecRow({ ...row, website_url: "https://acme.example" });
    expect(resolved).toMatchObject({ source_url: article, website_url: "https://acme.example", url: "https://acme.example" });
  });

  it("selects the official site for contact research", () => {
    const row = business({ source_page_type: "article", source_url: "https://publisher.example/list",
      website_url: "https://northplumbing.example", url: "https://northplumbing.example" });
    expect(contactSiteUrl(row)).toBe("https://northplumbing.example");
    expect(contactSiteUrl({ ...row, website_url: null, url: row.source_url })).toBeNull();
    expect(contactSiteUrl({ ...row, website_url: null, url: "https://another-publisher.example/story",
      source_page_type: undefined, page_type: "unknown" })).toBeNull();
  });

  it("requires structured absence and two exact checks before claiming website absence", async () => {
    const spec = extractSearchSpec("Find plumbers in Austin with no website");
    // Runtime understanding may classify absence as a constraint without a buying signal.
    spec.signal_required = false;
    const adapter = defaultEnrichmentAdapters()["no-website-verify"]!;
    const row = business({ source_url: "https://www.openstreetmap.org/node/123",
      no_website_verification: { structured_source_url: "https://www.openstreetmap.org/node/123",
        structured_absence: true, exact_queries: ['"North Plumbing" "Austin"'] } });
    const one = await adapter({ spec, candidate: row, fields: ["no_website"] });
    expect(one.claims).toBeUndefined();
    expect(qualifyLead(row, spec, [])).not.toMatchObject({ disposition: "qualified" });
    row.no_website_verification!.exact_queries.push('"North Plumbing" "Austin" official website');
    const two = await adapter({ spec, candidate: row, fields: ["no_website"] });
    expect(two.claims?.[0]).toMatchObject({ subject: "osm:123", confidence: 0.7,
      extraction_method: "osm_absence_plus_exact_web_check" });
    expect((two.claims?.[0].confidence ?? 1)).toBeLessThanOrEqual(0.75);
    expect(spec.signal_required).toBe(false);
    const enriched = await enrichCandidateForSpec(row, spec, { budget: { maxContactHarvest: 0, maxPaidCalls: 0 } });
    expect(enriched.row.evidence?.some((item) => item.evidence_type === "no_website" && item.subject === "osm:123")).toBe(true);
    expect(qualifyLead(enriched.row, spec, enriched.row.evidence).why_match).toMatch(/Website not found after verification/);
    row.website_url = "https://northplumbing.example";
    expect((await adapter({ spec, candidate: row, fields: ["no_website"] })).claims).toBeUndefined();
    expect(qualifyLead(row, spec, [])).toMatchObject({ disposition: "dropped", reject_code: "CLAIM_PARAMETER_MISMATCH" });
  });

  it("carries an OSM no-site candidate through browser research and verification", async () => {
    const spec = extractSearchSpec("Find 10 plumbers in Austin with no website");
    const osm = business({ source_url: "https://www.openstreetmap.org/node/123",
      no_website_verification: { structured_source_url: "https://www.openstreetmap.org/node/123",
        structured_absence: true, exact_queries: [] } });
    let seed: SpecRow | undefined;
    const live = await runLiveGapfill(spec, {
      desiredCount: 5,
      osm: async () => [osm],
      browser: async (_spec, options) => {
        seed = options.initialCandidates?.[0];
        return [{ ...seed!, no_website_verification: { ...seed!.no_website_verification!,
          exact_queries: ['"North Plumbing" "Austin"', '"North Plumbing" "Austin" official website'] } }];
      },
    });
    expect(seed?.no_website_verification).toMatchObject({ structured_absence: true,
      structured_source_url: osm.source_url });
    const merged = live.rows.find((row) => row.entity_id === osm.entity_id)!;
    expect(merged.no_website_verification?.exact_queries).toHaveLength(2);
    const enriched = await enrichCandidateForSpec(merged, spec, { budget: { maxContactHarvest: 0 } });
    expect(qualifyLead(enriched.row, spec, enriched.row.evidence).disposition).toBe("qualified");
  });
  it("keeps an Overture null website unverified until two exact checks", async () => {
    const spec = extractSearchSpec("Find plumbers in Austin with no website");
    spec.signal_required = false;
    const row = business({ key: "overture:123", entity_id: "overture:123", source_url: null,
      no_website_verification: { structured_source_url: "overture:123", structured_absence: true, exact_queries: [] } });
    expect(qualifyLead(row, spec, row.evidence).disposition).not.toBe("qualified");
    const adapter = defaultEnrichmentAdapters()["no-website-verify"]!;
    expect((await adapter({ spec, candidate: row, fields: ["no_website"] })).claims).toBeUndefined();
    row.no_website_verification!.exact_queries = [
      '"North Plumbing" "Austin"', '"North Plumbing" "Austin" official website',
    ];
    const enriched = await enrichCandidateForSpec(row, spec, { budget: { maxContactHarvest: 0 } });
    expect(enriched.row.evidence?.find((e) => e.evidence_type === "no_website")).toMatchObject({
      source_url: "overture:123", source_type: "db", subject: "overture:123",
      extraction_method: "structured_absence_plus_exact_web_check",
    });
    expect(qualifyLead(enriched.row, spec, enriched.row.evidence).disposition).toBe("qualified");
    expect(qualifyLead({ ...enriched.row, website_url: "https://northplumbing.example" }, spec, enriched.row.evidence).disposition).toBe("dropped");
  });
});
