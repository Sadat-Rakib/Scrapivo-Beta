/**
 * OpenStreetMap / Overpass local-business discovery (Mainstreet-style).
 * No API key. ODbL — attribute OpenStreetMap contributors in UI.
 *
 * Finds amenity/shop/office nodes with names in a place bbox, preferring
 * listings that publish a website (email harvest target) or phone.
 */
import type { Lead } from "../scoring";
import type { ExpandedQueries } from "./query-expander";

export type SourceLead = Lead & { intentBoost?: number };

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

function craftTags(skill: string): string[] {
  const s = (skill || "").toLowerCase();
  if (/dentist|dental|ortho/.test(s)) return ['"amenity"="dentist"', '"healthcare"="dentist"'];
  if (/roof|plumb|hvac|electric/.test(s)) return ['"craft"~"roofer|plumber|electrician"', '"shop"="trade"'];
  if (/law|attorney|legal/.test(s)) return ['"office"="lawyer"', '"amenity"="courthouse"'];
  if (/gym|fitness|yoga/.test(s)) return ['"leisure"="fitness_centre"', '"sport"="fitness"'];
  if (/cafe|coffee|restaurant|food/.test(s)) return ['"amenity"="cafe"', '"amenity"="restaurant"'];
  if (/market|agency|seo|design|lead|sales/.test(s)) {
    return ['"office"="advertising_agency"', '"office"="marketing"', '"office"="company"'];
  }
  if (/med.?spa|salon|beauty|spa/.test(s)) return ['"shop"="beauty"', '"leisure"="spa"'];
  return ['"office"', '"shop"', '"amenity"="business"'];
}

async function geocodeNominatim(place: string): Promise<{ south: number; west: number; north: number; east: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Scrapivo/1.0 (local-business discovery; contact: support@scrapivo.app)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ boundingbox?: string[] }>;
    const bb = data[0]?.boundingbox;
    if (!bb || bb.length < 4) return null;
    // Nominatim: [south, north, west, east]
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
 * Returns company-shaped leads (source: osm) for the Local tab + Companies.
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
  const tagFilter = tags.map((t) => `node[${t}](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`).join("\n  ");
  const query = `
[out:json][timeout:40];
(
  ${tagFilter}
  node["name"]["office"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out body 80;
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

    const website = (tagsMap.website || tagsMap["contact:website"] || "").trim();
    const phone = (tagsMap.phone || tagsMap["contact:phone"] || "").trim();
    const email = (tagsMap.email || tagsMap["contact:email"] || "").trim();
    const lat = el.lat;
    const lon = el.lon;
    const osmUrl =
      lat != null && lon != null
        ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`
        : `https://www.openstreetmap.org/node/${el.id}`;

    const category =
      tagsMap.office || tagsMap.amenity || tagsMap.shop || tagsMap.craft || tagsMap.leisure || "business";
    const snippetParts = [
      `${category} in ${loc}`,
      phone ? `Phone: ${phone}` : null,
      website ? `Website: ${website}` : null,
      email ? `Email: ${email}` : null,
    ].filter(Boolean);

    out.push({
      source: "osm",
      platform: "OpenStreetMap",
      platform_label: "Local business (OSM)",
      title: name,
      snippet: snippetParts.join(" · "),
      full_post_url: website || osmUrl,
      author: name,
      company: name,
      company_domain: website
        ? (() => {
            try {
              return new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(
                /^www\./,
                "",
              );
            } catch {
              return undefined;
            }
          })()
        : undefined,
      signal_type: "leading_indicator",
      source_confidence: website ? 70 : 55,
      intentBoost: website ? 16 : 10,
      demand_verified: true,
      match_reasons: ["Local business on OpenStreetMap", `${category} near ${loc}`],
      why_match: website
        ? `Local ${category} with a website — good email harvest target`
        : `Local ${category} in ${loc} (OSM)`,
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
