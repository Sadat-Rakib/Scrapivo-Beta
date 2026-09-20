import { createHash } from "node:crypto";
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

export function postingBucket(term: string, hexChars: number): string {
  return createHash("sha256").update(term, "utf8").digest("hex").slice(0, hexChars);
}

export function categoryTerms(entity: "business" | "company", value: string): string[] {
  if (entity === "business") return [canonCraft(value)];
  return [...new Set(companyCategoryTerms(value).map(normalizeIndexText).filter(Boolean))];
}

export const cityTerm = (value: string) => normCityLookup(value);
export const roleTerm = (value: string) => normalizeRole(value);

