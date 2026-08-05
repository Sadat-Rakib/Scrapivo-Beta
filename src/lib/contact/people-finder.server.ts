// =====================================================================
// Person & phone DISCOVERY — finding who to contact, before finding how
//
// Pattern derivation is useless without names, so this layer runs first: it
// answers "which humans work here, and what are their titles". Titles are not
// a nice-to-have — CASL's implied-consent test requires the message to be
// relevant to the recipient's role, so a contact with no captured title can
// never be marked outreach-ready (see provenance.ts).
//
// Everything here is logged-out and either an official API or a search-engine
// result. Notably: LinkedIn profile URLs are collected from SERP results via
// SearXNG, never by fetching linkedin.com — no account, no cookies, no ToS
// accepted. That distinction is the whole ballgame post-Meta v. Bright Data:
// platform terms bind account holders, and the moment a session authenticates,
// a defensible scrape becomes a contract you signed.
//
// Phone discovery is separate and deliberately thin, because phones cannot be
// derived. Main lines are very findable (registries, OSM, imprints); direct
// dials and mobiles essentially only exist inside broker datasets sourced from
// contact-app harvesting, which is a decision to make deliberately rather than
// drift into.
// =====================================================================
import { resilientText, resilientJson } from "../search/http-fetch.server";
import { searchSearxng } from "../search/searxng.server";
import { condensePageText } from "../search/fetch-gate.server";
import {
  contentHash,
  detectAntiCemStatement,
  provenanceEntry,
  type ContactProvenance,
} from "./provenance";
import { parsePersonName } from "./email-patterns";

export type DiscoveredPerson = {
  name: string;
  role_title?: string;
  /** Public profile URL (LinkedIn, GitHub, company bio page). */
  profile_url?: string;
  email?: string;
  source: "team_page" | "search_serp" | "registry_officer" | "sec_edgar" | "json_ld";
  confidence: number;
  provenance: ContactProvenance;
};

// ── 1. team pages (already harvested) ───────────────────────────────────────

/**
 * The company's own team page is the best person source there is: names,
 * titles, and often the address pattern all sit together on one public page
 * the company published to be read. This adapts harvest.server's raw output.
 */
export function peopleFromHarvest(
  people: Array<{
    name: string;
    role_title?: string;
    email?: string;
    profile_url?: string;
    source_url: string;
    via?: "json_ld" | "page_text";
  }>,
): DiscoveredPerson[] {
  return people
    .filter((p) => parsePersonName(p.name).ok)
    .map((p) => ({
      name: p.name,
      role_title: p.role_title,
      profile_url: p.profile_url,
      email: p.email,
      // A schema.org Person is the site declaring who works there; a name read
      // out of prose is a guess, and downstream derivation treats it as such.
      source: p.via === "json_ld" ? ("json_ld" as const) : ("team_page" as const),
      confidence: p.via === "json_ld" ? (p.role_title ? 0.85 : 0.7) : p.role_title ? 0.55 : 0.4,
      provenance: provenanceEntry("harvested", {
        source_url: p.source_url,
        locator: "team-page",
        role_title: p.role_title,
        anti_cem_statement: null,
        note: "Named on the company's own site",
      }),
    }));
}

// ── 2. search-engine person discovery (no platform fetches) ─────────────────

const SERP_TITLE_SPLIT = /\s+[-–—|]\s+/;

/** "Jane Smith - VP Engineering - Acme | LinkedIn" → name + title. */
function parseLinkedInSerpTitle(title: string): { name?: string; role_title?: string } {
  const cleaned = (title || "").replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  const parts = cleaned
    .split(SERP_TITLE_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return {};
  const name = parts[0];
  if (!parsePersonName(name).ok) return {};
  return { name, role_title: parts[1] || undefined };
}

/**
 * Find people at a company via site-restricted search. We read the SERP title
 * and snippet only — the profile URL is recorded, never fetched.
 *
 * `roles` should come from the user's ICP ("VP Engineering", "Head of Growth"),
 * because a role-targeted query returns people who can actually buy, and it
 * also gives us the title we need for the CASL relevance condition.
 */
export async function findPeopleViaSearch(
  company: string,
  roles: string[] = [],
  limit = 8,
): Promise<DiscoveredPerson[]> {
  if (!process.env.SEARXNG_URL || !company.trim()) return [];

  const roleTerms = roles.length ? roles.slice(0, 3) : ["founder", "head of", "director"];
  const queries = [
    ...roleTerms.map((r) => `site:linkedin.com/in "${company}" "${r}"`),
    `site:linkedin.com/in "${company}"`,
  ];

  // Person pages aren't news — a day-scoped time range would return nothing.
  const results = await searchSearxng(queries, 4, "year");
  const out: DiscoveredPerson[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    if (!/linkedin\.com\/in\//i.test(r.url)) continue;
    // Single-token slugs are company pages misfiled as profiles.
    const slug = r.url.split("/in/")[1]?.split(/[/?#]/)[0] ?? "";
    if (!slug.includes("-")) continue;

    const { name, role_title } = parseLinkedInSerpTitle(r.title);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Only keep people the snippet actually ties to this company.
    const haystack = `${r.title} ${r.content}`.toLowerCase();
    if (!haystack.includes(company.toLowerCase().split(/\s+/)[0])) continue;

    out.push({
      name,
      role_title,
      profile_url: r.url.split("?")[0],
      source: "search_serp",
      confidence: role_title ? 0.6 : 0.45,
      provenance: provenanceEntry("profile_harvest", {
        source_url: r.url.split("?")[0],
        locator: "search-result",
        role_title,
        anti_cem_statement: null,
        note: "Public search result; the profile page itself was not fetched",
      }),
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ── 3. SEC EDGAR (US public companies — free, official, no key) ─────────────

type EdgarCompany = { cik: string; name: string; ticker?: string };

let edgarIndex: EdgarCompany[] | null = null;

async function loadEdgarIndex(): Promise<EdgarCompany[]> {
  if (edgarIndex) return edgarIndex;
  const data = await resilientJson<
    Record<string, { cik_str: number; ticker: string; title: string }>
  >("https://www.sec.gov/files/company_tickers.json", {
    retries: 1,
    headers: { "User-Agent": edgarUserAgent() },
  });
  edgarIndex = data
    ? Object.values(data).map((c) => ({
        cik: String(c.cik_str).padStart(10, "0"),
        name: c.title,
        ticker: c.ticker,
      }))
    : [];
  return edgarIndex;
}

/** SEC requires a descriptive UA with a contact address on every request. */
function edgarUserAgent(): string {
  return process.env.SEC_EDGAR_USER_AGENT || "Scrapivo/1.0 (contact@scrapivo.app)";
}

export type EdgarProfile = {
  name: string;
  cik: string;
  phone?: string;
  website?: string;
  address?: string;
  sic_description?: string;
  source_url: string;
};

/**
 * SEC EDGAR company profile. Public filers publish a business address and
 * phone number as a matter of law, which makes this one of the few completely
 * unambiguous free phone sources for US companies — and it comes with an SIC
 * code, so it doubles as firmographic data.
 */
export async function secEdgarCompany(company: string): Promise<EdgarProfile | null> {
  const name = (company || "").trim();
  if (name.length < 3) return null;
  const index = await loadEdgarIndex();
  if (!index.length) return null;

  const needle = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match =
    index.find((c) => c.name.toLowerCase() === needle) ??
    (needle.length >= 5 ? index.find((c) => c.name.toLowerCase().startsWith(needle)) : undefined);
  if (!match) return null;

  const data = await resilientJson<Record<string, any>>(
    `https://data.sec.gov/submissions/CIK${match.cik}.json`,
    { retries: 1, headers: { "User-Agent": edgarUserAgent() } },
  );
  if (!data) return null;

  const biz = data.addresses?.business;
  const address = biz
    ? [biz.street1, biz.street2, biz.city, biz.stateOrCountry, biz.zipCode]
        .filter(Boolean)
        .join(", ")
    : undefined;

  return {
    name: data.name || match.name,
    cik: match.cik,
    phone: data.phone || undefined,
    website: data.website || undefined,
    address,
    sic_description: data.sicDescription || undefined,
    source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${match.cik}`,
  };
}

// ── 4. UK Companies House officers (free API key) ───────────────────────────

/**
 * Named directors and officers, straight from the statutory register. Free but
 * key-gated; when no key is set this silently returns nothing so the waterfall
 * carries on. Officers give names + roles, which is exactly what pattern
 * derivation and the CASL relevance test both need.
 */
export async function companiesHouseOfficers(company: string): Promise<DiscoveredPerson[]> {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key || !company.trim()) return [];
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;

  try {
    const searchRes = await fetch(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(company)}&items_per_page=3`,
      { headers: { Authorization: auth }, signal: AbortSignal.timeout(12_000) },
    );
    if (!searchRes.ok) return [];
    const search = (await searchRes.json()) as {
      items?: Array<{ company_number: string; title: string }>;
    };
    const first = search.items?.[0];
    if (!first) return [];

    // Strict-ish name check — "Vercel" must not match "Vercel Immobilier SA".
    const wanted = company.toLowerCase().replace(/[^a-z0-9]/g, "");
    const got = first.title
      .toLowerCase()
      .replace(/\b(limited|ltd|plc|llp)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
    if (!got.startsWith(wanted) && !wanted.startsWith(got)) return [];

    const officersRes = await fetch(
      `https://api.company-information.service.gov.uk/company/${first.company_number}/officers?items_per_page=10`,
      { headers: { Authorization: auth }, signal: AbortSignal.timeout(12_000) },
    );
    if (!officersRes.ok) return [];
    const officers = (await officersRes.json()) as {
      items?: Array<{ name: string; officer_role?: string; resigned_on?: string }>;
    };

    const url = `https://find-and-update.company-information.service.gov.uk/company/${first.company_number}/officers`;
    return (officers.items ?? [])
      .filter((o) => !o.resigned_on)
      .slice(0, 8)
      .map((o) => {
        // Companies House writes names as "SMITH, Jane Elizabeth".
        const [surname, given] = o.name.split(",").map((s) => s.trim());
        const name = given ? `${given.split(/\s+/)[0]} ${titleCase(surname)}` : titleCase(o.name);
        return {
          name,
          role_title: o.officer_role?.replace(/-/g, " "),
          source: "registry_officer" as const,
          confidence: 0.7,
          provenance: provenanceEntry("registry", {
            source_url: url,
            locator: "companies-house:officers",
            role_title: o.officer_role,
            anti_cem_statement: null,
            note: `Statutory register, company ${first.company_number}`,
          }),
        };
      })
      .filter((p) => parsePersonName(p.name).ok);
  } catch {
    return [];
  }
}

function titleCase(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

// ── 5. phone discovery ──────────────────────────────────────────────────────

export type DiscoveredPhone = {
  raw: string;
  source: "osm" | "sec_edgar" | "site";
  /** Attribution obligations travel with the data (OSM is ODbL). */
  attribution?: string;
  provenance: ContactProvenance;
};

/**
 * OpenStreetMap via Overpass. Free, no key, and businesses tag `phone`,
 * `contact:phone`, `email`, and `website` on their premises. Data is ODbL, so
 * the attribution string rides along with the record rather than being an
 * afterthought at export time.
 */
export async function osmPhoneLookup(
  companyName: string,
  countryCode?: string,
): Promise<DiscoveredPhone[]> {
  const name = (companyName || "").trim();
  if (name.length < 3) return [];

  const escaped = name.replace(/["\\]/g, "");
  const area = countryCode ? `area["ISO3166-1"="${countryCode.toUpperCase()}"]->.a;` : "";
  const scope = countryCode ? "(area.a)" : "";
  const query = `[out:json][timeout:20];${area}nwr["name"="${escaped}"]["phone"]${scope};out tags 5;`;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Scrapivo/1.0 (contact@scrapivo.app)",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      elements?: Array<{ id: number; type: string; tags?: Record<string, string> }>;
    };

    const out: DiscoveredPhone[] = [];
    for (const el of data.elements ?? []) {
      const phone = el.tags?.phone || el.tags?.["contact:phone"];
      if (!phone) continue;
      out.push({
        raw: phone,
        source: "osm",
        attribution: "© OpenStreetMap contributors (ODbL)",
        provenance: provenanceEntry("structured_data", {
          source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          locator: "osm:phone",
          anti_cem_statement: null,
          note: "OpenStreetMap premises tag — ODbL, attribution required",
        }),
      });
    }
    return out.slice(0, 3);
  } catch {
    return [];
  }
}

/** SEC business phone as a DiscoveredPhone, so callers handle one shape. */
export function edgarPhoneToDiscovered(profile: EdgarProfile): DiscoveredPhone | null {
  if (!profile.phone) return null;
  return {
    raw: profile.phone,
    source: "sec_edgar",
    provenance: provenanceEntry("registry", {
      source_url: profile.source_url,
      locator: "sec:submissions.phone",
      anti_cem_statement: null,
      note: "Business phone filed with the SEC",
    }),
  };
}

// ── 6. press pages (direct media contacts) ──────────────────────────────────

/**
 * Press releases and media pages are an underused source: they publish a named
 * media contact with a DIRECT email and often a direct phone, because they want
 * journalists to call. Same publication logic as the rest of the harvest.
 */
export async function pressContactsFromUrl(url: string): Promise<{
  emails: string[];
  phones: string[];
  provenance: ContactProvenance;
} | null> {
  try {
    const html = await resilientText(url, { retries: 1 });
    if (!html) return null;
    const text = condensePageText(html, 12_000);
    if (!/\b(press|media|for more information|contact)\b/i.test(text)) return null;

    // Only take contacts from the neighbourhood of a press-contact heading —
    // the whole-page sweep already happened in the harvest layer.
    const blocks = [
      ...text.matchAll(/\b(?:media|press)\s+(?:contact|inquiries|enquiries)\b([\s\S]{0,320})/gi),
    ];
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (const b of blocks) {
      for (const m of b[1].matchAll(/\b[a-zA-Z0-9._%+'-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g)) {
        emails.add(m[0].toLowerCase());
      }
      for (const m of b[1].matchAll(/(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g)) {
        phones.add(m[0]);
      }
    }
    if (!emails.size && !phones.size) return null;

    return {
      emails: [...emails].slice(0, 3),
      phones: [...phones].slice(0, 3),
      provenance: provenanceEntry("harvested", {
        source_url: url,
        locator: "press-contact-block",
        content_hash: contentHash(text),
        anti_cem_statement: detectAntiCemStatement(text),
        note: "Media contact published for press enquiries",
      }),
    };
  } catch {
    return null;
  }
}
