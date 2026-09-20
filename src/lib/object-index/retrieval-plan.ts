import type { SearchSpec } from "@/lib/search/search-spec";
import type { CompactSearchDocument } from "./types";

export interface RetrievalPlan {
  radiusKm: number | null;
  origin: { latitude: number; longitude: number } | null;
  excludedLocations: string[];
}

const field = (spec: SearchSpec, name: string) =>
  spec.criteria.find((criterion) => criterion.field === name)?.value?.trim() || null;

export function retrievalPlanFromSpec(spec: SearchSpec): RetrievalPlan {
  const radiusRaw = field(spec, "radius_km");
  const latitude = Number(field(spec, "location_latitude"));
  const longitude = Number(field(spec, "location_longitude"));
  const radiusKm = radiusRaw && Number.isFinite(Number(radiusRaw)) && Number(radiusRaw) > 0
    ? Number(radiusRaw)
    : null;
  const origin = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
  const excludedLocations = spec.criteria
    .filter((criterion) => criterion.field === "excluded_location")
    .flatMap((criterion) => criterion.value.split("|"))
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
  return { radiusKm, origin, excludedLocations };
}

export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function documentSatisfiesRetrievalPlan(
  document: CompactSearchDocument,
  plan: RetrievalPlan,
): boolean {
  const location = [document.city, document.coarse_location, document.country]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  if (plan.excludedLocations.some((excluded) => location.includes(excluded))) return false;
  if (plan.radiusKm !== null) {
    if (!plan.origin || document.latitude == null || document.longitude == null) return false;
    return distanceKm(plan.origin, {
      latitude: document.latitude,
      longitude: document.longitude,
    }) <= plan.radiusKm;
  }
  return true;
}
