/** Internshala adapter battery: ItemList parsing + slug decoding + gating. */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const HTML = `<html><body>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"WebSite"}</script>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"ItemList","name":"Web Development Jobs","numberOfItems":2,"itemListElement":[
{"@type":"ListItem","position":1,"name":"SR React Developer","url":"https://internshala.com/job/detail/sr-react-developer-job-in-multiple-locations-at-devendra-batra1787812984"},
{"@type":"ListItem","position":2,"name":"Senior Laravel Developer","url":"https://internshala.com/job/detail/senior-laravel-developer-job-in-chennai-at-fyntune-solution-private-limited1787827166"}
]}</script>
</body></html>`;

vi.mock("@/lib/search/http-fetch.server", () => ({
  resilientText: vi.fn(async () => HTML),
  resilientJson: vi.fn(async () => null),
  resilientFetch: vi.fn(),
}));

import { resilientText } from "@/lib/search/http-fetch.server";
import { fetchInternshalaJobs } from "@/lib/jobs/remote-fetchers.server";

describe("fetchInternshalaJobs", () => {
  it("parses ItemList titles + decodes location/company from slugs", async () => {
    const rows = await fetchInternshalaJobs("react developer");
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("SR React Developer");
    expect(rows[0].location).toBeNull(); // multiple-locations
    expect(rows[0].company).toBe("Devendra Batra");
    expect(rows[1].location).toBe("Chennai");
    expect(rows[1].company).toBe("Fyntune Solution Private Limited");
    expect(rows[0].source).toBe("source-internshala");
    expect(rows[0].url).toMatch(/^https:\/\/internshala\.com\/job\/detail\//);
  });

  it("empty query fetches nothing", async () => {
    expect(await fetchInternshalaJobs("")).toEqual([]);
    expect(await fetchInternshalaJobs("   ")).toEqual([]);
  });
});

describe("registration", () => {
  it("source-internshala is registered in the catalog", async () => {
    const { ensureRemoteJobAdaptersRegistered } = await import(
      "@/lib/jobs/remote-adapters"
    );
    const { listJobSources } = await import("@/lib/jobs/registry");
    ensureRemoteJobAdaptersRegistered();
    expect(listJobSources().map((s) => s.id)).toContain("source-internshala");
  });
});
