/** Offering utilities and frame-owned user-context semantics. Sales context
 * cannot invent a target need, website absence, or site-quality claim. */
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
  it("explicit website absence filters site rows but a missing value cannot verify absence", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin without a website",
      { businesses: fakeBusinesses, index: null }, 25,
    );
    expect(res.dbMeta.length).toBeGreaterThan(0);
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_mode");
    expect(res.spec.criteria).toContainEqual(expect.objectContaining({ field: "opportunity", value: "no_website" }));
    expect(res.spec.signal_required).toBe(false);
    expect(res.rows).toEqual([]);
    expect(res.candidateLedger?.rejectReasons.NO_CLAIM_EVIDENCE).toBe(1);
  });

  it("selling a website service does not force a target website preference", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "websites" },
    );
    expect(res.dbMeta.length).toBeGreaterThan(0);
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_site");
    expect(res.spec.criteria).toContainEqual(expect.objectContaining({ field: "offer", value: "websites" }));
    expect(res.spec.criteria.some((c) => c.field === "opportunity")).toBe(false);
  });

  it("an explicit absence answer still needs observed verification", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "websites", opportunity: "no_website" },
    );
    expect(res.dbMeta.length).toBeGreaterThan(0);
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_site");
    expect(res.rows).toEqual([]);
    expect(res.candidateLedger?.rejectReasons.NO_CLAIM_EVIDENCE).toBe(1);
  });

  it("marketing user context does not force a channel follow-up", async () => {
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "seo services" },
    );
    expect(res.dbMeta.length).toBeGreaterThan(0);
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_channel");
    expect(res.spec.criteria).toContainEqual(expect.objectContaining({ field: "offer", value: "seo services" }));
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
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_offer");
    expect(res.spec.criteria.some((c) => c.field === "offer")).toBe(false);
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

  it("design user context keeps target discovery free of site coaching", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: siteFakes, index: null }, 25,
      { mode: "selling", offer: "logo and branding" },
    );
    expect(res.rows).toHaveLength(3);
    expect(res.clarify).toEqual([]);
    expect(res.spec.criteria).toContainEqual(expect.objectContaining({ field: "offer", value: "logo and branding" }));
  });

  it("design + site=with does not invent a stale-site opportunity", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: siteFakes, index: null }, 25,
      { mode: "selling", offer: "logo and branding", site: "with" },
    );
    expect(res.clarify).toEqual([]);
    expect(
      res.spec.criteria.some((c) => c.field === "opportunity" && c.value === "stale_site"),
    ).toBe(false);
    expect(res.rows.map((r) => r.title)).toEqual(["StaleSite Studio", "RichSite Studio", "NoSite Studio"]);
  });

  it("explicit stale_site refinement keeps only the stored thin-presence proxy", async () => {
    const res = await runSpecSearchCore("plumbers in Austin", {
      businesses: siteFakes, index: null,
    }, 25, { mode: "selling", offer: "logo and branding", opportunity: "stale_site" });
    expect(res.clarify).toEqual([]);
    expect(res.rows.map((r) => r.title)).toEqual(["StaleSite Studio"]);
    expect(res.rows[0].website_url).toBe("https://stale.example");
    expect(res.rows[0].email).toBeNull();
    expect(res.rows[0].phone).toBeNull();
  });

  it("design + explicit absence still requires bounded observation", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: siteFakes, index: null }, 25,
      { mode: "selling", offer: "logo and branding", opportunity: "no_website" },
    );
    expect(res.dbMeta.length).toBeGreaterThan(0);
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_site");
    expect(res.rows).toEqual([]);
    expect(res.candidateLedger?.rejectReasons.NO_CLAIM_EVIDENCE).toBe(1);
  });
});
  it("force (Search with defaults) bypasses the gate unfiltered — client shows the chip", async () => {
    const res = await runSpecSearchCore(
      "plumbers in Austin", { businesses: fakeBusinesses, index: null }, 25,
      { mode: "selling", offer: "websites" },
      { force: true },
    );
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_mode");
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
    expect(res.dbMeta.length).toBeGreaterThan(0);
    expect(res.clarify.map((q) => q.id)).not.toContain("entity_mode");
  });
});
