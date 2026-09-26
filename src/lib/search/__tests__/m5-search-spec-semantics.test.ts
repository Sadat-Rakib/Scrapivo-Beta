/**
 * M5 — Semantic / SearchSpec completion battery.
 *
 * Inspects the SearchSpec that extractSearchSpec produces — the same object
 * the production SPEC_SEARCH path consumes — not an isolated toy parser.
 */
import { describe, expect, it } from "vitest";
import { extractSearchSpec } from "../search-spec-extract";
import { queryRequiredFields } from "../canonical-contract";
import type { SearchSpec } from "../search-spec";

function field(spec: SearchSpec, f: string): string | null {
  return spec.criteria.find((c) => c.field === f)?.value ?? null;
}

describe("M5 SearchSpec semantics (production extractSearchSpec)", () => {
  describe("acceptance battery", () => {
    it("restaurants in Toronto → business + category + location, no signal", () => {
      const spec = extractSearchSpec("restaurants in Toronto");
      expect(spec.entity).toBe("business");
      expect(field(spec, "category")?.toLowerCase()).toMatch(/restaurant/);
      expect(field(spec, "location")?.toLowerCase()).toContain("toronto");
      expect(spec.signal_required).toBe(false);
      expect(spec.status).toBe("ready_to_search");
      expect(queryRequiredFields(spec)).not.toContain("claim_evidence");
    });

    it("restaurants in Toronto without websites → opportunity + claim required", () => {
      const spec = extractSearchSpec("restaurants in Toronto without websites");
      expect(spec.entity).toBe("business");
      expect(field(spec, "location")?.toLowerCase()).toContain("toronto");
      expect(field(spec, "opportunity")).toBe("no_website");
      expect(spec.signal_required).toBe(true);
      expect(queryRequiredFields(spec)).toContain("claim_evidence");
    });

    it("companies needing marketing help in Austin → need, not industry", () => {
      const spec = extractSearchSpec("companies needing marketing help in Austin");
      expect(spec.entity).toBe("company");
      expect(field(spec, "requested_service")?.toLowerCase()).toMatch(/marketing/);
      expect(field(spec, "industry")?.toLowerCase()).not.toBe("marketing");
      expect(field(spec, "location")?.toLowerCase()).toContain("austin");
      expect(spec.signal_required).toBe(true);
      expect(queryRequiredFields(spec)).toContain("claim_evidence");
    });

    it("founders needing developers in San Francisco → person + role + need", () => {
      const spec = extractSearchSpec("founders needing developers in San Francisco");
      expect(spec.entity).toBe("person");
      expect(field(spec, "role")).toBe("founder");
      expect(field(spec, "requested_role")?.toLowerCase()).toMatch(/developer/);
      expect(field(spec, "location")?.toLowerCase()).toMatch(/san francisco|sf/);
      expect(spec.signal_required).toBe(true);
      expect(spec.status).toBe("ready_to_search");
      expect(queryRequiredFields(spec)).toContain("claim_evidence");
    });

    it("companies hiring senior React developers in Austin → hiring + role + tech + seniority", () => {
      const spec = extractSearchSpec(
        "companies hiring senior React developers in Austin",
      );
      expect(spec.entity).toBe("company");
      expect(spec.signal_required).toBe(true);
      expect(spec.signal_types).toEqual(expect.arrayContaining(["hiring"]));
      expect(field(spec, "requested_role")?.toLowerCase()).toMatch(/developer/);
      expect(field(spec, "technology")).toBe("React");
      expect(field(spec, "seniority")).toBe("senior");
      expect(field(spec, "location")?.toLowerCase()).toContain("austin");
    });

    it("React jobs in Toronto → job; salary NOT required", () => {
      const spec = extractSearchSpec("React jobs in Toronto");
      expect(spec.entity).toBe("job");
      expect(field(spec, "technology")).toBe("React");
      expect(field(spec, "role")?.toLowerCase()).toMatch(/developer|react/);
      expect(field(spec, "location")?.toLowerCase()).toContain("toronto");
      expect(field(spec, "salary_min")).toBeNull();
      expect(spec.status).toBe("ready_to_search");
      expect(queryRequiredFields(spec)).not.toContain("salary");
    });

    it("React jobs in Toronto paying $150k+ → salary required", () => {
      const spec = extractSearchSpec("React jobs in Toronto paying $150k+");
      expect(spec.entity).toBe("job");
      expect(field(spec, "salary_min")).toBe("150000");
      expect(queryRequiredFields(spec)).toContain("salary");
      expect(spec.status).toBe("ready_to_search");
    });

    it("recently funded startups in Berlin → company + funding + temporal", () => {
      const spec = extractSearchSpec("recently funded startups in Berlin");
      expect(spec.entity).toBe("company");
      expect(spec.signal_required).toBe(true);
      expect(spec.signal_types).toEqual(expect.arrayContaining(["funding"]));
      expect(field(spec, "funding_status")).toBe("recent");
      expect(field(spec, "location")?.toLowerCase()).toContain("berlin");
      expect(spec.signal_recency).toBe("90d");
      expect(field(spec, "temporal_relation")).toBe("recent");
    });

    it("people asking for website help → person + social/service signal", () => {
      const spec = extractSearchSpec("people asking for website help");
      expect(spec.entity).toBe("person");
      expect(spec.signal_required).toBe(true);
      expect(spec.signal_types).toEqual(
        expect.arrayContaining(["service_request", "social_ask"]),
      );
      expect(field(spec, "opportunity")).not.toBe("no_website");
      expect(
        field(spec, "requested_product")?.toLowerCase() ??
          field(spec, "requested_service")?.toLowerCase(),
      ).toMatch(/website|web/);
      expect(spec.status).toBe("ready_to_search");
    });
  });

  describe("adversarial pairs (need ≠ industry, hiring ≠ funded, …)", () => {
    it("marketing companies ≠ companies needing marketing", () => {
      const industry = extractSearchSpec("marketing companies in Austin");
      const need = extractSearchSpec("companies needing marketing help in Austin");
      expect(industry.signal_required).toBe(false);
      expect(field(industry, "industry")?.toLowerCase()).toBe("marketing");
      expect(field(industry, "requested_service")).toBeNull();
      expect(need.signal_required).toBe(true);
      expect(field(need, "requested_service")?.toLowerCase()).toMatch(/marketing/);
      expect(field(need, "industry")?.toLowerCase()).not.toBe("marketing");
    });

    it("funded companies ≠ companies hiring", () => {
      const funded = extractSearchSpec("funded companies");
      const hiring = extractSearchSpec("companies hiring");
      expect(funded.signal_types).toEqual(expect.arrayContaining(["funding"]));
      expect(funded.signal_types).not.toEqual(expect.arrayContaining(["hiring"]));
      expect(hiring.signal_types).toEqual(expect.arrayContaining(["hiring"]));
      expect(hiring.signal_types).not.toEqual(expect.arrayContaining(["funding"]));
      expect(field(funded, "funding_status")).toBe("recent");
      expect(field(hiring, "funding_status")).toBeNull();
    });

    it("developer companies ≠ companies needing developers", () => {
      const identity = extractSearchSpec("developer companies");
      const need = extractSearchSpec("companies needing developers");
      expect(identity.signal_required).toBe(false);
      expect(field(identity, "requested_role")).toBeNull();
      expect(need.signal_required).toBe(true);
      expect(field(need, "requested_role")?.toLowerCase()).toMatch(/developer/);
    });

    it("founder organizations ≠ founders", () => {
      const orgs = extractSearchSpec("founder organizations");
      const people = extractSearchSpec("founders");
      expect(orgs.entity).toBe("company");
      expect(field(orgs, "role")).toBeNull();
      expect(people.entity).toBe("person");
      expect(field(people, "role")).toBe("founder");
    });
  });

  describe("clarification discipline", () => {
    it("ambiguous 'people who can help with websites' clarifies — never guesses", () => {
      const spec = extractSearchSpec("Find people who can help with websites.");
      expect(spec.entity).toBe("person");
      // Must not invent a need/opportunity; role remains missing → clarify.
      expect(spec.signal_required).toBe(false);
      expect(field(spec, "opportunity")).toBeNull();
      expect(spec.status).toBe("needs_clarification");
      expect(spec.missing).toContain("role");
    });

    it("clear founder need query does not clarify", () => {
      const spec = extractSearchSpec(
        "Find founders needing developers in San Francisco.",
      );
      expect(spec.status).toBe("ready_to_search");
      expect(spec.missing).toEqual([]);
    });
  });

  describe("open role + temporal ontology", () => {
    it("normalizes marketing director without collapsing to a closed enum only", () => {
      const spec = extractSearchSpec("marketing directors in Austin");
      expect(spec.entity).toBe("person");
      expect(field(spec, "role")).toBe("marketing director");
      expect(field(spec, "location")?.toLowerCase()).toContain("austin");
    });

    it("last 30 days → signal_recency 30d", () => {
      const spec = extractSearchSpec("companies funded in the last 30 days in Berlin");
      expect(spec.signal_recency).toBe("30d");
      expect(field(spec, "temporal_relation")).toBe("last_n_days");
    });

    it("this quarter → temporal relation", () => {
      const spec = extractSearchSpec("startups funded this quarter in Berlin");
      expect(spec.signal_recency).toBe("3m");
      expect(field(spec, "temporal_relation")).toBe("this_quarter");
    });

    it("in 2026 → temporal_year", () => {
      const spec = extractSearchSpec("startups funded in 2026 in Berlin");
      expect(field(spec, "temporal_year")).toBe("2026");
      expect(field(spec, "temporal_relation")).toBe("in_year");
    });
  });
});
