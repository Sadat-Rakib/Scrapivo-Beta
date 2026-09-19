import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractSearchSpec } from "@/lib/search/search-spec-extract";

const mockState = vi.hoisted(() => ({
  rows: new Map<string, unknown[]>(),
  calls: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/integrations/my-supabase/admin.server", () => ({
  getAdmin: () => ({
    from: (table: string) => {
      const q: any = {};
      for (const method of ["select", "eq", "in", "is", "not", "ilike", "or", "order", "range"]) {
        q[method] = (...args: unknown[]) => {
          mockState.calls.push([table, method, args]);
          return q;
        };
      }
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: mockState.rows.get(table) ?? [], error: null });
      return q;
    },
  }),
}));

import { queryIndexForSpec } from "./search-index.server";

describe("indexed stored retrieval mapping", () => {
  beforeEach(() => {
    mockState.rows.clear();
    mockState.calls.length = 0;
  });

  it("maps business rows as resolved stored entities", async () => {
    mockState.rows.set("idx_businesses", [{
      registry_key: "osm:b1", name: "Austin Air", category: "hvac",
      city: "Austin", region: "TX", country: "US", phone: "+15125550123",
    }]);
    const result = await queryIndexForSpec(extractSearchSpec("HVAC contractors in Austin"), 10);
    expect(result?.rows[0]).toMatchObject({
      entity_id: "osm:b1", entity_resolved: true, page_type: "entity_page",
    });
  });

  it("preserves no-website opportunity before completeness splitting", async () => {
    mockState.rows.set("idx_businesses", [{
      registry_key: "osm:no-site", name: "No Site Cafe", category: "restaurant",
      city: "Austin", region: "TX", country: "US", website: null, email: null, phone: null,
    }]);
    const result = await queryIndexForSpec(
      extractSearchSpec("restaurants in Austin without websites"),
      10,
    );
    expect(result?.rows[0]).toMatchObject({ opportunity: "no_website", url: null });
  });

  it("uses contained category matching and preserves company qualification identity", async () => {
    mockState.rows.set("idx_companies", [{
      registry_key: "co:c1", name: "North Stack",
      category: "Information Technology, Software", city: "London", country: "GB",
      website: "https://north-stack.example",
    }]);
    const result = await queryIndexForSpec(extractSearchSpec("SaaS companies in London"), 10);
    expect(mockState.calls.some(([t, m]) => t === "idx_companies" && m === "or")).toBe(true);
    expect(result?.rows[0]).toMatchObject({
      entity_id: "co:c1", entity_resolved: true, page_type: "company_page",
    });
  });

  it("maps people with city, profile contact and employment evidence", async () => {
    mockState.rows.set("idx_people", [{
      registry_key: "p:p1", name: "Ada", role: "Founder & CEO", company: "Analytical",
      city: "Toronto", country: "CA", industry: "Software",
      linkedin: "https://linkedin.com/in/ada", email: null, phone: null,
    }]);
    const result = await queryIndexForSpec(extractSearchSpec("founders in Toronto"), 10);
    expect(result?.rows[0]).toMatchObject({
      entity_id: "p:p1", entity_resolved: true, page_type: "person_page",
      location: "Toronto", url: "https://linkedin.com/in/ada",
    });
    expect(result?.rows[0].evidence).toHaveLength(1);
  });

  it("pushes explicit contact requirements into candidate supply", async () => {
    mockState.rows.set("idx_people", []);
    await queryIndexForSpec(extractSearchSpec("founders in Canada with email and phone"), 50);
    const notCalls = mockState.calls.filter(([t, m]) => t === "idx_people" && m === "not");
    expect(notCalls).toHaveLength(2);
  });
});
