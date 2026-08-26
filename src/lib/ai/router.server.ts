// Multi-provider AI router. Free / low-cost only (no Lovable AI Gateway).
// Providers: Groq (fast classify), OpenRouter (free models), DeepSeek/GLM/Kimi
// when keys are present. Task-typed routing with automatic fallback.

type Task = "classify" | "extract" | "research" | "expand";

type Provider = {
  id: string;
  available: boolean;
  endpoint: string;
  headers: () => Record<string, string>;
  model: string;
  json?: boolean;
};

// ── Circuit breaker ────────────────────────────────────────────────────────
// Consecutive failures trip a cooldown so dead providers stop costing latency
// on every call; successes clear the count. In-memory per serverless instance.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;
const breaker = new Map<string, { fails: number; until: number }>();

function breakerOpen(id: string): boolean {
  const b = breaker.get(id);
  return !!b && b.until > Date.now();
}

function breakerFail(id: string): void {
  const b = breaker.get(id) ?? { fails: 0, until: 0 };
  b.fails += 1;
  if (b.fails >= BREAKER_THRESHOLD) {
    b.until = Date.now() + BREAKER_COOLDOWN_MS;
    b.fails = 0;
    console.warn(`[ai-router] ${id} cooling down ${BREAKER_COOLDOWN_MS / 1000}s after repeated failures`);
  }
  breaker.set(id, b);
}

function breakerSuccess(id: string): void {
  breaker.delete(id);
}

function providersFor(task: Task): Provider[] {
  const list: Provider[] = [];

  const groq = process.env.GROQ_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;
  const deepseek = process.env.DEEPSEEK_API_KEY;
  const glm = process.env.GLM_API_KEY;
  const moonshot = process.env.MOONSHOT_API_KEY;

  // ---- classify: fast, cheap, JSON-mode preferred -------------------
  if (task === "classify" || task === "extract") {
    if (groq)
      list.push({
        id: "groq:gpt-oss-20b",
        available: true,
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        headers: () => ({ authorization: `Bearer ${groq}`, "content-type": "application/json" }),
        model: "openai/gpt-oss-20b",
        json: true,
      });
    if (groq)
      list.push({
        id: "groq:gpt-oss-120b",
        available: true,
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        headers: () => ({ authorization: `Bearer ${groq}`, "content-type": "application/json" }),
        model: "openai/gpt-oss-120b",
        json: true,
      });
    if (openrouter)
      list.push({
        id: "openrouter:gemma-free",
        available: true,
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        headers: () => ({
          authorization: `Bearer ${openrouter}`,
          "content-type": "application/json",
          "http-referer": "https://scrapivo.app",
          "x-title": "Scrapivo",
        }),
        model: "google/gemma-4-31b-it:free",
        json: true,
      });
    if (openrouter)
      list.push({
        id: "openrouter:llama33-free",
        available: true,
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        headers: () => ({
          authorization: `Bearer ${openrouter}`,
          "content-type": "application/json",
          "http-referer": "https://scrapivo.app",
          "x-title": "Scrapivo",
        }),
        model: "meta-llama/llama-3.3-70b-instruct:free",
        json: true,
      });
    if (openrouter)
      list.push({
        id: "openrouter:mistral-small-free",
        available: true,
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        headers: () => ({
          authorization: `Bearer ${openrouter}`,
          "content-type": "application/json",
          "http-referer": "https://scrapivo.app",
          "x-title": "Scrapivo",
        }),
        model: "mistralai/mistral-small-3.2-24b-instruct:free",
        json: true,
      });
    if (openrouter)
      list.push({
        id: "openrouter:qwen-free",
        available: true,
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        headers: () => ({
          authorization: `Bearer ${openrouter}`,
          "content-type": "application/json",
          "http-referer": "https://scrapivo.app",
          "x-title": "Scrapivo",
        }),
        model: "qwen/qwen3-30b-a3b:free",
        json: true,
      });
  }

  // ---- expand / research: longer-context, better synthesis ----------
  if (task === "expand" || task === "research") {
    if (deepseek)
      list.push({
        id: "deepseek:chat",
        available: true,
        endpoint: "https://api.deepseek.com/chat/completions",
        headers: () => ({
          authorization: `Bearer ${deepseek}`,
          "content-type": "application/json",
        }),
        model: "deepseek-chat",
        json: true,
      });
    if (moonshot)
      list.push({
        id: "moonshot:8k",
        available: true,
        endpoint: "https://api.moonshot.cn/v1/chat/completions",
        headers: () => ({
          authorization: `Bearer ${moonshot}`,
          "content-type": "application/json",
        }),
        model: "moonshot-v1-8k",
        json: true,
      });
    if (glm)
      list.push({
        id: "glm:4-flash",
        available: true,
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        headers: () => ({ authorization: `Bearer ${glm}`, "content-type": "application/json" }),
        model: "glm-4-flash",
        json: true,
      });
    if (openrouter)
      list.push({
        id: "openrouter:glm-free",
        available: true,
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        headers: () => ({
          authorization: `Bearer ${openrouter}`,
          "content-type": "application/json",
          "http-referer": "https://scrapivo.app",
          "x-title": "Scrapivo",
        }),
        model: "z-ai/glm-5.2:free",
        json: true,
      });
    if (openrouter)
      list.push({
        id: "openrouter:deepseek-free",
        available: true,
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        headers: () => ({
          authorization: `Bearer ${openrouter}`,
          "content-type": "application/json",
          "http-referer": "https://scrapivo.app",
          "x-title": "Scrapivo",
        }),
        model: "deepseek/deepseek-chat-v3-0324:free",
        json: true,
      });
    if (groq)
      list.push({
        id: "groq:gpt-oss-120b",
        available: true,
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        headers: () => ({ authorization: `Bearer ${groq}`, "content-type": "application/json" }),
        model: "openai/gpt-oss-120b",
        json: true,
      });
  }

  return list.filter((p) => p.available && !breakerOpen(p.id));
}

export type AiCall = {
  task: Task;
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export async function aiComplete(call: AiCall): Promise<string> {
  const providers = providersFor(call.task);
  if (providers.length === 0) throw new Error("No AI provider keys configured");

  // 24h response cache (content-keyed). Skip when caller wants creative output.
  const { cacheKey, getCached, putCached } = await import("./cache.server");
  const useCache = (call.temperature ?? 0.2) <= 0.4;
  const ck = useCache ? cacheKey(call.task, call.system, call.user) : "";
  if (useCache) {
    const hit = await getCached(ck);
    if (hit) return hit;
  }

  let lastErr: unknown = null;
  for (const p of providers) {
    if (breakerOpen(p.id)) continue;
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

      const res = await fetch(p.endpoint, {
        method: "POST",
        headers: p.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        lastErr = new Error(`${p.id} ${res.status}: ${txt.slice(0, 200)}`);
        breakerFail(p.id);
        continue;
      }
      const j = await res.json();
      const content: string = j.choices?.[0]?.message?.content ?? "";
      if (!content) {
        lastErr = new Error(`${p.id}: empty response`);
        breakerFail(p.id);
        continue;
      }
      breakerSuccess(p.id);
      if (useCache) void putCached(ck, call.task, content);
      return content;
    } catch (err) {
      lastErr = err;
      breakerFail(p.id);
      continue;
    }
  }
  throw lastErr ?? new Error("All AI providers failed");
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
