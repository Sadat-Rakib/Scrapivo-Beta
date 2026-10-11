import { describe, expect, it } from "vitest";
import { buildCandidateResearchQueries, registryBlockedProviderIds } from "../source-plan";
import type { SourceDefinition } from "@/lib/sources/registry";
import type { SearchSpec } from "../search-spec";

describe('candidate research follows the requested claim', () => {
  const base: SearchSpec = { entity: 'investor', criteria: [], missing: [], signal_required: true, signal_types: ['investment'], signal_recency: null, status: 'ready_to_search', raw_query: 'investors who actually invest in AI startups' };
  const row = { title: 'Example Fund' };
  it('researches actual investor portfolio activity rather than careers or company funding', () => {
    const spec = { ...base, criteria: [{ field: 'investor_sector', value: 'AI', stated: true, confidence: 1 }] };
    expect(buildCandidateResearchQueries(spec, row, ['signal'])).toEqual(['Example Fund AI portfolio invested backed']);
  });
  it('preserves hiring careers and requested role, including the job signal alias', () => {
    const spec = { ...base, entity: 'company' as const, signal_types: ['job'], criteria: [{ field: 'requested_role', value: 'engineer', stated: true, confidence: 1 }] };
    expect(buildCandidateResearchQueries(spec, row, ['signal_evidence'])).toEqual(['Example Fund hiring engineer', 'Example Fund careers']);
  });
  it('keeps company funding distinct from investor investment', () => {
    expect(buildCandidateResearchQueries({ ...base, entity: 'company', signal_types: ['funded'] }, row, ['signal'])).toEqual(['Example Fund funding raised round']);
  });
  it('keeps custom and unknown signals generic without injecting hiring', () => {
    expect(buildCandidateResearchQueries({ ...base, entity: 'company', signal_types: ['custom'], custom_signal_text: 'manual invoice workflows' }, row, ['signal'])).toEqual(['Example Fund manual invoice workflows']);
    expect(buildCandidateResearchQueries({ ...base, signal_types: ['custom'] }, row, ['signal'])).toEqual(['Example Fund recent activity evidence']);
    expect(buildCandidateResearchQueries({ ...base, signal_types: [] }, row, ['signal'])).toEqual(['Example Fund recent activity evidence']);
  });
  it('emits both independently requested claim queries and never researches a signal that is not missing', () => {
    expect(buildCandidateResearchQueries({ ...base, signal_types: ['investment', 'hiring'] }, row, ['signal'])).toEqual(['Example Fund hiring', 'Example Fund careers', 'Example Fund portfolio invested backed']);
    expect(buildCandidateResearchQueries(base, row, [])).toEqual([]);
  });
});

function def(id: string, decision: SourceDefinition["decision"]): SourceDefinition {
  return {
    id,
    name: id,
    entityTypes: ["company"],
    sourceKind: "database",
    accessMode: "http",
    decision,
    checkedAt: "2026-09-27",
  } as SourceDefinition;
}

describe("registryBlockedProviderIds", () => {
  it("blocks plan providers whose registry decision is disabled or needs_review", () => {
    const blocked = registryBlockedProviderIds([
      def("db-osm", "disabled"),
      def("search-searxng", "needs_review"),
      def("db-indexed", "allowed"),
      def("api-foursquare", "needs_key"), // unmapped id — ignored here
    ]);
    expect(blocked.get("osm-local")).toBe("registry_disabled");
    expect(blocked.get("searxng")).toBe("registry_needs_review");
    expect(blocked.has("indexed-db")).toBe(false);
    expect(blocked.has("foursquare")).toBe(false);
  });

  it("leaves the live registry's allowed decisions unblocked", () => {
    const blocked = registryBlockedProviderIds();
    // Current registry: these are allowed — nothing may silently block them.
    expect(blocked.has("searxng")).toBe(false);
    expect(blocked.has("indexed-db")).toBe(false);
    expect(blocked.has("osm-local")).toBe(false);
    expect(blocked.has("direct-http")).toBe(false);
  });
});
