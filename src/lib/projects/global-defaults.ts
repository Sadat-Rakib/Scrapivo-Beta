// Global defaults layer for the research-context resolver. Reads the
// per-user `project_global_defaults` row (backfilled from `profiles` by
// 20260927100000_projects_ext.sql — the profile data itself is never
// deleted). If no stored row exists yet (backfill raced signup), the layer
// is derived lazily from the live profile row — read-only, no backwrite.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextLayer } from "./context-resolver";

export type ProfileLike = {
  location?: string | null;
  job_title?: string | null;
  full_name?: string | null;
  work_preference?: string | null;
  rate_range?: string | null;
  skills?: string[] | null;
};

/** Map a profiles row into a global context layer (backfill-shape parity). */
export function profileToDefaults(p: ProfileLike): ContextLayer {
  return {
    geography: p.location ?? null,
    offer: {
      ...(p.full_name ? { name: p.full_name } : {}),
      ...(p.job_title ? { what_they_do: p.job_title } : {}),
      ...(p.rate_range ? { rate_range: p.rate_range } : {}),
      ...(p.work_preference ? { work_preference: p.work_preference } : {}),
    },
    ...(p.skills?.length ? { custom: { skills: p.skills } } : {}),
  };
}

/**
 * Load the user's global defaults layer. Prefers the stored
 * project_global_defaults row; falls back to deriving it from the profile
 * row so brand-new users still resolve a global layer.
 */
export async function loadGlobalDefaults(
  client: SupabaseClient,
  userId: string,
): Promise<ContextLayer> {
  const stored = await client
    .from("project_global_defaults")
    .select("context")
    .eq("user_id", userId)
    .maybeSingle();
  if (stored.error) throw new Error(stored.error.message);
  const ctx = (stored.data as { context?: ContextLayer } | null)?.context;
  if (ctx && typeof ctx === "object") return ctx;

  const prof = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (prof.error) throw new Error(prof.error.message);
  return profileToDefaults((prof.data as ProfileLike) ?? {});
}
