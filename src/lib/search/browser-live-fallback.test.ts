import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserEntitiesToRows, deterministicLocalEntities, extractEntities } from "./browser-live.server";
import { aiComplete, safeJsonParse } from "@/lib/ai/router.server";
import { qualifyLead } from "./qualify";
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
  it("does not treat paid or retail words as evidence of an AI company", () => {
    const companySpec = { ...spec("company"), criteria: [{ field: "industry", value: "AI company", stated: true, confidence: 1 }] };
    for (const name of ["Paid Services", "Retail Portal"]) {
      const page = { url: "https://unrelated.example/", title: name, text: `${name} is a retail company offering paid subscriptions.` };
      expect(deterministicLocalEntities([page], companySpec)).toEqual([]);
    }
  });

  it("uses a meaningful industry when the category contains only generic company nouns", () => {
    const page = { url: "https://acme.example/", title: "Acme Cloud", text: "Acme Cloud is a cybersecurity software company." };
    const companySpec = { ...spec("company"), criteria: [
      { field: "category", value: "company", stated: true, confidence: 1 },
      { field: "industry", value: "cybersecurity", stated: true, confidence: 1 },
    ] };
    const entities = deterministicLocalEntities([page], companySpec);
    expect(browserEntitiesToRows(entities, [page]).map((row) => row.title)).toEqual(["Acme Cloud"]);
    expect(deterministicLocalEntities([page], { ...companySpec, criteria: companySpec.criteria.slice(0, 1) })).toEqual([]);
  });

  it("anchors company directories on the industry criterion and validates each named company", async () => {
    const companySpec = { ...spec("company"), criteria: [{ field: "industry", value: "cybersecurity company", stated: true, confidence: 1 }] };
    const page = { url: "https://publisher.example/security-products", title: "Product directory", text:
      "Northstar Labs\nNorthstar Labs is a cybersecurity software company.\nAcme Cloud\nAcme Cloud builds a cybersecurity platform.\nBirch Security\nBirch Security is a cybersecurity company." };
    const entities = await extractEntities([page], companySpec);
    expect(browserEntitiesToRows(entities, [page], undefined, companySpec).map((row) => row.title).sort())
      .toEqual(["Acme Cloud", "Birch Security", "Northstar Labs"]);
    expect(aiComplete).not.toHaveBeenCalled();
  });

  it("anchors a first-party AI infrastructure company without inventing the requested industry label", () => {
    const companySpec = { ...spec("company"), criteria: [{ field: "industry", value: "ai infra/devtool startup", stated: true, confidence: 1 }] };
    const page = { url: "https://acme.example/", title: "Acme Cloud", text:
      "Acme Cloud builds artificial intelligence infrastructure software for developers." };
    const rows = browserEntitiesToRows(deterministicLocalEntities([page], companySpec), [page], undefined, companySpec);
    expect(rows.map((row) => row.title)).toEqual(["Acme Cloud"]);
    expect(rows[0].detail).toContain("artificial intelligence infrastructure");
    expect(rows[0].category).toBeNull();
    expect(rows[0].industry).toBeNull();
  });

  it("does not suppress model extraction when three or more company fallback names fail source validation", async () => {
    const companySpec = { ...spec("company"), criteria: [{ field: "industry", value: "cybersecurity", stated: true, confidence: 1 }] };
    const page = { url: "https://publisher.example/security-guide", title: "Cybersecurity guide", text:
      "Resources\nCybersecurity best practices\nLearn More\nCybersecurity recommendations\nPopular Topics\nCybersecurity guidance\nProduct Categories\nCybersecurity resources" };
    const fallback = deterministicLocalEntities([page], companySpec);
    expect(fallback.length).toBeGreaterThanOrEqual(3);
    expect(browserEntitiesToRows(fallback, [page], undefined, companySpec)).toHaveLength(0);
    vi.mocked(aiComplete).mockResolvedValue(JSON.stringify({ entities: [] }));
    await extractEntities([page], companySpec);
    expect(aiComplete).toHaveBeenCalledOnce();
  });

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

  it.each([
    ["United States", "Top Software Development Companies in USA"],
    ["Canada", "Top Software Development Companies in Canada"],
    ["Europe", "Best Software Development Companies in Europe"],
    ["Toronto", "Top Marketing Companies in Toronto"],
  ])("rejects directory scope heading %s while preserving company cards", (name, heading) => {
    const companySpec: SearchSpec = { ...spec("company"), raw_query: "software companies in USA", criteria: [
      { field: "industry", value: "software company", stated: true, confidence: 1 },
      { field: "location", value: "USA", stated: true, confidence: 1 },
    ] };
    const page = { url: "https://www.goodfirms.co/directory/country/top-software-development-companies/us",
      title: "Top Software Development Companies in the USA - 2026 Reviews | Goodfirms",
      text: `${name}\n${heading}\nAcme Labs\nAcme Labs is a software company based in USA\nBeta Labs\nBeta Labs is a software company based in USA` };
    const entities = deterministicLocalEntities([page], companySpec);
    const rows = browserEntitiesToRows(entities, [page], undefined, companySpec);
    expect(entities.some(entity => entity.name === name)).toBe(false);
    expect(rows.map(row => row.title)).toEqual(expect.arrayContaining(["Acme Labs", "Beta Labs"]));
    expect(rows.some(row => row.title === name && qualifyLead(row, companySpec, row.evidence).disposition === "qualified")).toBe(false);
  });

  it.each([
    ["Acme Labs", "Acme Labs is one of the top software development companies in USA"],
    ["Best Software", "Best Software is a software company based in USA"],
    ["Top Companies", "Top Companies is a software company based in USA"],
    ["Acme Labs", "Custom software development services"],
    ["Acme Labs", "Leading provider of software services for companies"],
  ])("preserves named own description %s despite ranking words in identity", (name, description) => {
    const companySpec = { ...spec("company"), criteria: [{ field: "industry", value: "software company", stated: true, confidence: 1 }] };
    const page = { url: "https://www.goodfirms.co/directory/country/top-software-development-companies/us",
      title: "Top Software Development Companies in the USA - 2026 Reviews | Goodfirms",
      text: `${name}\n${description}\nBeta Labs\nBeta Labs is a software company based in USA` };
    expect(deterministicLocalEntities([page], companySpec).some(entity => entity.name === name)).toBe(true);
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

describe("identity ownership (master PRD extraction contract)", () => {
  const companySpec: SearchSpec = { ...spec("company"), raw_query: "solar installers in Windhoek", criteria: [
    { field: "industry", value: "solar installer", stated: true, confidence: 1 },
    { field: "location", value: "Windhoek", stated: true, confidence: 1 },
  ] };

  it("a first-party company site yields ONE identity; its sections become attributes, not companies", () => {
    const page = { url: "https://cedarsolar.example/", title: "Cedar Solar Namibia | Home", text: [
      "Cedar Solar Namibia",
      "Solar panel installation and maintenance for homes and businesses in Windhoek.",
      "Strong technical team",
      "Solar pump repair center for Spitfire, Premium Power and more.",
      "Helpful after-sales support team",
      "Large installer network with PV Greencard accredited installers.",
      "Contact us on +264 61 555 0100",
    ].join("\n") };
    const entities = deterministicLocalEntities([page], companySpec);
    expect(entities.map((entity) => entity.name)).toEqual(["Cedar Solar Namibia"]);
    expect(browserEntitiesToRows(entities, [page], undefined, companySpec)).toHaveLength(1);
  });

  it("a directory page with several cards yields each card, none of the directory furniture", () => {
    const page = { url: "https://namdir.example/solar", title: "Solar Installers Directory in Windhoek", text: [
      "Cedar Solar Namibia",
      "Cedar Solar Namibia — solar installations, Windhoek",
      "Hopsol Africa",
      "Hopsol Africa — on-grid and off-grid solar, Windhoek",
      "Sun Push Solar",
      "Sun Push Solar — solar geysers and PV, Windhoek",
    ].join("\n") };
    const entities = deterministicLocalEntities([page], companySpec);
    const names = entities.map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(["Cedar Solar Namibia", "Hopsol Africa", "Sun Push Solar"]));
    expect(names.some((name) => /directory/i.test(name))).toBe(false);
  });

  it("fused text (HTML block boundaries without whitespace) does not mint a mangled identity", () => {
    const page = { url: "https://cedarsolar.example/", title: "Cedar Solar Namibia | Home", text:
      "Home EnergyCedar Solar Namibia Cedar Solar Namibia Claimed — solar installations in Windhoek. Call +264 61 555 0100." };
    const entities = deterministicLocalEntities([page], companySpec);
    for (const entity of entities) expect(entity.name).not.toMatch(/EnergyCedar/);
  });

  it("an unrelated university portal never becomes a company", () => {
    const page = { url: "https://it.university.example/solar", title: "SOLAR | Division of Information Technology", text:
      "SOLAR\nFaculty and Staff\nStudents\nCurrent Students\nSubmit a Ticket\nSystem Status" };
    const entities = deterministicLocalEntities([page], companySpec);
    expect(browserEntitiesToRows(entities, [page], undefined, companySpec)).toHaveLength(0);
  });
});
