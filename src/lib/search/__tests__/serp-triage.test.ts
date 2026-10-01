import { describe, expect, it } from "vitest";
import { triageSerpResults } from "../serp-triage.server";

describe("triageSerpResults (Workstream G)", () => {
  it("ranks the first-party source above directories and sinks contamination", () => {
    const results = triageSerpResults(
      [
        { url: "https://www.acmeroofing.com/contact", title: "Acme Roofing — Contact us", snippet: "Roof repair in Mississauga, phone 905-555-0100" },
        { url: "https://www.yelp.com/biz/acme-roofing-mississauga", title: "Acme Roofing reviews", snippet: "roofing mississauga" },
        { url: "https://duckduckgo.com/?q=acme+roofing", title: "Acme Roofing at DuckDuckGo", snippet: "search results" },
      ],
      { query: "Acme Roofing Mississauga phone", entityNames: ["Acme Roofing"], locationTerms: ["Mississauga"], signalTerms: ["phone"] },
    );
    expect(results[0].url).toContain("acmeroofing.com");
    expect(results[0].accept).toBe(true);
    const ddg = results.find((r) => r.url.includes("duckduckgo.com"));
    expect(ddg?.accept).toBe(false);
  });

  it("skips results with no query relevance before a navigation is spent", () => {
    const results = triageSerpResults(
      [
        { url: "https://www.intowindows.com/startup-folder", title: "How to open the startup folder in Windows", snippet: "windows startup folder location" },
      ],
      { query: "founders looking for a web designer", signalTerms: ["web designer", "looking for"] },
    );
    expect(results[0].accept).toBe(false);
  });

  it("penalizes duplicate domains and already-opened hosts", () => {
    const results = triageSerpResults(
      [
        { url: "https://a.example/1", title: "Roofer A", snippet: "roof repair toronto" },
        { url: "https://a.example/2", title: "Roofer A again", snippet: "roof repair toronto" },
        { url: "https://b.example/1", title: "Roofer B", snippet: "roof repair toronto" },
      ],
      { query: "roofers toronto", locationTerms: ["toronto"] },
      { openedHosts: new Set(["b.example"]) },
    );
    const b = results.find((r) => r.url.includes("b.example"))!;
    const dup = results.filter((r) => r.url.includes("a.example"));
    expect(b.reason).toBe("domain already opened this run");
    expect(dup[1].reason).toBe("duplicate domain");
    expect(results[0].score).toBeGreaterThan(b.score);
  });

  it("downranks directory results for signal-required requests", () => {
    const results = triageSerpResults(
      [
        { url: "https://top10agencies.example/list", title: "Top 10 marketing agencies directory", snippet: "best agencies list" },
        { url: "https://community.example/thread", title: "Anyone have a marketing agency recommendation?", snippet: "looking for a marketing agency that gets B2B" },
      ],
      { query: "founders complaining about lead generation asking for recommendations", signalTerms: ["recommendations", "lead generation"] },
    );
    const community = results.find((r) => r.url.includes("community.example"))!;
    const directory = results.find((r) => r.url.includes("top10agencies"))!;
    expect(community.score).toBeGreaterThan(directory.score);
  });
});
