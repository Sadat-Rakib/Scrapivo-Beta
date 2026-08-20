import { resilientJson } from "@/lib/search/http-fetch.server";
import { loadAtsBoards, type AtsProvider } from "@/lib/search/ats-sources.server";
import { registerJobSource } from "./registry";
import { tenantBoardsFor } from "./tenants";
import { guessSeniority, looksRemote } from "./filters";
import type { JobSearchFilters, RawJobPosting } from "./types";

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

async function boardsFor(provider: AtsProvider): Promise<string[]> {
  const fromDb = await loadAtsBoards(provider).catch(() => [] as string[]);
  const extra = tenantBoardsFor(provider);
  const merged = [...new Set([...fromDb, ...extra])].filter(
    (b) => b && b !== "netflix" && b !== "notion",
  );
  if (provider === "greenhouse") return merged.slice(0, 24);
  return merged;
}

import { sanitizeJobText } from "./hygiene";

async function fetchGreenhouse(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await boardsFor("greenhouse");
  const out: RawJobPosting[] = [];
  const pages = await Promise.all(
    boards.map(async (board) => {
      const data = await withTimeout(
        resilientJson<{ jobs?: any[] }>(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
        ).catch(() => null),
        9000,
        null,
      );
      return { board, data };
    }),
  );
  for (const { board, data } of pages) {
    for (const j of data?.jobs || []) {
      const title = sanitizeJobText(j.title);
      if (!title) continue;
      const loc = sanitizeJobText(j.location?.name);
      const desc = sanitizeJobText(j.content).slice(0, 800);
      const url = j.absolute_url as string | undefined;
      if (!url) continue;
      out.push({
        title,
        company: sanitizeJobText(j.company_name || board),
        location: loc || null,
        url,
        source: "source-ats-greenhouse",
        board_id: board,
        posted_at: j.updated_at || j.first_published || null,
        description: desc,
        salary: null,
        remote: looksRemote(loc, title, desc),
        seniority: guessSeniority(title),
      });
    }
  }
  return out;
}

async function fetchLever(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await boardsFor("lever");
  const out: RawJobPosting[] = [];
  const pages = await Promise.all(
    boards.map(async (board) => {
      const data = await withTimeout(
        resilientJson<any[]>(
          `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`,
        ).catch(() => null),
        9000,
        null,
      );
      return { board, data };
    }),
  );
  for (const { board, data } of pages) {
    if (!Array.isArray(data)) continue;
    for (const j of data) {
      const title = sanitizeJobText(j.text || j.title);
      if (!title) continue;
      const loc = sanitizeJobText(
        Array.isArray(j.categories?.location)
          ? j.categories.location.join(", ")
          : j.categories?.location || j.location,
      );
      const url = String(j.hostedUrl || j.applyUrl || "");
      if (!url) continue;
      const created = typeof j.createdAt === "number" ? new Date(j.createdAt).toISOString() : null;
      const desc = sanitizeJobText(j.descriptionPlain || j.description).slice(0, 800) || null;
      out.push({
        title,
        company: sanitizeJobText(j.categories?.team || board),
        location: loc || null,
        url,
        source: "source-ats-lever",
        board_id: board,
        posted_at: created,
        description: desc,
        salary: null,
        remote: looksRemote(loc, title, desc) || Boolean(j.workplaceType === "remote"),
        seniority: guessSeniority(title),
      });
    }
  }
  return out;
}

async function fetchAshby(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await boardsFor("ashby");
  const out: RawJobPosting[] = [];
  const pages = await Promise.all(
    boards.map(async (board) => {
      const data = await withTimeout(
        resilientJson<{ jobs?: any[] }>(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`,
        ).catch(() => null),
        9000,
        null,
      );
      return { board, data };
    }),
  );
  for (const { board, data } of pages) {
    for (const j of data?.jobs || []) {
      const title = sanitizeJobText(j.title);
      if (!title) continue;
      const loc = sanitizeJobText(j.location || j.address?.postalAddress);
      const url = String(j.jobUrl || j.applyUrl || "");
      if (!url) continue;
      const salary = sanitizeJobText(
        j.compensation?.summaryPlainText || j.compensation?.summaryHtml,
      );
      const desc = sanitizeJobText(j.descriptionPlain || j.description).slice(0, 800) || null;
      out.push({
        title,
        company: sanitizeJobText(board),
        location: loc || null,
        url,
        source: "source-ats-ashby",
        board_id: board,
        posted_at: j.publishedAt || j.updatedAt || null,
        description: desc,
        salary: salary ? salary.slice(0, 200) : null,
        remote: looksRemote(loc, title, desc) || Boolean(j.isRemote),
        seniority: guessSeniority(title),
      });
    }
  }
  return out;
}

async function fetchSmartRecruiters(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await boardsFor("smartrecruiters");
  const out: RawJobPosting[] = [];
  for (const company of boards) {
    const data = await withTimeout(
      resilientJson<{ content?: any[] }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`,
      ).catch(() => null),
      9000,
      null,
    );
    for (const p of data?.content || []) {
      const title = String(p.name || "");
      if (!title) continue;
      const loc =
        p.location?.fullLocation ||
        [p.location?.city, p.location?.country].filter(Boolean).join(", ");
      const ident = p.company?.identifier || company;
      const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(ident)}/${p.id}`;
      out.push({
        title,
        company: String(p.company?.name || company),
        location: loc || null,
        url,
        source: "source-ats-smartrecruiters",
        board_id: company,
        posted_at: p.releasedDate || p.createdOn || null,
        description: null,
        salary: null,
        remote: looksRemote(loc, title),
        seniority: guessSeniority(title),
      });
    }
  }
  return out;
}

async function fetchWorkable(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await boardsFor("workable");
  const out: RawJobPosting[] = [];
  for (const account of boards) {
    const data = await withTimeout(
      resilientJson<{ jobs?: any[] }>(
        `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}`,
      ).catch(() => null),
      9000,
      null,
    );
    for (const j of data?.jobs || []) {
      const title = String(j.title || "");
      if (!title || !j.url) continue;
      const loc = [j.city, j.country].filter(Boolean).join(", ");
      out.push({
        title,
        company: account,
        location: loc || null,
        url: String(j.url),
        source: "source-ats-workable",
        board_id: account,
        posted_at: j.published_on || j.created_at || null,
        description: String(j.shortcode || "").slice(0, 400) || null,
        salary: null,
        remote: looksRemote(loc, title) || Boolean(j.telecommuting),
        seniority: guessSeniority(title),
      });
    }
  }
  return out;
}

async function fetchRecruitee(_filters: JobSearchFilters): Promise<RawJobPosting[]> {
  const boards = await boardsFor("recruitee");
  const out: RawJobPosting[] = [];
  for (const company of boards) {
    const data = await withTimeout(
      resilientJson<{ offers?: any[] }>(
        `https://${encodeURIComponent(company)}.recruitee.com/api/offers`,
      ).catch(() => null),
      9000,
      null,
    );
    for (const o of data?.offers || []) {
      const title = String(o.title || "");
      if (!title) continue;
      const url = String(o.careers_url || o.url || "");
      if (!url) continue;
      const loc = String(o.location || o.city || "");
      out.push({
        title,
        company,
        location: loc || null,
        url,
        source: "source-ats-recruitee",
        board_id: company,
        posted_at: o.published_at || o.created_at || null,
        description:
          String(o.description || "")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 800) || null,
        salary: null,
        remote: looksRemote(loc, title) || Boolean(o.remote),
        seniority: guessSeniority(title),
      });
    }
  }
  return out;
}

let registered = false;
export function ensureJobAdaptersRegistered(): void {
  if (registered) return;
  registered = true;
  registerJobSource({ id: "source-ats-greenhouse", label: "Greenhouse", fetch: fetchGreenhouse });
  registerJobSource({ id: "source-ats-lever", label: "Lever", fetch: fetchLever });
  registerJobSource({ id: "source-ats-ashby", label: "Ashby", fetch: fetchAshby });
  registerJobSource({
    id: "source-ats-smartrecruiters",
    label: "SmartRecruiters",
    fetch: fetchSmartRecruiters,
  });
  registerJobSource({ id: "source-ats-workable", label: "Workable", fetch: fetchWorkable });
  registerJobSource({ id: "source-ats-recruitee", label: "Recruitee", fetch: fetchRecruitee });
}
