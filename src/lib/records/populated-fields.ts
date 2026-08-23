/**
 * Scrapivo — lossless populated-field walker.
 *
 * Flattens any source record into its every non-null, non-empty leaf value
 * (nested objects become dotted keys). Powers the Details "Full Record"
 * section and the dev-mode visible-field audit so no populated source value
 * can be silently lost between normalization and render.
 */

export interface PopulatedField {
  key: string;
  value: string;
}

const DEFAULT_SKIP = new Set(["_ranking", "_matchMetadata"]);

const formatLeaf = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v
      .map((x) => (x != null && typeof x === "object" ? JSON.stringify(x) : String(x)))
      .filter((s) => s.trim());
    return parts.length ? parts.join(", ") : null;
  }
  return null;
};

export function populatedFields(
  rec: unknown,
  opts?: { skip?: ReadonlySet<string> },
): PopulatedField[] {
  const skip = opts?.skip ?? DEFAULT_SKIP;
  const out: PopulatedField[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (skip.has(key)) continue;
      if (v != null && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, key);
        continue;
      }
      const s = formatLeaf(v);
      if (s) out.push({ key, value: s });
    }
  };
  if (rec != null && typeof rec === "object") walk(rec as Record<string, unknown>, "");
  return out;
}
