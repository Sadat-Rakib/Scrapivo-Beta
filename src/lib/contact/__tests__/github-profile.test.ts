/** J4: GitHub profile enrichment battery (API mocked, no network). */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../search/http-fetch.server", () => ({
  resilientText: vi.fn(async () => ""),
  resilientJson: vi.fn(async () => null),
}));

import { resilientJson } from "../../search/http-fetch.server";
import { fetchGitHubProfile, harvestProfileContacts } from "../contact-finder.server";

const mockedJson = vi.mocked(resilientJson);

beforeEach(() => {
  mockedJson.mockReset();
});

describe("fetchGitHubProfile", () => {
  it("returns structured fields, noise-filtered email", async () => {
    mockedJson.mockResolvedValueOnce({
      email: "dev@example-corp.com",
      blog: "https://dev.example",
      bio: "OSS hacker",
      company: "@acme",
      location: "Berlin",
    });
    const p = await fetchGitHubProfile("octocat");
    expect(p?.email).toBe("dev@example-corp.com");
    expect(p?.blog).toBe("https://dev.example");
    expect(mockedJson).toHaveBeenCalledTimes(1);
    expect(String(mockedJson.mock.calls[0][0])).toContain("/users/octocat");
  });

  it("drops noise-domain emails, keeps the rest", async () => {
    mockedJson.mockResolvedValueOnce({ email: "x@example.com", blog: "https://x.example" });
    const p = await fetchGitHubProfile("noisy");
    expect(p?.email).toBeUndefined();
    expect(p?.blog).toBe("https://x.example");
  });

  it("null on rate limit / 404 / bad handle", async () => {
    mockedJson.mockResolvedValueOnce(null);
    expect(await fetchGitHubProfile("ghost")).toBeNull();
    expect(await fetchGitHubProfile("not a handle!!")).toBeNull();
    expect(await fetchGitHubProfile("a")).toBeNull();
  });
});

describe("harvestProfileContacts github branch", () => {
  it("uses the API result and skips the HTML scrape", async () => {
    mockedJson.mockResolvedValueOnce({ email: "dev@example-corp.com", blog: "", bio: "" });
    const r = await harvestProfileContacts(["https://github.com/octocat"]);
    expect(r.emails).toContain("dev@example-corp.com");
    expect(r.pages).toContain("https://github.com/octocat");
  });
});
