import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { websiteStatus } from "../website-status";
import { LocalBusinessCard } from "@/components/discover/result-tabs";
import type { LocalBusinessRow } from "../lead-segments";

const claim = { claim_type: "no_website", evidence_text: "Official website not found after structured-source and exact-name verification.", evidence_url: "osm:node/1" };
const base: LocalBusinessRow = { key: "b1", name: "Camrose Plumbing", source: "qualified-business", sample_url: "", score: 60, phone: "+1 780 555 0100" };

describe("websiteStatus", () => {
  it("only a subject-bound no_website claim earns 'verified'", () => {
    expect(websiteStatus({ ...base, claim_evidence: [claim] })).toMatchObject({ state: "no_website_verified", label: "No website (verified)", tone: "opportunity" });
    expect(websiteStatus({ ...base, claim_evidence: [claim] }).proof).toMatch(/exact-name verification/);
    // A listing without a URL is not proof of absence — not even when a
    // legacy source stamped it "verified_no_website".
    expect(websiteStatus({ ...base, website_status: "verified_no_website" })).toMatchObject({ state: "no_website_on_record", tone: "neutral" });
    expect(websiteStatus(base).label).toBe("No website on record (not verified)");
  });

  it("a real site is a site; an unreachable listed site says so", () => {
    expect(websiteStatus({ ...base, website: "camroseplumbing.ca" }).state).toBe("has_website");
    expect(websiteStatus({ ...base, website: "https://camroseplumbing.ca", website_status: "unreachable" })).toMatchObject({ state: "unreachable", tone: "warning" });
    // A site wins over a stale claim.
    expect(websiteStatus({ ...base, website: "https://camroseplumbing.ca", claim_evidence: [claim] }).state).toBe("has_website");
  });

  it("the lead card labels verified absence and never claims it without proof", () => {
    const verified = renderToStaticMarkup(createElement(LocalBusinessCard, { row: { ...base, claim_evidence: [claim] } }));
    expect(verified).toContain("No website (verified)");
    const unverified = renderToStaticMarkup(createElement(LocalBusinessCard, { row: base }));
    expect(unverified).toContain("No website on record (not verified)");
    expect(unverified).not.toContain("(verified)<");
    const withSite = renderToStaticMarkup(createElement(LocalBusinessCard, { row: { ...base, website: "https://camroseplumbing.ca" } }));
    expect(withSite).toContain("Website");
    expect(withSite).not.toContain("No website");
  });
});
