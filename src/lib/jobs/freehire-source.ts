/**
 * freehire live jobs source — keyless public API of the vendored freehire
 * project (MIT; 3.3M postings / 294k companies crawled from companies' own
 * ATS career pages). Contract: freehire/docs/API.md.
 *
 *   GET https://freehire.me/api/v1/jobs/search?q=<skill>&work_mode=remote
 *       &posted_within_days=7&limit=50
 *   → { data: [{ title, company, company_slug, url, location, posted_at,
 *               work_mode, skills[], description, ... }], meta }
 *
 * Registered into the jobs registry so JOB_DISCOVERY fan-outs include it
 * alongside the ATS boards.
 */
import { registerJobSource } from "./registry";
import { guessSeniority, looksRemote } from "./filters";
import type { RawJobPosting } from "./types";
import { sanitizeJobText } from "./hygiene";

const BASE = "https://freehire.me/api/v1";
const CAP = Number(process.env.FREEHIRE_CAP ?? 50);

type FreehireJob = {
  title?: string;
  company?: string;
  company_slug?: string;
  url?: string;
  public_slug?: string;
  location?: string;
  description?: string;
  posted_at?: string;
  work_mode?: string;
  skills?: string[];
};

let registered = false;
export function ensureFreehireSourceRegistered(): void {
  if (registered) return;
  registered = true;
  registerJobSource({
    id: "source-freehire",
    label: "Freehire",
    fetch: async (filters) => {
      const q = (filters.query ?? "").trim();
      if (!q) return [];
      const params = new URLSearchParams({
        q,
        limit: String(CAP),
        posted_within_days: "14",
      });
      if (filters.remoteOnly) params.set("work_mode", "remote");
      let data: FreehireJob[] = [];
      try {
        const res = await fetch(`${BASE}/jobs/search?${params.toString()}`, {
          headers: { Accept: "application/json", "User-Agent": "Scrapivo/1.0" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return [];
        const json = (await res.json().catch(() => null)) as { data?: FreehireJob[] } | null;
        data = json?.data ?? [];
      } catch {
        return [];
      }
      const out: RawJobPosting[] = [];
      for (const j of data) {
        const title = sanitizeJobText(j.title);
        const url = j.url || (j.public_slug ? `https://freehire.me/jobs/${j.public_slug}` : "");
        if (!title || !url) continue;
        const desc = sanitizeJobText(j.description ?? "").slice(0, 800);
        out.push({
          title,
          company: sanitizeJobText(j.company ?? "") || "—",
          location: sanitizeJobText(j.location ?? "") || "—",
          url,
          source: "source-freehire",
          board_id: j.company_slug ?? "freehire",
          posted_at: j.posted_at || null,
          updated_at: null,
          description: desc,
          salary: null,
          remote: j.work_mode === "remote" || looksRemote(j.location ?? "", title, desc),
          seniority: guessSeniority(title),
        });
      }
      return out;
    },
  });
}
