/**
 * OpenStreetMap / Overpass local-business discovery.
 * Finds amenity/shop/office/craft nodes with names in a place bbox.
 */
import type { Lead } from "../scoring";
import type { ExpandedQueries } from "./query-expander";
import { disambiguatePlaceQuery, isRealBusinessWebsite } from "./place-disambiguate.server";

export type SourceLead = Lead & { intentBoost?: number };

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

function craftTags(skill: string): string[] {
  const s = (skill || "").toLowerCase();
  if (/dentist|dental|ortho/.test(s)) return ['"amenity"="dentist"', '"healthcare"="dentist"'];
  // Exact crafts only — never broad shop=trade (pulls unrelated stores).
  if (/\bplumb/.test(s)) return ['"craft"="plumber"'];
  if (/\broof/.test(s)) return ['"craft"="roofer"'];
  if (/\belectric/.test(s)) return ['"craft"="electrician"'];
  if (/\bhvac|heating|cooling/.test(s)) return ['"craft"="hvac"', '"craft"="plumber"'];
  if (/law|attorney|legal/.test(s)) return ['"office"="lawyer"'];
  if (/gym|fitness|yoga/.test(s)) return ['"leisure"="fitness_centre"', '"sport"="fitness"'];
  if (/cafe|coffee|restaurant|food/.test(s)) return ['"amenity"="cafe"', '"amenity"="restaurant"'];
  if (/market|agency|seo|design|lead|sales/.test(s)) {
    return ['"office"="advertising_agency"', '"office"="marketing"', '"office"="company"'];
  }
  if (/med.?spa|salon|beauty|spa/.test(s)) return ['"shop"="beauty"', '"leisure"="spa"'];
  return ['"office"', '"shop"', '"amenity"="business"'];
}

async function geocodeNominatim(
  place: string,
): Promise<{ south: number; west: number; north: number; east: number } | null> {
  try {
    const q = disambiguatePlaceQuery(place);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Scrapivo/1.0 (local-business discovery; contact: support@scrapivo.app)",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      boundingbox?: string[];
      type?: string;
      class?: string;
      importance?: number;
      address?: { country_code?: string; city?: string };
      display_name?: string;
    }>;
    if (!data?.length) return null;

    const score = (r: (typeof data)[0]): number => {
      let s = (r.importance ?? 0) * 100;
      const t = `${r.type || ""} ${r.class || ""}`.toLowerCase();
      if (/city|town|municipality|administrative/.test(t)) s += 40;
      if (/village|hamlet/.test(t)) s -= 30;
      const cc = (r.address?.country_code || "").toLowerCase();
      if (/, canada$/i.test(q) && cc === "ca") s += 50;
      if (/, uk$/i.test(q) && cc === "gb") s += 50;
      if (/usa$/i.test(q) && cc === "us") s += 50;
      // Bare "Toronto" must not win as Toronto IA
      if (
        /toronto/i.test(place) &&
        !/canada|ontario/i.test(place) &&
        cc === "us"
      ) {
        s -= 100;
      }
      return s;
    };

    const best = [...data].sort((a, b) => score(b) - score(a))[0];
    const bb = best?.boundingbox;
    if (!bb || bb.length < 4) return null;
    const south = Number(bb[0]);
    const north = Number(bb[1]);
    const west = Number(bb[2]);
    const east = Number(bb[3]);
    if (![south, north, west, east].every(Number.isFinite)) return null;
    return { south, west, north, east };
  } catch {
    return null;
  }
}

async function overpass(query: string): Promise<any[]> {
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { elements?: any[] };
      if (Array.isArray(data.elements) && data.elements.length) return data.elements;
    } catch {
      /* try next mirror */
    }
  }
  return [];
}

/**
 * Discover local businesses near `place` matching the craft.
 */
export async function searchOsmLocalBusinesses(
  qx: ExpandedQueries,
  place: string,
): Promise<SourceLead[]> {
  const skill = (qx.skill || qx.role || "").trim();
  const loc = (place || "").trim();
  if (!skill || !loc || loc.toLowerCase() === "anywhere") return [];

  const bbox = await geocodeNominatim(loc);
  if (!bbox) return [];

  const tags = craftTags(skill);
  // Include ways (many shops are mapped as ways) + nodes. No office union.
  const tagFilter = tags
    .flatMap((t) => [
      `node[${t}](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`,
      `way[${t}](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`,
    ])
    .join("\n  ");
  // Name fallback for sparse craft tags (e.g. plumbers tagged only by name).
  const nameNeedle = /\bplumb/.test(skill)
    ? "plumb"
    : /\broof/.test(skill)
      ? "roof"
      : /\belectric/.test(skill)
        ? "electric"
        : "";
  const nameFallback = nameNeedle
    ? `node["name"~"${nameNeedle}",i]["craft"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["name"~"${nameNeedle}",i]["shop"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["name"~"${nameNeedle}",i]["office"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["name"~"${nameNeedle}",i]["craft"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["name"~"${nameNeedle}",i]["shop"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`
    : "";
  const query = `
[out:json][timeout:40];
(
  ${tagFilter}
  ${nameFallback}
);
out center 150;
`;

  const elements = await overpass(query);
  const out: SourceLead[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const tagsMap = el.tags || {};
    const name = (tagsMap.name || "").trim();
    if (!name || name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const websiteRaw = (tagsMap.website || tagsMap["contact:website"] || "").trim();
    const website = isRealBusinessWebsite(
      websiteRaw
        ? websiteRaw.startsWith("http")
          ? websiteRaw
          : `https://${websiteRaw}`
        : "",
    )
      ? websiteRaw.startsWith("http")
        ? websiteRaw
        : `https://${websiteRaw}`
      : undefined;
    const phone = (tagsMap.phone || tagsMap["contact:phone"] || "").trim();
    const email = (tagsMap.email || tagsMap["contact:email"] || "").trim();
    const category =
      tagsMap.craft || tagsMap.office || tagsMap.amenity || tagsMap.shop || tagsMap.leisure || skill;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;

    out.push({
      source: "osm",
      platform: "Local business",
      platform_label: "Local business",
      title: name,
      snippet: [loc, phone ? `Phone: ${phone}` : null].filter(Boolean).join(" · "),
      full_post_url: website,
      author: name,
      company: name,
      company_domain: website
        ? (() => {
            try {
              return new URL(website).hostname.replace(/^www\./, "");
            } catch {
              return undefined;
            }
          })()
        : undefined,
      signal_type: "leading_indicator",
      source_confidence: website ? 70 : 55,
      intentBoost: website ? 16 : 10,
      demand_verified: true,
      match_reasons: [`${category} near ${loc}`],
      why_match: `${name} — ${category} in ${loc}`,
      emails: email ? [email] : undefined,
      phones: phone ? [phone] : undefined,
    } as SourceLead);

    if (out.length >= 60) break;
  }

  if (out.length) {
    console.info(`[osm-local] ${out.length} businesses near ${loc} for ${skill}`);
  }
  return out;
}
