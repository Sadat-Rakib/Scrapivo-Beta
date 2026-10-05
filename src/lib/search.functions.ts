import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

const Context = z.object({
  audience: z.enum(["companies", "agencies", "people", "all"]).optional(),
  goal: z.enum(["jobs", "clients", "both"]).optional(),
  niche: z.string().max(200).optional(),
  service: z.string().max(200).optional(),
  location: z.string().max(120).optional(),
  business: z.string().max(120).optional(),
  experience_level: z.enum(["0-1", "2-4", "5+"]).optional(),
  work_style: z.enum(["remote", "onsite", "any"]).optional(),
});

/**
 * Answers from the clarifying-question flow. Every field optional — the flow is
 * skippable by design, and applyClarifyAnswers fills recommended defaults, so
 * omitting this entirely runs the search a careful operator would have run.
 */
const ClarifyInput = z.object({
  audience: z.enum(["people", "companies", "posts", "all"]).optional(),
  buyer_type: z.enum(["startups", "smb", "agency", "enterprise", "individual", "any"]).optional(),
  geography: z.enum(["global", "us", "na", "eu", "uk", "local"]).optional(),
  experience: z.enum(["0-1", "1-2", "3-4", "5+"]).optional(),
  signal_focus: z.enum(["all", "recommend", "pain", "compare"]).optional(),
  craft: z.string().max(80).optional(),
  local_opportunity: z
    .enum(["any", "no_website", "seo_poor", "has_phone", "sales_ready"])
    .optional(),
  investor_stage: z.enum(["pre-seed", "seed", "series-a", "series-b", "any"]).optional(),
  investor_check: z.enum(["angel", "seed", "growth", "any"]).optional(),
  other: z.record(z.string(), z.string().max(120)).optional(),
});

const Input = z.object({
  query: z.string().min(2).max(300),
  context: Context.optional(),
  clarify: ClarifyInput.optional(),
  /** Search intensity: scrapy = normal, insane = deeper, crazy = maximum. */
  tier: z.enum(["scrapy", "insane", "crazy"]).optional(),
  /** Extended thinking: slower, more careful extraction + verification. */
  thinker: z.boolean().optional(),
});

/** Tier budgets: result caps, score floor adjustment, enrich caps. */
const TIER_CONFIG = {
  scrapy: { poolMul: 1, minScoreBonus: 0, enrichCap: 6, investorCap: 40 },
  insane: { poolMul: 1.5, minScoreBonus: -3, enrichCap: 10, investorCap: 60 },
  crazy: { poolMul: 2, minScoreBonus: -5, enrichCap: 16, investorCap: 100 },
} as const;


export const getRemainingSearches = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, searches_used, searches_reset_at")
      .eq("id", userId)
      .maybeSingle();
    const plan = profile?.plan ?? "free";
    let used = profile?.searches_used ?? 0;
    const resetAt = profile?.searches_reset_at ? new Date(profile.searches_reset_at) : new Date(0);
    if (resetAt < new Date(Date.now() - 86400_000)) used = 0;
    const { isOwnerEmail } = await import("./owner");
    const owner = isOwnerEmail(context.user.email);
    const cap = owner || plan !== "free" ? Infinity : 5;
    // Owner is unlimited — never present an accruing counter as a budget.
    return { plan, used: owner ? 0 : used, cap: cap === Infinity ? null : cap };
  });

/**
 * Classify a query and return clarifying questions WITHOUT searching.
 *
 * Exists so the question flow can run BEFORE results instead of after. The
 * original design showed questions alongside results (refine what you already
 * have), but that means the first search is the wrong one and the user watches
 * it happen — asking first is what was actually wanted.
 *
 * Deliberately cheap: classification only, no source fan-out, no network, no
 * search-quota consumption. Safe to call on every keystroke-completed query.
 */
export const prepareSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().min(2).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const { classifyQuery } = await import("./search/query-classifier");
    const { buildClarifyingQuestions, shouldClarify, applyClarifyAnswers } =
      await import("./search/clarifier");
    const classified = classifyQuery(data.query);
    const needed = shouldClarify(classified);
    const { tokenizeInput } = await import("./search/tokenize-input");
    const prepTokens = tokenizeInput(data.query);
    return {
      needsClarify: needed,
      questions: needed
        ? buildClarifyingQuestions(classified, {
            hasLocation: !!classified.location,
            known: { stage: prepTokens.stage, sector: prepTokens.sector },
          })
        : [],
      // What we'd assume if they skip — shown so the flow never feels like a
      // black box they're forced through.
      defaultSummary: applyClarifyAnswers(classified, {}).summary,
    };
  });
