import { resolveCanonicalLocation } from "../search/location-resolver";

interface InvestorLocation {
  location_raw: string | null;
  location_city?: string | null;
  location_country?: string | null;
}

/** A multi-country source span cannot describe one city/country pair. */
export function projectInvestorLocation(location: InvestorLocation) {
  const parts = (location.location_raw ?? "").split(",").map(part => part.trim()).filter(Boolean);
  const countries = parts.flatMap(part => {
    const geo = resolveCanonicalLocation(part);
    return geo?.kind === "country" && geo.country_code ? [{ name: part, code: geo.country_code }] : [];
  });
  const multipleCountries = new Set(countries.map(country => country.code)).size > 1;
  return {
    location_raw: location.location_raw,
    location_city: location.location_city ?? parts[0] ?? null,
    location_country: multipleCountries ? null : location.location_country ?? countries[0]?.name ?? null,
  };
}
