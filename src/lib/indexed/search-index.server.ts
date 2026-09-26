/**
 * Indexed retrieval (Postgres) for spec-first search — Gate 4 cutover.
 *
 * Contract: the parser (SearchSpec) owns WHAT+WHERE interpretation; this
 * module owns retrieval. It returns SpecRow[] in the exact shapes
 * runSpecSearchCore maps to today, so validation, logging, and display
 * behave identically whichever engine served the query.
 *
 * Rules (locked):
 * - Exact matches ONLY. No nearby-fill, no guessing: a city query returns
 *   that city's rows; fewer than the limit returns fewer rows.
 * - Normalization mirrors the loader (scripts/pipeline/store.py):
 *   country via COUNTRY_ISO (upper ISO2), city via normCityLookup (lower),
 *   category via canonCraft, role via role_norm equality.
 * - Reads go through the service-role client (getAdmin) with projection-only
 *   SELECTs + LIMIT. No writes, ever.
 * - Any throw -> caller falls back to the S3 readers. Never a hard failure.
 */
import { getAdmin } from "@/integrations/my-supabase/admin.server";
import type { DbHitMeta } from "@/lib/canonical/read-parquet.server";
import { COUNTRY_ISO, normCityLookup, normalizeRole } from "@/lib/search/search-spec-extract";
import { countryHintForCity } from "@/lib/search/location-resolver";
import { canonCraft, expandCategory } from "@/lib/canonical/businesses.server";
import { companyCategoryTerms } from "@/lib/canonical/companies.server";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { checkPhone } from "@/lib/search/phone-safety";
import { makeEvidence, type Evidence } from "@/lib/search/evidence";
import { queryRequiredFields } from "@/lib/search/canonical-contract";

export interface IndexQueryResult {
  rows: SpecRow[];
  meta: DbHitMeta;
}

function fieldOf(spec: SearchSpec, f: string): string | null {
  const c = spec.criteria.find((x) => x.field === f);
  return c ? c.value : null;
}

/** Spec location display name -> ISO2 upper ('Canada' -> 'CA'). */
function isoOf(location: string): string | null {
  const list = COUNTRY_ISO[location.toLowerCase().trim()];
  return list?.[0]?.toUpperCase() ?? null;
}

/** Country predicate for a spec location: ISO for country queries, hinted
 *  ISO for known cities (single-sourced in location-resolver; e.g.
 *  disambiguates London GB from London Ontario), none for unknown cities. */
function countryEq(location: string | null): string | null {
  if (!location) return null;
  return isoOf(location) ?? countryHintForCity(location) ?? null;
}

const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

async function queryBusinesses(
  category: string | null,
  location: string | null,
  limit: number,
  offset = 0,
  opportunity: string | null = null,
  requireEmail = false,
  requirePhone = false,
): Promise<IndexQueryResult> {
  const t0 = Date.now();
  // Country-level ('Canada') vs city-level ('Pune') routing, same semantics
  // as the S3 reader's isCountryQuery/exact split.
  const isCountry = !!location && !!COUNTRY_ISO[location.toLowerCase().trim()];
  const cc = countryEq(location);
  let q = getAdmin()
    .from("idx_businesses")
    .select(
      "registry_key,name,category,address,city,region,country,phone,email,website,quality_score",
    )
    .eq("junk_flag", 0)
    .order("quality_score", { ascending: false })
    .range(offset, offset + limit - 1);
  if (cc) q = q.eq("country", cc);
  // Family expansion (Step 2.2): `hvac` must also match `hvac_services`
  // rows, `real_estate` both agent + service rows. IN-list stays indexable.
  if (category) q = q.in("category", expandCategory(canonCraft(category)));
  if (location && !isCountry) q = q.eq("city_norm", normCityLookup(location));
  // Opportunity pushdown (Step 2.3): no-website hunts filter at the DB.
  if (opportunity === "no_website") q = q.is("website", null);
  if (requireEmail) q = q.not("email", "is", null);
  if (requirePhone) q = q.not("phone", "is", null);
  const { data, error } = await q;
  if (error) throw new Error(`[pg-index businesses] ${error.message}`);
  const rows: SpecRow[] = (data ?? []).map((b) => ({
    kind: "business" as const,
    key: b.registry_key ?? null,
    entity_id: b.registry_key ?? null,
    entity_resolved: !!b.registry_key,
    page_type: "entity_page" as const,
    identity_confidence: 0.9,
    title: b.name ?? "?",
    detail: [b.address, b.city, b.region, b.country].filter(has).join(", "),
    email: b.email ?? null,
    // Phase 1.5: wrong-country dial codes are source-data hallucinations —
    // hide + flag, never display (e.g. +1 numbers on IN rows).
    phone: checkPhone(b.phone, b.country ?? "").phone,
    phoneStatus: checkPhone(b.phone, b.country ?? "").status,
    url: b.website ?? null,
    website_url: b.website ?? null,
    // The indexed Overture record explicitly stores a null website field.
    // Keep that structured fact as an unverified research seed only.
    no_website_verification: opportunity === "no_website" && !b.website &&
      typeof b.registry_key === "string" && b.registry_key.startsWith("overture:")
      ? { structured_source_url: b.registry_key, structured_absence: true, exact_queries: [] }
      : undefined,
    category: b.category ?? null,
    location: [b.city, b.region].filter(has).join(", ") || null,
    country: b.country ?? null,
    opportunity,
  }));
  return {
    rows,
    meta: {
      dbHit: rows.length > 0,
      engine: "pg-index",
      partitionsRead: ["idx_businesses(country,city_norm,category)"],
      rowsScanned: rows.length,
      rowsReturned: rows.length,
      elapsedMs: Date.now() - t0,
      indexUsed: "idx_biz_country_citynorm_cat",
    },
  };
}

async function queryCompanies(
  category: string | null,
  location: string | null,
  limit: number,
  offset = 0,
  requireEmail = false,
  requirePhone = false,
  opportunity: string | null = null,
): Promise<IndexQueryResult> {
  const t0 = Date.now();
  const isCountry = !!location && !!COUNTRY_ISO[location.toLowerCase().trim()];
  const cc = countryEq(location);
  let q = getAdmin()
    .from("idx_companies")
    .select("registry_key,name,country,city,region,category,website,email,phone,quality_score")
    .order("quality_score", { ascending: false })
    .range(offset, offset + limit - 1);
  if (cc) q = q.eq("country", cc);
  if (category) {
    const terms = companyCategoryTerms(category)
      .map((term) => term.replace(/[%_,]/g, ""))
      .filter(Boolean);
    q = terms.length > 1
      ? q.or(terms.map((term) => `category.ilike.%${term}%`).join(","))
      : q.ilike("category", `%${terms[0] ?? ""}%`);
  }
  if (location && !isCountry) q = q.eq("city_norm", normCityLookup(location));
  if (requireEmail) q = q.not("email", "is", null);
  if (requirePhone) q = q.not("phone", "is", null);
  const { data, error } = await q;
  if (error) throw new Error(`[pg-index companies] ${error.message}`);
  const rows: SpecRow[] = (data ?? []).map((c) => ({
    kind: "company" as const,
    key: c.registry_key ?? null,
    entity_id: c.registry_key ?? null,
    entity_resolved: !!c.registry_key,
    page_type: "company_page" as const,
    identity_confidence: 0.9,
    title: `${c.name ?? "?"} — ${c.category ?? ""}`,
    detail: [[c.city, c.region, c.country].filter(has).join(", "), c.website]
      .filter(has)
      .join(" · "),
    email: c.email ?? null,
    phone: checkPhone(c.phone, c.country ?? "").phone,
    phoneStatus: checkPhone(c.phone, c.country ?? "").status,
    url: c.website ?? null,
    category: c.category ?? null,
    location: [c.city, c.region].filter(has).join(", ") || null,
    country: c.country ?? null,
    opportunity,
  }));
  return {
    rows,
    meta: {
      dbHit: rows.length > 0,
      engine: "pg-index",
      partitionsRead: ["idx_companies(country,city_norm)"],
      rowsScanned: rows.length,
      rowsReturned: rows.length,
      elapsedMs: Date.now() - t0,
      indexUsed: "idx_co_country_city_quality_cover",
    },
  };
}

async function queryPeople(
  role: string | null,
  industry: string | null,
  location: string | null,
  limit: number,
  offset = 0,
  requireEmail = false,
  requirePhone = false,
): Promise<IndexQueryResult> {
  const t0 = Date.now();
  const cc = countryEq(location);
  let q = getAdmin()
    .from("idx_people")
    .select("registry_key,name,role,company,city,country,industry,email,phone,linkedin,quality_score")
    .order("quality_score", { ascending: false })
    .range(offset, offset + limit - 1);
  if (role) {
    const normalizedRole = normalizeRole(role);
    // Country-scoped founder lookups use the country+role B-tree. Worldwide
    // lookups use the role trigram index because the B-tree starts with country.
    q = normalizedRole === "founder" && cc
      ? q.eq("role_norm", "founder")
      : q.ilike("role_norm", `%${normalizedRole.replace(/[%_]/g, "")}%`);
  }
  if (industry) {
    const safeIndustry = industry.replace(/[%_,]/g, "").trim();
    const industryTerms = /^saas$/i.test(safeIndustry)
      ? ["saas", "software as a service"]
      : [safeIndustry];
    q = industryTerms.length > 1
      ? q.or(industryTerms.map((term) => `industry.ilike.%${term}%`).join(","))
      : q.ilike("industry", `%${safeIndustry}%`);
  }
  if (cc) q = q.eq("country", cc);
  if (location && !COUNTRY_ISO[location.toLowerCase().trim()]) {
    q = q.eq("city_norm", normCityLookup(location));
  }
  if (requireEmail) q = q.not("email", "is", null);
  if (requirePhone) q = q.not("phone", "is", null);
  const { data, error } = await q;
  if (error) throw new Error(`[pg-index people] ${error.message}`);
  const rows: SpecRow[] = (data ?? []).map((p) => {
    const entityId = p.registry_key ?? null;
    const company = (p.company ?? "").trim();
    const roleName = (p.role ?? "").trim();
    const evidence: Evidence[] = entityId && company
      ? [makeEvidence({
          source_url: p.linkedin ?? `db://people/${entityId}`,
          source_type: "db",
          excerpt: roleName ? `${roleName} at ${company}` : `Associated with ${company}`,
          evidence_type: "identity",
          supports: "identity",
          subject: entityId,
          claim_parameters: {
            role: roleName ? normalizeRole(roleName) : "employee",
            organization_entity_id: `company:${company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            organization_name: company,
            role_currentness: "current_role",
            relationship: /\bfounder\b/i.test(roleName) ? "founder" : "employment",
          },
        } as unknown as Evidence & { claim_parameters: Record<string, string> })]
      : [];
    return {
      kind: "person" as const,
      key: entityId,
      entity_id: entityId,
      entity_resolved: !!entityId,
      page_type: "person_page" as const,
      identity_confidence: 0.9,
      title: `${p.name ?? "?"} — ${p.role ?? "?"} @ ${p.company ?? "?"}`,
      detail: [p.company, p.country, p.industry, p.city].filter(has).join(" · "),
      email: p.email ?? null,
      phone: checkPhone(p.phone, p.country ?? "").phone,
      phoneStatus: checkPhone(p.phone, p.country ?? "").status,
      url: p.linkedin ?? null,
      industry: p.industry ?? null,
      location: p.city ?? p.country ?? null,
      country: p.country ?? null,
      evidence,
    };
  });
  return {
    rows,
    meta: {
      dbHit: rows.length > 0,
      engine: "pg-index",
      partitionsRead: ["idx_people(country,city_norm,role_norm)"],
      rowsScanned: rows.length,
      rowsReturned: rows.length,
      elapsedMs: Date.now() - t0,
      indexUsed: "idx_ppl_country_citynorm_rolenorm",
    },
  };
}

/** True when the spec carries a geo predicate the indexes can seek on.
 *  Without country or city every table would seq-scan + sort (Supabase
 *  free-tier statement timeout) — the caller must clarify/S3-refuse instead.
 *  This is the unconstrained-query guard (Batch 1 correctness). */
function hasGeoPredicate(spec: SearchSpec): boolean {
  const location = fieldOf(spec, "location");
  if (!location) return false;
  if (isoOf(location)) return true; // country query
  return normCityLookup(location).length > 0; // city query (hint or bare)
}

function hasSelectivePersonPredicate(spec: SearchSpec): boolean {
  return !!(fieldOf(spec, "role") || fieldOf(spec, "industry"));
}

/**
 * Indexed counterpart to the S3 readers in runSpecSearchCore. Returns null
 * for entities with no index table (investor/job/unknown) AND for specs
 * without a geo predicate (would seq-scan) so the caller transparently
 * uses the clarify/S3 path. Throws on any DB error -> S3 fallback.
 */
export async function queryIndexForSpec(
  spec: SearchSpec,
  limit: number,
  offset = 0,
): Promise<IndexQueryResult | null> {
  const location = fieldOf(spec, "location");
  const required = new Set(queryRequiredFields(spec));
  const requireEmail = required.has("email");
  const requirePhone = required.has("phone");
  const geoBound = hasGeoPredicate(spec);
  const unboundedDirectory = (spec.entity === "business" || spec.entity === "company") && !geoBound;
  const unboundedPeople = spec.entity === "person" && !geoBound && !hasSelectivePersonPredicate(spec);
  if (unboundedDirectory || unboundedPeople) {
    if (typeof console !== "undefined") {
      console.info(`[index-skip] index_skipped_unconstrained entity=${spec.entity}`);
    }
    return null;
  }
  if (spec.entity === "business") {
    return queryBusinesses(
      fieldOf(spec, "category"),
      location,
      limit,
      offset,
      fieldOf(spec, "opportunity"),
      requireEmail,
      requirePhone,
    );
  }
  if (spec.entity === "company") {
    const cat = fieldOf(spec, "category") ?? fieldOf(spec, "industry");
    return queryCompanies(
      cat,
      location,
      limit,
      offset,
      requireEmail,
      requirePhone,
      fieldOf(spec, "opportunity"),
    );
  }
  if (spec.entity === "person") {
    return queryPeople(
      fieldOf(spec, "role"),
      fieldOf(spec, "industry"),
      location,
      limit,
      offset,
      requireEmail,
      requirePhone,
    );
  }
  return null;
}
