/**
 * Personio (XML) / Teamtailor (RSS) / Gem (JSON) ATS adapters — offline,
 * mocked global fetch. Each adapter: normal payload, empty payload, renamed
 * schema (→ empty, never throws), 500/network failure (→ isolated empty),
 * repeated listings dedupe, and missing fields staying absent (not defaulted).
 */
import { beforeAll, beforeEach, describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/search/ats-sources.server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/search/ats-sources.server")>();
  return { ...orig, loadAtsBoards: vi.fn(async () => ["acme"]) };
});

import { ensureJobAdaptersRegistered } from "../ats-adapters";
import { dedupeJobs, listJobSources } from "../registry";
import { normalizeJob } from "../registry";
import type { JobPosting, RawJobPosting } from "../types";

const fetchAdapter = async (id: string): Promise<RawJobPosting[]> => {
  const adapter = listJobSources().find((a) => a.id === id);
  if (!adapter) throw new Error(`adapter ${id} not registered`);
  return adapter.fetch({});
};

const PersonioXml = String.raw`<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>981288</id>
    <createdAt>2026-09-01</createdAt>
    <name>Senior Backend Engineer (m/f/d)</name>
    <office>Munich</office>
    <department>Engineering</department>
    <employmentType>fulltime</employmentType>
    <subcompany>Acme GmbH</subcompany>
    <jobDescriptions>
      <jobDescription>
        <name>Intro</name>
        <value><![CDATA[<p>Build the platform &amp; ship it. Remote friendly team.</p>]]></value>
      </jobDescription>
    </jobDescriptions>
  </position>
  <position>
    <id>981289</id>
    <createdAt>2026-09-15T09:30:00+02:00</createdAt>
    <name>Product Designer</name>
    <office>Berlin</office>
    <employmentType>parttime</employmentType>
  </position>
  <position>
    <name>No Link Role</name>
    <office>Vienna</office>
  </position>
</workzag-jobs>`;

const TeamtailorRss = String.raw`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="http://teamtailor.com/ns/1.0"><channel>
  <item>
    <title>Backend Developer</title>
    <link>https://acme.teamtailor.com/jobs/123</link>
    <pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Ruby on rails &amp; coffee</p>]]></description>
    <tt:location>Malmö</tt:location>
    <company_name>Acme AB</company_name>
  </item>
  <item>
    <title>Remote Customer Success</title>
    <link>https://acme.na.teamtailor.com/jobs/124</link>
    <pubDate>Mon, 31 Aug 2026 08:00:00 GMT</pubDate>
    <description>Help customers</description>
    <city>Remote</city>
  </item>
</channel></rss>`;

const GemPosts = [
  {
    id: "p1",
    title: "Growth Marketer",
    company_name: "Beta Inc",
    location: "New York, NY",
    created_at: "2026-09-10T14:00:00Z",
    url: "https://jobs.gem.com/beta/p1",
    employment_type: "Full-time",
    description: "<p>Grow things</p>",
    remote: false,
  },
  {
    id: "p2",
    name: "Support Engineer",
    company: { name: "Beta Inc" },
    locations: ["Remote", "Lisbon"],
    first_published: "2026-09-12",
    apply_url: "https://beta.com/apply/2",
    is_remote: true,
  },
  { id: "p3", title: "No Link Role" },
];

const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  ensureJobAdaptersRegistered();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPersonio", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PersonioXml, { status: 200 })),
    );
  });

  it("parses positions: constructs canonical URL from id, normalizes fields", async () => {
    const jobs = await fetchAdapter("source-ats-personio");
    expect(jobs).toHaveLength(2); // third listing has no id/detail link → skipped, never invented
    const first = jobs[0];
    expect(first.title).toBe("Senior Backend Engineer (m/f/d)");
    expect(first.company).toBe("Acme GmbH");
    expect(first.location).toBe("Munich");
    expect(first.url).toBe("https://acme.jobs.personio.de/job/981288");
    expect(first.posted_at).toBe("2026-09-01T12:00:00.000Z"); // date-only → stable noon UTC
    expect(first.employment_type).toBe("fulltime");
    expect(first.department).toBe("Engineering");
    expect(first.remote).toBe(true); // stated in the description text
    expect(first.description).toBe("Intro Build the platform & ship it. Remote friendly team.");
    const second = jobs[1];
    expect(second.posted_at).toBe("2026-09-15T07:30:00.000Z"); // offset time → ISO
    expect(second.company).toBe("acme"); // no subcompany → board slug
    expect(second.remote).toBe(false);
  });

  it("prefers an explicit detail link over the id pattern", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<workzag-jobs><position><name>Custom</name><detailUrl>https://careers.acme.com/x</detailUrl></position></workzag-jobs>`,
            { status: 200 },
          ),
      ),
    );
    const jobs = await fetchAdapter("source-ats-personio");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe("https://careers.acme.com/x");
  });

  it("empty payload → []", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`<workzag-jobs></workzag-jobs>`, { status: 200 })),
    );
    expect(await fetchAdapter("source-ats-personio")).toEqual([]);
  });

  it("renamed schema → [] without throwing (isolated, no error escape)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`<workzag-jobs><position><jobTitle>Renamed</jobTitle><jobId>7</jobId></position></workzag-jobs>`, {
            status: 200,
          }),
      ),
    );
    await expect(fetchAdapter("source-ats-personio")).resolves.toEqual([]);
  });

  it("500 on both TLDs → [] (isolated failure)", async () => {
    const f = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", f);
    expect(await fetchAdapter("source-ats-personio")).toEqual([]);
    expect(f).toHaveBeenCalledTimes(2); // tried .de then .com
  });

  it("network rejection → [] without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hung up");
      }),
    );
    await expect(fetchAdapter("source-ats-personio")).resolves.toEqual([]);
  });

  it("repeated listings dedupe via the registry key (source + url)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`<workzag-jobs><position><id>5</id><name>Dup Role</name></position><position><id>5</id><name>Dup Role</name></position></workzag-jobs>`, { status: 200 })),
    );
    const jobs = await fetchAdapter("source-ats-personio");
    expect(jobs).toHaveLength(2);
    const deduped: JobPosting[] = dedupeJobs(jobs.map(normalizeJob));
    expect(deduped).toHaveLength(1);
  });
});

describe("fetchTeamtailor", () => {
  it("parses items: namespaced location, company tag, pubDate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("acme.teamtailor.com/jobs.rss");
        return new Response(TeamtailorRss, { status: 200 });
      }),
    );
    const jobs = await fetchAdapter("source-ats-teamtailor");
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe("Backend Developer");
    expect(jobs[0].company).toBe("Acme AB");
    expect(jobs[0].location).toBe("Malmö");
    expect(jobs[0].url).toBe("https://acme.teamtailor.com/jobs/123");
    expect(jobs[0].posted_at).toBe("2026-09-01T10:00:00.000Z");
    expect(jobs[0].remote).toBe(false);
    expect(jobs[1].location).toBe("Remote");
    expect(jobs[1].remote).toBe(true);
    expect(jobs[1].company).toBe("acme");
  });

  it("base host 404 → falls back to the .na mirror", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("acme.teamtailor.com")
        ? new Response("not found", { status: 404 })
        : new Response(TeamtailorRss, { status: 200 }),
    );
    vi.stubGlobal("fetch", f);
    const jobs = await fetchAdapter("source-ats-teamtailor");
    expect(jobs).toHaveLength(2);
    expect(f.mock.calls[0][0]).toContain("acme.teamtailor.com/jobs.rss");
    expect(f.mock.calls[1][0]).toContain("acme.na.teamtailor.com/jobs.rss");
  });

  it("base host 500 → no mirror attempt, [] (isolated)", async () => {
    const f = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", f);
    expect(await fetchAdapter("source-ats-teamtailor")).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("empty feed → []", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`<rss><channel></channel></rss>`, { status: 200 }),
      ),
    );
    expect(await fetchAdapter("source-ats-teamtailor")).toEqual([]);
  });

  it("renamed schema (no <item>) → [] without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`<rss><channel><job><title>X</title></job></channel></rss>`, { status: 200 }),
      ),
    );
    await expect(fetchAdapter("source-ats-teamtailor")).resolves.toEqual([]);
  });

  it("follows pages until one holds fewer than 100 items", async () => {
    const page = (n: number, count: number): string =>
      `<rss><channel>${Array.from({ length: count }, (_, i) => `<item><title>R${n}-${i}</title><link>https://acme.teamtailor.com/jobs/${n}-${i}</link><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate></item>`).join("")}</channel></rss>`;
    const f = vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
      return new Response(page(offset, offset === 100 ? 30 : 100), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    const jobs = await fetchAdapter("source-ats-teamtailor");
    expect(f).toHaveBeenCalledTimes(2);
    expect(jobs).toHaveLength(130);
  });

  it("stops at 10 pages even when every page is full", async () => {
    const fullPage = `<rss><channel>${Array.from(
      { length: 100 },
      (_, i) => `<item><title>R${i}</title><link>https://acme.teamtailor.com/jobs/${i}</link></item>`,
    ).join("")}</channel></rss>`;
    const f = vi.fn(async () => new Response(fullPage, { status: 200 }));
    vi.stubGlobal("fetch", f);
    const jobs = await fetchAdapter("source-ats-teamtailor");
    expect(f).toHaveBeenCalledTimes(10);
    expect(jobs).toHaveLength(1000);
  });

  it("repeated listings dedupe via the registry key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<rss><channel><item><title>Dup</title><link>https://acme.teamtailor.com/jobs/1</link></item><item><title>Dup</title><link>https://acme.teamtailor.com/jobs/1</link></item></channel></rss>`,
            { status: 200 },
          ),
      ),
    );
    const jobs = await fetchAdapter("source-ats-teamtailor");
    expect(dedupeJobs(jobs.map(normalizeJob))).toHaveLength(1);
  });
});

describe("fetchGem", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes(GemPosts)),
    );
  });

  it("maps fields defensively; no-link posts are skipped", async () => {
    const jobs = await fetchAdapter("source-ats-gem");
    expect(jobs).toHaveLength(2); // p3 has no absolute url → skipped
    expect(jobs[0].title).toBe("Growth Marketer");
    expect(jobs[0].company).toBe("Beta Inc");
    expect(jobs[0].location).toBe("New York, NY");
    expect(jobs[0].posted_at).toBe("2026-09-10T14:00:00.000Z");
    expect(jobs[0].remote).toBe(false);
    expect(jobs[0].employment_type).toBe("Full-time");
    expect(jobs[0].description).toBe("Grow things");
    expect(jobs[1].title).toBe("Support Engineer"); // `name` fallback
    expect(jobs[1].company).toBe("Beta Inc"); // nested company.name
    expect(jobs[1].location).toBe("Remote, Lisbon"); // locations array joined
    expect(jobs[1].url).toBe("https://beta.com/apply/2"); // apply_url fallback
    expect(jobs[1].remote).toBe(true); // is_remote flag
  });

  it("missing fields stay absent/unknown — never defaulted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes([{ title: "Bare", url: "https://x/1" }])));
    const jobs = await fetchAdapter("source-ats-gem");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBeNull();
    expect(jobs[0].posted_at).toBeNull();
    expect(jobs[0].description).toBeNull();
    expect(jobs[0].employment_type).toBeNull();
    expect(jobs[0].remote).toBe(false);
    expect(jobs[0].company).toBe("acme"); // board fallback only
  });

  it("bare array response = one page and stop", async () => {
    const f = vi.fn(async () => jsonRes(GemPosts));
    vi.stubGlobal("fetch", f);
    await fetchAdapter("source-ats-gem");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("object payload with numeric next_page is followed, then stops", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("page=2")
        ? jsonRes({ job_posts: [], next_page: null })
        : jsonRes({ job_posts: [GemPosts[0]], next_page: 2 }),
    );
    vi.stubGlobal("fetch", f);
    const jobs = await fetchAdapter("source-ats-gem");
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1][0]).toContain("page=2");
    expect(jobs).toHaveLength(1);
  });

  it("empty array → []", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes([])));
    expect(await fetchAdapter("source-ats-gem")).toEqual([]);
  });

  it("renamed schema (unknown payload shape) → [] without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes({ jobPosts: [{ title: "X" }] })));
    await expect(fetchAdapter("source-ats-gem")).resolves.toEqual([]);
  });

  it("500 → [] (isolated failure)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect(await fetchAdapter("source-ats-gem")).toEqual([]);
  });

  it("network rejection → [] without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    await expect(fetchAdapter("source-ats-gem")).resolves.toEqual([]);
  });

  it("repeated listings dedupe via the registry key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes([GemPosts[0], GemPosts[0]])));
    const jobs = await fetchAdapter("source-ats-gem");
    expect(dedupeJobs(jobs.map(normalizeJob))).toHaveLength(1);
  });
});
