/**
 * Website href safety (Phase 1.6 audit fix): ~1% of stored websites lack a
 * scheme ("www.example.in") — rendered raw, the link navigates inside the
 * app instead of opening the site. Central choke point: every website href
 * in results UI goes through here. Returns null when there is nothing
 * linkable (callers render nothing — never a dead link).
 */
export function ensureHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const t = url.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  // Bare domain (+ optional path/query): qualify with https.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(t)) return `https://${t}`;
  return null;
}
