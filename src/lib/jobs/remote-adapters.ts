import { registerJobSource } from "./registry";
import { guessSeniority, looksRemote } from "./filters";
import type { ExpandedQueries } from "@/lib/search/query-expander";
import type { JobSourceKind, RawJobPosting } from "./types";

/**
 * Sources with dedicated high-volume fetchers (remote-fetchers.server.ts):
 * structured APIs fetched directly — 100-row caps, 21-day windows, real
 * location/type/salary fields, and no phantom "software" default query.
 * The remaining text-y sources (HN, GitHub repos, YC, USAJobs) keep their
 * shared Discover-pipeline search fns via qxFrom.
 */
function qxFrom(filters: { query?: string }): ExpandedQueries {
  const q = (filters.query || "").trim();
  return {
    raw: q,
    skill: q,
    role: q,
    queryType: "skill",
    relatedSkills: [],
    buyerIntentQueries: [],
    buyerPhrases: [],
    jobBoardQueries: [q],
    jobBoardTerms: q ? [q] : [],
    socialQueries: [],
    redditBuyerQueries: [],
    booleanWebQueries: [],
    customerPhrases: [],
    subreddits: [],
    negativePhrases: [],
    negativeSignals: [],
  };
}

function leadToRaw(
  lead: {
    title?: string;
    author?: string;
    snippet?: string;
    full_post_url?: string;
    posted_at?: string;
    source?: string;
  },
  source: JobSourceKind,
  board: string,
): RawJobPosting | null {
  const url = lead.full_post_url || "";
  if (!url) return null;
  let title = (lead.title || "").replace(/^JOB:\s*/i, "").trim();
  let company = (lead.author || "").trim();
  const at = title.match(/^(.+?)\s+@\s+(.+)$/);
  if (at) {
    title = at[1].replace(/^YC startup:\s*/i, "").trim();
    company = company || at[2].trim();
  }
  title = title.replace(/^YC startup:\s*/i, "").trim();
  if (!title) return null;
  if (!company) company = board;
  const locMatch = (lead.snippet || "").match(/(?:in|location[:\s]+)([^·\n]{2,60})/i);
  const loc = locMatch?.[1]?.trim() || (/remote/i.test(lead.snippet || "") ? "Remote" : null);
  const desc = (lead.snippet || "").replace(/<[^>]+>/g, " ").slice(0, 800);
  return {
    title,
    company,
    location: loc,
    url,
    source,
    board_id: board,
    posted_at: lead.posted_at || null,
    description: desc || null,
    salary: null,
    remote:
      looksRemote(loc || "", title, desc) ||
      source.startsWith("source-remote") ||
      source === "source-weworkremotely" ||
      source === "source-workingnomads" ||
      source === "source-jobicy",
    seniority: guessSeniority(title),
  };
}

async function wrap(
  loader: () => Promise<
    Array<{
      title?: string;
      author?: string;
      snippet?: string;
      full_post_url?: string;
      posted_at?: string;
    }>
  >,
  source: JobSourceKind,
  board: string,
): Promise<RawJobPosting[]> {
  try {
    const leads = await Promise.race([
      loader(),
      new Promise<[]>((r) => setTimeout(() => r([]), 12_000)),
    ]);
    const out: RawJobPosting[] = [];
    for (const l of leads) {
      const raw = leadToRaw(l, source, board);
      if (raw) out.push(raw);
    }
    return out;
  } catch (e) {
    console.warn(`[jobs] ${source} failed`, e);
    return [];
  }
}

let remoteRegistered = false;
export function ensureRemoteJobAdaptersRegistered(): void {
  if (remoteRegistered) return;
  remoteRegistered = true;

  registerJobSource({
    id: "source-remoteok",
    label: "RemoteOK",
    fetch: async (f) => {
      const { fetchRemoteOkJobs } = await import("./remote-fetchers.server");
      return fetchRemoteOkJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-remotive",
    label: "Remotive",
    fetch: async (f) => {
      const { fetchRemotiveJobs } = await import("./remote-fetchers.server");
      return fetchRemotiveJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-jobicy",
    label: "Jobicy",
    fetch: async (f) => {
      const { fetchJobicyJobs } = await import("./remote-fetchers.server");
      return fetchJobicyJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-weworkremotely",
    label: "We Work Remotely",
    fetch: async (f) => {
      const { fetchWwrJobs } = await import("./remote-fetchers.server");
      return fetchWwrJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-arbeitnow",
    label: "Arbeitnow",
    fetch: async (f) => {
      const { fetchArbeitnowJobs } = await import("./remote-fetchers.server");
      return fetchArbeitnowJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-workingnomads",
    label: "Working Nomads",
    fetch: async (f) => {
      const { fetchWorkingNomadsJobs } = await import("./remote-fetchers.server");
      return fetchWorkingNomadsJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-himalayas",
    label: "Himalayas",
    fetch: async (f) => {
      const { fetchHimalayasJobs } = await import("./remote-fetchers.server");
      return fetchHimalayasJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-internshala",
    label: "Internshala",
    fetch: async (f) => {
      const { fetchInternshalaJobs } = await import("./remote-fetchers.server");
      return fetchInternshalaJobs(f.query, f.location);
    },
  });
  registerJobSource({
    id: "source-4dayweek",
    label: "4dayweek",
    fetch: async (f) => {
      const { fetch4DayWeekJobs } = await import("./remote-fetchers.server");
      return fetch4DayWeekJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-nodesk",
    label: "Nodesk",
    fetch: async (f) => {
      const { fetchNodeskJobs } = await import("./remote-fetchers.server");
      return fetchNodeskJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-themuse",
    label: "The Muse",
    fetch: async (f) => {
      const { fetchTheMuseJobs } = await import("./remote-fetchers.server");
      return fetchTheMuseJobs(f.query);
    },
  });
  registerJobSource({
    id: "source-usajobs",
    label: "USAJobs",
    fetch: async (f) => {
      const { searchUSAJobs } = await import("@/lib/search/sources.server");
      return wrap(() => searchUSAJobs(qxFrom(f)), "source-usajobs", "usajobs");
    },
  });
  registerJobSource({
    id: "source-githubjobs",
    label: "GitHub job repos",
    fetch: async (f) => {
      const { searchGitHubJobRepos } = await import("@/lib/search/github-jobs.server");
      return wrap(() => searchGitHubJobRepos(qxFrom(f)), "source-githubjobs", "github");
    },
  });
  registerJobSource({
    id: "source-hn",
    label: "Hacker News",
    fetch: async (f) => {
      // Hiring-thread ONLY: the full searchHackerNews mixes "Who is hiring"
      // comments with broad buyer-intent/Show-HN sweeps (freelancer profiles,
      // product pitches) — wrong shape for a jobs fleet. Legacy Discover
      // buyer-intent keeps the full function untouched.
      const { searchHackerNewsHiringThread } = await import("@/lib/search/sources.server");
      return wrap(() => searchHackerNewsHiringThread(qxFrom(f)), "source-hn", "hn");
    },
  });
  registerJobSource({
    id: "source-workatastartup",
    label: "Work at a Startup",
    fetch: async (f) => {
      const { searchWorkAtAStartup } = await import("@/lib/search/startup-sources.server");
      return wrap(() => searchWorkAtAStartup(qxFrom(f)), "source-workatastartup", "yc");
    },
  });
}
