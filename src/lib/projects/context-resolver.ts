// Research-context resolver (Workstream 3) — PURE, no I/O.
//
// Layer precedence per field: explicit > project > global. A field absent
// from every layer stays absent — defaults are never invented, and an
// unknown/contradicted value is never collapsed into `false` or dropped
// into an opposite bucket. Every resolved field carries provenance so the
// UI can show where a value came from and applySpecOverrides can respect
// what the user's query already said.

export type ContextProvenance = "explicit" | "project" | "global";

/** One layer of research context. All fields optional; null = unset. */
export type ContextLayer = {
  geography?: string | null;
  industry?: string | null;
  icp?: string | null;
  exclusions?: string[] | null;
  signals?: string[] | null;
  offer?: Record<string, unknown> | null;
  messaging?: Record<string, unknown> | null;
  /** Free-form extra fields (arbitrary keys, copied as-is). */
  custom?: Record<string, unknown> | null;
};

export type ResolvedContext = ContextLayer;

export type ProvenanceMap = Record<string, ContextProvenance>;

export type ResolveInput = {
  explicit?: ContextLayer | null;
  project?: ContextLayer | null;
  global?: ContextLayer | null;
};

export type ResolveResult = {
  resolved: ResolvedContext;
  provenance: ProvenanceMap;
};

/** Field keys resolved per-layer, in precedence order. */
const SCALAR_KEYS = ["geography", "industry", "icp"] as const;
const LIST_KEYS = ["exclusions", "signals"] as const;
const OBJECT_KEYS = ["offer", "messaging", "custom"] as const;

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/**
 * Merge explicit > project > global per field. Absent everywhere → absent
 * from the result (no invented defaults). `custom` keys resolve
 * individually with the same precedence, so one layer can contribute
 * `custom.x` and another `custom.y`.
 */
export function resolveContext({ explicit, project, global }: ResolveInput): ResolveResult {
  const layers: Array<[ContextProvenance, ContextLayer | null | undefined]> = [
    ["explicit", explicit],
    ["project", project],
    ["global", global],
  ];

  const resolved: ResolvedContext = {};
  const provenance: ProvenanceMap = {};

  const put = (key: string, value: unknown, source: ContextProvenance) => {
    if (!hasValue(value)) return;
    (resolved as Record<string, unknown>)[key] = value;
    provenance[key] = source;
  };

  for (const key of SCALAR_KEYS) {
    for (const [source, layer] of layers) {
      const v = layer?.[key];
      if (hasValue(v)) {
        put(key, v, source);
        break;
      }
    }
  }

  for (const key of LIST_KEYS) {
    for (const [source, layer] of layers) {
      const v = layer?.[key];
      if (hasValue(v)) {
        put(key, v, source);
        break;
      }
    }
  }

  for (const key of OBJECT_KEYS) {
    // offer/messaging merge key-wise across layers (project beats global per
    // key); explicit wins wholesale — it is what the user just typed.
    const merged: Record<string, unknown> = {};
    let any = false;
    for (const [source, layer] of [...layers].reverse()) {
      const obj = layer?.[key];
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
      for (const [k, v] of Object.entries(obj)) {
        if (!hasValue(v)) continue;
        merged[k] = v;
        provenance[`${key}.${k}`] = source;
        any = true;
      }
    }
    if (any) (resolved as Record<string, unknown>)[key] = merged;
  }

  return { resolved, provenance };
}

// ---------------------------------------------------------------------------
// SearchSpec shaping
// ---------------------------------------------------------------------------

/** Minimal structural subset of SearchSpec (src/lib/search/search-spec.ts) —
 *  the resolver never imports the spec module so it stays dependency-free. */
export type SpecLike = {
  criteria: Array<{ field: string; value: string; stated: boolean; confidence: number }>;
  signal_types?: string[];
  [k: string]: unknown;
};

/** Resolved-context field → SearchSpec criteria field. */
const SPEC_FIELD_MAP: Record<string, string> = {
  geography: "location",
  industry: "industry",
  icp: "icp",
};

/**
 * Merge resolved context into a SearchSpec-shaped object WITHOUT overriding
 * fields the explicit query already set (criteria entries with stated=true
 * are the user's own words — context may only fill gaps). Context-derived
 * criteria are added as stated=false with a mid confidence so downstream
 * scoring treats them as hints, never as verified ask.
 */
export function applySpecOverrides<T extends SpecLike>(spec: T, resolved: ResolvedContext): T {
  const existing = new Map<string, { stated: boolean }>();
  for (const c of spec.criteria ?? []) existing.set(c.field, { stated: !!c.stated });

  const extra = [...(spec.criteria ?? [])];
  const signals: string[] = [];

  for (const [ctxKey, specField] of Object.entries(SPEC_FIELD_MAP)) {
    const v = resolved[ctxKey as keyof ResolvedContext];
    if (!hasValue(v) || typeof v !== "string") continue;
    const prior = existing.get(specField);
    if (prior?.stated) continue; // explicit query wins — never override
    if (prior) continue; // already inferred from the query; leave as-is
    extra.push({ field: specField, value: v.trim(), stated: false, confidence: 0.5 });
  }

  for (const s of resolved.signals ?? []) {
    if (typeof s === "string" && s.trim() && !(spec.signal_types ?? []).includes(s.trim())) {
      signals.push(s.trim());
    }
  }

  return {
    ...spec,
    criteria: extra,
    ...(signals.length ? { signal_types: [...(spec.signal_types ?? []), ...signals] } : {}),
  };
}
