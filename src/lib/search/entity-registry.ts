/**
 * M7 — Entity / registry feed for M4 corroboration.
 *
 * Cross-source corroboration strengthens resolution; it does NOT lower
 * MIN_IDENTITY_CONFIDENCE (0.7) and does NOT turn fuzzy name matching into identity.
 *
 * Same display name → multiple registry rows → fail closed (ambiguous).
 */
import type { KnownEntity } from "@/lib/search/entity-resolve";
import { normalizeEntityName, normalizeDomain } from "@/lib/search/entity-resolve";

/** Seeded known entities for corroboration (tests + thin local feed). */
const SEED: KnownEntity[] = [
  {
    name: "Acme Robotics",
    entity_type: "company",
    domain: "acmerobotics.example",
    location: "Berlin",
    entity_id: "org:acme-robotics",
  },
  {
    name: "Nimbus Analytics",
    entity_type: "company",
    domain: "nimbusanalytics.example",
    location: "Austin",
    entity_id: "org:nimbus-analytics",
  },
  // Same display name, two orgs — unique corroboration impossible by name alone.
  {
    name: "Horizon Labs",
    entity_type: "company",
    domain: "horizon-sf.example",
    location: "San Francisco",
    entity_id: "org:horizon-sf",
  },
  {
    name: "Horizon Labs",
    entity_type: "company",
    domain: "horizon-austin.example",
    location: "Austin",
    entity_id: "org:horizon-austin",
  },
];

const extra: KnownEntity[] = [];

function allRows(): KnownEntity[] {
  return [...SEED, ...extra];
}

/** Register a known entity for the current process (tests / thin feeds). */
export function registerKnownEntity(entity: KnownEntity): void {
  extra.push(entity);
}

/** Clear process-local extras (seeds remain). */
export function clearRegisteredEntities(): void {
  extra.length = 0;
}

/** Snapshot of the full registry (seed + extras). */
export function listKnownEntities(): KnownEntity[] {
  return allRows().map((e) => ({ ...e }));
}

/**
 * Exact normalized-name lookup. Multiple hits → return all (caller fail-closes).
 * Never fuzzy-matches or guesses.
 */
export function lookupKnownEntities(name: string | null | undefined): KnownEntity[] {
  const n = normalizeEntityName(name ?? "");
  if (!n || n.length < 3) return [];
  return allRows().filter((k) => normalizeEntityName(k.name) === n);
}

/**
 * Domain-unique lookup (stronger corroboration).
 */
export function lookupKnownByDomain(domainOrUrl: string | null | undefined): KnownEntity[] {
  const d = normalizeDomain(domainOrUrl);
  if (!d) return [];
  return allRows().filter((k) => normalizeDomain(k.domain ?? null) === d);
}

/**
 * Merge caller-supplied known rows with registry hits for a name hint.
 * Dedupes by entity_id / domain / name+type.
 */
export function mergeKnownWithRegistry(
  known: KnownEntity[] | undefined,
  nameHint: string | null | undefined,
  domainHint?: string | null,
): KnownEntity[] {
  const out: KnownEntity[] = [...(known ?? [])];
  const seen = new Set(
    out.map(
      (k) =>
        k.entity_id ??
        `${normalizeEntityName(k.name)}|${normalizeDomain(k.domain ?? null) ?? ""}`,
    ),
  );
  const add = (k: KnownEntity) => {
    const key =
      k.entity_id ??
      `${normalizeEntityName(k.name)}|${normalizeDomain(k.domain ?? null) ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(k);
  };
  for (const k of lookupKnownEntities(nameHint)) add(k);
  for (const k of lookupKnownByDomain(domainHint ?? null)) add(k);
  return out;
}
