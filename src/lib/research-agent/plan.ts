import type { SearchSpec } from "@/lib/search/search-spec";
import type { UnderstandingFrame } from "@/lib/understanding/frame";
import type { RetrievalPlan, SignalType } from "./types";

function field(spec: SearchSpec, name: string): string | null {
  return spec.criteria.find((item) => item.field === name)?.value?.trim() || null;
}

function values(spec: SearchSpec, name: string): string[] {
  return spec.criteria
    .filter((item) => item.field === name)
    .flatMap((item) => item.value.split("|"))
    .map((item) => item.trim())
    .filter(Boolean);
}

function openValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { value?: unknown }).value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function signalType(value: string): SignalType {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (/hir(ing|e)|job_opening/.test(normalized)) return "HIRING";
  if (/seek.*job|looking_for_work/.test(normalized)) return "SEEKING_JOB";
  if (/seek.*service|needs?_service|service_request/.test(normalized)) return "SEEKING_SERVICE";
  if (/fundrais/.test(normalized)) return "FUNDRAISING";
  if (/funded|funding/.test(normalized)) return "RECENTLY_FUNDED";
  if (/expand/.test(normalized)) return "EXPANDING";
  if (/launch/.test(normalized)) return "PRODUCT_LAUNCH";
  if (/no_website/.test(normalized)) return "NO_WEBSITE";
  if (/weak_website/.test(normalized)) return "WEAK_WEBSITE";
  if (/technolog|uses_/.test(normalized)) return "TECHNOLOGY_USAGE";
  if (/role_change/.test(normalized)) return "ROLE_CHANGE";
  if (/recent|activity|current/.test(normalized)) return "RECENT_ACTIVITY";
  return "USER_DEFINED";
}

export function retrievalPlanFromInputs(args: {
  spec: SearchSpec;
  frame?: UnderstandingFrame | null;
  defaultInitialTarget?: number;
  maxTarget?: number;
}): RetrievalPlan {
  const { spec, frame } = args;
  const defaultTarget = args.defaultInitialTarget ?? 10;
  const maxTarget = args.maxTarget ?? 1_000;
  const specQuantity = Number(field(spec, "quantity"));
  const frameQuantity = frame?.quantity;
  const requested = frameQuantity?.requested ?? frameQuantity?.minimum ??
    (Number.isFinite(specQuantity) && specQuantity > 0 ? specQuantity : null);
  const explicitQuantity = requested !== null || frameQuantity?.unlimited === true;
  const targetQuantity = Math.min(
    maxTarget,
    Math.max(1, frameQuantity?.unlimited ? maxTarget : requested ?? defaultTarget),
  );

  const frameLocation = frame?.location;
  const radius = frameLocation?.scope === "within_radius" ? frameLocation.radius : null;
  const radiusKm = radius == null
    ? Number(field(spec, "radius_km")) || null
    : frameLocation?.radius_unit === "miles" ? radius * 1.609344 : radius;
  const excludedFromFrame = frame?.constraints
    .filter((item) => item.negated && /location|city|country/i.test(item.field))
    .flatMap((item) => Array.isArray(item.value) ? item.value : [item.value])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0) ?? [];
  const relation = frame?.relation.type.value ?? field(spec, "relation");
  const signalValues = [
    ...spec.signal_types,
    ...(frame?.evidence.intent_signal_required && relation ? [relation] : []),
  ];
  const signalTypes = [...new Set(signalValues.map(signalType))];
  const temporal = frame?.temporal?.window ?? frame?.temporal?.relation ??
    spec.signal_recency ?? field(spec, "temporal_relation");
  const freshnessRequired = !!(
    frame?.temporal && frame.temporal.relation !== "any" ||
    spec.signal_recency ||
    field(spec, "temporal_relation")
  );

  return {
    spec,
    entity: spec.entity,
    role: openValue(frame?.target.role) ?? field(spec, "role"),
    title: openValue(frame?.target.job_title) ?? field(spec, "title"),
    industry: openValue(frame?.target.industry) ?? field(spec, "industry"),
    category: openValue(frame?.target.category) ?? field(spec, "category"),
    niche: openValue(frame?.target.niche) ?? field(spec, "niche"),
    company: openValue(frame?.organization_context.company) ?? field(spec, "company"),
    location: frameLocation?.canonical ?? frameLocation?.value ?? field(spec, "location"),
    radiusKm,
    excludedLocations: [...new Set([...values(spec, "excluded_location"), ...excludedFromFrame])],
    explicitQuantity,
    targetQuantity,
    initialTarget: explicitQuantity ? targetQuantity : defaultTarget,
    requiredFields: [...new Set([
      ...(frame?.required_fields.map(openValue).filter((item): item is string => !!item) ?? []),
      ...values(spec, "required_field"),
    ])],
    preferredFields: [...new Set([
      ...(frame?.preferred_fields.map(openValue).filter((item): item is string => !!item) ?? []),
      ...values(spec, "preferred_field"),
    ])],
    relation,
    signalRequired: spec.signal_required || frame?.evidence.intent_signal_required === true,
    signalTypes,
    freshnessRequired,
    temporal,
    technology: [...new Set([
      ...(frame?.target.technologies.map(openValue).filter((item): item is string => !!item) ?? []),
      ...values(spec, "technology"),
    ])],
    compoundSubgoals: frame?.compound.subgoals.map((item) => item.raw).filter((item): item is string => !!item) ?? [],
    outputRequirements: frame?.output.map((item) => item.label ?? item.kind) ?? [],
  };
}
