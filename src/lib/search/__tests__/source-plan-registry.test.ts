import { describe, expect, it } from "vitest";
import { registryBlockedProviderIds } from "../source-plan";
import type { SourceDefinition } from "@/lib/sources/registry";

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
