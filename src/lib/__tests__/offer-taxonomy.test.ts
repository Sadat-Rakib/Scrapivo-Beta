/** Phase 1.4: offering taxonomy battery. Inference, site mapping, and the
 *  gate's offer/follow-up sequencing. Retrieval fakes are canonical-shaped. */
import { describe, expect, it } from "vitest";
import { runSpecSearchCore } from "../spec-search.functions";
import {
  inferOfferingId,
  siteAnswerToCriteria,
} from "@/lib/search/offer-taxonomy";

const fakeBusinesses = (async () => ({
  rows: [
    {
      name: "NoSite Plumbing", category: "plumber", locality: "Austin",
      region: "TX", country: "US", address: "1 Main St", website: null,
    },
    {
      name: "HasSite Plumbing", category: "plumber", locality: "Austin",
      region: "TX", country: "US", address: "2 Main St",
      website: "https://hassite.example",
    },
  ],
  meta: {
    dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"],
    rowsScanned: 2, rowsReturned: 2,
  },
})) as never;

const emptyCompanies = (async () => ({
  rows: [],
  meta: {
    dbHit: false, engine: "s3-parquet", partitionsRead: ["fake"],
    rowsScanned: 0, rowsReturned: 0,
  },
})) as never;

describe("inferOfferingId", () => {
  it("names offerings across niches", () => {
    expect(inferOfferingId("I sell websites")).toBe("websites");
    expect(inferOfferingId("web design services")).toBe("websites");
    expect(inferOfferingId("seo and social media")).toBe("marketing");
    expect(inferOfferingId("cold email outreach")).toBe("sales");
    expect(inferOfferingId("logo and branding")).toBe("design");
    expect(inferOfferingId("blog writing")).toBe("copywriting");
    expect(inferOfferingId("crm setup")).toBe("software");
    expect(inferOfferingId("bookkeeping")).toBe("bookkeeping");
  });
  it("unknown → null (no fake precision)", () => {
    expect(inferOfferingId("dentists")).toBeNull();
    expect(inferOfferingId("")).toBeNull();
  });
});

describe("siteAnswerToCriteria", () => {
  it("maps preference answers honestly", () => {
    expect(siteAnswerToCriteria("without")).toEqual({ field: "opportunity", value: "no_website" });
    expect(siteAnswerToCriteria("with")).toEqual({ field: "site", value: "with" });
    expect(siteAnswerToCriteria("any")).toBeNull();
    expect(siteAnswerToCriteria("")).toBeNull();
  });
});

describe("offering-aware gate", () => {
  it("'without a website' query: zero questions, selling + offer inferred, rows filtered", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin without a website",
      { businesses: fakeBusinesses, index: null }, 25,
    );
    expect(res.clarify).toEqual([]);
    expect(res.spec.criteria.some((c) => c.field === "mode" && c.value === "selling") ||
      res.spec.criteria.some((c) => c.field === "offer")).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe("NoSite Plumbing");
  });

  it("selling + website offer, no site pref → exactly the site follow-up", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "websites" },
    );
    // Fake rows are Austin/US: validation rejects for Pune — but the gate
    // fires BEFORE retrieval, so clarify is what matters here.
    expect(res.clarify).toHaveLength(1);
    expect(res.clarify[0].id).toBe("entity_site");
  });

  it("site=without answer filters to no-website rows", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "websites", opportunity: "no_website" },
    );
    expect(res.clarify).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe("NoSite Plumbing");
  });

  it("marketing offer → channel follow-up (pitch tailoring, no row filter)", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "seo services" },
    );
    expect(res.clarify).toHaveLength(1);
    expect(res.clarify[0].id).toBe("entity_channel");
  });

  it("channel answer proceeds without filtering rows", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "seo services", channel: "seo" },
    );
    expect(res.clarify).toEqual([]);
    expect(res.rows).toHaveLength(2);
  });

  it("person hiring queries never infer selling offers", async () => {
    const res = await runSpecSearchCore(
      "web designers in Austin", { businesses: fakeBusinesses, index: null }, 25,
      { role: "web designer", mode: "selling" },
    );
    // Offer must be asked, never auto-filled, for person entities.
    expect(res.clarify.map((q) => q.id)).toContain("entity_offer");
  });

describe("stale_site (design redesign angle)", () => {
  const siteFakes = (async () => ({
    rows: [
      {
        name: "StaleSite Studio", category: "plumber", locality: "Austin",
        region: "TX", country: "US", address: "1 Main St",
        website: "https://stale.example", email: null, phone: null,
      },
      {
        name: "RichSite Studio", category: "plumber", locality: "Austin",
        region: "TX", country: "US", address: "2 Main St",
        website: "https://rich.example", email: "hi@rich.example",
        phone: "+15125550101",
      },
      {
        name: "NoSite Studio", category: "plumber", locality: "Austin",
        region: "TX", country: "US", address: "3 Main St",
        website: null, email: null, phone: null,
      },
    ],
    meta: {
      dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"],
      rowsScanned: 3, rowsReturned: 3,
    },
  })) as never;

  it("design offer, no site pref → design-worded site follow-up", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: siteFakes, index: null }, 25,
      { mode: "selling", offer: "logo and branding" },
    );
    expect(res.clarify).toHaveLength(1);
    expect(res.clarify[0].id).toBe("entity_site");
    expect(res.clarify[0].question).toMatch(/design/i);
  });

  it("design + site=with → opportunity=stale_site derived, only thin-presence rows", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: siteFakes, index: null }, 25,
      { mode: "selling", offer: "logo and branding", site: "with" },
    );
    expect(res.clarify).toEqual([]);
    expect(
      res.spec.criteria.some((c) => c.field === "opportunity" && c.value === "stale_site"),
    ).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe("StaleSite Studio");
  });

  it("design + site=without → no_website as before", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: siteFakes, index: null }, 25,
      { mode: "selling", offer: "logo and branding", opportunity: "no_website" },
    );
    expect(res.clarify).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe("NoSite Studio");
  });
});
  it("force (Search with defaults) bypasses the gate unfiltered — client shows the chip", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "websites" },
      { force: true },
    );
    expect(res.clarify).toEqual([]);
    // No opportunity criterion: both rows pass; the filter bar (client,
    // filterBarModel unset state) is what makes this explicit, not silence.
    expect(res.rows).toHaveLength(2);
    expect(
      res.spec.criteria.some((c) => c.field === "opportunity"),
    ).toBe(false);
  });

  it("P3-shape intent hunt keeps its signal behavior (looking-signal, no gate)", async () => {
    const res = await runSpecSearchCore(
      "companies looking for website developers",
      { companies: emptyCompanies, index: null }, 25,
    );
    expect(res.spec.signal_required).toBe(true);
    expect(res.clarify).toEqual([]);
  });
});
