import { registerJobSource } from "./registry";
import { guessSeniority, looksRemote } from "./filters";
import type { ExpandedQueries } from "@/lib/search/query-expander";
import type { JobSearchFilters, JobSourceKind, RawJobPosting } from "./types";

function qxFrom(filters: JobSearchFilters): ExpandedQueries {
  const q = (filters.query || "software").trim();
  return {
    raw: q,
    skill: q,
    role: q,
    queryType: "skill",
    relatedSkills: [],
    buyerIntentQueries: [],
    buyerPhrases: [],
    jobBoardQueries: [q],
    jobBoardTerms: [q],
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
      const { searchRemoteOkApi } = await import("@/lib/search/freelance-sources.server");
      return wrap(() => searchRemoteOkApi(qxFrom(f)), "source-remoteok", "remoteok");
    },
  });
  registerJobSource({
    id: "source-remotive",
    label: "Remotive",
    fetch: async (f) => {
      const { searchRemotive } = await import("@/lib/search/sources.server");
      return wrap(() => searchRemotive(qxFrom(f)), "source-remotive", "remotive");
    },
  });
  registerJobSource({
    id: "source-jobicy",
    label: "Jobicy",
    fetch: async (f) => {
      const { searchJobicy } = await import("@/lib/search/sources.server");
      return wrap(() => searchJobicy(qxFrom(f)), "source-jobicy", "jobicy");
    },
  });
  registerJobSource({
    id: "source-weworkremotely",
    label: "We Work Remotely",
    fetch: async (f) => {
      const { searchWeWorkRemotely } = await import("@/lib/search/sources.server");
      return wrap(() => searchWeWorkRemotely(qxFrom(f)), "source-weworkremotely", "wwr");
    },
  });
  registerJobSource({
    id: "source-arbeitnow",
    label: "Arbeitnow",
    fetch: async (f) => {
      const { searchArbeitnow } = await import("@/lib/search/sources.server");
      return wrap(() => searchArbeitnow(qxFrom(f)), "source-arbeitnow", "arbeitnow");
    },
  });
  registerJobSource({
    id: "source-workingnomads",
    label: "Working Nomads",
    fetch: async (f) => {
      const { searchWorkingNomads } = await import("@/lib/search/freelance-sources.server");
      return wrap(() => searchWorkingNomads(qxFrom(f)), "source-workingnomads", "workingnomads");
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
    id: "source-themuse",
    label: "The Muse",
    fetch: async (f) => {
      const { searchTheMuse } = await import("@/lib/search/sources.server");
      return wrap(() => searchTheMuse(qxFrom(f)), "source-themuse", "themuse");
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
      const { searchHackerNews } = await import("@/lib/search/sources.server");
      return wrap(() => searchHackerNews(qxFrom(f)), "source-hn", "hn");
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
