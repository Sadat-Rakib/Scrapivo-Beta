import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserEntitiesToRows, deterministicLocalEntities, extractEntities } from "./browser-live.server";
import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import type { SearchSpec } from "./search-spec";

vi.mock("@/lib/ai/router.server", () => ({
  aiComplete: vi.fn(),
  safeJsonParse: vi.fn(),
}));

const spec = (entity: SearchSpec["entity"]): SearchSpec => ({
  entity, raw_query: "test", criteria: [], missing: [], signal_required: false,
  signal_types: [], signal_recency: null, status: "ready_to_search",
});

beforeEach(() => {
  vi.mocked(aiComplete).mockReset().mockRejectedValue(new Error("provider_failed"));
  vi.mocked(safeJsonParse).mockReset().mockImplementation((text) => JSON.parse(text));
});

describe("browser extraction when the model is unavailable", () => {
  it("keeps source article founder cards as named people with source evidence", async () => {
    const page = { url: "https://publisher.example/saas-founders", title: "Top SaaS Founders", text:
      "Top 25 B2B SaaS Founder List\nThe Founders\nAndrew Breen\nFounder & CEO\nOutshine\nView Bio >>\nAndrew Breen is the founder of Outshine, a SaaS agency.\nDavid Chevalier\nCo-Founder & CEO\nSurfe\nView Bio >>" };
    const entities = await extractEntities([page], spec("person"));
    const rows = browserEntitiesToRows(entities, [page]);
    expect(rows.map((row) => row.title)).toEqual(["Andrew Breen", "David Chevalier"]);
    expect(rows[0]).toMatchObject({ company: "Outshine", role: "Founder & CEO", source_url: page.url });
    expect(rows[0].website_url == null).toBe(true);
    expect(rows[0].evidence?.[0].source_url).toBe(page.url);
  });

  it("uses observed SaaS company descriptions without turning a list into a company", async () => {
    const page = { url: "https://publisher.example/toronto-saas", title: "Toronto SaaS Companies", text:
      "Toronto SaaS companies\nAI Agents\nAI Agents is a software platform category for business teams.\nERP Software\nERP Software is a SaaS category.\nAcme Cloud\nAcme Cloud is a Toronto SaaS platform for business teams.\nNorthstar Labs - Northstar Labs builds software for Toronto companies." };
    const entities = await extractEntities([page], spec("company"));
    const rows = browserEntitiesToRows(entities, [page]);
    expect(rows.map((row) => row.title)).toContain("Acme Cloud");
    expect(rows.map((row) => row.title)).not.toContain("AI Agents");
    expect(rows.map((row) => row.title)).not.toContain("ERP Software");
    expect(rows.every((row) => row.source_url === page.url && row.website_url == null)).toBe(true);
  });
});

describe("investor deterministic regressions", () => {
  const investorSpec: SearchSpec = { ...spec("investor"), criteria: [
    { field: "investor_sector", value: "AI", stated: true, confidence: 1 },
    { field: "investor_stage", value: "seed", stated: true, confidence: 1 },
    { field: "location", value: "Canada", stated: true, confidence: 1 },
  ] };
  const names = ["Maple Capital", "Birch Capital", "Cedar Capital"];
  const page = { url: "https://publisher.example/funds", title: "Canadian VC firms", text: names
    .flatMap((name) => [name, `${name} invests in AI at seed stage in Canada.`]).join("\n") };

  it("keeps every consecutive descriptive fund card", async () => {
    const entities = await extractEntities([page], investorSpec);
    expect(entities.map((entity) => entity.name)).toEqual(names);
    expect(browserEntitiesToRows(entities, [page]).map((row) => row.title)).toEqual(names);
  });

  it("preserves descriptive company cards in the same shared loop", () => {
    const companyPage = { ...page, title: "SaaS companies", text: names
      .flatMap((name) => [name, `${name} builds a SaaS platform serving business teams.`]).join("\n") };
    const companySpec = { ...spec("company"), criteria: [{ field: "category", value: "SaaS", stated: true, confidence: 1 }] };
    expect(deterministicLocalEntities([companyPage], companySpec).map((entity) => entity.name)).toEqual(names);
  });

  it("keeps non-descriptive detail consumption", () => {
    const companyPage = { ...page, title: "SaaS companies", text: "Maple Capital\nSoftware platform for SaaS teams\nBirch Capital\nSoftware platform for SaaS teams\nCedar Capital\nSoftware platform for SaaS teams" };
    const companySpec = { ...spec("company"), criteria: [{ field: "category", value: "SaaS", stated: true, confidence: 1 }] };
    expect(deterministicLocalEntities([companyPage], companySpec).map((entity) => entity.name)).toEqual(names);
  });

  it("retains AI-only anchors on first-party fund pages", async () => {
    const pages = names.map((name, index) => ({ url: `https://fund${index}.example`, title: `${name} | AI`, text: `${name} invests in AI.` }));
    const entities = await extractEntities(pages, { ...investorSpec, criteria: investorSpec.criteria.slice(0, 1) });
    expect(browserEntitiesToRows(entities, pages).map((row) => row.title)).toEqual(names);
  });

  it("emits separate literal sector and stage evidence without synthetic category facts", async () => {
    const entities = await extractEntities([page], investorSpec);
    for (const entity of entities) {
      expect(entity.fields?.category).toBeUndefined();
      expect(entity.fields?.sector).toMatchObject({ value: "AI" });
      expect(entity.fields?.stage).toMatchObject({ value: "seed" });
      for (const field of [entity.fields?.sector, entity.fields?.stage]) {
        expect(field?.quote).toContain(entity.name);
        expect(field?.quote).toContain(field?.value);
        expect(page.text.replace(/\s+/g, " ")).toContain(field?.quote.replace(/\s+/g, " "));
      }
    }
    expect(browserEntitiesToRows(entities, [page]).every((row) => row.sector === "AI" && row.stage === "seed" && row.category == null)).toBe(true);
  });

  it("does not turn requested AI/seed into facts for fintech growth funds", async () => {
    const otherPage = { ...page, text: names.flatMap((name) => [name, `${name} invests in fintech at growth stage in Canada.`]).join("\n") };
    const entities = await extractEntities([otherPage], investorSpec);
    expect(entities).toHaveLength(3);
    expect(entities.every((entity) => !entity.fields?.category && !entity.fields?.sector && entity.fields?.stage?.value !== "seed")).toBe(true);
  });

  it("does not match AI inside retail", async () => {
    const retailPage = { ...page, text: names.flatMap((name) => [name, `${name} invests in retail at seed stage in Canada.`]).join("\n") };
    const entities = await extractEntities([retailPage], investorSpec);
    expect(entities).toHaveLength(3);
    expect(entities.every((entity) => !entity.fields?.sector)).toBe(true);
  });

  it("uses source-backed industry as the investor sector anchor", async () => {
    const entities = await extractEntities([page], { ...investorSpec, criteria: [{ field: "industry", value: "AI", stated: true, confidence: 1 }] });
    expect(entities).toHaveLength(3);
    expect(entities.every((entity) => entity.fields?.sector?.value === "AI" && !entity.fields?.category)).toBe(true);
  });

  it("does not relabel capital-named software businesses as deterministic investors", async () => {
    const otherPage = { ...page, text: names.flatMap((name) => [name, `${name} builds AI software for venture capital firms.`]).join("\n") };
    expect(await extractEntities([otherPage], investorSpec)).toEqual([]);
    expect(aiComplete).toHaveBeenCalledOnce();
  });

  it("does not treat sector or stage words in fund names as focus evidence", async () => {
    const fundNames = ["AI Ventures", "Seed Capital", "AI Seed Fund"];
    const namedPage = { ...page, text: fundNames.flatMap((name) => [name, `${name} invests in fintech companies in Canada.`]).join("\n") };
    const entities = await extractEntities([namedPage], investorSpec);
    expect(entities.map((entity) => entity.name)).toEqual(fundNames);
    expect(entities.every((entity) => !entity.fields?.sector && !entity.fields?.stage)).toBe(true);
  });

  it("does not let three invalid first-party identities suppress valid model extraction", async () => {
    const pages = names.map((name, index) => ({ url: `https://fund${index}.example`, title: `${name} | AI seed`,
      text: `We invest in AI at seed stage in Canada.\n${name} is an investment firm investing in AI at seed stage in Canada.` }));
    const entities = names.map((name, index) => ({ page: index, kind: "investor", name, identityQuote: pages[index].text.split("\n")[1] }));
    vi.mocked(aiComplete).mockResolvedValue(JSON.stringify({ entities }));
    const trace = vi.fn();
    const extracted = await extractEntities(pages, investorSpec, trace);
    expect(aiComplete).toHaveBeenCalledOnce();
    expect(trace).toHaveBeenCalledWith(expect.objectContaining({ extractor: "llm", llm: "ok" }));
    expect(browserEntitiesToRows(extracted, pages).map((row) => row.title)).toEqual(names);
  });
});
