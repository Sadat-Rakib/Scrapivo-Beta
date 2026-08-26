// Foursquare Places fallback when Geoapify returns thin coverage.
import type { ExpandedQueries } from "./query-expander";
import type { Lead } from "../scoring";
import { agencyRelevanceRank, extractLocationHint, geocodePlace } from "./geoapify-places.server";
import { extractLocationFromQuery, isCountryLocation } from "./query-classifier";
import { fanOutCitiesForCountry, normalizeLocalLocation } from "@/lib/local/city-gazetteer";

export type SourceLead = Lead & { intentBoost?: number };

const CITY_RADIUS_M = 40_000;

function queryText(qx: ExpandedQueries): string {
  const blob = `${qx.role} ${qx.skill} ${qx.raw}`.toLowerCase();
  if (/agenc|market|seo|advertis|brand/.test(blob)) {
    if (/agenc/.test(blob) && /market|digital|advertis/.test(blob)) {
      return "digital marketing agency";
    }
    return `${qx.skill || "marketing"} agency`;
  }
  // Trades: search the craft noun, not "office/service"
  if (/\bplumb/.test(blob)) return "plumber";
  if (/\broof/.test(blob)) return "roofer";
  if (/\belectric/.test(blob)) return "electrician";
  if (/\bhvac|heating|cooling|air.?cond/.test(blob)) return "hvac service";
  if (/\bdentist|dental/.test(blob)) return "dentist";
  if (/\blaw|attorney|legal/.test(blob)) return "law firm";
  if (/\bgym|fitness/.test(blob)) return "gym";
  if (/\bsalon|beauty|spa/.test(blob)) return "beauty salon";
  if (/\brestaurant|cafe|coffee/.test(blob)) return "restaurant";
  if (/\baccount/.test(blob)) return "accountant";
  if (/\breal.?estate/.test(blob)) return "real estate";
  return qx.skill || qx.role || "business";
}

function wantsAgencyIcp(qx: ExpandedQueries): boolean {
  return /agenc|advertis|marketing|seo|brand|pr\b|media/i.test(`${qx.role} ${qx.skill} ${qx.raw}`);
}

/** Warn once per process when Foursquare rejects the key (401). Legacy
 *  `fsq3…` API keys that were revoked or not migrated are rejected by BOTH
 *  hosts; the fix is a Service API Key from the Foursquare developer console
 *  (https://docs.foursquare.com/developer/docs/manage-service-api-keys). */
let warnedInvalidKey = false;
function warnInvalidKeyOnce(status: number, body: string): void {
  if (warnedInvalidKey) return;
  warnedInvalidKey = true;
  console.warn(
    `[foursquare] ${status} from Places API (${body.slice(0, 80)}) — FOURSQUARE_API_KEY is ` +
      `invalid or revoked. Create a Service API Key in the Foursquare developer ` +
      `console and update FOURSQUARE_API_KEY; until then Foursquare contributes 0 rows.`,
  );
}

// ── Self-throttling (Foursquare is a FALLBACK source on a shared quota) ────
// Geoapify + OSM are the primary local sources; Foursquare only fires when
// they come back thin. These caps keep one busy day from draining the whole
// monthly bucket. The remote `x-ratelimit-remaining` header is honored too.
const FSQ_DAILY_CAP = Number(process.env.FOURSQUARE_DAILY_CAP ?? 40);
const FSQ_MONTHLY_CAP = Number(process.env.FOURSQUARE_MONTHLY_CAP ?? 400);
const FSQ_MIN_REMOTE_REMAINING = 100;
let fsqDayKey = "";
let fsqMonthKey = "";
let fsqDailyCount = 0;
let fsqMonthlyCount = 0;
let fsqRemoteRemaining = Number.POSITIVE_INFINITY;
let warnedQuota = false;

function fsqQuotaAvailable(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== fsqDayKey) {
    fsqDayKey = today;
    fsqDailyCount = 0;
  }
  const month = today.slice(0, 7);
  if (month !== fsqMonthKey) {
    fsqMonthKey = month;
    fsqMonthlyCount = 0;
  }
  const ok =
    fsqDailyCount < FSQ_DAILY_CAP &&
    fsqMonthlyCount < FSQ_MONTHLY_CAP &&
    fsqRemoteRemaining > FSQ_MIN_REMOTE_REMAINING;
  if (!ok && !warnedQuota) {
    warnedQuota = true;
    console.info(
      `[foursquare] quota guard engaged (day ${fsqDailyCount}/${FSQ_DAILY_CAP}, ` +
        `month ${fsqMonthlyCount}/${FSQ_MONTHLY_CAP}, remote remaining ${Number.isFinite(fsqRemoteRemaining) ? fsqRemoteRemaining : "?"}) — skipping Foursquare calls.`,
    );
  }
  return ok;
}

function fsqRecordCall(remainingHeader: string | null): void {
  fsqDailyCount += 1;
  fsqMonthlyCount += 1;
  const n = Number(remainingHeader);
  if (Number.isFinite(n) && n > 0) fsqRemoteRemaining = n;
}

async function foursquareSearch(ll: string, query: string, radius: number): Promise<any[]> {
  const key = process.env.FOURSQUARE_API_KEY;
  if (!key || !fsqQuotaAvailable()) return [];

  const params = new URLSearchParams({
    ll,
    query,
    radius: String(radius),
    limit: "50",
  });

  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
    {
      url: `https://places-api.foursquare.com/places/search?${params}`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        "X-Places-Api-Version": "2025-06-17",
      },
    },
    {
      url: `https://api.foursquare.com/v3/places/search?${params}`,
      headers: {
        Accept: "application/json",
        Authorization: key,
      },
    },
  ];

  for (const a of attempts) {
    try {
      const res = await fetch(a.url, { headers: a.headers });
      if (!res.ok) {
        // A dead/revoked key 401s on BOTH hosts; say so once instead of
        // silently degrading to zero Foursquare results forever.
        if (res.status === 401) {
          warnInvalidKeyOnce(res.status, await res.text().catch(() => ""));
        }
        continue;
      }
      fsqRecordCall(res.headers.get("x-ratelimit-remaining"));
      const data = (await res.json()) as any;
      const results = data?.results ?? data?.places ?? [];
      if (Array.isArray(results) && results.length) return results;
    } catch {
      /* try next */
    }
  }
  return [];
}

async function foursquareNear(near: string, query: string): Promise<any[]> {
  const key = process.env.FOURSQUARE_API_KEY;
  if (!key || !fsqQuotaAvailable()) return [];
  const params = new URLSearchParams({ near, query, limit: "50" });
  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
    {
      url: `https://places-api.foursquare.com/places/search?${params}`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        "X-Places-Api-Version": "2025-06-17",
      },
    },
    {
      url: `https://api.foursquare.com/v3/places/search?${params}`,
      headers: {
        Accept: "application/json",
        Authorization: key,
      },
    },
  ];
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, { headers: a.headers });
      if (!res.ok) {
        if (res.status === 401) {
          warnInvalidKeyOnce(res.status, await res.text().catch(() => ""));
        }
        continue;
      }
      fsqRecordCall(res.headers.get("x-ratelimit-remaining"));
      const data = (await res.json()) as any;
      const results = data?.results ?? data?.places ?? [];
      if (Array.isArray(results) && results.length) return results;
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function searchFoursquarePlaces(
  qx: ExpandedQueries,
  locationHint?: string | null,
  opts?: { directoryMode?: boolean },
): Promise<SourceLead[]> {
  if (!process.env.FOURSQUARE_API_KEY) return [];

  const locText = normalizeLocalLocation(
    (locationHint && locationHint.trim()) ||
      extractLocationFromQuery(qx.raw) ||
      extractLocationHint(`${qx.skill} ${qx.role}`) ||
      "",
  );
  // Never invent Denver — empty location → empty results
  if (!locText) return [];

  const q = queryText(qx);
  const preferAgency = wantsAgencyIcp(qx);

  // Country directory: fan out metros with near=City, Country
  if (isCountryLocation(locText)) {
    const cities = fanOutCitiesForCountry(locText, 6);
    if (cities.length) {
      const batches = await Promise.all(
        cities.slice(0, 6).map(async (city) => {
          const results = await foursquareNear(`${city}, ${locText}`, q);
          return mapResults(results, city, opts?.directoryMode, preferAgency);
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
      merged.sort((a, b) => (b.intentBoost ?? 0) - (a.intentBoost ?? 0));
      return merged.slice(0, 100);
    }
  }

  const point = await geocodePlace(locText);
  if (!point) {
    const results = await foursquareNear(locText, q);
    return mapResults(results, locText, opts?.directoryMode, preferAgency);
  }

  const results = await foursquareSearch(`${point.lat},${point.lon}`, q, CITY_RADIUS_M);
  return mapResults(results, locText, opts?.directoryMode, preferAgency);
}

function mapResults(
  results: any[],
  city: string,
  directoryMode?: boolean,
  preferAgency?: boolean,
): SourceLead[] {
  const out: SourceLead[] = [];
  for (const r of results) {
    const name = r.name;
    if (!name) continue;
    if (
      r.closed === true ||
      r.permanently_closed === true ||
      r.closed_bucket === "PermanentlyClosed"
    )
      continue;
    if (/\b(permanently closed|closed down)\b/i.test(name)) continue;
    const cats = (r.categories || []).map((c: any) => c.name || c.short_name).filter(Boolean);
    const rank = preferAgency ? agencyRelevanceRank(name, cats) : 1;
    if (preferAgency && rank < 0) continue;
    if (preferAgency && rank < 20) continue;

    // Real website only — never Foursquare venue pages.
    const websiteRaw = r.website || undefined;
    const website =
      websiteRaw && /^https?:\/\//i.test(websiteRaw) && !/foursquare\.com/i.test(websiteRaw)
        ? websiteRaw
        : undefined;
    const loc = r.location || {};
    const address =
      loc.formatted_address || [loc.address, loc.locality, loc.region].filter(Boolean).join(", ");
    const locality = loc.locality || loc.region || city;
    const phone = r.tel || r.phone || undefined;
    const agencyHit = rank > 0;

    out.push({
      source: "foursquare",
      platform: "Local business",
      title: `${name}${locality ? ` — ${locality}` : ""}`,
      snippet: [address || locality || city, phone ? `Phone: ${phone}` : ""]
        .filter(Boolean)
        .join(" · "),
      full_post_url: website,
      author: name,
      company: name,
      phones: phone ? [phone] : undefined,
      posted_at: undefined,
      engagement: agencyHit ? 50 : 30,
      is_decision_maker: true,
      intentBoost: directoryMode ? (agencyHit ? 24 : 14) : 8,
      signal_type: "direct_intent",
      why_match: address || `${name} in ${locality || city}`,
      match_reasons: [`Match in ${locality || city}`, ...(agencyHit ? ["Agency signal"] : [])],
      address: address || undefined,
    } as SourceLead);
  }
  return out;
}

/** OSM (Nominatim+Overpass) is PRIMARY and fully free. Geoapify/Foursquare
 *  run only when OSM comes back thin AND their keys exist; CoreClaw only when
 *  USE_PAID_SOURCES=true. Zero paid calls happen without explicit keys. */
export async function searchLocalBusinesses(
  qx: ExpandedQueries,
  locationHint?: string | null,
  opts?: { directoryMode?: boolean; min?: number },
): Promise<SourceLead[]> {
  const min = opts?.min ?? (opts?.directoryMode ? 20 : 10);
  const directoryMode = !!opts?.directoryMode;
  const anyPlacesKey = !!(process.env.GEOAPIFY_API_KEY || process.env.FOURSQUARE_API_KEY);

  /** CoreClaw Maps — paid Discover opt-in only; never stall the free path. */
  const coreclawMaps = async () => {
    try {
      const { paidDiscoveryEnabled } = await import("./paid-discovery");
      if (!paidDiscoveryEnabled()) return [] as SourceLead[];
      const { searchCoreClawMapsLeads } = await import("./coreclaw-sources.server");
      return await Promise.race([
        searchCoreClawMapsLeads(qx, locationHint) as Promise<SourceLead[]>,
        new Promise<SourceLead[]>((resolve) => setTimeout(() => resolve([]), 6_000)),
      ]);
    } catch {
      return [] as SourceLead[];
    }
  };

  // ── Free primary: OpenStreetMap ──────────────────────────────────────────
  const { searchOsmLocalBusinesses } = await import("./osm-local-businesses.server");
  const osm = await searchOsmLocalBusinesses(qx, locationHint ?? "").catch(
    () => [] as SourceLead[],
  );
  if (osm.length >= Math.min(min, 12) || !anyPlacesKey) {
    if (!anyPlacesKey && directoryMode) {
      // No keys at all → still allow CoreClaw behind its paid flag.
      const maps = await coreclawMaps();
      if (maps.length) {
        const seen = new Set(osm.map((l) => (l.author || l.title).toLowerCase()));
        for (const m of maps) {
          if (seen.has((m.author || m.title).toLowerCase())) continue;
          osm.push(m);
        }
      }
    }
    return osm.slice(0, 120);
  }

  // ── Thin OSM + keys present: paid-optional top-up ───────────────────────
  const { searchGeoapifyPlaces } = await import("./geoapify-places.server");
  const merged: SourceLead[] = [...osm];
  const seen = new Set(osm.map((l) => (l.author || l.title).toLowerCase()));

  if (directoryMode) {
    const [primary, maps] = await Promise.all([
      searchGeoapifyPlaces(qx, locationHint, { directoryMode: true }),
      coreclawMaps(),
    ]);
    const ordered = [...maps, ...primary].sort(
      (a, b) => (b.intentBoost ?? 0) - (a.intentBoost ?? 0),
    );
    for (const l of ordered) {
      const k = (l.author || l.title).toLowerCase().replace(/\s+/g, " ");
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(l);
    }
    const strong = merged.filter((l) => (l.intentBoost ?? 0) >= 18 || l.source === "osm");
    if (strong.length >= min) return strong.slice(0, 120);
    if (merged.length >= min) return merged.slice(0, 120);

    const secondary = await searchFoursquarePlaces(qx, locationHint, { directoryMode: true });
    for (const l of secondary) {
      const k = (l.author || l.title).toLowerCase().replace(/\s+/g, " ");
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(l);
    }
    return merged.slice(0, 120);
  }

  const primary = await searchGeoapifyPlaces(qx, locationHint, { directoryMode: false });
  for (const l of primary) {
    const k = l.title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(l);
  }
  if (merged.length >= min) return merged;
  const [secondary, maps] = await Promise.all([
    searchFoursquarePlaces(qx, locationHint, { directoryMode: false }),
    coreclawMaps(),
  ]);
  for (const l of [...maps, ...secondary]) {
    const k = l.title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(l);
  }
  return merged;
}
