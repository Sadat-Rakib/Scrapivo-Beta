/** Phase A3/A4: relevance chips + filter-bar model battery. */
import { describe, expect, it } from "vitest";
import { filterBarModel, relevanceChips } from "@/lib/search/relevance";

const NO_SITE = { website: null, email: null, phone: null };
const RICH_SITE = { website: "https://x.example", email: "a@x.example", phone: "+15125550101" };
const THIN_SITE = { website: "https://x.example", email: null, phone: null };

describe("relevanceChips", () => {
  it("silent unless selling with a recognized offer", () => {
    expect(relevanceChips(NO_SITE, null)).toEqual([]);
    expect(relevanceChips(NO_SITE, { mode: "looking" })).toEqual([]);
    expect(relevanceChips(NO_SITE, { mode: "selling", offer: "mystery goo" })).toEqual([]);
  });
  it("websites + no_website filter: claims only what the row proves", () => {
    const f = { mode: "selling", offer: "websites", opportunity: "no_website" };
    expect(relevanceChips(NO_SITE, f)).toEqual(["No website", "Matches your offer"]);
    expect(relevanceChips(RICH_SITE, f)).toEqual(["Has website"]);
  });
  it("websites without site preference: no row claims", () => {
    expect(relevanceChips(NO_SITE, { mode: "selling", offer: "websites" })).toEqual([]);
  });
  it("design + stale_site: thin-presence rows claim the match", () => {
    const f = { mode: "selling", offer: "logo and branding", opportunity: "stale_site" };
    expect(relevanceChips(THIN_SITE, f)).toEqual(["Thin web presence", "Matches your offer"]);
    expect(relevanceChips(RICH_SITE, f)).toEqual(["Has website"]);
    expect(relevanceChips(NO_SITE, f)).toEqual(["No website"]);
  });
  it("marketing: channel pitch chip only, never a row claim", () => {
    const f = { mode: "selling", offer: "seo services", channel: "seo" };
    expect(relevanceChips(NO_SITE, f)).toEqual(["Pitch: seo"]);
    expect(relevanceChips(RICH_SITE, f)).toEqual(["Pitch: seo"]);
  });
  it("recognized-only offerings name the offer honestly", () => {
    expect(relevanceChips(NO_SITE, { mode: "selling", offer: "bookkeeping" })).toEqual([
      "For: bookkeeping",
    ]);
  });
});

describe("filterBarModel", () => {
  it("hidden unless selling", () => {
    expect(filterBarModel(null).visible).toBe(false);
    expect(filterBarModel({ mode: "looking" }).visible).toBe(false);
  });
  it("no-website filter ON", () => {
    const m = filterBarModel({ mode: "selling", offer: "websites", opportunity: "no_website" });
    expect(m.visible).toBe(true);
    expect(m.filterState).toBe("no-website-on");
    expect(m.showSiteToggle).toBe(false);
  });
  it("websites offer, no preference → unset + toggle offered", () => {
    const m = filterBarModel({ mode: "selling", offer: "websites" });
    expect(m.filterState).toBe("unset");
    expect(m.showSiteToggle).toBe(true);
  });
  it("stale-site state", () => {
    const m = filterBarModel({ mode: "selling", offer: "logo", opportunity: "stale_site" });
    // 'logo' matches design taxonomy
    expect(m.filterState).toBe("stale-site-on");
  });
  it("withholds thin-presence claims when contact fields are unknown", () => {
    const f = { mode: "selling", offer: "logo and branding", opportunity: "stale_site" };
    expect(relevanceChips({ website: "https://x.example" }, f, false)).toEqual(["Has website"]);
  });
});
