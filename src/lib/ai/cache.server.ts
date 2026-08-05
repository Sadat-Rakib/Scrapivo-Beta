// Postgres-backed 24h cache for AI responses. Content-keyed by sha256.
import { createHash } from "node:crypto";

export function cacheKey(task: string, system: string, user: string, model?: string): string {
  return createHash("sha256")
    .update(`${task}\u0000${model ?? ""}\u0000${system}\u0000${user}`)
    .digest("hex");
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
