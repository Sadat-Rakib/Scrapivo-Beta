/**
 * OpenStreetMap / Overpass local-business discovery.
 * City-radius `around:` only — never a country/state bbox (those time out).
 */
import type { Lead } from "../scoring";
import type { ExpandedQueries } from "./query-expander";
import { disambiguatePlaceQuery, isRealBusinessWebsite } from "./place-disambiguate.server";
import {
  fanOutCitiesForAdmin,
  fanOutCitiesForCountry,
  isGazetteerCountry,
  normalizeLocalLocation,
} from "@/lib/local/city-gazetteer";
import { isCountryLocation } from "./query-classifier";

export type SourceLead = Lead & { intentBoost?: number; address?: string };

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

/** Last mirror that answered OK — tried first next time (mirrors differ a lot
 *  in uptime/latency; probing dead ones costs seconds per query). */
let preferredOverpass = 0;

function craftTags(skill: string): string[] {
  const s = (skill || "").toLowerCase();
  if (/dentist|dental|ortho/.test(s))
    return ['"amenity"="dentist"', '"healthcare"="dentist"', '"amenity"="clinic"'];
  if (/\bplumb/.test(s)) return ['"craft"="plumber"', '"shop"="hardware"', '"office"="company"'];
  if (/\broof/.test(s)) return ['"craft"="roofer"', '"office"="company"'];
  if (/\belectric/.test(s)) return ['"craft"="electrician"', '"office"="company"'];
  if (/\bhvac|heating|cooling|air.?cond/.test(s)) {
    return [
      '"craft"="hvac"',
      '"craft"="heating_engineer"',
      '"shop"="air_conditioning"',
    ];
  }
  if (/law|attorney|legal/.test(s)) return ['"office"="lawyer"', '"office"="company"'];
  if (/gym|fitness|yoga/.test(s)) return ['"leisure"="fitness_centre"', '"sport"="fitness"'];
  if (/cafe|coffee|restaurant|food/.test(s)) return ['"amenity"="cafe"', '"amenity"="restaurant"'];
  if (/market|agency|seo|design|lead|sales/.test(s)) {
    return ['"office"="advertising_agency"', '"office"="marketing"', '"office"="company"'];
  }
  if (/med.?spa|salon|beauty|spa/.test(s)) return ['"shop"="beauty"', '"leisure"="spa"'];
  if (/account|bookkeep|cpa/.test(s)) return ['"office"="accountant"', '"office"="tax_advisor"'];
  if (/real.?estate|realtor/.test(s)) return ['"office"="estate_agent"'];
  // Fallback: add broader office/company tag
  return ['"office"="company"', '"shop"="yes"'];
}

function nameNeedleFor(skill: string): string {
  const s = (skill || "").toLowerCase();
  if (/\bplumb/.test(s)) return "plumb";
  if (/\broof/.test(s)) return "roof";
  if (/\belectric/.test(s)) return "electric";
  if (/\bhvac|heating|cooling|air.?cond/.test(s)) return "hvac|heating|cooling|air.?cond|climate";
  if (/dentist|dental/.test(s)) return "dentist|dental";
  if (/law|attorney|legal/.test(s)) return "law|attorney|legal";
  if (/account/.test(s)) return "account";
  if (/gym|fitness/.test(s)) return "gym|fitness";
  if (/market|agency/.test(s)) return "market|agency";
  return "";
}

/** Broad fallback tags must not turn an arbitrary POI into a plumber. */
export function osmTradeCategory(skill: string, tag: string, name: string): string | null {
  if (!/\bplumb/.test(skill.toLowerCase())) return tag;
  if (tag.toLowerCase() === "plumber") return "plumber";
  if (/\bplumb(?:er|ers|ing)?\b/i.test(name) &&
      !/\b(supply|supplies|wholesale|parts|showroom)\b/i.test(name)) return "plumber";
  return null;
}

type GeoHit = {
  lat: number;
  lon: number;
  type: string;
  displayName: string;
};

function isBroadAdmin(hit: GeoHit): boolean {
  // Nominatim labels single-tier municipalities (e.g. Toronto, Ottawa) as
  // "administrative boundary" classes even when the addresstype is city —
  // those are real searchable cities, not broad admin areas.
  if (/city|town|municipality/.test(hit.type)) return false;
  return /country|state|region|province|boundary/i.test(hit.type);
}

export function isClosedOsmTags(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const name = `${tags.name || ""} ${tags.official_name || ""}`.toLowerCase();
  if (/\b(permanently closed|closed down)\b/.test(name)) return true;
  if ((tags.opening_hours || "").toLowerCase() === "closed") return true;
  if (tags.shop === "vacant" || tags.abandoned === "yes" || tags.disused === "yes") return true;
  for (const [k, v] of Object.entries(tags)) {
    if (/^disused:/.test(k) && v) return true;
    if (k === "abandoned" && v && v !== "no") return true;
    if (/demolished|was:/.test(k)) return true;
  }
  return false;
}

export function formatOsmAddress(tags: Record<string, string>): string {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:suburb"] || tags["addr:neighbourhood"],
    tags["addr:city"] || tags["addr:town"] || tags["addr:village"],
    tags["addr:state"] || tags["addr:province"],
    tags["addr:postcode"],
  ].filter((p) => p && String(p).trim());
  return parts.join(", ");
}

async function geocodeNominatimPoint(place: string): Promise<GeoHit | null> {
  try {
    const q = disambiguatePlaceQuery(normalizeLocalLocation(place));
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Scrapivo/1.0 (local-business discovery; contact: support@scrapivo.app)",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      type?: string;
      class?: string;
      addresstype?: string;
      importance?: number;
      address?: { country_code?: string };
      display_name?: string;
    }>;
    if (!data?.length) return null;

    const score = (r: (typeof data)[0]): number => {
      let s = (r.importance ?? 0) * 100;
      const t = `${r.type || ""} ${r.class || ""} ${r.addresstype || ""}`.toLowerCase();
      if (/city|town|municipality|village|suburb/.test(t)) s += 40;
      if (/country|state|province|region/.test(t)) s -= 20;
      const cc = (r.address?.country_code || "").toLowerCase();
      if (/, canada$/i.test(q) && cc === "ca") s += 50;
      if (/, uk$/i.test(q) && cc === "gb") s += 50;
      if (/usa$/i.test(q) && cc === "us") s += 50;
      if (/bangladesh/i.test(q) && cc === "bd") s += 50;
      if (/india/i.test(q) && cc === "in") s += 50;
      if (/toronto/i.test(place) && !/canada|ontario/i.test(place) && cc === "us") s -= 100;
      return s;
    };

    const best = [...data].sort((a, b) => score(b) - score(a))[0];
    const lat = Number(best?.lat);
    const lon = Number(best?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      type: `${best.type || ""} ${best.class || ""} ${best.addresstype || ""}`.trim(),
      displayName: best.display_name || q,
    };
  } catch {
    return null;
  }
}

async function overpass(query: string): Promise<any[]> {
  // Round 0 tries every mirror once (preferred mirror first). A second round
  // runs ONLY when no mirror gave a usable HTTP response (transient outage) —
  // legitimate empty results are final, otherwise sparse areas double latency.
  const order = [
    ...OVERPASS_MIRRORS.slice(preferredOverpass),
    ...OVERPASS_MIRRORS.slice(0, preferredOverpass),
  ];
  let sawResponse = false;
  for (let round = 0; round < 2; round++) {
    if (round > 0) {
      if (sawResponse) break;
      await new Promise((r) => setTimeout(r, 900));
    }
    for (const mirror of order) {
      try {
        const res = await fetch(mirror, {
          method: "POST",
          // Node (undici) sends NO default User-Agent — Overpass mirrors
          // answer 406 without one, so always identify ourselves.
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Scrapivo/1.0 (local-business discovery; contact: support@scrapivo.app)",
            Accept: "*/*",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(round === 0 ? 22_000 : 14_000),
        });
        if (!res.ok) continue;
        sawResponse = true;
        const idx = OVERPASS_MIRRORS.indexOf(mirror);
        if (idx >= 0) preferredOverpass = idx;
        const data = (await res.json()) as { elements?: any[] };
        if (Array.isArray(data.elements)) return data.elements;
      } catch {
        /* try next mirror */
      }
    }
  }
  // A provider outage is different from a valid empty OSM response. Let the
  // caller record SOURCE_ERROR instead of reporting zero local businesses.
  throw new Error("Overpass mirrors unavailable");
}

/** Tag-only query — fast and reliable. NEVER mix name-regex statements into
 *  the same union: Overpass's planner turns `name~"x",i` + around into a
 *  multi-minute scan that returns 0 elements (verified against 2 mirrors). */
function tagQuery(tags: string[], lat: number, lon: number, radiusM: number): string {
  const tagFilter = tags
    .flatMap((t) => [`nwr[${t}](around:${radiusM},${lat},${lon});`])
    .join("\n  ");
  return `
[out:json][timeout:25];
(
  ${tagFilter}
);
out center 150;
`;
}

/** Name-regex fallback — separate query, separately timeboxed by the caller. */
function nameQuery(needle: string, lat: number, lon: number, radiusM: number): string {
  return `
[out:json][timeout:15];
(
  nwr["name"~"${needle}",i]["craft"](around:${radiusM},${lat},${lon});
  nwr["name"~"${needle}",i]["office"](around:${radiusM},${lat},${lon});
);
out center 60;
`;
}

export function elementsToLeads(elements: any[], loc: string, skill: string, cap: number): SourceLead[] {
  const out: SourceLead[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const tagsMap = el.tags || {};
    const name = (tagsMap.name || "").trim();
    if (!name || name.length < 2) continue;
    if (isClosedOsmTags(tagsMap)) continue;
    const websiteRaw = (tagsMap.website || tagsMap["contact:website"] || "").trim();
    const website = isRealBusinessWebsite(
      websiteRaw ? (websiteRaw.startsWith("http") ? websiteRaw : `https://${websiteRaw}`) : "",
    )
      ? websiteRaw.startsWith("http")
        ? websiteRaw
        : `https://${websiteRaw}`
      : undefined;
    const phone = (tagsMap.phone || tagsMap["contact:phone"] || "").trim();
    const email = (tagsMap.email || tagsMap["contact:email"] || "").trim();
    const rawCategory =
      tagsMap.craft ||
      tagsMap.office ||
      tagsMap.amenity ||
      tagsMap.shop ||
      tagsMap.leisure ||
      skill;
    const category = osmTradeCategory(skill, rawCategory, name);
    if (!category) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const address = formatOsmAddress(tagsMap);

    out.push({
      source: "osm",
      platform: "Local business",
      platform_label: "Local business",
      title: name,
      snippet: [address || loc, phone ? `Phone: ${phone}` : null].filter(Boolean).join(" · "),
      full_post_url: website,
      // A directory/social URL in OSM is not an official business website.
      // This is only a research seed; exact-name checks still decide absence.
      structured_website_absent: !website,
      source_record_url: el.type && el.id ? `https://www.openstreetmap.org/${el.type}/${el.id}` : undefined,
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
      why_match: address || `${name} — ${category} in ${loc}`,
      emails: email ? [email] : undefined,
      phones: phone ? [phone] : undefined,
      address: address || undefined,
    } as SourceLead);

    if (out.length >= cap) break;
  }
  return out;
}

async function searchAroundCity(
  skill: string,
  locLabel: string,
  lat: number,
  lon: number,
  deadlineMs = 55_000,
): Promise<SourceLead[]> {
  const tags = craftTags(skill);
  const needle = nameNeedleFor(skill);
  const start = Date.now();
  // Try smaller radius first (12km)
  let leads = elementsToLeads(await overpass(tagQuery(tags, lat, lon, 12_000)), locLabel, skill, 150);
  // If insufficient results, expand to 25km — but never blow the wall-clock.
  if (leads.length < 15 && Date.now() - start < deadlineMs * 0.45) {
    leads = elementsToLeads(
      await overpass(tagQuery(tags, lat, lon, 25_000)),
      locLabel,
      skill,
      150,
    );
  }
  // Still thin → separately-timeboxed name-regex sweep at 25km.
  if (leads.length < 10 && needle && Date.now() - start < deadlineMs * 0.75) {
    const extra = await Promise.race([
      overpass(nameQuery(needle, lat, lon, 25_000)),
      new Promise<any[]>((r) => setTimeout(() => r([]), 18_000)),
    ]);
    const merged = [...elementsToLeads(extra, locLabel, skill, 60), ...leads];
    const seen = new Set<string>();
    leads = merged.filter((l) => {
      const k = (l.author || l.title).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return leads;
}

/**
 * Discover local businesses near `place` matching the craft.
 */
export async function searchOsmLocalBusinesses(
  qx: ExpandedQueries,
  place: string,
): Promise<SourceLead[]> {
  const skill = (qx.skill || qx.role || "").trim();
  const loc = normalizeLocalLocation(place || "");
  if (!skill || !loc || loc.toLowerCase() === "anywhere") return [];

  if (isCountryLocation(loc) || isGazetteerCountry(loc)) {
    const cities = fanOutCitiesForCountry(loc, 4);
    if (!cities.length) return [];
    const batches = await Promise.all(
      cities.map(async (city) => {
        const hit = await geocodeNominatimPoint(`${city}, ${loc}`);
        if (!hit || isBroadAdmin(hit)) return [] as SourceLead[];
        return searchAroundCity(skill, `${city}, ${loc}`, hit.lat, hit.lon);
      }),
    );
    const merged: SourceLead[] = [];
    const seen = new Set<string>();
    for (const batch of batches) {
      for (const lead of batch) {
        const k = (lead.author || lead.title).toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(lead);
      }
    }
    if (merged.length)
      console.info(`[osm-local] ${merged.length} businesses in ${loc} (city fan-out)`);
    return merged.slice(0, 100);
  }

  const hit = await geocodeNominatimPoint(loc);
  if (!hit) return [];
  if (isBroadAdmin(hit)) {
    const cities = fanOutCitiesForAdmin(loc, 6);
    if (!cities.length) {
      // Unknown admin — do not Overpass a province/country bbox (times out).
      return [];
    }
    const batches = await Promise.all(
      cities.map(async (city) => {
        const cityHit = await geocodeNominatimPoint(`${city}, ${loc}`);
        if (!cityHit || isBroadAdmin(cityHit)) return [] as SourceLead[];
        return searchAroundCity(skill, `${city}, ${loc}`, cityHit.lat, cityHit.lon);
      }),
    );
    const merged: SourceLead[] = [];
    const seen = new Set<string>();
    for (const batch of batches) {
      for (const lead of batch) {
        const k = (lead.author || lead.title).toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(lead);
      }
    }
    return merged.slice(0, 100);
  }

  const out = await searchAroundCity(skill, loc, hit.lat, hit.lon);
  if (out.length) console.info(`[osm-local] ${out.length} businesses near ${loc} for ${skill}`);
  return out;
}
