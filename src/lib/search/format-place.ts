/**
 * Compose a place string without repeating equivalent tokens
 * (e.g. "Alberta, AB, Alberta, CA" → "Alberta, CA").
 */
export function formatPlace(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t) continue;
    // Split commas inside a part so "Alberta, AB" doesn't re-add Alberta later.
    for (const piece of t.split(/,\s*/)) {
      const p = piece.trim();
      if (!p) continue;
      const key = p.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/gi, "");
      if (!key || seen.has(key)) continue;
      // Soft-alias common province/state abbreviations against already-seen names
      // is intentionally not attempted here — token equality only.
      seen.add(key);
      out.push(p);
    }
  }
  return out.join(", ");
}

/** Flag rows that share the same phone + address blob (soft duplicate). */
export function markSoftDuplicates<
  T extends { phone?: string | null; detail?: string | null; soft_duplicate?: boolean },
>(rows: T[]): T[] {
  const counts = new Map<string, number>();
  const keyOf = (r: T) => {
    const phone = (r.phone ?? "").replace(/\D+/g, "");
    const detail = (r.detail ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (phone.length < 7 || !detail) return "";
    return `${phone}|${detail}`;
  };
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return rows.map((r) => {
    const k = keyOf(r);
    if (k && (counts.get(k) ?? 0) > 1) return { ...r, soft_duplicate: true };
    return r;
  });
}
