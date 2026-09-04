// Postgres-backed 24h cache for AI responses. Content-keyed by hash.
//
// NOTE: pure-TS FNV-1a on purpose — no `node:crypto` import. This module sits
// in the AI router's import graph, so a node builtin here breaks the browser
// bundle if the graph is ever pulled client-side. Cache keys just cold-miss
// once after this change; no migration needed.
export function cacheKey(task: string, system: string, user: string, model?: string): string {
  const s = `${task}\u0000${model ?? ""}\u0000${system}\u0000${user}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + (i & 0xff)), 0x01000193) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export async function getCached(key: string): Promise<string | null> {
  try {
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    const { data } = await getAdmin()
      .from("ai_cache")
      .select("response, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
    return data.response as string;
  } catch {
    return null;
  }
}

export async function putCached(key: string, task: string, response: string): Promise<void> {
  try {
    const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
    await getAdmin()
      .from("ai_cache")
      .upsert({ cache_key: key, task, response }, { onConflict: "cache_key" });
  } catch {
    /* best effort */
  }
}
