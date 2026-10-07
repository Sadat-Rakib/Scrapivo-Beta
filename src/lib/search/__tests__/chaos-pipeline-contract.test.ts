import { describe, expect, it, vi } from "vitest";
import { rowSatisfiesSpec, rowSatisfyRejectReason, postResearchRejectReason, runSpecSearchCore, type SpecRow } from "@/lib/spec-search.functions";
import { emptyFrame, openValue, QuantitySchema, LocationSchema } from "@/lib/understanding/frame";
import * as watchdog from "../run-watchdog";
import { companyCategoryMatches } from "@/lib/canonical/companies.server";
import { qualifyLead } from "../qualify";
import { enrichZeroNarrative } from "../outcome-ui";
import type { SearchSpec } from "../search-spec";
import { browserEntitiesToRows } from "../browser-live.server";
import { verifyClaimEvidence } from "../verification";

const base: SearchSpec = { entity: "business", criteria: [], missing: [], signal_required: false,
  signal_types: [], signal_recency: null, status: "ready_to_search", raw_query: "" };
const business = (category: string): SpecRow => ({ kind: "business", key: category, title: "Provider", detail: "", category, location: "Toronto", country: "CA" });
const categorySpec = (value: string): SearchSpec => ({ ...base, criteria: [{ field: "category", value, stated: true, confidence: 1 }] });

describe("phrase criteria retain their subject", () => {
  it("retains explicit industry alternatives for people, companies, investors, and job technologies", () => {
    const criterion = (field: string, value: string) => [{ field, value, stated: true, confidence: 1 }];
    expect(companyCategoryMatches("AI infrastructure", "ai infra/devtool startup")).toBe(true);
    expect(companyCategoryMatches("Developer tools", "ai infra/devtool startup")).toBe(true);
    expect(companyCategoryMatches("Healthcare", "ai infra/devtool startup")).toBe(false);
    expect(companyCategoryMatches("Infrastructure", "AI infrastructure")).toBe(false);
    expect(companyCategoryMatches("SaaS", "commercial SaaS companies")).toBe(false);
    expect(companyCategoryMatches("Retail", "AI or SaaS")).toBe(false);
    expect(rowSatisfiesSpec({ ...base, entity: "person", criteria: criterion("industry", "SaaS or AI/devtools") },
      { ...business(""), kind: "person", industry: "Developer tools" })).toBe(true);
    expect(rowSatisfiesSpec({ ...base, entity: "investor", criteria: criterion("investor_sector", "AI or fintech") },
      { ...business(""), kind: "investor", sector: "Fintech" })).toBe(true);
    expect(rowSatisfiesSpec({ ...base, entity: "investor", criteria: criterion("investor_sector", "AI infrastructure") },
      { ...business(""), kind: "investor", sector: "Retail infrastructure" })).toBe(false);
    const jobSpec = { ...base, entity: "job" as const, criteria: criterion("technology", "React/Next.js") };
    expect(rowSatisfiesSpec(jobSpec, { ...business(""), kind: "job", title: "Senior Next.js Engineer" })).toBe(true);
    expect(rowSatisfiesSpec(jobSpec, { ...business(""), kind: "job", title: "Senior Java Engineer" })).toBe(false);
  });
  it.each([
    ["commercial electricians", "commercial cleaners"], ["wedding photographers", "wedding planners"],
    ["industrial plumbers", "industrial designers"], ["residential roofers", "residential painters"],
  ])("rejects shared modifiers: %s vs %s", (requested, observed) => {
    expect(rowSatisfiesSpec(categorySpec(requested), business(observed))).toBe(false);
    expect(rowSatisfyRejectReason(categorySpec(requested), business(observed))).toBe("rejected_category");
  });
  it.each(["commercial electricians or plumbers", "commercial electricians, plumbers", "commercial electricians and plumbers"])("accepts explicit alternatives %s", (requested) => {
    expect(rowSatisfiesSpec(categorySpec(requested), business("plumber"))).toBe(true);
    expect(rowSatisfiesSpec(categorySpec(requested), business("commercial cleaners"))).toBe(false);
  });
  it("reports failed field and evidence state", () => {
    expect(postResearchRejectReason(categorySpec("electricians"), business("cleaner"))).toBe('UNPROVEN_CRITERION:category="electricians":CONTRADICTED');
    expect(postResearchRejectReason(categorySpec("electricians"), business(""))).toBe('UNPROVEN_CRITERION:category="electricians":UNKNOWN');
  });
  it("does not infer a commercial/wedding modifier from the generic trade", () => {
    expect(rowSatisfiesSpec(categorySpec("commercial electricians"), business("residential electrician"))).toBe(false);
    expect(rowSatisfiesSpec(categorySpec("wedding photographers"), business("photographer"))).toBe(false);
    expect(rowSatisfiesSpec(categorySpec("wedding photographers"), business("wedding photographer"))).toBe(true);
  });
  it("keeps detailed unproven reasons visible in zero narrative", () => {
    expect(enrichZeroNarrative(null, { counts: {}, streamedNotReturned: [{ fate: "filtered", reason: 'UNPROVEN_CRITERION:category="electrician":UNKNOWN' }] }))
      .toContain("1 candidate looked promising");
  });
});

describe("alternative requested fields use the existing qualification gate", () => {
  const spec = { ...base, required_field_groups: [{ any_of: ["website", "instagram"] }], requested_fields: ["contact"] };
  const row: SpecRow = { ...business("dentist"), entity_id: "dentist:1", entity_resolved: true, page_type: "entity_page", phone: "+14165550123" };
  it("accepts website or observed Instagram while still requiring contact", () => {
    expect(qualifyLead({ ...row, website_url: "https://clinic.example" }, spec, []).disposition).toBe("qualified");
    const social = [{ source_url: "https://www.instagram.com/clinic/", source_type: "social" as const, evidence_type: "identity" as const,
      supports: "identity" as const, subject: row.entity_id!, observed_at: new Date().toISOString(), excerpt: "Clinic", confidence: 0.9 }];
    expect(qualifyLead(row, spec, social).disposition).toBe("qualified");
    expect(qualifyLead(row, spec, []).reject_code).toBe("MISSING_QUERY_REQUIRED");
    expect(qualifyLead({ ...row, phone: null }, spec, social).reject_code).toBe("MISSING_QUERY_REQUIRED");
    expect(qualifyLead(row, spec, [{ ...social[0], source_url: "https://example.com/about-instagram" }]).reject_code).toBe("MISSING_QUERY_REQUIRED");
    expect(qualifyLead(row, spec, [{ ...social[0], subject: "another-clinic" }]).reject_code).toBe("MISSING_QUERY_REQUIRED");
    expect(qualifyLead(row, spec, [{ ...social[0], source_type: "web" }]).reject_code).toBe("MISSING_QUERY_REQUIRED");
    expect(qualifyLead(row, spec, [{ ...social[0], source_type: "web", extraction_method: "browser_observed_text", excerpt: "Provider is a dentist" }]).disposition).toBe("qualified");
    expect(qualifyLead({ ...row, phone: null, website_url: "https://clinic.example" }, spec,
      [{ ...social[0], evidence_type: "contact", subject: "another-clinic" }]).reject_code).toBe("MISSING_QUERY_REQUIRED");
    expect(qualifyLead(row, { ...spec, required_field_groups: [], requested_fields: ["socials"] },
      [{ ...social[0], subject: "another-clinic" }]).reject_code).toBe("MISSING_QUERY_REQUIRED");
    expect(qualifyLead(row, { ...spec, requested_fields: ["email"], required_field_groups: [{ any_of: ["email", "phone"] }] }, [])
      .reject_code).toBe("MISSING_QUERY_REQUIRED");
  });
});

describe("compound searches execute every semantic bucket", () => {
  it("keeps paired goal locations and the root budget after elapsed work", async () => {
    const frame = emptyFrame("dentists in Perth and orthodontists in Adelaide");
    const places = ["Perth", "Adelaide"].map(value => LocationSchema.parse({ value, raw: value, country_code: "AU" }));
    frame.locations = places;
    frame.location = places[0];
    const goals = ["dentists", "orthodontists"].map((category, index) => ({ raw: `${category} in ${places[index].value}`,
      target: { ...frame.target, entity_type: { value: "business" as const, raw: "businesses", confidence: 1 }, category: openValue(category) },
      relation: frame.relation, location: places[index], temporal: null, constraints: [], quantity: QuantitySchema.parse({ requested: 1 }) }));
    frame.target = goals[0].target;
    frame.compound = { is_compound: true, subgoals: goals };
    const businesses = vi.fn(async () => ({ rows: [], meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fixture"], rowsScanned: 0, rowsReturned: 0 } }));
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 350_000);
    const watch = vi.spyOn(watchdog, "startRunWatchdog").mockReturnValue({ stop: vi.fn() } as ReturnType<typeof watchdog.startRunWatchdog>);
    try {
      await runSpecSearchCore(frame.input.raw, { businesses: businesses as never, liveGapfill: null }, 10, {}, {
        spec: { ...base, understanding: frame, criteria: [] }, runStartedAt: now, runBudgetMs: 500_000,
      });
      const args = businesses.mock.calls as unknown as Array<[{ category: string; location: string }]>;
      expect(args.map(([query]) => [query.category, query.location])).toEqual([["dentists", "Perth"], ["orthodontists", "Adelaide"]]);
      expect(watch.mock.calls.map(([args]) => args.budgetMs)).toEqual([500_000, 500_000]);
    } finally { watch.mockRestore(); clock.mockRestore(); }
  });
  it("executes the natural Q11 request through Stage 1 without selecting a single half", async () => {
    const raw = "need maybe 15 cybersecurity companies then another 15 ai infra/devtool startups, mostly usa/canada, preferably under like 100 employees but if headcount is unknown dont kill the result, founders or decision makers would be useful and pls dont mix cybersecurity consultants with actual product companies unless they genuinely fit";
    const companies = vi.fn(async ({ category, location, limit }: { category: string; location: string; limit: number }) => ({
      rows: Array.from({ length: limit }, (_, index) => ({ registry_id: `${category}:${location}:${index}`, company_name: `Product Firm ${category} ${location} ${index}`,
        category: index === 0 ? "Healthcare" : /cybersecurity/i.test(category) ? "Cybersecurity" : index % 2 ? "AI infrastructure" : "Developer tools",
        location, website: `https://product-${index}.example` })),
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["fixture"], rowsScanned: limit, rowsReturned: limit },
    }));
    let result = await runSpecSearchCore(raw, { companies: companies as never, liveGapfill: null }, 30);
    if (!companies.mock.calls.length) result = await runSpecSearchCore(raw, { companies: companies as never, liveGapfill: null }, 30, {},
      { force: true, priorFrame: result.spec.understanding });
    expect(companies.mock.calls.length).toBe(4);
    expect(result.questions.some(question => /which.*(?:part|half|search|goal)/i.test(question))).toBe(false);
    const args = companies.mock.calls as unknown as Array<[{ category: string; location: string; limit: number }]>;
    expect(new Set(args.map(([query]) => query.category)).size).toBe(2);
    expect(new Set(args.map(([query]) => query.location)).size).toBe(2);
    expect(args.every(([query]) => query.limit === 16)).toBe(true);
    expect(result.rows).toHaveLength(30);
    expect(result.rows.filter(row => row.category === "Cybersecurity")).toHaveLength(15);
    expect(result.rows.filter(row => ["AI infrastructure", "Developer tools"].includes(row.category ?? ""))).toHaveLength(15);
    expect(result.rows.some(row => row.category === "Healthcare")).toBe(false);
  });
  it("preserves each bucket's target, count, and root identity", async () => {
    const frame = emptyFrame("find 2 cybersecurity companies then another 3 AI companies");
    const goals = ["Cybersecurity", "AI"].map((industry, index) => {
      const target = { ...frame.target, entity_type: { value: "company" as const, raw: "companies", confidence: 1 }, industry: openValue(industry) };
      return { raw: `find ${index + 2} ${industry} companies`, target, relation: frame.relation, location: null, temporal: null,
        constraints: [], quantity: QuantitySchema.parse({ requested: index + 2 }) };
    });
    frame.target = goals[0].target;
    frame.compound = { is_compound: true, subgoals: goals };
    const companies = vi.fn(async ({ category, limit }: { category: string; limit: number }) => ({
      rows: Array.from({ length: Math.min(limit, 5) }, (_, index) => ({ registry_id: `${category}-${index}`, company_name: `${category} Company ${index}`,
        category: category === "AI" ? "artificial intelligence" : category, location: "Toronto", website: `https://${category.toLowerCase()}-${index}.example`, country: "CA" })),
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: [category], rowsScanned: 5, rowsReturned: 5 },
    }));
    const result = await runSpecSearchCore(frame.input.raw, { companies: companies as never, liveGapfill: null }, 10, {}, {
      spec: { ...base, entity: "company", understanding: frame, criteria: [{ field: "industry", value: "Cybersecurity", stated: true, confidence: 1 }] },
      search_run_id: "compound:test",
    });
    expect(companies.mock.calls.map(([args]) => args.category)).toEqual(["Cybersecurity", "AI"]);
    expect(result.rows.filter(row => row.category === "Cybersecurity")).toHaveLength(2);
    expect(result.rows.filter(row => row.category === "artificial intelligence")).toHaveLength(3);
    expect(result.search_run_id).toBe("compound:test");
    expect(result.candidateLedger?.accounting?.ok).toBe(true);
  });
});

describe("investor mandate is distinct from recipient funding", () => {
  it.each([
    "looking for investors who actually invest in ai startups, ideally seed/preseed, canada or us is good, checks maybe 100k to 2m ish but thats not an absolute rule, bonus if theyve invested in devtools automation agents data infra kinda stuff recently, i want actual funds/angels not articles talking about venture capital",
    "Find investors that invest in AI startups in Canada. Seed is preferred, and recent devtools investment is a bonus.",
  ])("qualifies source-bound static mandate under natural soft preferences: %s", async raw => {
    const investors = vi.fn(async () => ({ rows: [{ name: "North Fund", kind: "fund", role: "Investor", firm: "North Fund", sectors: ["AI"], stages: ["seed"],
      location_raw: "Toronto, Canada", location_city: "Toronto", location_country: "CA", website: "https://north.example", linkedin: null,
      email: "hello@north.example", check_min_usd: 100_000, check_max_usd: 2_000_000 }],
      meta: { dbHit: true, engine: "s3-parquet", partitionsRead: ["investor-fixture"], rowsScanned: 1, rowsReturned: 1 } }));
    const result = await runSpecSearchCore(raw, { investors: investors as never, liveGapfill: null }, 1, {}, { force: true });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].evidence?.some(item => item.evidence_type === "investment" && item.subject === result.rows[0].entity_id)).toBe(true);
  });
  const spec: SearchSpec = { ...base, entity: "investor", signal_required: true, signal_types: ["investment"],
    criteria: [{ field: "investor_sector", value: "AI", stated: true, confidence: 1 }] };
  const quote = "North Fund is an early-stage AI investor in Canada.";
  const pages = [{ url: "https://north.example/about", title: "North Fund", text: quote }];
  const entities = [{ page: 0, kind: "investor" as const, name: "North Fund", identityQuote: quote,
    fields: { sector: { value: "AI", quote } } }];
  it("creates investment proof only from observed named mandate", () => {
    const row = browserEntitiesToRows(entities, pages)[0];
    const claim = row.evidence!.find((item) => item.evidence_type === "investment")!;
    expect(claim.claim_parameters).toEqual({ investor_sector: "AI" });
    expect(verifyClaimEvidence({ evidence: claim, entityId: row.entity_id!, spec }).ok).toBe(true);
    expect(verifyClaimEvidence({ evidence: { ...claim, evidence_type: "funding" }, entityId: row.entity_id!, spec }).reject_code).toBe("CLAIM_TYPE_MISMATCH");
    expect(verifyClaimEvidence({ evidence: claim, entityId: "another-fund", spec }).reject_code).toBe("CLAIM_NOT_SUBJECT_BOUND");
    expect(verifyClaimEvidence({ evidence: claim, entityId: row.entity_id!, spec: { ...spec, signal_recency: "90d" } }).reject_code).toBe("TEMPORAL_UNKNOWN");
  });
  it("cannot copy desired sector from a different quote", () => {
    expect(browserEntitiesToRows([{ ...entities[0], fields: { sector: { value: "AI", quote: "North Fund invests in health." } } }], pages)).toHaveLength(1);
    expect(browserEntitiesToRows([{ ...entities[0], fields: { sector: { value: "AI", quote: "North Fund invests in health." } } }], pages)[0].evidence!.some((item) => item.evidence_type === "investment")).toBe(false);
  });
});
