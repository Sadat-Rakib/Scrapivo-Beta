/**
 * Thin CoreClaw adapter — helpful Workers only:
 *  Contact enrich: domain-email-finder, LinkedIn company/person,
 *    Instagram / YouTube / TikTok profile scrapers
 *  Discover (separate module): maps lead finder, SERP backup
 *
 * Profile enrich is manual Resolve / Deep enrich only.
 * @see https://github.com/cporter202/coreclaw-api-directory
 */
import type { ContactSignal, SocialLinks } from "./contact-finder.server";

const BASE = "https://openapi.coreclaw.com/api/v2";

function apiKey(): string | undefined {
  return process.env.CORECLAW_API_KEY?.trim() || undefined;
}

function toWorkerId(path: string): string {
  return path.replace(/^\//, "").replace(/\//g, "~");
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (!data) return [];
  if (Array.isArray(data))
    return data.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  for (const key of ["items", "results", "rows", "data", "records"]) {
    const v = d[key];
    if (Array.isArray(v)) return asRows(v);
  }
  // Single object result
  if (d.email || d.emails || d.url || d.name || d.company_name || d.headline) {
    return [d];
  }
  return [];
}

async function fetchRunResults(runId: string, key: string): Promise<Record<string, unknown>[]> {
  const url = `${BASE}/worker-runs/${encodeURIComponent(runId)}/result?offset=0&limit=50`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { code?: number; data?: unknown };
  if (json.code !== 0 && json.code !== undefined) return [];
  return asRows(json.data);
}

async function waitForRun(
  runId: string,
  key: string,
  maxMs = 75_000,
): Promise<Record<string, unknown>[]> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const detailRes = await fetch(`${BASE}/worker-runs/${encodeURIComponent(runId)}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (detailRes.ok) {
        const detail = (await detailRes.json()) as {
          data?: { status?: string; state?: string };
        };
        const status = String(detail.data?.status || detail.data?.state || "").toLowerCase();
        if (/(fail|error|abort|cancel)/.test(status)) return [];
        if (/(success|succeed|finish|complete|done)/.test(status) || !status) {
          const rows = await fetchRunResults(runId, key);
          if (rows.length || /(success|succeed|finish|complete|done)/.test(status)) return rows;
        }
      } else {
        const rows = await fetchRunResults(runId, key);
        if (rows.length) return rows;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return fetchRunResults(runId, key);
}

/** Run a CoreClaw Worker (sync preferred, async+poll fallback). */
export async function runCoreClawWorker(
  workerPath: string,
  custom: Record<string, unknown>,
  opts?: { limit?: number; timeoutMs?: number },
): Promise<Record<string, unknown>[]> {
  const key = apiKey();
  if (!key) return [];

  const workerId = toWorkerId(workerPath);
  const limit = opts?.limit ?? 20;
  const body = {
    input: { parameters: { custom } },
    is_async: false,
    limit,
    offset: 0,
  };

  try {
    const res = await fetch(`${BASE}/workers/${encodeURIComponent(workerId)}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 90_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      code?: number;
      data?: { run_slug?: string; items?: unknown; results?: unknown };
    };
    if (json.code !== 0 && json.code !== undefined) return [];

    const syncRows = asRows(json.data);
    if (syncRows.length) return syncRows;

    const runId = json.data?.run_slug;
    if (!runId) return [];
    return waitForRun(runId, key, opts?.timeoutMs ?? 75_000);
  } catch {
    return [];
  }
}

function pickEmail(row: Record<string, unknown>): string | undefined {
  const direct = row.email ?? row.Email_address ?? row.mail;
  if (typeof direct === "string" && direct.includes("@")) return direct.toLowerCase().trim();
  const emails = row.emails;
  if (Array.isArray(emails) && typeof emails[0] === "string") {
    return String(emails[0]).toLowerCase().trim();
  }
  if (emails && typeof emails === "object" && !Array.isArray(emails)) {
    const first = Object.values(emails as Record<string, unknown>).find(
      (v) => typeof v === "string" && String(v).includes("@"),
    );
    if (typeof first === "string") return first.toLowerCase().trim();
  }
  return undefined;
}

/** Domain Email Finder — only website + contact pages (fast, no extra API keys). */
export async function coreclawDomainEmails(domain: string): Promise<ContactSignal[]> {
  if (!apiKey() || !domain) return [];
  const host = domain
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .split("/")[0];
  if (!host || !host.includes(".")) return [];

  const rows = await runCoreClawWorker(
    "odin-kael/domain-email-finder",
    {
      start_urls: [{ url: `https://${host}` }],
      sources: ["website", "contact_pages"],
      max_results: 8,
      max_pages: 12,
      max_depth: 1,
      same_domain_only: true,
      include_affiliate_emails: false,
    },
    { limit: 15, timeoutMs: 90_000 },
  );

  const out: ContactSignal[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const email = pickEmail(row);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const conf = Number(row.confidence ?? row.score ?? 0.55);
    out.push({
      kind: "coreclaw",
      email,
      domain: host,
      confidence: Math.max(0.4, Math.min(0.8, conf > 1 ? conf / 100 : conf)),
      note: "CoreClaw domain email finder",
      url: typeof row.source_url === "string" ? row.source_url : `https://${host}`,
    });
    if (out.length >= 5) break;
  }
  return out;
}

function linkedInCompanyUrl(urls: string[]): string | undefined {
  return urls.find((u) => /linkedin\.com\/company\//i.test(u));
}

function linkedInPersonUrl(urls: string[]): string | undefined {
  return urls.find((u) => /linkedin\.com\/in\//i.test(u));
}

export async function coreclawLinkedInCompany(
  urls: string[],
): Promise<{ signals: ContactSignal[]; socials: SocialLinks }> {
  const url = linkedInCompanyUrl(urls);
  if (!apiKey() || !url) return { signals: [], socials: {} };

  const rows = await runCoreClawWorker(
    "coreclaw/linkedin-company-scraper",
    { startURLs: [{ url }] },
    { limit: 5, timeoutMs: 90_000 },
  );
  const row = rows[0];
  if (!row) return { signals: [], socials: { linkedin: url } };

  const name =
    (typeof row.name === "string" && row.name) ||
    (typeof row.company_name === "string" && row.company_name) ||
    (typeof row.title === "string" && row.title) ||
    undefined;
  const website =
    (typeof row.website === "string" && row.website) ||
    (typeof row.company_website === "string" && row.company_website) ||
    undefined;
  const email = pickEmail(row);

  const signals: ContactSignal[] = [
    {
      kind: "coreclaw",
      name,
      email,
      url,
      domain: website?.replace(/^https?:\/\//, "").split("/")[0],
      confidence: email ? 0.6 : 0.4,
      note: name ? `CoreClaw LinkedIn company: ${name}` : "CoreClaw LinkedIn company profile",
    },
  ];
  return { signals, socials: { linkedin: url } };
}

export async function coreclawLinkedInPerson(
  urls: string[],
  personName?: string,
): Promise<{ signals: ContactSignal[]; socials: SocialLinks }> {
  const url = linkedInPersonUrl(urls);
  if (!apiKey() || !url) return { signals: [], socials: {} };

  const rows = await runCoreClawWorker(
    "coreclaw/linkedin-people-profile-scraper",
    { profile_url: [{ profile_url: url }] },
    { limit: 5, timeoutMs: 90_000 },
  );
  const row = rows[0];
  if (!row) return { signals: [], socials: { linkedin: url } };

  const name =
    (typeof row.full_name === "string" && row.full_name) ||
    (typeof row.name === "string" && row.name) ||
    personName;
  const headline =
    (typeof row.headline === "string" && row.headline) ||
    (typeof row.title === "string" && row.title) ||
    undefined;
  const email = pickEmail(row);

  return {
    signals: [
      {
        kind: "coreclaw",
        name,
        email,
        url,
        confidence: email ? 0.65 : 0.4,
        note: headline
          ? `CoreClaw LinkedIn person: ${headline.slice(0, 80)}`
          : "CoreClaw LinkedIn person profile",
      },
    ],
    socials: { linkedin: url },
  };
}

export function coreclawEnabled(): boolean {
  return !!apiKey();
}

function igUsernameFromUrls(urls: string[]): string | undefined {
  for (const u of urls) {
    const m = u.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})\/?/i);
    if (m && !["p", "reel", "stories", "explore", "accounts"].includes(m[1].toLowerCase())) {
      return m[1];
    }
  }
  return undefined;
}

function ytUrlFromUrls(urls: string[]): string | undefined {
  return urls.find(
    (u) => /youtube\.com\/(@|channel\/|c\/|user\/)/i.test(u) || /youtu\.be\//i.test(u),
  );
}

function tiktokUrlFromUrls(urls: string[]): string | undefined {
  return urls.find((u) => /tiktok\.com\/@/i.test(u));
}

/** Instagram profile by username — bio / website / optional email. */
export async function coreclawInstagramProfile(
  urls: string[],
): Promise<{ signals: ContactSignal[]; socials: SocialLinks }> {
  const username = igUsernameFromUrls(urls);
  if (!apiKey() || !username) return { signals: [], socials: {} };

  const rows = await runCoreClawWorker(
    "coreclaw/instagram-profile-data-scraper",
    { username: [{ string: username }] },
    { limit: 5, timeoutMs: 90_000 },
  );
  const row = rows[0];
  const profileUrl = `https://www.instagram.com/${username}/`;
  if (!row) return { signals: [], socials: { instagram: profileUrl } };

  const email = pickEmail(row);
  const bio = strField(row, "biography", "bio", "description");
  return {
    signals: [
      {
        kind: "coreclaw",
        email,
        url: profileUrl,
        confidence: email ? 0.6 : 0.35,
        note: bio ? `CoreClaw Instagram: ${bio.slice(0, 80)}` : "CoreClaw Instagram profile",
      },
    ],
    socials: { instagram: profileUrl },
  };
}

/** YouTube channel by URL — description / links. */
export async function coreclawYouTubeChannel(
  urls: string[],
): Promise<{ signals: ContactSignal[]; socials: SocialLinks }> {
  const url = ytUrlFromUrls(urls);
  if (!apiKey() || !url) return { signals: [], socials: {} };

  const rows = await runCoreClawWorker(
    "coreclaw/youtube-channel-scraper",
    { urls: [{ url }] },
    { limit: 5, timeoutMs: 90_000 },
  );
  const row = rows[0];
  if (!row) return { signals: [], socials: { youtube: url } };

  const email = pickEmail(row);
  const desc = strField(row, "description", "about", "channel_description");
  // Pull mailto-looking strings from description
  let fromDesc: string | undefined;
  if (!email && desc) {
    const m = desc.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/);
    if (m) fromDesc = m[0].toLowerCase();
  }
  return {
    signals: [
      {
        kind: "coreclaw",
        email: email || fromDesc,
        url,
        confidence: email || fromDesc ? 0.55 : 0.35,
        note: "CoreClaw YouTube channel",
      },
    ],
    socials: { youtube: url },
  };
}

/** TikTok profile by URL — bio / website. */
export async function coreclawTikTokProfile(
  urls: string[],
): Promise<{ signals: ContactSignal[]; socials: SocialLinks }> {
  const url = tiktokUrlFromUrls(urls);
  if (!apiKey() || !url) return { signals: [], socials: {} };

  const rows = await runCoreClawWorker(
    "coreclaw/tiktok-profile-scraper",
    { url: [{ url, country: "us" }] },
    { limit: 5, timeoutMs: 90_000 },
  );
  const row = rows[0];
  if (!row) return { signals: [], socials: { tiktok: url } };

  const email = pickEmail(row);
  const bio = strField(row, "biography", "bio", "signature", "description");
  let fromBio: string | undefined;
  if (!email && bio) {
    const m = bio.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/);
    if (m) fromBio = m[0].toLowerCase();
  }
  return {
    signals: [
      {
        kind: "coreclaw",
        email: email || fromBio,
        url,
        confidence: email || fromBio ? 0.55 : 0.35,
        note: "CoreClaw TikTok profile",
      },
    ],
    socials: { tiktok: url },
  };
}

function strField(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Run at most one social profile Worker matching the first known URL
 * (priority: Instagram → YouTube → TikTok) to save credits.
 */
export async function coreclawSocialProfileEnrich(
  urls: string[],
): Promise<{ signals: ContactSignal[]; socials: SocialLinks }> {
  if (!apiKey() || !urls.length) return { signals: [], socials: {} };
  if (igUsernameFromUrls(urls)) return coreclawInstagramProfile(urls);
  if (ytUrlFromUrls(urls)) return coreclawYouTubeChannel(urls);
  if (tiktokUrlFromUrls(urls)) return coreclawTikTokProfile(urls);
  return { signals: [], socials: {} };
}
