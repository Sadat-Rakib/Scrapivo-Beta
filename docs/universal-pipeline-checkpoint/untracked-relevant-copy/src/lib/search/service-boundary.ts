import type { SpecRow } from "../spec-search.functions";
import type { SearchSpec } from "./search-spec";

/** Unknown product fit remains researchable, but cannot pass final delivery. */
export function serviceBoundaryState(spec: SearchSpec, row: SpecRow): "pass" | "unknown" {
  const boundaries = spec.criteria.filter(item => item.field === "exclude_service_only");
  if (!boundaries.length) return "pass";
  const subjectName = row.title.split(/\s+[—–]\s+/)[0];
  const observations = (row.evidence ?? []).filter(item => item.subject && item.subject === row.entity_id &&
    item.source_url && item.excerpt && subjectName && item.excerpt.toLowerCase().includes(subjectName.toLowerCase()) &&
    (item.evidence_type === "identity" || item.supports === "requested_product"));
  // Category/industry facts must be traceable to the subject's observations;
  // a query or directory title in row.detail cannot manufacture product fit.
  const fields = [row.category, row.industry].filter((value): value is string => !!value && observations.some(item =>
    item.excerpt!.toLowerCase().includes(value.toLowerCase())));
  const text = fields.join(" ");
  const productCategory = /\b(?:saas|software|products?|platforms?)\b/i.test(text) &&
    !/\b(?:software|product|platform)\s+(?:consulting|consultancy|development\s+services|services)\b/i.test(text);
  const subjectNames = [subjectName].filter(Boolean);
  const productObservation = observations.some(item =>
    subjectNames.some(name => {
      const at = item.excerpt!.toLowerCase().indexOf(name.toLowerCase());
      if (at < 0) return false;
      const ownStatement = item.excerpt!.slice(at + name.length).split(/[.;\n]/)[0];
      return /^\s+(?:builds?|develops?|owns?|offers?|provides?)\s+(?:its?\s+own\s+|a\s+|an\s+)?(?:[a-z-]+\s+){0,4}(?:saas|software|product|platform)\b/i.test(ownStatement);
    }));
  if (productCategory || productObservation) return "pass";
  return "unknown";
}
