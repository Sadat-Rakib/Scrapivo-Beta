// Multi-provider AI router. Free / low-cost only (no Lovable AI Gateway).
//
// WHO the providers are, in WHICH order, now lives in `./providers` as data.
// What lives here is the part that is genuinely behaviour: the response cache,
// the circuit breaker, failure classification, and the failover loop.

import {
  GATEWAYS,
  type AiTask as Task,
  type FailureKind,
  type ModelRef,
  authHeaders,
  baseUrlFor,
  classifyFailure,
  isPermanent,
  keyFor,
  ladderFor,
  refId,
  shouldFailOver,
} from "./providers";

type Provider = {
  id: string;
  /** The gateway this model is reached through — i.e. whose credential is used. */
  gatewayId: string;
  endpoint: string;
  headers: () => Record<string, string>;
  model: string;
  json: boolean;
  /**
   * Fields folded into the request body for this provider alone. Groq's gpt-oss
   * models reason before answering and count those tokens against the budget,
   * so a request with no `reasoning_effort` spends its whole allowance thinking
   * and returns nothing — which Groq then rejects as `json_validate_failed`
   * with an empty `failed_generation`, a 400 that reads like our bug.
   */
  extraBody?: Record<string, unknown>;
};

/** Resolve one registry entry into a callable provider, or null if keyless. */
function resolve(ref: ModelRef): Provider | null {
  const gw = GATEWAYS[ref.gateway];
  if (!gw || !keyFor(gw)) return null;
  const extraBody: Record<string, unknown> = { ...ref.extraBody };
  if (ref.reasoningEffort && gw.capabilities.reasoningEffort) {
    extraBody.reasoning_effort = ref.reasoningEffort;
  }
  return {
    id: refId(ref),
    gatewayId: ref.gateway,
    endpoint: `${baseUrlFor(gw)}/chat/completions`,
    headers: () => authHeaders(gw),
    model: ref.model,
    json: gw.capabilities.jsonMode,
    extraBody: Object.keys(extraBody).length ? extraBody : undefined,
  };
}

// ── Circuit breaker ────────────────────────────────────────────────────────
// Consecutive failures trip a cooldown so dead providers stop costing latency
// on every call; successes clear the count. In-memory per serverless instance.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;
/**
 * Extra attempts at the SAME provider after a transient failure (a gateway
 * 5xx, a dropped connection, a 200 carrying nothing). One, not a loop: a
 * second rejection means the provider is genuinely unwell and the ladder
 * should move on rather than spend the caller's time on a third.
 */
const TRANSIENT_RETRIES = 1;
const TRANSIENT_BACKOFF_MS = 1_500;
type BreakerEntry = { fails: number; until: number; reason?: FailureKind };
const breaker = new Map<string, BreakerEntry>();

function breakerOpen(id: string): boolean {
  const b = breaker.get(id);
  return !!b && b.until > Date.now();
}

/** Why a provider is currently held back, for diagnostics only. */
export function breakerReason(id: string): FailureKind | null {
  const b = breaker.get(id);
  return b && b.until > Date.now() ? (b.reason ?? null) : null;
}

function breakerFail(id: string, reason?: FailureKind): void {
  const b = breaker.get(id) ?? { fails: 0, until: 0 };
  b.fails += 1;
  b.reason = reason;
  if (b.fails >= BREAKER_THRESHOLD) {
    b.until = Date.now() + BREAKER_COOLDOWN_MS;
    b.fails = 0;
    console.warn(`[ai-router] ${id} cooling down ${BREAKER_COOLDOWN_MS / 1000}s after repeated failures`);
  }
  breaker.set(id, b);
}

/**
 * A wrong key and an unserved model id are not transient, so there is nothing
 * to wait for: three strikes would mean three identical rejections before the
 * provider stops being tried, and on a grading run that is three per case.
 * Parked immediately, for longer than any run lasts.
 */
function breakerPermanent(id: string, reason: FailureKind): void {
  breaker.set(id, { fails: 0, until: Date.now() + 24 * 3600_000, reason });
  console.warn(`[ai-router] ${id} unavailable for this run (${reason})`);
}

/**
 * The DAY's allowance is gone. Distinct from `breakerBusy` because waiting
 * cannot help: on the last Gate 1 attempt every call politely waited for a
 * budget that would not refill until the next UTC day, so the run read as an
 * outage and silently spent its whole length on the deterministic fallback.
 */
function breakerQuota(id: string, retryAfter: number | null): void {
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  const until = retryAfter ? Date.now() + retryAfter : midnight.getTime();
  breaker.set(id, { fails: 0, until, reason: "quota_exhausted" });
  console.warn(`[ai-router] ${id} daily quota exhausted; held until ${new Date(until).toISOString()}`);
}

function breakerSuccess(id: string): void {
  breaker.delete(id);
}

/**
 * Gateways whose credential has been accepted at least once in this process.
 *
 * A 401/403 is normally permanent — a wrong key stays wrong — but a gateway
 * that has already answered on this key is telling us something else. Free
 * tiers answer 401/403 mid-run once a concurrency or per-minute limit is
 * crossed, and a single one of those parked a certified model for a day: the
 * fallback battery's remaining probes went unanswered and the model looked
 * disqualified by a credential that had worked six calls earlier. So the rule
 * is about the credential, not the status code — unproven key + auth failure is
 * a misconfiguration, proven key + auth failure is a throttle, held for the
 * seconds a throttle lasts rather than the day a quota does.
 */
const authenticated = new Set<string>();

/**
 * Models that have answered at least once in this process. Same reasoning one
 * level down: `model_missing` for a model id the gateway has already served is
 * a claim we can disprove, and the free tiers make it (NaraRouter returned it
 * for `agnes-3-flash` seven calls into a battery it had been answering).
 */
const served = new Set<string>();

/**
 * A 429 is not an outage. The provider is up, answering, and telling us the
 * minute's budget is spent — so it is held back until the budget refills
 * rather than counted as a failure. Counted as one, three rate limits in a row
 * (trivial on a free tier, where one extraction is a third of the per-minute
 * allowance) parked a perfectly healthy provider for five minutes, and every
 * call for those five minutes went to the deterministic fallback while the
 * logs said "repeated failures".
 *
 * The strike count is deliberately left alone: a provider that is merely busy
 * has not moved any closer to being broken.
 */
function breakerBusy(id: string, retryAfter: number | null): void {
  const wait = Math.min(Math.max(retryAfter ?? 20_000, 1_000), BREAKER_COOLDOWN_MS);
  const b = breaker.get(id) ?? { fails: 0, until: 0 };
  b.until = Math.max(b.until, Date.now() + wait);
  b.reason = "rate_limited";
  breaker.set(id, b);
}

/** `retry-after` is seconds, or an HTTP date. Missing is normal. */
function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(h);
  return Number.isFinite(at) ? at - Date.now() : null;
}

/**
 * The candidates for a task, in order, minus the ones with no key.
 *
 * `pin` restricts the list to one gateway and/or one model. A grading run MUST
 * pin, because "which model answered" is half of what a grade means — and an
 * unpinned run that fails over silently grades a different model than the one
 * the report names.
 *
 * Deliberately NOT filtered by the breaker. Removing cooling-down providers
 * here made an empty list mean two different things, and the caller's guard
 * reported both as "No AI provider keys configured" — so a rate limit was
 * diagnosed for an hour as a missing API key. The call loop skips a cooling
 * provider itself, and can say so.
 */
function providersFor(task: Task, pin?: { gateway?: string; model?: string }): Provider[] {
  let refs = ladderFor(task);
  if (pin?.gateway) refs = refs.filter((r) => r.gateway === pin.gateway);
  if (pin?.model) refs = refs.filter((r) => r.model === pin.model);
  // A pinned pair that the ladder does not carry is still callable: the point
  // of pinning is to measure a candidate BEFORE it is certified into the
  // ladder, so refusing here would make certification impossible.
  if (refs.length === 0 && pin?.gateway && pin.model) {
    refs = [{ gateway: pin.gateway, model: pin.model }];
  }
  return refs.map(resolve).filter((p): p is Provider => p !== null);
}

export type AiCall = {
  task: Task;
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Bound a single HTTP attempt. This is deliberately longer than the
   * observed p90 for reasoning models, but shorter than the platform's
   * multi-minute socket timeout. */
  timeoutMs?: number;
  /**
   * Extra material folded into the cache key. A prompt's own version string
   * belongs here: without it, editing a prompt keeps serving yesterday's
   * answer for 24h and the edit looks like it did nothing.
   */
  cacheSalt?: string;
  /** Skip the cache entirely — for inspectors and graders, which must measure
   *  the current prompt against the live provider, not a stored answer. */
  noCache?: boolean;
  /**
   * How long the caller will wait for a resting provider rather than take the
   * deterministic answer. Only meaningful for batch work (the grader): a user
   * waiting on a request wants the fallback now, not the model in a minute.
   */
  waitForSlotMs?: number;
  /**
   * Restrict the call to one gateway and/or one model id. Grading pins; the
   * app does not. See `providersFor`.
   */
  pin?: { gateway?: string; model?: string };
};

export type AiAttempt = {
  provider: string;
  model: string;
  status: number | null;
  kind: FailureKind | null;
  latencyMs: number;
};

export type AiResult = {
  content: string;
  /** Which provider actually answered, for latency attribution. */
  provider: string | null;
  model: string | null;
  cached: boolean;
  latencyMs: number;
  /** Tokens, when the gateway reports them. Absent is normal, not an error. */
  usage?: { prompt: number | null; completion: number | null };
  /**
   * Every provider tried and why each was passed over. The observability the
   * Gate 1 report needs: "the LLM answered" and "the fourth LLM answered after
   * three quota rejections" are different facts about the same success.
   */
  attempts?: AiAttempt[];
};

export async function aiComplete(call: AiCall): Promise<string> {
  return (await aiCompleteDetailed(call)).content;
}

/** Same call, but reporting who answered and how long it took. */
export async function aiCompleteDetailed(call: AiCall): Promise<AiResult> {
  const startedAt = Date.now();
  const providers = providersFor(call.task, call.pin);
  if (providers.length === 0) {
    throw new Error(
      call.pin
        ? `No configured provider matches pin ${call.pin.gateway ?? "*"}:${call.pin.model ?? "*"}`
        : "No AI provider keys configured",
    );
  }
  const soonestFree = () =>
    Math.min(...providers.map((p) => breaker.get(p.id)?.until ?? 0).filter((t) => t > Date.now()));

  // 24h response cache (content-keyed). Skip when caller wants creative output.
  const { cacheKey, getCached, putCached } = await import("./cache.server");
  const useCache = (call.temperature ?? 0.2) <= 0.4 && !call.noCache;
  const ck = useCache ? cacheKey(call.task, call.system, call.user, call.cacheSalt) : "";
  if (useCache) {
    const hit = await getCached(ck);
    if (hit)
      return {
        content: hit,
        provider: null,
        model: null,
        cached: true,
        latencyMs: Date.now() - startedAt,
      };
  }

  // Every provider is resting at once. Waiting is almost always better than the
  // answer the caller would otherwise get (the deterministic fallback), so a
  // caller that can afford to wait says how long it is willing to.
  if (call.waitForSlotMs && providers.every((p) => breakerOpen(p.id))) {
    const wait = soonestFree() - Date.now();
    if (wait > 0 && wait <= call.waitForSlotMs) {
      await new Promise((r) => setTimeout(r, wait + 250));
    }
  }

  let lastErr: unknown = null;
  let skipped = 0;
  const attempts: AiAttempt[] = [];

  /**
   * One request to one provider, and what the ladder should do next.
   *
   * `again` is the transient case — a gateway 5xx or a dropped connection,
   * where the same provider asked a second time usually answers. It is
   * separate from `next` because the ladder's LAST entry has no next, and a
   * pinned call has no ladder at all: without a retry here, one Cloudflare
   * error page is indistinguishable from the model being wrong.
   */
  type Outcome =
    | { kind: "done"; result: AiResult }
    | { kind: "again"; reason: "server" | "empty" }
    | { kind: "next" }
    | { kind: "stop" };

  const attempt = async (p: Provider): Promise<Outcome> => {
    const attemptedAt = Date.now();
    try {
      const body: Record<string, unknown> = {
        model: p.model,
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: call.user },
        ],
        temperature: call.temperature ?? 0.2,
        max_tokens: call.maxTokens ?? 1024,
      };
      if ((call.json ?? true) && p.json) body.response_format = { type: "json_object" };
      if (p.extraBody) Object.assign(body, p.extraBody);

      const res = await fetch(p.endpoint, {
        method: "POST",
        headers: p.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(call.timeoutMs ?? 120_000),
      });
      if (!res.ok) {
        const txt = await res.text();
        let kind = classifyFailure(res.status, txt);
        if (kind === "auth" && authenticated.has(p.gatewayId)) kind = "rate_limited";
        if (kind === "model_missing" && served.has(p.id)) kind = "rate_limited";
        attempts.push({
          provider: p.id,
          model: p.model,
          status: res.status,
          kind,
          latencyMs: Date.now() - attemptedAt,
        });
        lastErr = new Error(`${p.id} ${res.status} (${kind}): ${txt.slice(0, 200)}`);
        if (isPermanent(kind)) breakerPermanent(p.id, kind);
        else if (kind === "quota_exhausted") breakerQuota(p.id, retryAfterMs(res));
        // A rate limit is not an outage: the provider is up, answering, and
        // telling us this minute's budget is spent. Counted as a failure,
        // three in a row (trivial on a free tier) parked a healthy provider
        // for five minutes.
        else if (kind === "rate_limited") breakerBusy(p.id, retryAfterMs(res));
        else if (kind !== "server") breakerFail(p.id, kind);
        // Our own malformed payload will be rejected by every gateway in turn,
        // so one bug must not become six wasted calls and six tripped breakers.
        if (!shouldFailOver(kind)) return { kind: "stop" };
        return kind === "server" ? { kind: "again", reason: "server" } : { kind: "next" };
      }
      const j = await res.json();
      const content: string = j.choices?.[0]?.message?.content ?? "";
      if (!content) {
        attempts.push({
          provider: p.id,
          model: p.model,
          status: res.status,
          kind: "empty",
          latencyMs: Date.now() - attemptedAt,
        });
        lastErr = new Error(`${p.id}: empty response`);
        return { kind: "again", reason: "empty" };
      }
      attempts.push({
        provider: p.id,
        model: p.model,
        status: res.status,
        kind: null,
        latencyMs: Date.now() - attemptedAt,
      });
      breakerSuccess(p.id);
      authenticated.add(p.gatewayId);
      served.add(p.id);
      if (useCache) void putCached(ck, call.task, content);
      return {
        kind: "done",
        result: {
          content,
          provider: p.id,
          model: p.model,
          cached: false,
          latencyMs: Date.now() - startedAt,
          usage: {
            prompt: j.usage?.prompt_tokens ?? null,
            completion: j.usage?.completion_tokens ?? null,
          },
          attempts,
        },
      };
    } catch (err) {
      attempts.push({
        provider: p.id,
        model: p.model,
        status: null,
        kind: "server",
        latencyMs: Date.now() - attemptedAt,
      });
      lastErr = err;
      return { kind: "again", reason: "server" };
    }
  };

  ladder: for (const p of providers) {
    if (breakerOpen(p.id)) {
      skipped++;
      attempts.push({
        provider: p.id,
        model: p.model,
        status: null,
        kind: breakerReason(p.id),
        latencyMs: 0,
      });
      continue;
    }
    let retries = TRANSIENT_RETRIES;
    for (;;) {
      const out = await attempt(p);
      if (out.kind === "done") return out.result;
      if (out.kind === "stop") break ladder;
      if (out.kind === "again" && retries > 0) {
        retries--;
        await new Promise((r) => setTimeout(r, TRANSIENT_BACKOFF_MS));
        continue;
      }
      if (out.kind === "again") breakerFail(p.id, out.reason);
      continue ladder;
    }
  }
  if (lastErr) throw lastErr;
  if (skipped > 0) {
    const secs = Math.max(0, Math.ceil((soonestFree() - Date.now()) / 1000));
    throw new Error(
      `All ${skipped} provider(s) for "${call.task}" are rate-limited or cooling down; next free in ~${secs}s`,
    );
  }
  throw new Error("All AI providers failed");
}

export function safeJsonParse<T = unknown>(s: string): T | null {
  if (!s) return null;
  // strip markdown fences if a provider ignored json_format
  const cleaned = s.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // not raw JSON — try to extract the first {...} block below
  }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      // unparseable — fall through to null
    }
  }
  return null;
}
