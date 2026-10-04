/**
 * Task 15: privacy boundary on user-visible text, and guided pills that enter
 * the normal clarification pipeline instead of running a canned search.
 */
import { describe, expect, it, vi } from "vitest";
import { GUIDED_SEARCH_TEXT } from "@/components/discover/discover-welcome-hero";
import { runSpecSearchCore } from "@/lib/spec-search.functions";
import { presentActivityEvent } from "../activity-presenter";
import { classifySourceHealth } from "../source-health";
import { outcomeUi, zeroResultsNarrative } from "../outcome-ui";
import { streamedFateLabel } from "../candidate-ledger";
import { websiteStatus } from "../website-status";

const INTERNAL = /searxng|openstreetmap|\bosm\b|supabase|\bs3\b|parquet|duckdb|pg-index|browser-live|direct-http|overpass|json-?ld|worker|token|fetch failed|ECONNREFUSED/i;

describe("user-visible text never names internal infrastructure", () => {
  it("activity events, source health, outcomes and labels", () => {
    const texts: string[] = [];
    for (const event of [
      { action: "Found search results", source: "searxng", detail: "SEARXNG_UNREACHABLE: fetch failed" },
      { action: "Read page", source: "direct-http", detail: "3722 characters" },
      { action: "Leads verified", source: "browser-live", count: 3 },
    ]) {
      const shown = presentActivityEvent(event);
      texts.push(shown.action, shown.source ?? "", shown.detail ?? "");
    }
    const health = classifySourceHealth({
      providers: [{ provider: "browser-live", attempted: true, succeeded: false, artifactsFound: 0, error: "BROWSER_SEARCH_SOURCES_UNAVAILABLE" }],
      diagnostics: [{ code: "SOURCE_UNAVAILABLE", source: "searxng", detail: "SEARXNG_UNREACHABLE: fetch failed" }],
    });
    texts.push(health.summary ?? "", zeroResultsNarrative({ rawCandidates: 0, sourceHealth: health }) ?? "");
    texts.push(outcomeUi("SOURCE_UNAVAILABLE", { detail: health.summary }).message ?? "");
    for (const fate of ["qualified_more", "rejected", "gated", "incomplete", "excluded", "unaccounted"] as const) texts.push(streamedFateLabel({ fate, reason: "MISSING_QUERY_REQUIRED" }));
    texts.push(websiteStatus({ website: null }).label, websiteStatus({ claim_evidence: [{ claim_type: "no_website" }] }).label);
    for (const text of texts) expect(text, text).not.toMatch(INTERNAL);
    expect(health.summary).toMatch(/could not be searched/);
  });
});

describe("streamed leads are data, not telemetry", () => {
  it("keeps lead names, locations and evidence as observed, and drops only infrastructure links", () => {
    const row = { key: "k", entity_id: "e", kind: "business", title: "Care Provider Ltd", url: "https://home-care-provider.co.uk/",
      website_url: "https://home-care-provider.co.uk/", profile_url: null, email: null, phone: null, location: "Leeds",
      why_match: "Care Provider Ltd, a home care provider in Leeds" };
    const shown = presentActivityEvent({ action: "Candidate verified", row })!.row!;
    expect(shown.title).toBe("Care Provider Ltd");
    expect(shown.website_url).toBe("https://home-care-provider.co.uk/");
    expect(shown.why_match).toMatch(/home care provider/);
    for (const url of ["http://localhost:8788/browser/sessions", "http://127.0.0.1:8888/search", "https://abc.supabase.co/rest/v1", "https://bucket.s3.amazonaws.com/x", "https://user:pass@example.com/"]) {
      expect(presentActivityEvent({ action: "Candidate verified", row: { ...row, url, website_url: url } })!.row!.website_url, url).toBeNull();
    }
    // System text stays scrubbed.
    expect(presentActivityEvent({ action: "SEARXNG_UNREACHABLE: fetch failed" }).action).toBe("Working");
  });
});

describe("guided pills", () => {
  it("each pill sends only a bare category into the normal pipeline", () => {
    expect(Object.values(GUIDED_SEARCH_TEXT)).toEqual(["investors", "founders", "companies", "jobs", "local businesses"]);
  });

  it("guided pills: bare entity nouns clarify and search nothing; runnable kinds search honestly", async () => {
    const fail = vi.fn(async () => { throw new Error("no search may run for a bare entity noun"); });
    // Stage 1 policy: a bare entity NOUN ("investors") narrows nothing and
    // asks its one scope question; a runnable KIND ("founders" — a role,
    // "local businesses"/"companies" — head-noun kinds) searches honestly
    // (zero rows without a place) and never asks the removed purpose question.
    const clarifies = new Set(["investors", "companies", "jobs"]);
    const searches = new Set(["founders", "local businesses"]);
    const zeroReaders = {
      people: vi.fn(async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })),
      businesses: vi.fn(async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })),
      investors: vi.fn(async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })),
      providerJobs: vi.fn(async () => ({ rows: [], meta: { dbHit: false, engine: "none", partitionsRead: [], rowsScanned: 0, rowsReturned: 0 } })),
      index: null,
      liveGapfill: { osm: null, web: null, jobs: null, browser: vi.fn(async () => [] as never[]) },
    };
    for (const text of Object.values(GUIDED_SEARCH_TEXT)) {
      if (clarifies.has(text)) {
        const res = await runSpecSearchCore(text, {
          people: fail as never, companies: fail as never, businesses: fail as never, investors: fail as never, providerJobs: fail as never,
          index: null, liveGapfill: { osm: null, web: null, jobs: null, browser: fail as never },
        }, 10, {});
        expect(res.rows, text).toEqual([]);
        expect(res.clarify.length, text).toBeGreaterThan(0);
        expect(res.clarify[0]!.question, text).toMatch(/\?/);
        expect(res.outcome, text).toBeUndefined();
      } else {
        expect(searches.has(text), text).toBe(true);
        const res = await runSpecSearchCore(text, zeroReaders as never, 10, {});
        expect(res.spec.status, text).toBe("ready_to_search");
        expect(res.rows, text).toEqual([]);
        // A completed zero run (outcome present) — any clarify here is the
        // advisory thin-ask, never a blocking purpose question.
        expect(res.outcome, text).toBeDefined();
      }
    }
    expect(fail).not.toHaveBeenCalled();
  });
});
