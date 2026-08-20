/**
 * Canonical entity resolution — merge Discover/Local/Jobs hits by domain/name/phone.
 */
import { createHash } from "node:crypto";

export type EntityHint = {
  name?: string;
  domain?: string;
  phone?: string;
  entityType?: "company" | "person" | "business" | "investor";
};

function normName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company|the)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normDomain(d: string): string {
  return d
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

function normPhone(p: string): string {
  return p.replace(/\D/g, "").slice(-10);
}

/** Stable canonical id from strongest available identity signals. */
export function canonicalEntityId(hint: EntityHint): string {
  const domain = hint.domain ? normDomain(hint.domain) : "";
  const phone = hint.phone ? normPhone(hint.phone) : "";
  const name = hint.name ? normName(hint.name) : "";
  const key = domain
    ? `d:${domain}`
    : phone
      ? `p:${phone}`
      : name
        ? `n:${name}`
        : `u:${Math.random().toString(36).slice(2)}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 20);
}

export type ResolveResult = {
  id: string;
  match: "domain" | "phone" | "name" | "none";
  confidence: number;
};

export function resolveEntity(hint: EntityHint, known: EntityHint[] = []): ResolveResult {
  const domain = hint.domain ? normDomain(hint.domain) : "";
  const phone = hint.phone ? normPhone(hint.phone) : "";
  const name = hint.name ? normName(hint.name) : "";

  for (const k of known) {
    if (domain && k.domain && normDomain(k.domain) === domain) {
      return { id: canonicalEntityId(k), match: "domain", confidence: 0.95 };
    }
  }
  for (const k of known) {
    if (phone && k.phone && normPhone(k.phone) === phone && phone.length >= 10) {
      return { id: canonicalEntityId(k), match: "phone", confidence: 0.85 };
    }
  }
  for (const k of known) {
    if (name && k.name && normName(k.name) === name && name.length >= 3) {
      // Name-only is weaker without domain
      return { id: canonicalEntityId(k), match: "name", confidence: 0.55 };
    }
  }
  return {
    id: canonicalEntityId(hint),
    match: domain ? "domain" : phone ? "phone" : name ? "name" : "none",
    confidence: domain ? 0.8 : phone ? 0.7 : name ? 0.5 : 0.2,
  };
}

/** Dedupe a list of rows that have name/domain/phone into unique entities. */
export function dedupeByEntity<T extends EntityHint>(rows: T[]): T[] {
  const known: EntityHint[] = [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const r = resolveEntity(row, known);
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    known.push(row);
    out.push(row);
  }
  return out;
}
