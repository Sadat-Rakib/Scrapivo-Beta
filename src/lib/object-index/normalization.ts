import { canonCraft } from "@/lib/canonical/businesses.server";
import { companyCategoryTerms } from "@/lib/canonical/companies.server";
import { normCityLookup, normalizeRole } from "@/lib/search/search-spec-extract";

export function normalizeIndexText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export async function postingBucket(term: string, hexChars: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(term));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, hexChars);
}

export function categoryTerms(entity: "business" | "company", value: string): string[] {
  if (entity === "business") return [canonCraft(value)];
  return [...new Set(companyCategoryTerms(value).map(normalizeIndexText).filter(Boolean))];
}

export const cityTerm = (value: string) => normCityLookup(value);
export const roleTerm = (value: string) => normalizeRole(value);
