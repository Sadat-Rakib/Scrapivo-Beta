/** User-facing search labels — never show raw boolean / dork strings. */

const BOOL_NOISE_RE = /\b(AND|OR|NOT)\b/i;
const DORK_RE = /\b(site|after|before|intitle|inurl|filetype):\S+/i;

export function isBooleanQueryNoise(q: string): boolean {
  const s = (q || "").trim();
  return BOOL_NOISE_RE.test(s) || DORK_RE.test(s) || /[()]{2,}/.test(s);
}

/** Strip operators so Discover never flashes "web developer AND … OR …". */
export function displaySearchLabel(q: string, fallback = "your search"): string {
  let s = toPlainSearchQuery(q);
  if (!s) return fallback;
  if (s.length > 72) s = `${s.slice(0, 69)}…`;
  return s;
}

/** Normalize Scrapy / composer text into plain-English search input. */
export function toPlainSearchQuery(q: string): string {
  const raw = (q || "").trim();
  if (!raw) return "";
  if (isBooleanQueryNoise(raw)) {
    const quoted = raw.match(/"([^"]{2,80})"/);
    if (quoted?.[1]) return quoted[1].trim();
  }
  return raw
    .replace(/\b(AND|OR|NOT)\b/gi, " ")
    .replace(/\b(site|after|before|intitle|inurl|filetype):\S+/gi, " ")
    .replace(/[()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SCRAPY_ACKS = [
  "Roger that, boss.",
  "Got it, captain.",
  "On it, boss.",
  "Copy that, hunting now.",
  "Aye aye, searching.",
  "Locked in. Searching.",
];

/** Strip em/en dashes and tidy spacing so Scrapy never replies with them. */
function stripDashes(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/-{2,}/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Prefer a short action ack over “search for X / try this query” lectures. */
export function scrapyAckReply(cleaned: string): string {
  const t = stripDashes((cleaned || "").trim());
  if (
    !t ||
    t.length > 140 ||
    /\b(search for|try searching|here'?s (a |the )?query|I('ll| will) search|you (should|can) search|SEARCH:)\b/i.test(
      t,
    ) ||
    isBooleanQueryNoise(t)
  ) {
    return SCRAPY_ACKS[Math.floor(Math.random() * SCRAPY_ACKS.length)]!;
  }
  return t;
}
