// =====================================================================
// Free-forever public registries — no keys, no rate anxiety, no vendor
// dependency. These fill company identity/socials when the own-crawler
// finds nothing, BEFORE any paid provider is considered.
//
//   • Wikidata: website, LinkedIn/Twitter handles, HQ, employee count for
//     any notable company (SPARQL, free forever).
//   • GLEIF: global Legal Entity Identifier records — proves a company is
//     a real registered legal entity (free forever).
// =====================================================================
import type { ContactSignal, SocialLinks } from "./contact-finder.server";

export type WikidataCompany = {
  name: string;
  website?: string;
  socials: SocialLinks;
  hq?: string;
  employees?: number;
  wikidata_url: string;
};

const UA = { "User-Agent": "Scrapivo/1.0 (lead verification; hello@scrapivo.app)" };

const COMPANY_DESC_RE =
  /compan|corporat|startup|software|technolog|business|enterprise|firm|platform|developer|manufactur|brand|provider|service|agency|retailer|publisher|studio|conglomerate|bank|insur/i;

function claimValue(claims: any, prop: string): any {
  try {
    return claims?.[prop]?.[0]?.mainsnak?.datavalue?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Look a company up on Wikidata by name; returns identity + socials.
 * Uses entity search (fast, fuzzy) and picks the first result whose
 * DESCRIPTION reads like a company — "Vercel" must resolve to the software
 * company, not the French commune of the same name.
 */
export async function wikidataCompanyLookup(name: string): Promise<WikidataCompany | null> {
  const q = (name || "").trim();
  if (!q || q.length < 2) return null;
  try {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&type=item&format=json&limit=5`;
    const sres = await fetch(searchUrl, { headers: UA });
    if (!sres.ok) return null;
    const sdata = (await sres.json()) as any;
    const hit = (sdata?.search ?? []).find((h: any) =>
      COMPANY_DESC_RE.test(h?.display?.description?.value || h?.description || ""),
    );
    if (!hit?.id) return null;

    const eres = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`, {
      headers: UA,
    });
    if (!eres.ok) return null;
    const edata = (await eres.json()) as any;
    const entity = edata?.entities?.[hit.id];
    const claims = entity?.claims ?? {};

    const website = claimValue(claims, "P856") as string | null;
    const linkedinId = claimValue(claims, "P4264") as string | null;
    const twitter = claimValue(claims, "P2002") as string | null;
    const employeesRaw = claimValue(claims, "P1128") as { amount?: string } | null;

    const socials: SocialLinks = {};
    if (linkedinId) socials.linkedin = `https://www.linkedin.com/company/${linkedinId}`;
    if (twitter) socials.twitter = `https://x.com/${twitter}`;
    if (!website && !linkedinId && !twitter) return null;

    return {
      name: hit.display?.label?.value || hit.label || q,
      website: website || undefined,
      socials,
      hq: hit.display?.description?.value || hit.description || undefined,
      employees: employeesRaw?.amount ? Math.abs(Number(employeesRaw.amount)) : undefined,
      wikidata_url: `https://www.wikidata.org/wiki/${hit.id}`,
    };
  } catch {
    return null;
  }
}

export type WikidataPerson = {
  name: string;
  socials: SocialLinks;
  description?: string;
  wikidata_url: string;
};

/**
 * Lightweight person lookup on Wikidata (notable people only).
 * Returns LinkedIn/Twitter/GitHub when present — most freelancers won't hit.
 */
export async function wikidataPersonLookup(name: string): Promise<WikidataPerson | null> {
  const q = (name || "").trim();
  if (!q || q.length < 3 || !/\s/.test(q)) return null; // need first+last-ish
  try {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&type=item&format=json&limit=5`;
    const sres = await fetch(searchUrl, { headers: UA });
    if (!sres.ok) return null;
    const sdata = (await sres.json()) as any;
    const PERSON_DESC =
      /\b(entrepreneur|founder|ceo|engineer|developer|designer|businessperson|executive|investor|programmer)\b/i;
    const hit = (sdata?.search ?? []).find((h: any) => {
      const d = h?.display?.description?.value || h?.description || "";
      return PERSON_DESC.test(d) || /\bhuman\b/i.test(d);
    });
    if (!hit?.id) return null;
    const eres = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`, {
      headers: UA,
    });
    if (!eres.ok) return null;
    const edata = (await eres.json()) as any;
    const claims = edata?.entities?.[hit.id]?.claims ?? {};
    const twitter = claimValue(claims, "P2002") as string | null;
    const github = claimValue(claims, "P2037") as string | null;
    const linkedinId = claimValue(claims, "P6634") as string | null; // LinkedIn personal ID
    const socials: SocialLinks = {};
    if (twitter) socials.twitter = `https://x.com/${twitter}`;
    if (github) socials.github = `https://github.com/${github}`;
    if (linkedinId) socials.linkedin = `https://www.linkedin.com/in/${linkedinId}`;
    if (!twitter && !github && !linkedinId) return null;
    return {
      name: hit.display?.label?.value || hit.label || q,
      socials,
      description: hit.display?.description?.value || hit.description || undefined,
      wikidata_url: `https://www.wikidata.org/wiki/${hit.id}`,
    };
  } catch {
    return null;
  }
}

/** Convert a Wikidata hit into corroboration signals for the merge step. */
export function wikidataToSignals(w: WikidataCompany): ContactSignal[] {
  const out: ContactSignal[] = [];
  if (w.website) {
    try {
      const domain = new URL(w.website).hostname.replace(/^www\./, "");
      out.push({
        kind: "post_text",
        domain,
        confidence: 0.5,
        url: w.wikidata_url,
        note: `Wikidata identity: ${w.name}${w.hq ? ` (HQ ${w.hq})` : ""}`,
      });
    } catch {
      /* invalid website URL */
    }
  }
  return out;
}

/** GLEIF LEI lookup — proves the company is a registered legal entity. */
export async function gleifLookup(name: string): Promise<ContactSignal | null> {
  const q = (name || "").trim();
  if (!q || q.length < 3) return null;
  try {
    const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(q)}&page[size]=1`;
    const res = await fetch(url, { headers: { ...UA, Accept: "application/vnd.api+json" } });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const rec = d?.data?.[0];
    const entity = rec?.attributes?.entity;
    if (!entity?.legalName?.name) return null;
    const legal = String(entity.legalName.name);
    // Strict-ish match: every query token must appear in the legal name, and
    // the legal name may add at most ONE extra word beyond legal suffixes —
    // otherwise "Vercel" would "verify" against "Vercel Immobilier SA"
    // (a different Swiss company; real false positive from live testing).
    const clean = (s: string) =>
      s
        .toLowerCase()
        .replace(
          /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|sa|srl|bv|plc|ag|oy|ab|as|pty|pvt|llp|lp|se|nv|kk|oyj)\b/g,
          " ",
        )
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    const qTokens = clean(q);
    const lTokens = clean(legal);
    if (!qTokens.length || !qTokens.every((t) => lTokens.includes(t))) return null;
    if (lTokens.length > qTokens.length + 1) return null;
    const country = entity.legalAddress?.country || "";
    return {
      kind: "opencorporates",
      name: legal,
      url: rec?.attributes?.lei
        ? `https://search.gleif.org/#/record/${rec.attributes.lei}`
        : undefined,
      confidence: 0.55,
      note: `GLEIF legal entity${country ? ` (${country})` : ""} — LEI ${rec?.attributes?.lei ?? ""}`,
    };
  } catch {
    return null;
  }
}
