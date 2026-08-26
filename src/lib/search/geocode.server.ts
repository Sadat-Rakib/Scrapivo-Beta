/**
 * Neutral keyless geocoder — Nominatim → Photon (komoot) → Geoapify.
 * Free services are tried FIRST; Geoapify only runs when GEOAPIFY_API_KEY is
 * set, so nothing in the pipeline depends on a paid key to resolve places.
 */
import { disambiguatePlaceQuery } from "./place-disambiguate.server";
import { normalizeLocalLocation } from "@/lib/local/city-gazetteer";

export type GeoPoint = {
  lon: number;
  lat: number;
  city?: string;
  country_code?: string;
  state_code?: string;
  place_id?: string;
  result_type?: string;
};

type NomHit = {
  lat?: string;
  lon?: string;
  type?: string;
  class?: string;
  addresstype?: string;
  importance?: number;
  address?: {
    country_code?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
  };
  display_name?: string;
};

async function nominatimGeocode(query: string): Promise<GeoPoint | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=` +
      encodeURIComponent(query);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Scrapivo/1.0 (place resolution; contact: support@scrapivo.app)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NomHit[];
    if (!data?.length) return null;

    const score = (r: NomHit): number => {
      let s = (r.importance ?? 0) * 100;
      const t = `${r.type || ""} ${r.class || ""} ${r.addresstype || ""}`.toLowerCase();
      if (/city|town|municipality/.test(t)) s += 40;
      if (/village|hamlet|suburb/.test(t)) s -= 20;
      if (/country|state|province|region/.test(t)) s -= 15;
      return s;
    };
    const best = [...data].sort((a, b) => score(b) - score(a))[0];
    const lat = Number(best?.lat);
    const lon = Number(best?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      city: best.address?.city || best.address?.town || best.address?.village,
      country_code: best.address?.country_code?.toUpperCase(),
      state_code: best.address?.state,
      result_type: `${best.type || ""} ${best.class || ""} ${best.addresstype || ""}`.trim(),
    };
  } catch {
    return null;
  }
}

type PhotonHit = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    city?: string;
    countrycode?: string;
    state?: string;
    osm_id?: number;
    type?: string;
  };
};

/** Photon (komoot) — free, no key, backed by OpenStreetMap. */
async function photonGeocode(query: string): Promise<GeoPoint | null> {
  try {
    const url = `https://photon.komoot.io/api/?limit=5&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Scrapivo/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: PhotonHit[] };
    const feats = data.features ?? [];
    if (!feats.length) return null;
    const scored = feats.map((f) => {
      let s = 0;
      const t = String(f.properties?.type || "").toLowerCase();
      if (/city|town/.test(t)) s += 30;
      if (/district|locality/.test(t)) s -= 10;
      return { f, s };
    });
    scored.sort((a, b) => b.s - a.s);
    const best = scored[0].f;
    const coords = best.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      city: best.properties?.city,
      country_code: best.properties?.countrycode?.toUpperCase(),
      state_code: best.properties?.state,
      place_id: best.properties?.osm_id ? `photon:${best.properties.osm_id}` : undefined,
      result_type: best.properties?.type,
    };
  } catch {
    return null;
  }
}

/** Geoapify — last resort, only when a key is configured. */
async function geoapifyGeocode(query: string): Promise<GeoPoint | null> {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) return null;
  try {
    const url =
      `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}` +
      `&limit=5&format=json&apiKey=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const r = data.results?.[0];
    if (!r) return null;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      city: typeof r.city === "string" ? r.city : undefined,
      country_code: typeof r.country_code === "string" ? r.country_code.toUpperCase() : undefined,
      state_code: typeof r.state_code === "string" ? r.state_code : undefined,
      place_id: typeof r.place_id === "string" ? r.place_id : undefined,
      result_type: typeof r.result_type === "string" ? r.result_type : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a place label to coordinates via the free-first chain.
 * Never throws — returns null when every provider fails or the query is empty.
 */
export async function geocodePlace(query: string): Promise<GeoPoint | null> {
  const q = query?.trim();
  if (!q) return null;
  const prepared = disambiguatePlaceQuery(normalizeLocalLocation(q));
  return (
    (await nominatimGeocode(prepared)) ??
    (await photonGeocode(prepared)) ??
    (await photonGeocode(q)) ??
    (await geoapifyGeocode(prepared))
  );
}
