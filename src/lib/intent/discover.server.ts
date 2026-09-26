/**
 * Per-candidate signal discovery (Step 4.2) — free sources only.
 *
 * SearXNG dork queries built from the strategy's phrases + candidate
 * context (company, city). Results are matched back to the candidate by
 * name/company tokens — unmatched results are dropped, never attributed.
 * Hard caps: 3 queries and 5 hits per candidate, 30s outer timeout.
 * No keys required (SearXNG self-host); empty source -> empty hits.
 */
import { searchSearxng } from "@/lib/search/searxng.server";
import type { IntentStrategy } from "./strategy";
import { TIER_STRENGTH } from "./strategy";
import type { EvidenceHit } from "./evidence";

export interface IntentCandidate {
  key: string;
  name: string;
  company?: string | null;
  city?: string | null;
  country?: string | null;
}

export const QUERIES_PER_CANDIDATE = 3;
export const HITS_PER_CANDIDATE = 5;
const DISCOVER_TIMEOUT_MS = 30_000;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/** Candidate matches when its name or company surfaces in the result. */
export function resultMatchesCandidate(
  r: { url: string; title: string; content: string },
  c: IntentCandidate,
): boolean {
  const hay = `${r.url} ${r.title} ${r.content}`.toLowerCase();
  const nameToks = tokens(c.name).filter((t) => !COMMON_NAMES.has(t));
  // Full-name mention, or 2+ distinctive tokens, or company token hit.
  if (c.name && hay.includes(c.name.toLowerCase())) return true;
  if (nameToks.filter((t) => hay.includes(t)).length >= 2) return true;
  if (c.company) {
    const co = tokens(c.company).filter((t) => !GENERIC_ORG.has(t));
    if (co.some((t) => hay.includes(t))) return true;
  }
  return false;
}

const COMMON_NAMES = new Set([
  "john", "mike", "michael", "david", "james", "robert", "mary", "jane",
  "smith", "kumar", "singh", "chen", "wang",
]);
const GENERIC_ORG = new Set([
  "inc", "llc", "ltd", "corp", "company", "group", "labs", "studio",
  "agency", "the", "and", "com", "org", "net", "io", "co",
]);

function buildQueries(s: IntentStrategy): Array<{ phrase: string; tier: keyof typeof TIER_STRENGTH; strength: number }> {
  const out: Array<{ phrase: string; tier: keyof typeof TIER_STRENGTH; strength: number }> = [];
  for (const sig of s.signals) {
    for (const phrase of sig.phrases) {
      out.push({ phrase, tier: sig.type, strength: sig.strength });
      if (out.length >= QUERIES_PER_CANDIDATE) return out;
    }
  }
  return out;
}

export async function discoverCandidateEvidence(
  candidate: IntentCandidate,
  strategy: IntentStrategy,
): Promise<EvidenceHit[]> {
  const picked = buildQueries(strategy);
  if (!picked.length) return [];
  // Context is geographic (city/country), NOT the company name: quoted
  // phrase + company returns nothing on any engine, while phrase + city
  // returns a pool the matcher then attributes to the candidate.
  const ctx = [candidate.city, candidate.country].filter(Boolean).join(" ") ||
    candidate.company ||
    "";
  const queries = picked.map((p) => (`"${p.phrase}" ${ctx}`).trim());
  let results;
  try {
    results = await Promise.race([
      searchSearxng(queries, QUERIES_PER_CANDIDATE, "month", "intent"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("intent discovery timeout")), DISCOVER_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return []; // Source down -> no hits, never an error to the user.
  }
  const hits: EvidenceHit[] = [];
  const seen = new Set<string>();
  // Attribute each result to the strongest matching phrase (tier order kept).
  // No phrase matched: weakest tier, never inflated to explicit (T4 fix —
  // the candidate matched, but nothing it said maps to a known pattern).
  const weakest = picked[picked.length - 1];
  for (const r of results) {
    if (hits.length >= HITS_PER_CANDIDATE) break;
    if (!r.url || seen.has(r.url)) continue;
    if (!resultMatchesCandidate(r, candidate)) continue;
    seen.add(r.url);
    const hay = `${r.title} ${r.content}`.toLowerCase();
    let tier = weakest.tier;
    let strength = weakest.strength;
    let phrase = weakest.phrase;
    for (const p of picked) {
      if (hay.includes(p.phrase.toLowerCase())) {
        tier = p.tier;
        strength = p.strength;
        phrase = p.phrase;
        break;
      }
    }
    hits.push({
      tier,
      strength,
      phrase,
      source: "web",
      url: r.url,
      title: r.title,
      excerpt: r.content.slice(0, 280),
      publishedAt: r.publishedDate ?? null,
      freshnessWindow: r.freshnessWindow ?? null,
    });
  }
  return hits;
}
