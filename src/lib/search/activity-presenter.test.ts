import { describe, expect, it } from "vitest";
import { presentActivityEvent, publicSourceLabel } from "./activity-presenter";
import {
  beginSearchBrowserProgress,
  publishSearchBrowserProgress,
  readSearchBrowserProgress,
  type StreamedLead,
} from "./search-browser-progress.server";

describe("public activity boundary", () => {
  it("replaces infrastructure and provider source names in activity and result labels", () => {
    const privateSources = [
      "OpenStreetMap",
      "OSM",
      "SearXNG",
      "Geoapify",
      "Foursquare",
      "S3",
      "s3-parquet",
      "Parquet",
      "DuckDB",
      "Supabase",
      "pg-index",
      "hot-index",
      "saved leads",
      "adapter",
    ];
    for (const source of privateSources) {
      const label = publicSourceLabel(source);
      expect(label).not.toMatch(
        /openstreetmap|osm|searxng|geoapify|foursquare|s3|parquet|duckdb|supabase|pg-index|hot-index|saved leads|adapter/i,
      );
    }
    expect(publicSourceLabel("GitHub")).toBe("GitHub");
    expect(publicSourceLabel("browser", "https://example.com/article")).toBe("Public websites");
    expect(publicSourceLabel("unrecognized source", "https://example.com/article")).toBe(
      "example.com",
    );
    expect(publicSourceLabel("unrecognized source")).toBe("Public source");
  });

  it("keeps a verified progressive row while removing raw source metadata", () => {
    const row: StreamedLead = {
      key: "lead-1",
      entity_id: "company:acme",
      kind: "company",
      title: "Acme",
      url: "https://acme.example",
      website_url: "https://acme.example",
      profile_url: null,
      email: "hello@acme.example",
      phone: null,
      location: "Austin",
      why_match: "Verified via SearXNG",
    };
    const result = presentActivityEvent({
      action: "Stored search complete",
      source: "s3-parquet",
      detail: "Loaded saved leads from DuckDB",
      count: 1,
      row,
      internalAdapter: "browser-live",
    } as Parameters<typeof presentActivityEvent>[0]);
    expect(result.action).toBe("Checked available records");
    expect(result.source).toBe("Available records");
    expect(result.detail).toBeUndefined();
    expect(result.row).toMatchObject({
      key: "lead-1",
      title: "Acme",
      email: "hello@acme.example",
      why_match: null,
    });
    expect(result).not.toHaveProperty("internalAdapter");
    // Infrastructure hosts (our database/storage platforms, loopback) never
    // reach the user. Contract change (semantic review): a host is judged by
    // what it is, not by containing a word, so real leads keep their links.
    expect(presentActivityEvent({ action: "Working", row: {
      ...row,
      url: "s3://private-bucket/lead",
      website_url: "https://abcdxyz.supabase.co/rest/v1/leads",
    } }).row).toMatchObject({ url: null, website_url: null });
    expect(presentActivityEvent({ action: "Working", row: {
      ...row,
      title: "Supabase",
      url: "https://supabase.com",
      website_url: "https://supabase.com",
      why_match: "Supabase, an open-source database provider",
    } }).row).toMatchObject({ title: "Supabase", website_url: "https://supabase.com/", why_match: "Supabase, an open-source database provider" });
  });

  it("delivers the preserved row through the browser progress store", () => {
    const runId = `privacy-${Math.random()}`;
    const ownerId = "owner";
    beginSearchBrowserProgress(runId, ownerId);
    publishSearchBrowserProgress(runId, ownerId, {
      action: "Candidate verified",
      source: "OSM",
      row: {
        key: "lead-2",
        entity_id: "business:acme",
        kind: "business",
        title: "Acme",
        url: "https://acme.example",
        website_url: "https://acme.example",
        profile_url: null,
        email: null,
        phone: "555-0100",
        location: "Austin",
        why_match: "Verified business",
      },
    });
    const [event] = readSearchBrowserProgress(runId, ownerId, 0).events;
    expect(event.row).toMatchObject({ key: "lead-2", phone: "555-0100" });
    expect(event.source).toBe("Public business sources");
  });
});
