/**
 * Domain email pattern memory — learn formats from verified hits; probe top-2 first.
 * Pattern from AI Outreach Engine domain_email_patterns; Scrapivo verify remains authority.
 */
import type { PatternId } from "./email-patterns";
import { EMAIL_PATTERNS } from "./email-patterns";

export type DomainPatternRow = {
  domain: string;
  pattern_key: string;
  hit_count: number;
  last_seen_at: string;
};

export type DomainVerifyState = {
  domain: string;
  is_catch_all: boolean;
  risky_streak: number;
  valid_hits: number;
  last_status: string;
  updated_at: string;
};

type PatternMem = Map<string, Map<string, { hit_count: number; last_seen_at: string }>>;
type VerifyMem = Map<string, DomainVerifyState>;

const PATTERN_CACHE: PatternMem = new Map();
const VERIFY_CACHE: VerifyMem = new Map();

function normDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
}

/** In-memory (and optional Supabase) top patterns for a domain. */
export async function getLearnedPatterns(
  domainInput: string,
  opts?: { supabase?: { from: (t: string) => any }; limit?: number },
): Promise<PatternId[]> {
  const domain = normDomain(domainInput);
  if (!domain) return [];
  const limit = opts?.limit ?? 2;

  // Prefer DB when available
  if (opts?.supabase) {
    try {
      const { data } = await opts.supabase
        .from("domain_email_patterns")
        .select("pattern_key, hit_count")
        .eq("domain", domain)
        .order("hit_count", { ascending: false })
        .limit(limit);
      if (data?.length) {
        const ids = data
          .map((r: { pattern_key: string }) => r.pattern_key)
          .filter((k: string) => EMAIL_PATTERNS.some((p) => p.id === k)) as PatternId[];
        // Mirror into memory
        const m = PATTERN_CACHE.get(domain) || new Map();
        for (const row of data as { pattern_key: string; hit_count: number }[]) {
          m.set(row.pattern_key, {
            hit_count: row.hit_count,
            last_seen_at: new Date().toISOString(),
          });
        }
        PATTERN_CACHE.set(domain, m);
        return ids.slice(0, limit);
      }
    } catch {
      /* table may not exist yet */
    }
  }

  const m = PATTERN_CACHE.get(domain);
  if (!m?.size) return [];
  return [...m.entries()]
    .sort((a, b) => b[1].hit_count - a[1].hit_count)
    .map(([k]) => k as PatternId)
    .filter((k) => EMAIL_PATTERNS.some((p) => p.id === k))
    .slice(0, limit);
}

/** Record a verified pattern hit (only call when verify tier is verified). */
export async function recordPatternHit(
  domainInput: string,
  patternKey: string,
  opts?: { supabase?: { from: (t: string) => any } },
): Promise<void> {
  const domain = normDomain(domainInput);
  if (!domain || !patternKey) return;
  const now = new Date().toISOString();
  const m = PATTERN_CACHE.get(domain) || new Map();
  const prev = m.get(patternKey);
  m.set(patternKey, {
    hit_count: (prev?.hit_count ?? 0) + 1,
    last_seen_at: now,
  });
  PATTERN_CACHE.set(domain, m);

  if (opts?.supabase) {
    try {
      const hit = m.get(patternKey)!.hit_count;
      await opts.supabase.from("domain_email_patterns").upsert(
        {
          domain,
          pattern_key: patternKey,
          hit_count: hit,
          last_seen_at: now,
        },
        { onConflict: "domain,pattern_key" },
      );
    } catch {
      /* ignore */
    }
  }
}

export async function getDomainVerifyState(
  domainInput: string,
  opts?: { supabase?: { from: (t: string) => any } },
): Promise<DomainVerifyState | null> {
  const domain = normDomain(domainInput);
  if (!domain) return null;

  if (opts?.supabase) {
    try {
      const { data } = await opts.supabase
        .from("domain_verify_state")
        .select("*")
        .eq("domain", domain)
        .maybeSingle();
      if (data) {
        const row: DomainVerifyState = {
          domain,
          is_catch_all: Boolean(data.is_catch_all),
          risky_streak: data.risky_streak ?? 0,
          valid_hits: data.valid_hits ?? 0,
          last_status: data.last_status ?? "",
          updated_at: data.updated_at ?? new Date().toISOString(),
        };
        VERIFY_CACHE.set(domain, row);
        return row;
      }
    } catch {
      /* ignore */
    }
  }
  return VERIFY_CACHE.get(domain) ?? null;
}

export async function updateDomainVerifyState(
  domainInput: string,
  patch: Partial<Omit<DomainVerifyState, "domain" | "updated_at">>,
  opts?: { supabase?: { from: (t: string) => any } },
): Promise<DomainVerifyState> {
  const domain = normDomain(domainInput);
  const prev = VERIFY_CACHE.get(domain) || {
    domain,
    is_catch_all: false,
    risky_streak: 0,
    valid_hits: 0,
    last_status: "",
    updated_at: new Date().toISOString(),
  };
  const next: DomainVerifyState = {
    ...prev,
    ...patch,
    domain,
    updated_at: new Date().toISOString(),
  };
  VERIFY_CACHE.set(domain, next);

  if (opts?.supabase) {
    try {
      await opts.supabase.from("domain_verify_state").upsert(next, { onConflict: "domain" });
    } catch {
      /* ignore */
    }
  }
  return next;
}

/** Infer pattern id from a full email local-part (best effort). */
export function inferPatternKeyFromEmail(email: string, personName?: string): PatternId | null {
  const local = email.split("@")[0]?.toLowerCase() || "";
  if (!local) return null;
  if (!personName) {
    if (local.includes(".")) return "first.last";
    return "first";
  }
  const parts = personName
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 1) return null;
  const first = parts[0];
  const last = parts[parts.length - 1] || "";
  for (const p of EMAIL_PATTERNS) {
    const built = p.build(first, last);
    if (built && built === local) return p.id;
  }
  if (local === first) return "first";
  if (last && local === `${first}.${last}`) return "first.last";
  if (last && local === `${first[0]}${last}`) return "flast";
  if (last && local === `${first}${last}`) return "firstlast";
  if (last && local === `${first[0]}.${last}`) return "f.last";
  return null;
}

/** Test helper */
export function clearDomainMemoryCaches(): void {
  PATTERN_CACHE.clear();
  VERIFY_CACHE.clear();
}
