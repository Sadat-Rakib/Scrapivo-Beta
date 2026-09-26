/**
 * M6 — Location / geographic resolution battery.
 *
 * Inspects resolveCanonicalLocation + locationSatisfies + production
 * extractSearchSpec geo stamps + theorem LOCATION_MISMATCH gate.
 */
import { describe, expect, it } from "vitest";
import {
  locationSatisfies,
  resolveCanonicalLocation,
} from "../location-resolver";
import { extractSearchSpec } from "../search-spec-extract";
import {
  evaluateQualifiedLeadTheorem,
  type TheoremCandidate,
} from "../canonical-contract";
import { qualifyLead } from "../qualify";
import { makeEvidence } from "../evidence";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { SearchSpec } from "../search-spec";

function field(spec: SearchSpec, f: string): string | null {
  return spec.criteria.find((c) => c.field === f)?.value ?? null;
}

function resolvedCand(
  overrides: Partial<TheoremCandidate> & { location: string },
): TheoremCandidate {
  return {
    entity_id: "company:acme",
    entity_resolved: true,
    entity_resolution: "resolved",
    entity_type: "company",
    name: "Acme",
    page_type: "company_page",
    identity_confidence: 0.9,
    fields: { location: overrides.location },
    evidence: overrides.evidence ?? [],
    ...overrides,
  };
}

describe("M6 geographic resolution", () => {
  describe("canonical entities (not bare string aliases)", () => {
    it("Toronto → city entity with country + parents", () => {
      const g = resolveCanonicalLocation("Toronto");
      expect(g?.id).toBe("geo:city:toronto");
      expect(g?.kind).toBe("city");
      expect(g?.country_code).toBe("CA");
      expect(g?.resolution).toBe("resolved");
      expect(g?.parent_ids).toEqual(
        expect.arrayContaining(["geo:metro:gta", "geo:admin:ontario"]),
      );
    });

    it("GTA / Greater Toronto Area → metro", () => {
      expect(resolveCanonicalLocation("GTA")?.id).toBe("geo:metro:gta");
      expect(resolveCanonicalLocation("Greater Toronto Area")?.kind).toBe(
        "metro",
      );
    });

    it("Downtown Toronto → neighborhood inside Toronto", () => {
      const g = resolveCanonicalLocation("downtown Toronto");
      expect(g?.kind).toBe("neighborhood");
      expect(g?.parent_ids).toContain("geo:city:toronto");
    });

    it("Bay Area / Silicon Valley / Greater London / Manhattan / Ontario", () => {
      expect(resolveCanonicalLocation("Bay Area")?.id).toBe("geo:metro:bay-area");
      expect(resolveCanonicalLocation("Silicon Valley")?.id).toBe(
        "geo:metro:silicon-valley",
      );
      expect(resolveCanonicalLocation("Greater London")?.id).toBe(
        "geo:metro:greater-london",
      );
      expect(resolveCanonicalLocation("Manhattan")?.kind).toBe("neighborhood");
      expect(resolveCanonicalLocation("Ontario")?.kind).toBe("admin");
    });

    it("Toronto, Ontario and London, UK compound forms", () => {
      const t = resolveCanonicalLocation("Toronto, Ontario");
      expect(t?.id).toBe("geo:city:toronto");
      expect(t?.country_code).toBe("CA");
      const l = resolveCanonicalLocation("London, UK");
      expect(l?.id).toBe("geo:city:london");
      expect(l?.country_code).toBe("GB");
    });

    it("near Toronto stamps near scope on city entity", () => {
      const g = resolveCanonicalLocation("near Toronto");
      expect(g?.id).toBe("geo:city:toronto");
      expect(g?.scope).toBe("near");
    });

    it("unknown place stays provisional stated — not invented", () => {
      const g = resolveCanonicalLocation("Lyon");
      expect(g?.resolution).toBe("provisional");
      expect(g?.kind).toBe("stated");
      expect(g?.name).toMatch(/Lyon/i);
    });
  });

  describe("locationSatisfies hierarchy", () => {
    it("Downtown Toronto satisfies Toronto and GTA", () => {
      expect(locationSatisfies("Downtown Toronto", "Toronto")).toBe(true);
      expect(locationSatisfies("Toronto", "GTA")).toBe(true);
      expect(locationSatisfies("Mississauga", "Greater Toronto Area")).toBe(
        true,
      );
    });

    it("Toronto satisfies Ontario; Austin does not", () => {
      expect(locationSatisfies("Toronto", "Ontario")).toBe(true);
      expect(locationSatisfies("Austin", "Ontario")).toBe(false);
    });

    it("Dallas does not satisfy Austin (sibling cities)", () => {
      expect(locationSatisfies("Dallas", "Austin")).toBe(false);
      expect(locationSatisfies("Austin", "Austin")).toBe(true);
    });

    it("Ontario does not satisfy Toronto (broader ≠ narrower Spec)", () => {
      expect(locationSatisfies("Ontario", "Toronto")).toBe(false);
      expect(locationSatisfies("GTA", "Toronto")).toBe(false);
    });

    it("San Francisco satisfies Bay Area", () => {
      expect(locationSatisfies("San Francisco", "Bay Area")).toBe(true);
      expect(locationSatisfies("Dallas", "Bay Area")).toBe(false);
    });
    it("accepts exact coarse-location segments without treating a city token as the metro", () => {
      expect(
        locationSatisfies(
          "Dallas/Fort Worth Metroplex, Southern US",
          "Dallas/Fort Worth Metroplex",
        ),
      ).toBe(true);
      expect(locationSatisfies("Dallas/Fort Worth Metroplex, Southern US", "Dallas")).toBe(false);
    });
  });

  describe("production extractSearchSpec stamps geo fields", () => {
    it("companies in GTA → location_id metro + ready", () => {
      const spec = extractSearchSpec("companies needing marketing help in GTA");
      expect(field(spec, "location")).toMatch(/Greater Toronto Area|GTA/i);
      expect(field(spec, "location_id")).toBe("geo:metro:gta");
      expect(field(spec, "location_kind")).toBe("metro");
      expect(field(spec, "location_country")).toBe("CA");
    });

    it("in downtown Toronto → neighborhood id", () => {
      const spec = extractSearchSpec("restaurants in downtown Toronto");
      expect(field(spec, "location_id")).toBe(
        "geo:neighborhood:downtown-toronto",
      );
      expect(field(spec, "location_kind")).toBe("neighborhood");
    });

    it("near Toronto → location_scope near", () => {
      const spec = extractSearchSpec("companies near Toronto");
      expect(field(spec, "location_id")).toBe("geo:city:toronto");
      expect(field(spec, "location_scope")).toBe("near");
    });
  });

  describe("qualification gate — claim alone is not enough", () => {
    it("Austin Spec rejects Dallas company with matching marketing claim", () => {
      const spec = extractSearchSpec(
        "companies needing marketing help in Austin",
      );
      expect(field(spec, "location")?.toLowerCase()).toContain("austin");
      const entity_id = "company:dallas-co";
      const ev = [
        makeEvidence({
          source_url: "https://dallas.example/need",
          source_type: "web",
          excerpt: "We need marketing help",
          evidence_type: "service_request",
          supports: "requested_service",
          subject: entity_id,
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "Dallas Co",
        detail: "Dallas",
        location: "Dallas",
        url: "https://dallas.example",
        key: entity_id,
        entity_id,
        entity_resolved: true,
        page_type: "company_page",
        evidence: ev,
      };
      const q = qualifyLead(row, spec, ev);
      expect(q.disposition).not.toBe("qualified");
      expect(q.reject_code).toBe("LOCATION_MISMATCH");

      const theorem = evaluateQualifiedLeadTheorem(
        resolvedCand({
          entity_id,
          location: "Dallas",
          evidence: ev,
        }),
        spec,
      );
      expect(theorem.ok).toBe(false);
      expect(theorem.reject_code).toBe("LOCATION_MISMATCH");
    });

    it("Austin Spec accepts Austin company with matching claim", () => {
      const spec = extractSearchSpec(
        "companies needing marketing help in Austin",
      );
      const entity_id = "company:austin-co";
      const ev = [
        makeEvidence({
          source_url: "https://austin.example/need",
          source_type: "web",
          excerpt: "We need marketing help",
          evidence_type: "service_request",
          supports: "requested_service",
          subject: entity_id,
        }),
      ];
      const row: SpecRow = {
        kind: "company",
        title: "Austin Co",
        detail: "Austin",
        location: "Austin",
        url: "https://austin.example",
        key: entity_id,
        entity_id,
        entity_resolved: true,
        identity_confidence: 0.9,
        page_type: "company_page",
        evidence: ev,
      };
      expect(qualifyLead(row, spec, ev).disposition).toBe("qualified");
    });

    it("GTA Spec accepts Toronto candidate", () => {
      const spec = extractSearchSpec("restaurants in GTA without websites");
      const theorem = evaluateQualifiedLeadTheorem(
        resolvedCand({
          entity_id: "business:toronto-cafe",
          entity_type: "business",
          location: "Toronto",
          evidence: [
            makeEvidence({
              source_url: "osm:1",
              source_type: "osm",
              excerpt: "no website",
              evidence_type: "no_website",
              supports: "opportunity",
              subject: "business:toronto-cafe",
            }),
          ],
        }),
        spec,
      );
      expect(theorem.ok).toBe(true);
    });
  });
});
