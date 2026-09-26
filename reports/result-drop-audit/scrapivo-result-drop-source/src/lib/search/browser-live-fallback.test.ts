import { describe, expect, it, vi } from "vitest";
import { browserEntitiesToRows, extractEntities } from "./browser-live.server";
import type { SearchSpec } from "./search-spec";

vi.mock("@/lib/ai/router.server", () => ({
  aiComplete: vi.fn(async () => { throw new Error("model_missing"); }),
  safeJsonParse: vi.fn(() => null),
}));

const spec = (entity: SearchSpec["entity"]): SearchSpec => ({
  entity, raw_query: "test", criteria: [], missing: [], signal_required: false,
  signal_types: [], signal_recency: null, status: "ready_to_search",
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
