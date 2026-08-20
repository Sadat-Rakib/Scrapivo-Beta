// =====================================================================
// Query expansion layers (Phase 0, Task 0.3)
//
// Three distinct expansion strategies that feed dork-engine's `relatedRoles`
// and `intentTemplates` params:
//
//   1. Synonym/phrasing expansion  — static, rule-based head-noun synonyms
//      (developer → dev, engineer, programmer, coder).  [pure, offline]
//   2. Role-adjacent expansion     — one LLM call returning 8-10 real-world
//      adjacent job titles, cached aggressively per normalized role so it's a
//      cache-miss-only cost, not a per-search cost.      [LLM + cache]
//   3. Platform-specific phrasing  — a platform → preferred buyer-phrase
//      subset lookup, so Reddit/LinkedIn/Twitter phrasing differ.  [pure]
//
// server module: layer 2 uses the AI router (server-only). Layers 1 & 3 are
// pure and independently testable.
// =====================================================================

import {
  INTENT_TEMPLATES,
  generateDorkQueries,
  type DorkQueryOptions,
  type PlatformScopeKey,
} from "./dork-engine";
import type { ClassifiedQuery } from "./query-classifier";

// ---------------------------------------------------------------------
// Layer 1 — synonym / phrasing expansion (rule-based, pure)
// ---------------------------------------------------------------------
// Head-noun synonym groups. We substitute the *last* word of a role title
// with each synonym to produce phrasing variants that convert differently
// across platforms ("React developer" / "React dev" / "React engineer").
const HEAD_SYNONYMS: Record<string, string[]> = {
  developer: ["developer", "dev", "engineer", "programmer", "coder"],
  dev: ["dev", "developer", "engineer", "programmer"],
  engineer: ["engineer", "developer", "dev"],
  programmer: ["programmer", "developer", "coder", "engineer"],
  designer: ["designer", "design"],
  marketer: ["marketer", "marketing", "growth marketer"],
  consultant: ["consultant", "specialist", "expert", "advisor"],
  specialist: ["specialist", "consultant", "expert"],
  writer: ["writer", "copywriter", "content writer"],
  copywriter: ["copywriter", "writer", "content writer"],
  manager: ["manager", "lead", "coordinator"],
  analyst: ["analyst", "specialist"],
  scientist: ["scientist", "researcher", "engineer"],
  editor: ["editor", "specialist"],
  assistant: ["assistant", "va", "virtual assistant"],
  strategist: ["strategist", "consultant", "specialist"],
};

/**
 * Rule-based synonym expansion of a role/skill string. Returns the input
 * plus phrasing variants (head-noun substituted). Deterministic + deduped.
 */
export function expandSynonyms(role: string): string[] {
  const clean = (role || "").trim().replace(/\s+/g, " ");
  if (!clean) return [];
  const out = new Set<string>([clean]);
  const words = clean.split(" ");
  const head = words[words.length - 1].toLowerCase();
  const syns = HEAD_SYNONYMS[head];
  if (syns) {
    const prefix = words.slice(0, -1).join(" ");
    for (const s of syns) out.add(prefix ? `${prefix} ${s}` : s);
  }
  return Array.from(out);
}

// ---------------------------------------------------------------------
// Layer 3 — platform-specific intent-phrase tuning (pure lookup table)
// ---------------------------------------------------------------------
// Each platform gets the buyer-phrase subset that fits its conventions.
// Reddit r/forhire is terse ("{role} needed"); LinkedIn is formal
// ("we're hiring"/"open role"); Twitter/X is terse; Facebook/Quora lean on
// recommendation phrasing ("anyone know a good"). These reference the
// canonical INTENT_TEMPLATES so there's a single source of truth.
const T = INTENT_TEMPLATES;
export const PLATFORM_INTENT_PHRASES: Record<PlatformScopeKey, string[]> = {
  reddit: [T[6], T[7], T[1], T[2], T[3]], // needed/wanted, need a, hiring a/hiring {role}s
  linkedin_posts: [T[8], T[9], T[10], T[2], T[0]], // we're/we are hiring, open role, need a, looking for
  twitter_x: [T[6], T[7], T[2], T[3]], // needed/wanted, hiring
  facebook_groups: [T[4], T[5], T[0], T[1]], // anyone know a good, recommend, looking for, need a
  quora: [T[4], T[5], T[0]], // recommendation framing
  indie_forums: [T[1], T[0], T[5], T[8]], // need a, looking for, recommend, we're hiring
  discord_public: [T[2], T[3], T[6]], // hiring, needed
  fiverr_public: [T[1], T[0], T[6], T[7]], // need a / looking for / needed
};

/** The preferred buyer-phrase templates for a given platform scope. */
export function phrasesForPlatform(platform: PlatformScopeKey): string[] {
  return PLATFORM_INTENT_PHRASES[platform] ?? INTENT_TEMPLATES;
}

// ---------------------------------------------------------------------
// Layer 2 — role-adjacent expansion via LLM, cached per normalized role
// ---------------------------------------------------------------------
export type CacheStatus = "hit" | "memhit" | "miss" | "skip";
export interface RoleAdjacentResult {
  titles: string[];
  cache: CacheStatus;
}

// Process-level in-memory cache (fast path). Keyed by normalized role. This is
// the first cache tier; the persistent Postgres ai_cache is the second tier so
// the same role recurring across many users' searches stays a cache-miss-only
// LLM cost. (Spec suggested Redis; this project's established free pattern is
// the Postgres-backed ai_cache from ai/router.server.ts, reused here.)
const memCache = new Map<string, string[]>();

export function normalizeRoleKey(role: string): string {
  return (role || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXPAND_SYSTEM =
  `You expand a job role into adjacent real-world job titles for lead discovery. ` +
  `Given a ROLE, return 8-10 distinct, real, hireable adjacent titles someone might ` +
  `use when hiring for the same need (e.g. "AI engineer" → "ML engineer", "LLM engineer", ` +
  `"applied scientist"). No seniority prefixes, no duplicates, no explanations. ` +
  `Respond with strict JSON: {"titles":["...", ...]}. No prose, no markdown.`;

type CompleteFn = (args: { system: string; user: string }) => Promise<string>;

// default completion uses the project AI router ("expand" task, cacheable).
const defaultComplete: CompleteFn = async ({ system, user }) => {
  const { aiComplete } = await import("../ai/router.server");
  return aiComplete({ task: "expand", system, user, json: true, temperature: 0, maxTokens: 400 });
};

// default persistent-cache accessors reuse ai/cache.server (Postgres, 24h).
async function readPersistent(role: string): Promise<string[] | null> {
  try {
    const { cacheKey, getCached } = await import("../ai/cache.server");
    const key = cacheKey("expand", EXPAND_SYSTEM, `ROLE: ${role}`);
    const raw = await getCached(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { titles?: string[] };
    return Array.isArray(parsed?.titles) ? parsed.titles : null;
  } catch {
    return null;
  }
}
async function writePersistent(role: string, titles: string[]): Promise<void> {
  try {
    const { cacheKey, putCached } = await import("../ai/cache.server");
    const key = cacheKey("expand", EXPAND_SYSTEM, `ROLE: ${role}`);
    await putCached(key, "expand", JSON.stringify({ titles }));
  } catch {
    /* best effort */
  }
}

export interface RoleAdjacentDeps {
  complete?: CompleteFn;
  readCache?: (role: string) => Promise<string[] | null>;
  writeCache?: (role: string, titles: string[]) => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Return 8-10 adjacent job titles for `role`, cached aggressively.
 * Cache tiers: in-memory → persistent (Postgres ai_cache) → LLM.
 * Logs an explicit cache hit/miss line (spec acceptance).
 * Dependencies are injectable so the cache logic is unit-testable offline
 * without a live LLM provider / Supabase.
 */
export async function expandRoleAdjacent(
  role: string,
  deps: RoleAdjacentDeps = {},
): Promise<RoleAdjacentResult> {
  const log = deps.log ?? ((m: string) => console.info(m));
  const key = normalizeRoleKey(role);
  if (!key) return { titles: [], cache: "skip" };

  // tier 1: in-memory
  if (memCache.has(key)) {
    log(`[role-expand] cache=memhit role="${key}"`);
    return { titles: memCache.get(key)!, cache: "memhit" };
  }

  // tier 2: persistent
  const read = deps.readCache ?? readPersistent;
  const persisted = await read(key);
  if (persisted && persisted.length) {
    memCache.set(key, persisted);
    log(`[role-expand] cache=hit role="${key}"`);
    return { titles: persisted, cache: "hit" };
  }

  // tier 3: LLM (miss)
  const complete = deps.complete ?? defaultComplete;
  const write = deps.writeCache ?? writePersistent;
  try {
    const raw = await complete({ system: EXPAND_SYSTEM, user: `ROLE: ${role}` });
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { titles?: string[] };
    const titles = Array.from(
      new Set((parsed?.titles ?? []).map((t) => String(t).trim()).filter(Boolean)),
    ).slice(0, 10);
    if (titles.length) {
      memCache.set(key, titles);
      await write(key, titles);
    }
    log(`[role-expand] cache=miss role="${key}" titles=${titles.length}`);
    return { titles, cache: "miss" };
  } catch (err) {
    // No provider key / provider error → degrade gracefully (layers 1+3 still work).
    log(`[role-expand] cache=skip role="${key}" reason="${(err as Error)?.message}"`);
    return { titles: [], cache: "skip" };
  }
}

/** Test-only: clear the in-memory cache tier. */
export function _clearMemCache(): void {
  memCache.clear();
}

// ---------------------------------------------------------------------
// Assembly — combine the three layers into dork-engine inputs
// ---------------------------------------------------------------------
export interface BuildDorkOptions {
  platform?: PlatformScopeKey;
  dateRange?: DorkQueryOptions["dateRange"];
  limit?: number;
  /** include layer-2 LLM adjacent titles (requires provider/cache). */
  useLlm?: boolean;
  deps?: RoleAdjacentDeps;
}

/**
 * Build the fully-expanded `relatedRoles` (layers 1+2) and platform-tuned
 * `intentTemplates` (layer 3) for a classified query, then generate dork
 * queries. When `platform` is omitted, all scopes are used with their own
 * tuned phrasing (dork-engine handles per-scope ordering).
 */
export async function generateExpandedDorkQueries(
  classified: ClassifiedQuery,
  opts: BuildDorkOptions = {},
): Promise<{ queries: string[]; relatedRoles: string[]; cache: CacheStatus }> {
  const role = classified.roleTitle || classified.coreSkill || classified.raw;

  // Layer 1: synonyms of the role + each related skill.
  const related = new Set<string>();
  for (const r of expandSynonyms(role)) if (r.toLowerCase() !== role.toLowerCase()) related.add(r);
  for (const rs of classified.relatedSkills ?? []) {
    for (const r of expandSynonyms(rs)) related.add(r);
  }

  // Layer 2: LLM role-adjacent titles (optional, cached).
  let cache: CacheStatus = "skip";
  if (opts.useLlm) {
    const res = await expandRoleAdjacent(role, opts.deps);
    cache = res.cache;
    for (const t of res.titles) if (t.toLowerCase() !== role.toLowerCase()) related.add(t);
  }

  // Layer 3: platform-tuned templates.
  const intentTemplates = opts.platform ? phrasesForPlatform(opts.platform) : undefined;

  const queries = generateDorkQueries({
    role,
    relatedRoles: Array.from(related),
    platformScope: opts.platform,
    intentTemplates,
    // Layer 3 already selected the platform's preferred phrase subset, so
    // don't let dork-engine re-order it by its default-index priority table.
    platformTunedPhrasing: intentTemplates ? false : undefined,
    dateRange: opts.dateRange,
    limit: opts.limit,
  });

  return { queries, relatedRoles: Array.from(related), cache };
}
