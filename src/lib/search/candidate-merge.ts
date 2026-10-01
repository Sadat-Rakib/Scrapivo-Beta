import type { SpecRow } from "@/lib/spec-search.functions";

const normalize = (value: string | null | undefined) => (value ?? "").toLowerCase()
  .normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Source pages can name many entities. Their URL is not necessarily entity identity. */
export function candidateIdentityKeys(row: SpecRow): string[] {
  const prefix = `${row.kind}:`;
  const keys = [row.entity_id, row.key].filter((v): v is string => !!v)
    .map((value) => `${prefix}id:${value.toLowerCase()}`);
  const name = normalize(row.title);
  const organization = normalize(row.company ?? row.employer);
  const location = normalize(row.location ?? row.country);
  let url: URL | undefined;
  try { if (row.url && row.url !== row.source_url) url = new URL(row.url); } catch { /* No URL identity. */ }
  if (url) {
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    const canonical = `${url.hostname}${path}${url.search}`;
    const sourceIsEntity = !row.source_page_type || row.source_page_type === "entity_page";
    if (row.kind === "job") keys.push(`${prefix}url:${canonical}`);
    else if (row.kind === "person" && name) {
      if (/\/in\/|\/people\/|\/person\/|\/profile\//i.test(path)) keys.push(`${prefix}profile:${canonical}:${name}`);
    } else if (sourceIsEntity && row.page_type === "entity_page" && name) {
      if (row.kind === "company" && !path && !/(linkedin|facebook|crunchbase|yelp)\./i.test(url.hostname)) {
        keys.push(`${prefix}domain:${url.hostname}`);
      } else keys.push(`${prefix}url:${canonical}:${name}`);
    }
  }
  if (name && row.entity_resolved === true) {
    if (row.kind === "person" && organization) keys.push(`${prefix}name-company:${name}:${organization}`);
    if (["company", "business", "investor"].includes(row.kind) && location) keys.push(`${prefix}name-location:${name}:${location}`);
  }
  return keys;
}

const richness = (row: SpecRow) => [row.role, row.company, row.industry, row.category,
  row.location, row.country, row.email, row.phone, row.url, row.salary, row.employer]
  .filter((value) => value != null && value !== "").length
  + (row.entity_resolved ? 20 : 0) + (row.verification_status === "verified" ? 40 : 0);

/** C6: which row was absorbed into which survivor, so the funnel can ledger
 *  every dropped duplicate instead of losing it between stages. */
export type MergedDuplicate = { mergedKey: string; keptKey: string };
export type MergeDuplicateResult = SpecRow[] & { mergeReport?: MergedDuplicate[] };

const rowKey = (row: SpecRow): string =>
  row.key ?? row.entity_id ?? normalize(row.title).replace(/\s+/g, "-") ?? "";

/** Merge only shared entity identifiers; preserve sources and subject binding. */
export function mergeDuplicateCandidates(input: SpecRow[]): MergeDuplicateResult {
  const mergeReport: MergedDuplicate[] = [];
  const groups: { row: SpecRow; keys: Set<string> }[] = [];
  for (const incoming of input) {
    const keys = new Set(candidateIdentityKeys(incoming));
    const matches = groups.filter((group) => [...keys].some((key) => group.keys.has(key)));
    let row = incoming;
    for (const group of matches) {
      const prior = group.row;
      const preferred = richness(prior) >= richness(row) ? prior : row;
      const secondary = preferred === prior ? row : prior;
      mergeReport.push({ mergedKey: rowKey(secondary), keptKey: rowKey(preferred) });
      const combined = { ...secondary, ...preferred };
      for (const key of Object.keys(secondary) as (keyof SpecRow)[]) {
        if (combined[key] == null || combined[key] === "") {
          (combined as Record<string, unknown>)[key] = secondary[key];
        }
      }
      const identity = combined.entity_id ?? combined.key;
      const aliases = new Set([prior.entity_id, prior.key, row.entity_id, row.key].filter(Boolean));
      const evidence = [...(prior.evidence ?? []), ...(row.evidence ?? [])].map((item) =>
        identity && item.subject && aliases.has(item.subject) ? { ...item, subject: identity } : item);
      combined.evidence = evidence.filter((item, index) => evidence.findIndex((other) =>
        other.source_url === item.source_url && other.excerpt === item.excerpt &&
        other.evidence_type === item.evidence_type && other.subject === item.subject &&
        JSON.stringify(other.claim_parameters) === JSON.stringify(item.claim_parameters)) === index);
      combined.field_provenance = { ...secondary.field_provenance, ...preferred.field_provenance };
      if (prior.no_website_verification || row.no_website_verification) {
        const a = prior.no_website_verification;
        const b = row.no_website_verification;
        combined.no_website_verification = {
          structured_source_url: b?.structured_source_url ?? a?.structured_source_url ?? null,
          structured_absence: !!(a?.structured_absence || b?.structured_absence),
          exact_queries: [...new Set([...(a?.exact_queries ?? []), ...(b?.exact_queries ?? [])])],
          official_site_found: b?.official_site_found ?? a?.official_site_found ?? null,
        };
      }
      for (const field of ["website_url", "profile_url", "apply_url", "source_url"] as const) {
        combined[field] = preferred[field] ?? secondary[field] ?? null;
      }
      combined.url = combined.kind === "job" ? combined.apply_url ?? null
        : combined.kind === "person" ? combined.profile_url ?? combined.website_url ?? null
        : combined.website_url ?? null;
      // Qualification must run again after evidence and fields are merged.
      combined.disposition = undefined;
      combined.complete = undefined;
      combined.missingFields = undefined;
      row = combined;
      group.keys.forEach((key) => keys.add(key));
      groups.splice(groups.indexOf(group), 1);
    }
    groups.push({ row, keys });
  }
  const rows = groups.map(({ row }) => row) as MergeDuplicateResult;
  // Non-enumerable: existing array consumers (JSON, spreads) are unaffected.
  Object.defineProperty(rows, "mergeReport", { value: mergeReport, enumerable: false });
  return rows;
}
