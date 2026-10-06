/**
 * The provider registry: every LLM gateway this codebase can speak to, declared
 * as data rather than as a branch in a function.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * The router grew its provider list as a run of `if (key) list.push({...})`
 * blocks. That shape has three failure modes we actually hit: the ORDER is
 * spread across a hundred lines so nobody can state it, adding a gateway means
 * editing control flow, and a per-gateway quirk (OpenRouter's referer headers,
 * Groq's `reasoning_effort`) is copied into every entry that needs it and
 * drifts. Here a gateway is one record and a ladder is one ordered list.
 *
 * ── The one rule ──────────────────────────────────────────────────────────
 * A MODEL is certified, not a gateway. A gateway answering 200 says nothing
 * about whether the model behind it can hold a schema, so `UNDERSTANDING_LADDER`
 * names explicit (gateway, model) pairs and the understanding path will use
 * NOTHING else — never "whichever free model responds". See `ai:probe`.
 *
 * ── Secrets ───────────────────────────────────────────────────────────────
 * A key is read from the environment at call time and never returned, logged,
 * cached or embedded in an error. `describeGateway` is the only outward view
 * and reports `configured: boolean`, never a value or a length.
 */

export type Protocol = "openai_chat" | "anthropic_messages";

export type GatewayCapabilities = {
  /** Accepts `response_format: { type: "json_object" }`. */
  jsonMode: boolean;
  /** Accepts `reasoning_effort` (ignored rather than rejected on plain models). */
  reasoningEffort: boolean;
  /** Returns a `usage` block we can attribute tokens with. */
  usageReporting: boolean;
  streaming: boolean;
};

export type Gateway = {
  id: string;
  label: string;
  protocol: Protocol;
  /** Env var holding the secret. Read late, never stored. */
  keyEnv: string;
  /** Env var that overrides `defaultBaseUrl` — deployments move. */
  baseUrlEnv: string;
  defaultBaseUrl: string;
  capabilities: GatewayCapabilities;
  /** Non-secret headers this gateway wants on every request. */
  staticHeaders?: Record<string, string>;
  /**
   * How the key is presented. Most take a Bearer token; the escape hatch is
   * here because two of these gateways document `x-api-key` as an alternative
   * and a third may yet require it.
   */
  auth?: "bearer" | "x-api-key";
};

/**
 * Hosts were established by probing `/v1/models` WITHOUT a key and reading the
 * challenge each one returns — not by copying a base URL out of documentation
 * that might describe a different deployment of the same product name. The
 * challenge is quoted beside each entry because it is the evidence:
 * a gateway that answers `401 unauthorized` to an unauthenticated model list is
 * the gateway, while a name that does not resolve is not.
 */
export const GATEWAYS: Record<string, Gateway> = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    protocol: "openai_chat",
    keyEnv: "GEMINI_API_KEY",
    baseUrlEnv: "GEMINI_BASE_URL",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: false, streaming: false },
  },
  omniroute: {
    id: "omniroute",
    label: "OmniRoute",
    protocol: "openai_chat",
    keyEnv: "OMNIROUTE_API_KEY",
    baseUrlEnv: "OMNIROUTE_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:20128/v1",
    // Only the OpenAI-compatible JSON mode is Gate-1 verified.
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: false, streaming: false },
  },
  nararouter: {
    id: "nararouter",
    label: "NaraRouter",
    protocol: "openai_chat",
    keyEnv: "NARAROUTER_API_KEY",
    baseUrlEnv: "NARAROUTER_BASE_URL",
    // 401 {"error":{"type":"unauthorized","message":"A valid API key is required."}}
    defaultBaseUrl: "https://router.bynara.id/v1",
    capabilities: { jsonMode: true, reasoningEffort: true, usageReporting: true, streaming: true },
  },
  apinex: {
    id: "apinex",
    label: "APInex",
    protocol: "openai_chat",
    keyEnv: "APINEX_API_KEY",
    baseUrlEnv: "APINEX_BASE_URL",
    // 401 {"error":{"message":"Missing API key (Bearer or x-api-key)", ...}}
    defaultBaseUrl: "https://api.apinex.bond/v1",
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
  },
  kiosapi: {
    id: "kiosapi",
    label: "KiosAPI",
    protocol: "openai_chat",
    keyEnv: "KIOSAPI_API_KEY",
    baseUrlEnv: "KIOSAPI_BASE_URL",
    // 200 on an UNAUTHENTICATED /v1/models — the catalogue is public here.
    defaultBaseUrl: "https://api.kiosapi.id/v1",
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
  },
  tokenforge: {
    id: "tokenforge",
    label: "TokenForge",
    protocol: "openai_chat",
    keyEnv: "TOKENFORGE_API_KEY",
    baseUrlEnv: "TOKENFORGE_BASE_URL",
    // 401 {"error":{"code":"UNAUTHORIZED","message":"tfk bearer required"}} on
    // BOTH /v1/chat/completions and /v1/messages. Both surfaces exist, so the
    // choice is ours: `openai_chat`, because it is the shape the rest of this
    // file already speaks and needs no translation.
    defaultBaseUrl: "https://api.tokenforge.cloud/v1",
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
  },
  groq: {
    id: "groq",
    label: "Groq",
    protocol: "openai_chat",
    keyEnv: "GROQ_API_KEY",
    baseUrlEnv: "GROQ_BASE_URL",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    capabilities: { jsonMode: true, reasoningEffort: true, usageReporting: true, streaming: true },
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai_chat",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
    staticHeaders: { "http-referer": "https://scrapivo.app", "x-title": "Scrapivo" },
  },
  // Direct vendor keys. None is set today, so each is inert — they are declared
  // so the long-context ladder below reads as one list rather than as three
  // more `if (key)` branches waiting to be added back.
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai_chat",
    keyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    // Deliberately no `/v1`: DeepSeek serves `/chat/completions` off the apex.
    defaultBaseUrl: "https://api.deepseek.com",
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
  },
  moonshot: {
    id: "moonshot",
    label: "Moonshot",
    protocol: "openai_chat",
    keyEnv: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_BASE_URL",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
  },
  glm: {
    id: "glm",
    label: "GLM (Zhipu)",
    protocol: "openai_chat",
    keyEnv: "GLM_API_KEY",
    baseUrlEnv: "GLM_BASE_URL",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
  },
};

GATEWAYS.mistral = {
  id: "mistral",
  label: "Mistral",
  protocol: "openai_chat",
  keyEnv: "MISTRAL_API_KEY",
  baseUrlEnv: "MISTRAL_BASE_URL",
  defaultBaseUrl: "https://api.mistral.ai/v1",
  capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
};

GATEWAYS.cloudflare = {
  id: "cloudflare",
  label: "Cloudflare Workers AI",
  protocol: "openai_chat",
  keyEnv: "CLOUDFLARE_API_KEY",
  baseUrlEnv: "CLOUDFLARE_BASE_URL",
  defaultBaseUrl: "https://api.cloudflare.com/client/v4/accounts/ai/v1",
  capabilities: { jsonMode: true, reasoningEffort: false, usageReporting: true, streaming: true },
};

export type ModelRef = {
  gateway: string;
  model: string;
  /**
   * Sent only where the gateway accepts it. Understanding is structured
   * extraction, not theorem proving: `low` keeps a reasoning model from
   * spending its whole output budget thinking and returning empty content,
   * which is the failure Groq's gpt-oss models produce as a 400 that reads
   * like our bug.
   */
  reasoningEffort?: "none" | "low" | "medium" | "high";
  /** Anything else this one model needs folded into the body. */
  extraBody?: Record<string, unknown>;
};

export function refId(ref: ModelRef): string {
  return `${ref.gateway}:${ref.model}`;
}

export function parseRef(s: string): ModelRef | null {
  const i = s.indexOf(":");
  if (i <= 0 || i === s.length - 1) return null;
  const gateway = s.slice(0, i);
  if (!GATEWAYS[gateway]) return null;
  return { gateway, model: s.slice(i + 1) };
}

// ── Configuration ─────────────────────────────────────────────────────────

export function baseUrlFor(gw: Gateway): string {
  if (gw.id === "cloudflare" && !process.env[gw.baseUrlEnv]) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (accountId) return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  }
  return (process.env[gw.baseUrlEnv] || gw.defaultBaseUrl).replace(/\/+$/, "");
}

export function keyFor(gw: Gateway): string | null {
  const v = process.env[gw.keyEnv];
  return v && v.trim() ? v.trim() : null;
}

export function isConfigured(gatewayId: string): boolean {
  const gw = GATEWAYS[gatewayId];
  if (gatewayId === "cloudflare") return !!gw && keyFor(gw) !== null && !!process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  return !!gw && keyFor(gw) !== null;
}

/** Everything safe to print. Deliberately carries no length or fingerprint. */
export function describeGateway(gatewayId: string): {
  id: string;
  label: string;
  protocol: Protocol;
  host: string;
  configured: boolean;
} | null {
  const gw = GATEWAYS[gatewayId];
  if (!gw) return null;
  let host = baseUrlFor(gw);
  try {
    host = new URL(host).host;
  } catch {
    // A malformed override is itself worth showing, so keep the raw string.
  }
  return {
    id: gw.id,
    label: gw.label,
    protocol: gw.protocol,
    host,
    configured: keyFor(gw) !== null,
  };
}

export function authHeaders(gw: Gateway): Record<string, string> {
  const key = keyFor(gw);
  const h: Record<string, string> = { "content-type": "application/json", ...gw.staticHeaders };
  if (key) {
    if (gw.auth === "x-api-key") h["x-api-key"] = key;
    else h.authorization = `Bearer ${key}`;
  }
  return h;
}

// ── The understanding ladder ──────────────────────────────────────────────

/**
 * The DEFAULT order, overridable by `UNDERSTANDING_PROVIDER_ORDER` as a
 * comma-separated list of `gateway:model` refs.
 *
 * This list is a claim that each pair has been certified for understanding —
 * see `scripts/ai-probe.mts` and the Gate 1 LLM validation report. A pair is
 * added here only after it has produced a schema-valid frame with the right
 * semantic direction, never because the gateway offers it for free.
 *
 * The ladder is SHORT on purpose. Every rung below is a model that answered
 * the 6-pair adversarial battery (`scripts/understanding-fallback-cert.mts`)
 * without collapsing a direction; four further candidates were measured and
 * left out, and the reasons are worth keeping because each is a different way
 * a free rung fails:
 *
 *   nararouter:agnes-3-flash    6/6 on the canary, then `403 Your plan does
 *                               not include the requested model` mid-battery.
 *                               This account's plan withdraws a free id
 *                               without notice, so the rung would 403 on the
 *                               day it is needed.
 *   nararouter:stepfun-3.7-flash  11/11 answered probes correct, p50 48s with
 *                               a 208s worst case. The rung below this ladder
 *                               is the deterministic extractor, which answers
 *                               in microseconds and is nearly as good — a
 *                               three-minute LLM is worse than no LLM.
 *   groq:openai/gpt-oss-*       fastest of everything measured (p50 0.9s) and
 *                               unmeasurable: the DAILY allowance was spent
 *                               after ONE battery probe. Re-measure on a fresh
 *                               UTC day before restoring it.
 *   apinex:free/*               402 "Daily check-in required to use free
 *                               models" — a human in a dashboard, not a model
 *                               fact.
 *
 * KiosAPI and TokenForge never got as far as a model: the first's credential is
 * refused by every host this account can reach, the second's demands a bearer
 * scheme the key is not. An unmeasured rung is worse than a missing one — it
 * reads as certified.
 */
const DEFAULT_UNDERSTANDING_LADDER: ModelRef[] = [
  // PRIMARY. 12/12 on the battery, p50 11.1s, and the only model that kept
  // "kebab shop" as the category instead of widening it to "restaurant", which
  // is the open-vocabulary behaviour the whole frame is built around.
  { gateway: "nararouter", model: "laguna-s-2.1" },
  // 11/12, p50 8.0s — faster than the primary and a shade less careful: it read
  // "investors funding kelp farming startups" as a search for PEOPLE. Direction
  // and mode were right, so it is a sound fallback and not a primary.
  { gateway: "nararouter", model: "agnes-2.5-flash" },
];

/** Every ref this file tunes, in one place; see `understandingLadder`. */
const KNOWN_TUNING: ModelRef[] = [
  ...DEFAULT_UNDERSTANDING_LADDER,
  { gateway: "groq", model: "openai/gpt-oss-20b", reasoningEffort: "low" },
  { gateway: "groq", model: "openai/gpt-oss-120b", reasoningEffort: "low" },
];

export function understandingLadder(): ModelRef[] {
  const raw = process.env.UNDERSTANDING_PROVIDER_ORDER?.trim();
  const ladder = raw
    ? raw
        .split(",")
        .map((s) => parseRef(s.trim()))
        .filter((r): r is ModelRef => r !== null)
    : DEFAULT_UNDERSTANDING_LADDER;
  // Carry known per-model tuning onto an env-named pair, so pinning a
  // reasoning model from the command line does not silently drop the
  // `reasoning_effort` that keeps it from thinking its budget away. The lookup
  // spans the other task ladders too, because the models most likely to be
  // named by hand here are the ones this ladder just retired — and a Groq
  // gpt-oss id re-pinned without its `low` effort spends its whole allowance
  // thinking and returns nothing.
  return ladder.map((r) => {
    const known = KNOWN_TUNING.find((d) => d.gateway === r.gateway && d.model === r.model);
    return known ? { ...known, ...r } : r;
  });
}

// ── The other task ladders ────────────────────────────────────────────────

/**
 * One ordered list per task, replacing the run of `if (key) push({...})`
 * blocks this file was extracted from. Behaviour is unchanged: the same models
 * in the same order, with the same per-model tuning — the difference is that
 * the order is now readable in one place and a gateway's own quirks live on the
 * gateway.
 *
 * A retired `:free` id answers 404 to every request, which the breaker reads as
 * an outage; three ids here were corpses long enough that the fallback chain
 * was mostly dead and every request quietly landed on the deterministic
 * extractor. Re-check with `GET /models` when a gateway starts failing
 * wholesale — `:free` ids are withdrawn without notice.
 */
const TASK_LADDERS: Record<"classify" | "extract" | "research" | "expand", ModelRef[]> = {
  classify: [
    { gateway: "groq", model: "openai/gpt-oss-20b", reasoningEffort: "low" },
    { gateway: "groq", model: "openai/gpt-oss-120b", reasoningEffort: "low" },
    // Keyed fallback (MISTRAL_API_KEY): the openrouter :free ids below
    // rate-limit hard during long sweeps and left the browser extractor
    // returning empty entity arrays at the exact moment list pages were
    // on screen. Mistral's dev-tier limits survive that load.
    { gateway: "mistral", model: "mistral-small-latest" },
    { gateway: "openrouter", model: "google/gemma-4-31b-it:free" },
    { gateway: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    { gateway: "openrouter", model: "nvidia/nemotron-3.5-lightning:free" },
    { gateway: "openrouter", model: "nex-agi/nex-n2.5-mini:free" },
  ],
  get extract() {
    return TASK_LADDERS.classify;
  },
  research: [
    { gateway: "deepseek", model: "deepseek-chat" },
    { gateway: "moonshot", model: "moonshot-v1-8k" },
    { gateway: "glm", model: "glm-4-flash" },
    { gateway: "openrouter", model: "z-ai/glm-5.2:free" },
    { gateway: "openrouter", model: "deepseek/deepseek-chat-v3-0324:free" },
    { gateway: "groq", model: "openai/gpt-oss-120b", reasoningEffort: "low" },
  ],
  get expand() {
    return TASK_LADDERS.research;
  },
};

export type AiTask = "classify" | "extract" | "research" | "expand" | "understand";

/** The ordered candidates for a task, before any are dropped for a missing key. */
export function ladderFor(task: AiTask): ModelRef[] {
  return task === "understand" ? understandingLadder() : TASK_LADDERS[task];
}

// ── Failure classification ────────────────────────────────────────────────

export type FailureKind =
  | "auth" // 401/403 — the key or the account, not the request. Never retried.
  | "account_action" // 402 — a balance to top up or a daily quest to complete.
  | "model_missing" // this gateway does not serve this model id.
  | "rate_limited" // this minute's budget. Retry soon.
  | "quota_exhausted" // the DAY's budget. Retrying today cannot help.
  | "server" // 5xx or transport.
  | "bad_request" // our payload. Retrying it unchanged cannot help.
  | "empty"; // 200 with nothing in it.

/**
 * A minute-level throttle and a spent daily allowance both arrive as 429, and
 * treating them alike is what made the last Gate 1 run look like an outage:
 * the router waited politely for a budget that would not refill until
 * tomorrow, on every call. The distinction has to come from the body, because
 * no header carries it.
 */
export function classifyFailure(status: number, body: string): FailureKind {
  const b = body.toLowerCase();
  // A 403 that names the PLAN is not a bad credential and not a throttle: the
  // key is valid, the model is real, and the account is simply not entitled to
  // it ("Your plan does not include the requested model."). Filed as
  // `account_action` so the model — not the gateway — is parked, and so the
  // proven-credential rule in the router cannot mistake a standing entitlement
  // for this minute's allowance and retry it all run.
  if ((status === 401 || status === 403) && /\bplan\b|not entitled|upgrade/.test(b))
    return "account_action";
  if (status === 401 || status === 403) return "auth";
  // 402 is a standing condition on the ACCOUNT, and it arrived here as
  // `bad_request` — which reads as "our payload is malformed" and stops the
  // failover loop, so one gateway's unpaid balance suppressed every gateway
  // after it. Two live examples: "Insufficient balance" and "Daily check-in
  // required to use free models".
  if (status === 402) return "account_action";
  if (status === 404 || /model .*(not found|does not exist|unavailable)|unknown model/.test(b))
    return "model_missing";
  if (status === 429) {
    return /per-?day|daily|per day|quota exceeded|out of credits|insufficient|balance/.test(b)
      ? "quota_exhausted"
      : "rate_limited";
  }
  if (status >= 500) return "server";
  // Groq's JSON mode answers 400 when the MODEL failed to produce valid JSON
  // ("json_validate_failed" / "Failed to generate JSON"). The payload was
  // fine; another model can answer it. Filed as an empty answer so the
  // ladder moves on instead of stopping the whole extraction.
  if (status === 400 && /json_validate_failed|failed to generate json/.test(b)) return "empty";
  return "bad_request";
}

/** Is retrying this on ANOTHER provider worthwhile? */
export function shouldFailOver(kind: FailureKind): boolean {
  // `bad_request` is the one that must not fan out: the payload is ours, so
  // the next gateway will reject it too, and trying six of them turns one bug
  // into six wasted calls and six tripped breakers.
  return kind !== "bad_request";
}

/**
 * Should this provider be taken out of the ladder for the rest of the run?
 *
 * `account_action` is here with the two genuinely permanent kinds because the
 * remedy is a human in a dashboard — topping up a balance or completing a
 * daily quest — and nothing a retry does brings that closer. Waiting for it
 * per-call, on a grading run, is three identical rejections per case.
 */
export function isPermanent(kind: FailureKind): boolean {
  return kind === "auth" || kind === "model_missing" || kind === "account_action";
}
