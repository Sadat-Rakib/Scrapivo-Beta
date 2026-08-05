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

function providersFor(task: Task): Provider[] {
  const list: Provider[] = [];

  const groq = process.env.GROQ_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;
  const deepseek = process.env.DEEPSEEK_API_KEY;
  const glm = process.env.GLM_API_KEY;
  const moonshot = process.env.MOONSHOT_API_KEY;

  // ---- classify: fast, cheap, JSON-mode preferred -------------------
  if (task === "classify" || task === "extract") {
    if (groq) list.push({
      id: "groq:llama-3.1-8b",
      available: true,
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      headers: () => ({ authorization: `Bearer ${groq}`, "content-type": "application/json" }),
      model: "llama-3.1-8b-instant",
      json: true,
    });
    if (groq) list.push({
      id: "groq:llama-3.3-70b",
      available: true,
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      headers: () => ({ authorization: `Bearer ${groq}`, "content-type": "application/json" }),
      model: "llama-3.3-70b-versatile",
      json: true,
    });
    if (openrouter) list.push({
      id: "openrouter:deepseek-free",
      available: true,
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      headers: () => ({
        authorization: `Bearer ${openrouter}`,
        "content-type": "application/json",
        "http-referer": "https://scrapivo.app",
        "x-title": "Scrapivo",
      }),
      model: "deepseek/deepseek-chat-v3.1:free",
      json: true,
    });
  }

  // ---- expand / research: longer-context, better synthesis ----------
  if (task === "expand" || task === "research") {
    if (deepseek) list.push({
      id: "deepseek:chat",
      available: true,
      endpoint: "https://api.deepseek.com/chat/completions",
      headers: () => ({ authorization: `Bearer ${deepseek}`, "content-type": "application/json" }),
      model: "deepseek-chat",
      json: true,
    });
    if (moonshot) list.push({
      id: "moonshot:8k",
      available: true,
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
      headers: () => ({ authorization: `Bearer ${moonshot}`, "content-type": "application/json" }),
      model: "moonshot-v1-8k",
      json: true,
    });
    if (glm) list.push({
      id: "glm:4-flash",
      available: true,
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      headers: () => ({ authorization: `Bearer ${glm}`, "content-type": "application/json" }),
      model: "glm-4-flash",
      json: true,
    });
    if (openrouter) list.push({
      id: "openrouter:kimi-free",
      available: true,
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      headers: () => ({
        authorization: `Bearer ${openrouter}`,
        "content-type": "application/json",
        "http-referer": "https://scrapivo.app",
        "x-title": "Scrapivo",
      }),
      model: "moonshotai/kimi-k2:free",
      json: true,
    });
    if (groq) list.push({
      id: "groq:llama-3.3-70b",
      available: true,
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      headers: () => ({ authorization: `Bearer ${groq}`, "content-type": "application/json" }),
      model: "llama-3.3-70b-versatile",
      json: true,
    });
  }

  return list.filter((p) => p.available);
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
    try {
      const body: any = {
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
        continue;
      }
      const j = await res.json();
      const content: string = j.choices?.[0]?.message?.content ?? "";
      if (!content) {
        lastErr = new Error(`${p.id}: empty response`);
        continue;
      }
      if (useCache) void putCached(ck, call.task, content);
      return content;
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw lastErr ?? new Error("All AI providers failed");
}

export function safeJsonParse<T = unknown>(s: string): T | null {
  if (!s) return null;
  // strip markdown fences if a provider ignored json_format
  const cleaned = s.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(cleaned) as T; } catch {}
  // try to extract the first {...} block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]) as T; } catch {} }
  return null;
}
