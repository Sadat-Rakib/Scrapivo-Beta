/**
 * Scrapivo — lossless populated-field walker.
 *
 * Flattens any source record into its every non-null, non-empty leaf value
 * (nested objects become dotted keys). Powers the Details "Full Record"
 * section and the dev-mode visible-field audit so no populated source value
 * can be silently lost between normalization and render.
 *
 * Keys are lossless; VALUES are humanized for display:
 *   - booleans render as "Yes" / "No"
 *   - object arrays render as readable claims/summaries — never JSON blobs
 */

export interface PopulatedField {
  key: string;
  value: string;
}

const DEFAULT_SKIP = new Set(["_ranking", "_matchMetadata"]);

const hostnameOf = (rawUrl: unknown): string | null => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  try {
    return new URL(rawUrl.trim()).hostname.replace(/^www\./, "") || null;
  } catch {
    return null; // unparseable URL — omit the source hint rather than show junk
  }
};

/** True when an unknown object is an evidence-style claim worth rendering. */
const readClaim = (obj: Record<string, unknown>): string | null => {
  const claim = typeof obj.claim === "string" ? obj.claim.trim() : "";
  if (!claim) return null;
  let out = claim;
  const firstEvidence = Array.isArray(obj.evidence)
    ? (obj.evidence.find((e) => e != null && typeof e === "object") as
        | Record<string, unknown>
        | undefined)
    : undefined;
  const host = hostnameOf(obj.url) ?? hostnameOf(firstEvidence?.url);
  if (host) out += ` (${host})`;
  return out;
};

/** Last-ditch readable rendering for unknown object shapes: their primitive
 *  leaf values, joined. The dotted-key walk still preserves every scalar. */
const summarizeObject = (obj: Record<string, unknown>): string => {
  const parts: string[] = [];
  for (const v of Object.values(obj)) {
    if (v == null) continue;
    if (typeof v === "boolean") parts.push(v ? "Yes" : "No");
    else if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (typeof v === "number") parts.push(String(v));
  }
  return parts.join(", ");
};

const formatLeaf = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map((x) => {
      if (x == null) return null;
      if (typeof x === "boolean") return x ? "Yes" : "No";
      if (typeof x !== "object") return String(x);
      const rec = x as Record<string, unknown>;
      return readClaim(rec) ?? summarizeObject(rec);
    });
    const filled = parts.filter((s): s is string => !!s && !!s.trim());
    if (!filled.length) return null;
    // Plain scalar lists keep the historical ", " join; claim/object bullets
    // separate with "; " so each claim stays visually distinct.
    const hasObjectItems = v.some((x) => x != null && typeof x === "object");
    return filled.join(hasObjectItems ? "; " : ", ");
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
