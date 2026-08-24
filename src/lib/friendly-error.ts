/**
 * User-facing error text — never raw Zod JSON.
 *
 * TanStack Start serializes a thrown ZodError's `.message`, which is a JSON
 * issue array like `[{"code":"too_big","maximum":80,"path":["name"]}]`. That
 * blob used to land verbatim in toasts. This maps it to plain language.
 */
export function friendlyErrorText(
  e: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw) return fallback;

  // Serialized Zod issue array.
  if (raw.trimStart().startsWith("[") || raw.trimStart().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const issues = Array.isArray(parsed) ? parsed : [parsed];
      const first = issues[0] as
        | { path?: (string | number)[]; message?: string; code?: string; maximum?: number }
        | undefined;
      if (first?.message) {
        const field = Array.isArray(first.path) && first.path.length ? String(first.path[0]) : "";
        const label = field ? `${field.charAt(0).toUpperCase()}${field.slice(1)}` : "That value";
        if (first.code === "too_big") {
          return `${label} is too long${first.maximum ? ` (max ${first.maximum} characters)` : ""}`;
        }
        if (first.code === "too_small") {
          return `${label} is required`;
        }
        return label === "That value" ? first.message : `${label}: ${first.message}`;
      }
    } catch {
      /* not JSON — fall through */
    }
  }

  if (/String must contain at most (\d+) character/i.test(raw)) {
    const m = raw.match(/String must contain at most (\d+)/i);
    return `Text is too long (max ${m?.[1] ?? "80"} characters)`;
  }

  return raw.length > 200 ? fallback : raw;
}
