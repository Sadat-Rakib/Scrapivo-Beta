/**
 * ScrapeGraphAI managed API — Layer-2 extract with named fields + exclusion rules.
 * Fail-soft: missing key / credits / timeout never breaks search.
 */
export type SgaiCompanyExtract = {
  company_name?: string;
  website?: string;
  role?: string;
  email?: string;
  phone?: string;
  description?: string;
};

function apiKey(): string | undefined {
  const k = process.env.SGAI_API_KEY?.trim();
  return k || undefined;
}

export function scrapegraphEnabled(): boolean {
  return !!apiKey();
}

const EXTRACT_PROMPT =
  "Extract structured lead fields from this page. Return JSON with: company_name, website, role, email, phone, description. " +
  "Skip any field you cannot verify from the page. Skip the whole result if there is no clear company name and no website.";

async function sgaiExtract(url: string, prompt: string): Promise<Record<string, unknown> | null> {
  const key = apiKey();
  if (!key || !url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch("https://v2-api.scrapegraphai.com/api/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "SGAI-APIKEY": key,
      },
      body: JSON.stringify({
        url,
        prompt,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: Record<string, unknown> | string;
      data?: Record<string, unknown>;
      status?: string;
    };
    const raw = json.result ?? json.data;
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return { description: raw };
      }
    }
    return raw;
  } catch {
    return null;
  }
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

/** Enrich a company homepage / profile URL into structured fields. */
export async function scrapegraphExtractCompany(url: string): Promise<SgaiCompanyExtract | null> {
  const raw = await sgaiExtract(url, EXTRACT_PROMPT);
  if (!raw) return null;
  const company =
    asString(raw.company_name) ||
    asString(raw.company) ||
    asString(raw.name) ||
    asString(raw.organization);
  const website = asString(raw.website) || asString(raw.url) || asString(raw.site);
  if (!company && !website) return null;
  return {
    company_name: company,
    website,
    role: asString(raw.role) || asString(raw.job_title) || asString(raw.title),
    email: asString(raw.email),
    phone: asString(raw.phone) || asString(raw.telephone),
    description: asString(raw.description) || asString(raw.about),
  };
}

/**
 * Best-effort enrich top companies missing website. Caps concurrency and total calls.
 */
export async function enrichCompaniesWithScrapegraph<
  T extends {
    name: string;
    website?: string;
    domain?: string;
    sample_url?: string;
    why_now?: string;
  },
>(companies: T[], limit = 8): Promise<T[]> {
  if (!scrapegraphEnabled() || !companies.length) return companies;
  const targets = companies
    .filter((c) => !c.website)
    .slice(0, limit)
    .map((c) => {
      const url =
        c.website ||
        (c.domain ? `https://${c.domain.replace(/^https?:\/\//, "")}` : undefined) ||
        c.sample_url;
      return { c, url };
    })
    .filter((x): x is { c: T; url: string } => !!x.url && /^https?:\/\//i.test(x.url));

  await Promise.race([
    Promise.allSettled(
      targets.map(async ({ c, url }) => {
        const ex = await scrapegraphExtractCompany(url);
        if (!ex) return;
        if (!c.website && ex.website) {
          c.website = ex.website;
          try {
            c.domain = c.domain || new URL(ex.website).hostname.replace(/^www\./, "");
          } catch {
            /* ignore */
          }
        }
        if (ex.description && (!c.why_now || c.why_now === "Active buying signal")) {
          c.why_now = ex.description.slice(0, 160);
        }
      }),
    ),
    new Promise((r) => setTimeout(r, 10_000)),
  ]);
  return companies;
}
