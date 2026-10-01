/**
 * Fair re-score of the frozen understanding corpus (MVP RC pass).
 *
 * Reads the FROZEN corpus from reports/understanding-forensic/CORPUS.json
 * (never rewritten here) and runs every prompt through the exact deterministic
 * chain Discover uses when the provider is off (understandSearchSpec's
 * no-provider branch), then grades clarification with the SAME canonical
 * decision the SPEC route calls (decideSpecClarification).
 *
 * Scorer mechanics fixes vs reports/understanding-forensic/stress.mts:
 *   S1 spec_entity accepts string | string[] expectations (the frame check
 *      already did; the spec check compared an array with ===).
 *   S2 OR locations are compared structurally: the canonical contract carries
 *      alternatives in frame.locations / spec.locations, not as repeated
 *      `location` criteria.
 *   S3 clarification is graded against decideSpecClarification, the only gate
 *      the SPEC route applies when an UnderstandingFrame is attached. The old
 *      readiness/mode gates run only for frame-less specs.
 *
 * Policy overrides (C) are applied from corpus-policy-overrides.json and are
 * reported separately; raw and mechanics-only scores are always printed.
 *
 * Run: npx tsx reports/mvp-release-candidate/stress.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extractFrameDeterministic } from "../../src/lib/understanding/fallback";
import { validateFrame } from "../../src/lib/understanding/validate";
import { applyClarificationToFrame, frameToSearchSpec } from "../../src/lib/understanding/to-search-spec";
import { decideSpecClarification } from "../../src/lib/search/spec-clarification";
import { ensureCityGazetteer } from "../../src/lib/search/gazetteer.server";

// Same world gazetteer the product registers on the server before understanding.
await ensureCityGazetteer();

type Case = { id: string; family: string; prompt: string; expect: Record<string, any> };
type Override = { id: string; set: Record<string, unknown>; unset?: string[]; policy: string; rationale: string };

const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8").replace(/^\uFEFF/, ""));
const corpus = readJson("../understanding-forensic/CORPUS.json") as { seed: number; cases: Case[] };
const overrides = readJson("./corpus-policy-overrides.json") as { overrides: Override[] };
const overrideById = new Map(overrides.overrides.map((o) => [o.id, o]));

const norm = (x: unknown) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const contains = (x: unknown, y: unknown) => norm(x).includes(norm(y));
const oneOf = (expected: unknown, actual: unknown) => Array.isArray(expected) ? expected.includes(actual) : expected === actual;

type Run = { rows: Array<{ id: string; family: string; query: string; checks: Record<string, boolean>; failed: string[]; question?: string | null; frame?: unknown; spec?: unknown; error?: string }>; score: Record<string, { pass: number; total: number }> };

function grade(cases: Case[], applyOverrides: boolean): Run {
  const score: Run["score"] = {};
  const add = (axis: string, pass: boolean) => { const s = (score[axis] ??= { pass: 0, total: 0 }); s.total++; if (pass) s.pass++; return pass; };
  const rows: Run["rows"] = [];
  for (const c of cases) {
    const o = applyOverrides ? overrideById.get(c.id) : undefined;
    const e: Record<string, any> = { ...c.expect, ...(o?.set ?? {}) };
    for (const key of o?.unset ?? []) delete e[key];
    let frame;
    try { frame = validateFrame(extractFrameDeterministic(c.prompt)).frame; add("extraction_crash", true); }
    catch (error) {
      add("extraction_crash", false);
      rows.push({ id: c.id, family: c.family, query: c.prompt, checks: { extraction_crash: false }, failed: ["extraction_crash"], error: String(error) });
      continue;
    }
    const f = applyClarificationToFrame(frame, {});
    const s = frameToSearchSpec(f);
    const crit = (field: string) => s.criteria.find((x) => x.field === field)?.value;
    const frameLocations = [f.location, ...(f.locations ?? [])].filter(Boolean).map((l: any) => `${l.value} ${l.canonical ?? ""}`);
    const specLocations = [...(s.locations ?? []), ...s.criteria.filter((x) => x.field === "location").map((x) => x.value)];
    const target = [f.target.role?.value, f.target.job_title?.value, f.target.category?.value, f.target.industry?.value, f.target.business_type?.value, f.target.entity_subtype?.value].filter(Boolean).join(" ");
    const checks: Record<string, boolean> = {};
    const check = (axis: string, ok: boolean) => { checks[axis] = add(axis, ok); };
    if (e.task_type) check("task", oneOf(e.task_type, f.task_type.value));
    if (e.entity_type) check("entity", oneOf(e.entity_type, f.target.entity_type.value));
    if (e.entity_subtype) check("subtype", contains(f.target.entity_subtype?.value ?? f.target.category?.value, e.entity_subtype));
    if (e.target) check("subtype", contains(target, e.target));
    if (e.role) check("role", contains(f.target.role?.value ?? f.target.job_title?.value, e.role));
    if (e.category) check("category", contains(f.target.category?.value, e.category));
    if (e.industry) check("industry", contains(f.target.industry?.value ?? f.target.category?.value, e.industry));
    if (e.location) check("location", frameLocations.some((l) => contains(l, e.location)));
    if (e.no_location) check("location", !f.location && !(f.locations ?? []).length);
    if (e.business_model) check("business_model", contains(f.target.business_type?.value ?? crit("business_model"), e.business_model));
    if (e.prospecting_mode) check("mode", oneOf(e.prospecting_mode, f.prospecting_mode.value));
    if (e.relation) check("relation", oneOf(e.relation, f.relation.type.value));
    if (e.direction) check("direction", e.direction === f.relation.direction.value);
    if (e.intent_signal_required !== undefined) check("signal", f.evidence.intent_signal_required === e.intent_signal_required);
    if (e.signal) check("signal", f.evidence.intent_signal_required || s.signal_required);
    if (e.negated) { const words = Array.isArray(e.negated) ? e.negated : [e.negated]; check("negation", words.every((v: string) => f.constraints.some((x) => x.negated && contains(x.field + " " + x.value, v)))); }
    if (e.min_constraints !== undefined) check("filters", f.constraints.length >= e.min_constraints);
    if (e.required_fields) check("contacts_outputs", e.required_fields.every((v: string) => f.required_fields.some((x) => contains(x.value, v))));
    if (e.remote) check("remote", contains(crit("employment"), "remote") || contains(crit("geo_scope"), "worldwide"));
    if (e.technology) check("technology", contains(crit("technology") + " " + f.target.technologies.map((x) => x.value).join(" "), e.technology));
    if (e.salary_min) check("salary", Number(crit("salary_min") ?? 0) >= e.salary_min);
    if (e.no_website !== undefined) check("no_website", (crit("opportunity") === "no_website") === e.no_website);
    if (e.has_website) check("has_website", f.relation.type.value === "has_asset" || s.criteria.some((x) => x.field === "website" && x.value === "true"));
    // S2: alternatives are structural (frame.locations / spec.locations).
    if (e.multi_location) check("multi_location", f.compound.subgoals.length >= 2 || new Set(specLocations.map(norm)).size >= 2 || (f.locations ?? []).length >= 2);
    if (e.placeholder) check("placeholder", f.constraints.some((x) => contains(x.raw, "this much") || contains(x.raw, "around this size")) || s.missing.includes("salary_min") || (s.unresolved ?? []).length > 0);
    if (e.social_freshness) check("social_freshness", f.verification.some((x) => contains(x.raw, "post") || contains(x.label, "post")) || f.enrichment_requirements.some((x) => contains(x.value, "post")) || crit("needs_live") === "true");
    // S3: the SPEC route's only gate when a frame is attached.
    const question = decideSpecClarification(s, false);
    const clarify = !!question;
    if (e.clarification) check("clarification", clarify === (e.clarification === "required"));
    if (e.goal_clarify !== undefined) check("goal_clarification", clarify === e.goal_clarify && (!e.goal_clarify || question?.id === "entity_purpose"));
    if (e.clarification_id) check("clarification_id", question?.id === e.clarification_id);
    // S1: string | string[] entity expectations.
    if (e.entity_type) check("spec_entity", oneOf(e.entity_type, s.entity));
    if (e.location) check("spec_location", specLocations.some((l) => contains(l, e.location)));
    if (e.business_model) check("spec_business_model", contains(crit("business_model"), e.business_model));
    if (e.required_fields) check("spec_required_fields", e.required_fields.every((v: string) => s.criteria.some((x) => contains(x.field + " " + x.value, v))));
    const specChecks = Object.entries(checks).filter(([axis]) => axis.startsWith("spec_"));
    if (specChecks.length) check("spec_preservation", specChecks.every(([, ok]) => ok));
    rows.push({
      id: c.id, family: c.family, query: c.prompt, checks, failed: Object.keys(checks).filter((k) => !checks[k]),
      question: question?.id ?? null,
      frame: { entity: f.target.entity_type.value, location: f.location?.value, locations: (f.locations ?? []).map((l: any) => l.value), category: f.target.category?.value, industry: f.target.industry?.value, role: f.target.role?.value, relation: f.relation.type.value, required_fields: f.required_fields.map((x) => x.value), objective: f.user_context?.objective?.value ?? null },
      spec: { entity: s.entity, locations: s.locations, purpose: s.purpose ?? null, criteria: s.criteria.map((x) => `${x.field}=${x.value}`), missing: s.missing, status: s.status },
    });
  }
  return { rows, score };
}

const mechanics = grade(corpus.cases, false);
const fair = grade(corpus.cases, true);
const full = (r: Run) => r.rows.filter((x) => x.failed.length === 0).length;
const failing = (r: Run) => r.rows.filter((x) => x.failed.length).map((x) => ({ id: x.id, failed: x.failed, question: x.question, query: x.query }));
writeFileSync(new URL("./STRESS_RESULTS.json", import.meta.url), JSON.stringify({
  seed: corpus.seed, total: corpus.cases.length,
  mechanics_fixed: { fullyCorrect: full(mechanics), score: mechanics.score, failing: failing(mechanics) },
  policy_adjusted: { fullyCorrect: full(fair), score: fair.score, failing: failing(fair), overrides_applied: overrides.overrides.map((o) => o.id) },
  rows: fair.rows,
}, null, 2));
console.log(JSON.stringify({ total: corpus.cases.length, mechanicsFixed: full(mechanics), policyAdjusted: full(fair) }));
console.log(JSON.stringify({ mechanicsFailing: failing(mechanics).map((x) => `${x.id}:${x.failed.join("+")}:${x.question ?? "-"}`) }));
console.log(JSON.stringify({ fairFailing: failing(fair).map((x) => `${x.id}:${x.failed.join("+")}:${x.question ?? "-"}`) }));
