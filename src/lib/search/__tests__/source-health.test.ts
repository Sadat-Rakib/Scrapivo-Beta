import { describe, expect, it } from "vitest";
import { classifySourceHealth } from "../source-health";
import { zeroResultsNarrative } from "../outcome-ui";

const attempt = (provider: string, over: Partial<{ attempted: boolean; succeeded: boolean; artifactsFound: number; error: string | null }> = {}) =>
  ({ provider, attempted: true, succeeded: true, artifactsFound: 3, error: null, ...over });

describe("classifySourceHealth", () => {
  it("classifies answered, empty, down, blocked and throttled sources", () => {
    const { sources } = classifySourceHealth({
      providers: [
        attempt("browser-live"),
        attempt("osm", { artifactsFound: 0 }),
        attempt("searxng", { succeeded: false, artifactsFound: 0, error: "SEARXNG_UNREACHABLE: fetch failed" }),
        attempt("geoapify", { succeeded: false, artifactsFound: 0, error: "429 Too Many Requests" }),
        attempt("linkedin", { succeeded: false, artifactsFound: 0, error: "captcha challenge" }),
        attempt("news", { succeeded: false, artifactsFound: 0, error: "request timed out" }),
        attempt("jobs", { attempted: false, succeeded: false }),
      ],
    });
    const state = Object.fromEntries(sources.map((item) => [item.source, `${item.state}:${item.reason}`]));
    expect(state).toEqual({
      "browser-live": "healthy:OK", osm: "empty:NO_RESULTS", searxng: "unavailable:UNREACHABLE",
      geoapify: "degraded:RATE_LIMITED", linkedin: "blocked:BLOCKED", news: "degraded:TIMEOUT",
    });
  });

  it("a source that answered once is up, even if another attempt failed", () => {
    const { sources } = classifySourceHealth({ providers: [attempt("osm"), attempt("osm", { succeeded: false, error: "fetch failed" })] });
    expect(sources).toEqual([expect.objectContaining({ source: "osm", state: "healthy" })]);
  });

  it("says nothing when the browser covered a down search index (the real founder run)", () => {
    const health = classifySourceHealth({
      providers: [attempt("browser-live", { artifactsFound: 1 })],
      diagnostics: [
        { code: "SOURCE_UNAVAILABLE", source: "direct-http", detail: "SEARXNG_UNREACHABLE: fetch failed" },
        { code: "SOURCE_UNAVAILABLE", source: "searxng", detail: "SEARXNG_UNREACHABLE: fetch failed" },
      ],
    });
    expect(health.degraded).toBe(true);
    expect(health.summary).toBeNull();
  });

  it("names uncovered sources with public labels only", () => {
    const health = classifySourceHealth({
      providers: [attempt("browser-live", { succeeded: false, artifactsFound: 0, error: "BROWSER_SEARCH_SOURCES_UNAVAILABLE" })],
      diagnostics: [{ code: "SOURCE_UNAVAILABLE", source: "searxng", detail: "SEARXNG_UNREACHABLE: fetch failed" }],
    });
    expect(health.summary).toMatch(/could not be searched/);
    expect(health.summary).toMatch(/The web/);
    expect(health.summary).not.toMatch(/searxng|SEARXNG|fetch failed|browser-live/i);
    expect(zeroResultsNarrative({ rawCandidates: 0, sourceHealth: health })).toMatch(/could not be searched.*no candidates/);
  });
});
