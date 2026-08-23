/**
 * Scrapivo — long-text readability helpers.
 *
 * Details drawers must present long source text as readable paragraphs:
 * existing paragraph breaks are preserved; a single dense block is split at
 * safe sentence boundaries without changing meaning.
 */

/** Split source text into readable paragraphs. */
export function splitParagraphs(text: string, maxChars = 480): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Preserve author-provided paragraph breaks.
  if (/\n\s*\n/.test(normalized)) {
    return normalized
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean);
  }

  // Single dense block: split at sentence boundaries when long.
  if (normalized.length <= maxChars) return [normalized];

  const sentences = normalized.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [normalized];
  const paragraphs: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current && (current + s).length > maxChars) {
      paragraphs.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) paragraphs.push(current.trim());
  return paragraphs.length ? paragraphs : [normalized];
}
