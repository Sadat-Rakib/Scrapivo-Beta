import { describe, expect, it } from "vitest";
import { makeEvidence } from "@/lib/search/evidence";
import {
  ABSENCE_COMPONENT_KEYS,
  WEBSITE_NOT_FOUND_AFTER_VERIFICATION,
  verifyWebsiteAbsence,
  type WebsiteAbsenceInputs,
} from "@/lib/search/absence-verification";

function ev(url: string, excerpt: string): ReturnType<typeof makeEvidence> {
  return makeEvidence({
    source_url: url,
    source_type: "web",
    excerpt,
    evidence_type: "no_website",
    supports: "opportunity",
    subject: "business:acme",
    confidence: 0.7,
    extraction_method: "fixture",
  });
}

function fullInputs(): WebsiteAbsenceInputs {
  return {
    structured_listing_absence: [ev("osm:live-osm:1", "Structured listing has no website field.")],
    exact_identity_search: [ev("https://duckduckgo.test/html/?q=%22acme%22", "Exact identity search performed.")],
    official_domain_search: [ev("https://duckduckgo.test/html/?q=%22acme%22+official+website", "Official-domain search performed.")],
    no_first_party_site: [ev("https://duckduckgo.test/html/?q=%22acme%22+contact", "No first-party site discovered.")],
  };
}

describe("H14 website-absence rule", () => {
  it.each(ABSENCE_COMPONENT_KEYS)("refuses the claim when %s is missing", (component) => {
    const inputs = fullInputs();
    inputs[component] = [];
    const result = verifyWebsiteAbsence(inputs, { subject: "business:acme" });
    expect(result.ok).toBe(false);
    expect(result.claim).toBeNull();
    expect(result.missing).toEqual([component]);
    // Component evidence is still recorded for diagnostics.
    expect(result.components[component]).toEqual([]);
  });

  it.each(ABSENCE_COMPONENT_KEYS)("does not accept empty-url entries as evidence for %s", (component) => {
    const inputs = fullInputs();
    inputs[component] = [ev("", "no provenance")];
    const result = verifyWebsiteAbsence(inputs, { subject: "business:acme" });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([component]);
  });

  it("emits the claim with the exact wording when all four components hold", () => {
    const result = verifyWebsiteAbsence(fullInputs(), { subject: "business:acme" });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.claim).not.toBeNull();
    expect(result.claim?.excerpt?.startsWith(WEBSITE_NOT_FOUND_AFTER_VERIFICATION)).toBe(true);
    expect(result.claim?.evidence_type).toBe("no_website");
    expect(result.claim?.supports).toBe("opportunity");
    expect(result.claim?.subject).toBe("business:acme");
    expect(result.claim?.source_url).toBe("osm:live-osm:1");
    // Per-component evidence array: all four components recorded + the claim.
    expect(result.evidence).toHaveLength(5);
    for (const key of ABSENCE_COMPONENT_KEYS) {
      expect(result.components[key].length).toBeGreaterThan(0);
    }
  });

  it("records all component evidence on the claim's provenance when refused", () => {
    const inputs = fullInputs();
    inputs.official_domain_search = [];
    const result = verifyWebsiteAbsence(inputs, { subject: "business:acme" });
    expect(result.ok).toBe(false);
    expect(result.components.structured_listing_absence).toHaveLength(1);
    expect(result.components.exact_identity_search).toHaveLength(1);
    expect(result.components.no_first_party_site).toHaveLength(1);
    expect(result.evidence).toHaveLength(3);
  });

  it("never accepts blank-provenance entries as component evidence", () => {
    const blank = fullInputs();
    blank.structured_listing_absence = [ev("   ", "whitespace url")];
    expect(verifyWebsiteAbsence(blank, { subject: "business:acme" }).ok).toBe(false);
    const empty = fullInputs();
    empty.exact_identity_search = [ev("", "no url")];
    expect(verifyWebsiteAbsence(empty, { subject: "business:acme" }).ok).toBe(false);
  });
});
