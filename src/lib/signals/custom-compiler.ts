/**
 * WS7B — Custom Signal Compiler V1 (MVP scope; beta spec §20 — NO big DSL).
 *
 * Turns the user's free-text custom signal ("companies with manual
 * onboarding", "founders complaining about spreadsheets") into STRUCTURED
 * SEARCH HYPOTHESES:
 *   observableIndicators — phrases a public post/page about a matching
 *                          company would literally contain
 *   searchQueries        — web queries the deep-signal pass may run
 *   evidenceRules        — what a source must show for an indicator to count
 *   negativeIndicators   — phrases that VETO a hit (disconfirming context)
 *
 * THESE ARE SEARCH HYPOTHESES, NOT FACTS. The compiler never verifies
 * anything and its output never qualifies a lead by itself: every piece of
 * evidence the custom hunter gathers still goes through
 * isVerifiedSignalEvidence (src/lib/signals/deep-pass.server.ts) and then
 * the full, unweakened theorem gate. LLMs compile hypotheses; only verified
 * evidence counts.
 *
 * Two paths, one contract:
 *   - LLM path (one prompt, low temperature, JSON-only): parsed, normalized
 *     and Zod-validated. ANY failure — throw, timeout, unparseable output,
 *     schema mismatch, usefully-empty output — falls back to the
 *     deterministic path. The production call goes through the existing AI
 *     router (aiComplete) exactly like the other LLM-assisted steps.
 *   - Deterministic fallback: quoted phrases + stopword-filtered content
 *     runs + a small association lexicon. Pure and stable (no randomness,
 *     no clock), non-empty for any input >=3 chars.
 *
 * Parent wiring (spec-search.functions.ts — not wired inside this module):
 * read `spec.custom_signal_text`, compile ONCE per pass, and pass the result
 * to runDeepSignalPass via its `customSignal` option.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CustomSignalSchema = z.object({
  observableIndicators: z.array(z.string().min(3)).max(12),
  searchQueries: z.array(z.string().min(3)).max(10),
  evidenceRules: z.array(z.string().min(3)).max(8),
  negativeIndicators: z.array(z.string()).max(8),
});

export type CompiledCustomSignal = z.infer<typeof CustomSignalSchema>;

/** Typed failure for empty/nonsense input (the ONLY case compile rejects). */
export class CustomSignalCompileError extends Error {
  readonly code = "custom_signal_input_invalid";
  constructor(message: string) {
    super(message);
    this.name = "CustomSignalCompileError";
  }
}

export interface CompileCustomSignalOptions {
  /**
   * Injectable LLM (tests/adapters). Receives the full compile prompt and
   * returns the raw model text. Omitted → the production AI router.
   */
  signal?: (prompt: string) => Promise<string>;
  /** Wall-clock bound for the LLM path (default 12s). Timeout → fallback. */
  signalTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------

const DEFAULT_SIGNAL_TIMEOUT_MS = 12_000;

const COMPILE_SYSTEM_PROMPT =
  "You compile a user's custom demand signal into structured search " +
  "hypotheses as JSON. You never verify claims and never invent facts; you " +
  "only propose what to search for and what a public source would have to " +
  "say for the indicator to count. Output JSON only, no commentary.";

function buildCompilePrompt(userSignalText: string): string {
  return [
    'Custom signal from the user (verbatim): """',
    userSignalText,
    '"""',
    "",
    "Compile it into JSON with EXACTLY these keys:",
    "{",
    '  "observableIndicators": string[], // 3-12 SHORT phrases a public post or page about a matching company/person would literally contain (extractive words, not abstractions)',
    '  "searchQueries": string[],        // 3-10 web search queries that would surface such posts or pages',
    '  "evidenceRules": string[],        // up to 8 rules for when a source counts as showing the indicator',
    '  "negativeIndicators": string[]    // up to 8 phrases meaning the source does NOT show the signal (e.g. the problem is already solved)',
    "}",
    "Rules: every string 3+ characters; phrases in the user's own vocabulary; no commentary; JSON only.",
  ].join("\n");
}

/** Mirror of the router's safeJsonParse (fence strip + first {...} block). */
function extractJsonBlock(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(cleaned);
  if (direct) return direct;
  const m = cleaned.match(/\{[\s\S]*\}/);
  return m ? attempt(m[0]) : null;
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((s) => s.length > 0);
}

/**
 * Normalize a raw LLM answer into the schema's shape (trim, drop junk, cap
 * lengths) then validate. Returns null when the answer is unusable — the
 * caller falls back rather than trusting a malformed compile.
 */
function fromLlmOutput(raw: string): CompiledCustomSignal | null {
  const json = extractJsonBlock(raw);
  if (!json) return null;
  const candidate = {
    observableIndicators: coerceStringArray(json.observableIndicators)
      .filter((s) => s.length >= 3)
      .slice(0, 12),
    searchQueries: coerceStringArray(json.searchQueries)
      .filter((s) => s.length >= 3)
      .slice(0, 10),
    evidenceRules: coerceStringArray(json.evidenceRules)
      .filter((s) => s.length >= 3)
      .slice(0, 8),
    negativeIndicators: coerceStringArray(json.negativeIndicators).slice(0, 8),
  };
  const parsed = CustomSignalSchema.safeParse(candidate);
  if (!parsed.success) return null;
  // Uselessly empty (e.g. the model answered only negatives) → fallback.
  if (!parsed.data.observableIndicators.length || !parsed.data.searchQueries.length)
    return null;
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Deterministic fallback — pure, stable, never empty for input >=3 chars
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "with", "without", "that", "who",
  "whom", "whose", "which", "for", "of", "in", "on", "at", "to", "from",
  "by", "about", "into", "over", "under", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "should", "can", "could", "may", "might", "their", "there",
  "they", "them", "its", "it", "this", "these", "those", "using", "use",
  "uses", "still", "yet", "also", "very", "really", "some", "any", "all",
]);

/** Entity kinds that are never informative indicators on their own. */
const GENERIC_NOUNS = new Set([
  "company", "companies", "business", "businesses", "people", "person",
  "founder", "founders", "startup", "startups", "team", "teams", "client",
  "clients", "customer", "customers", "firm", "firms", "agency", "agencies",
  "owner", "owners", "shop", "shops", "store", "stores", "organization",
  "organizations",
]);

/**
 * Tiny association lexicon: single content tokens → observable phrases.
 * Deliberately small and static (deterministic, no model at fallback time).
 */
const LEXICON: Record<string, string[]> = {
  manual: ["manual process", "done by hand", "manual entry"],
  onboarding: ["onboarding step", "onboarding process", "client intake"],
  spreadsheet: ["spreadsheet", "excel", "google sheets"],
  complaining: ["complains about", "frustrated with", "tired of"],
  complaint: ["complains about", "frustrated with", "tired of"],
  paperwork: ["paperwork", "paper form", "manual filing"],
  outdated: ["outdated process", "legacy process", "old system"],
  invoice: ["invoice", "invoicing", "manual billing"],
  invoicing: ["invoicing", "manual billing", "billing process"],
  bookkeeping: ["bookkeeping", "manual books", "accounting by hand"],
  chasing: ["chasing", "follow up", "manual reminders"],
  tracking: ["tracking", "manual log", "keeping track"],
  scheduling: ["scheduling", "appointment booking", "calendar juggling"],
  dispatch: ["dispatch", "dispatching", "scheduling jobs"],
  quote: ["quote", "quoting", "estimates"],
  quoting: ["quoting", "estimates", "price quote"],
  hiring: ["hiring", "open role", "now hiring"],
  growing: ["growing", "scaling up", "expanding"],
  overwhelmed: ["overwhelmed", "swamped", "too much work"],
};

/** Simple plural → singular (enough for the lexicon; no real stemmer). */
function singularize(token: string): string {
  if (token.length >= 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length >= 4 && token.endsWith("s") && !token.endsWith("ss"))
    return token.slice(0, -1);
  return token;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Contiguous non-stopword runs, e.g. "companies with manual onboarding" → ["companies", "manual onboarding"]. */
function contentRuns(text: string): string[] {
  const runs: string[] = [];
  let current: string[] = [];
  for (const token of tokenize(text)) {
    if (STOPWORDS.has(token)) {
      if (current.length) runs.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length) runs.push(current.join(" "));
  return runs;
}

/** Deterministic indicators: quoted phrases → content runs → lexicon. */
function fallbackIndicators(text: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim().toLowerCase();
    if (v.length >= 3 && !out.includes(v)) out.push(v);
  };

  // 1. Quoted phrases are the user's own words — strongest hypothesis.
  //    Double quotes only (straight or curly); apostrophes are not quotes.
  for (const m of text.matchAll(/["“”]([^"“”]{3,})["“”]/g)) push(m[1]!);

  // 2. Content runs: multi-token runs first, then informative single nouns.
  const runs = contentRuns(text);
  for (const run of runs) if (run.includes(" ")) push(run);
  for (const run of runs) {
    if (run.includes(" ")) continue;
    const token = singularize(run);
    if (!GENERIC_NOUNS.has(token) && !GENERIC_NOUNS.has(run)) push(run);
  }

  // 3. Lexicon expansion of content tokens.
  for (const token of tokenize(text)) {
    for (const phrase of LEXICON[singularize(token)] ?? []) push(phrase);
  }

  // Nonsense input (no usable tokens): the verbatim text is the only honest
  // hypothesis. Non-empty guaranteed for any input >=3 chars.
  if (!out.length) push(text);
  return out.slice(0, 12);
}

function fallbackSearchQueries(text: string, indicators: string[]): string[] {
  const out: string[] = [];
  const push = (q: string) => {
    const v = q.trim();
    if (v.length >= 3 && !out.includes(v) && out.length < 10) out.push(v);
  };
  push(text);
  const TEMPLATES = ['"looking for"', "hiring", '"we need"'];
  for (const ind of indicators) {
    for (const t of TEMPLATES) {
      push(`${ind} ${t}`);
      if (out.length >= 10) return out;
    }
  }
  return out;
}

function deterministicFallback(text: string): CompiledCustomSignal {
  const indicators = fallbackIndicators(text);
  return {
    observableIndicators: indicators,
    searchQueries: fallbackSearchQueries(text, indicators),
    evidenceRules: ["public post or page states the indicator for the subject"],
    negativeIndicators: [],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Compile a user's custom-signal text into search hypotheses. Never throws
 * for input >=3 chars — every LLM failure lands on the deterministic
 * fallback — and throws CustomSignalCompileError only for empty/nonsense
 * input (<3 chars after trim).
 */
export async function compileCustomSignal(
  userSignalText: string,
  opts: CompileCustomSignalOptions = {},
): Promise<CompiledCustomSignal> {
  const text = typeof userSignalText === "string" ? userSignalText.trim() : "";
  if (text.length < 3) {
    throw new CustomSignalCompileError(
      `custom signal text must be at least 3 characters (got ${text.length})`,
    );
  }

  const timeoutMs = Math.max(
    50,
    Math.floor(opts.signalTimeoutMs ?? DEFAULT_SIGNAL_TIMEOUT_MS),
  );
  const prompt = buildCompilePrompt(text);

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const run: Promise<string> = opts.signal
      ? Promise.resolve().then(() => opts.signal!(prompt)).then((r) => r ?? "")
      : (async () => {
          const { aiComplete } = await import("@/lib/ai/router.server");
          return aiComplete({
            task: "classify",
            system: COMPILE_SYSTEM_PROMPT,
            user: prompt,
            json: true,
            temperature: 0.1,
            maxTokens: 800,
            timeoutMs,
            cacheSalt: "custom-signal-compiler-v1",
          });
        })();
    const raw = await Promise.race([
      run,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("custom signal compile timed out")), timeoutMs);
      }),
    ]);
    const compiled = fromLlmOutput(raw);
    if (compiled) return compiled;
  } catch {
    // Any LLM failure (throw/timeout/unparseable/invalid) is a fallback
    // trigger, never a hard error — the deterministic compile always works.
  } finally {
    if (timer) clearTimeout(timer);
  }
  return deterministicFallback(text);
}
