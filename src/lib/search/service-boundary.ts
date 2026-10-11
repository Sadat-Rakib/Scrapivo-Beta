import type { SpecRow } from "../spec-search.functions";
import type { SearchSpec } from "./search-spec";

export function softwareActivityRequested(spec: SearchSpec): boolean {
  if (spec.entity !== "company") return false;
  const focus = spec.criteria.filter(item => item.field === "industry" || item.field === "category")
    .map(item => item.value).join(" ");
  return /\bsoftware(?:\s+(?:compan(?:y|ies)|business(?:es)?|firms?|providers?|developers?|development))?\b/i.test(focus);
}

/** Unknown product fit remains researchable, but cannot pass final delivery. */
export function serviceBoundaryState(spec: SearchSpec, row: SpecRow): "pass" | "unknown" {
  const boundaries = spec.criteria.filter(item => item.field === "exclude_service_only");
  const focus = spec.criteria.filter(item => item.field === "industry" || item.field === "category")
    .map(item => item.value).join(" ");
  const technologyStartup = spec.entity === "company" && /\bstartups?\b/i.test(focus) &&
    /\b(?:ai\s+(?:infra(?:structure)?|infrastructure)|dev\s*tools?|developer\s*tools?)\b/i.test(focus);
  const needsSoftwareActivity = softwareActivityRequested(spec);
  if (!boundaries.length && !technologyStartup && !needsSoftwareActivity) return "pass";

  const subjectName = row.title.split(/\s+[-–—]\s+/)[0];
  const observations = (row.evidence ?? []).filter(item => item.subject && item.subject === row.entity_id &&
    item.source_url && item.excerpt && subjectName &&
    (item.evidence_type === "identity" || item.supports === "requested_product"));

  const statesActivity = (statement: string) => {
    const prefix = /^(?:\s+(builds?|develops?|owns?|operates?|offers?|provides?|is|are)\s+|['’]s\s+)/i;
    const matchedPrefix = prefix.exec(statement);
    if (!matchedPrefix) return false;
    const action = (matchedPrefix[1] ?? "owns").toLowerCase();
    const object = statement.replace(prefix, "").split(/[.;\n]|\s+(?:and|alongside)\s+/i)[0];
    if (/\b(?:not(?!\s+only\b)|never|without|no(?![-\s]+code\b))\b/i.test(object)) return false;
    if (/\b(?:customers?|clients?)\b/i.test(object) && (technologyStartup || !/\b(?:custom\s+software|software\s+development)\b/i.test(object))) return false;
    if (/\b(?:customer\s+of|licensed\s+\w*\s*software|uses?\s+\w*\s*software|using\s+\w*\s*software|vendor\s+software|support\s+(?:for|of)\s+\w*\s*software|software\s+to\s+\w+)\b/i.test(object)) return false;
    if ((boundaries.length || technologyStartup) && /\b(?:consulting|consultanc(?:y|ies)|advisory|web\s*design|development\s+(?:services|agency))\b/i.test(object)) return false;

    const product = /\b(?:saas|software|products?|platforms?)\b/i.test(object);
    const activity = /\b(?:ai\s+infra(?:structure)?|dev\s*tools?|developer\s+(?:tools?|tooling|platforms?|productivity))\b/i.test(object);
    const softwareActivity =
      action === "is" || action === "are"
        ? /^(?:an?\s+)?(?:(?:online|custom|enterprise|business|cloud|ai|b2b)\s+){0,3}(?:software|saas)\s+(?:compan(?:y|ies)|business(?:es)?|firms?|developers?|development|consultanc(?:y|ies)|providers?|platforms?|products?)\b/i.test(object)
        : /\b(?:software|saas)\b/i.test(object);
    return (!boundaries.length || product) && (!technologyStartup || activity) && (!needsSoftwareActivity || softwareActivity);
  };

  const escapedName = subjectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const activityObservation = observations.some(item => {
    if ([...item.excerpt!.matchAll(new RegExp(`\\b${escapedName}(?=\\s|['’]s\\b|:|[.;]|$)`, "gi"))]
      .some(match => statesActivity(item.excerpt!.slice(match.index! + subjectName.length)))) return true;
    if (!row.entity_resolved || !row.website_url || !["web", "company"].includes(item.source_type)) return false;
    try {
      const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      if (host(item.source_url) !== host(row.website_url)) return false;
    } catch { return false; }
    return /(?:^|[.;\n])\s*We\b/gi.test(item.excerpt!) && item.excerpt!.split(/[.;\n]/)
      .some(sentence => /^\s*We\b/i.test(sentence) && statesActivity(sentence.replace(/^\s*We\b/i, "")));
  });
  if (activityObservation) return "pass";
  // A stored canonical record whose identity excerpt is bare registry metadata
  // ("name · category · location", no description of its own) has only its
  // curated category as industry evidence, and that stands. A record that
  // carries prose must prove the activity through it (checked above) or stay
  // researchable — a tag echoed back as prose is still tag-only.
  if (
    needsSoftwareActivity &&
    !boundaries.length &&
    !technologyStartup &&
    /\bsoftware(?:\s+(?:compan(?:y|ies)|business(?:es)?|firms?|providers?|developers?|development))?\b/i.test(
      `${row.category ?? ""} ${row.detail ?? ""}`,
    ) &&
    (observations.length === 0 ||
      observations.every(
        (item) => item.source_type === "db" && (item.excerpt ?? "").split(" · ").length <= 3,
      ))
  )
    return "pass";
  return "unknown";
}
