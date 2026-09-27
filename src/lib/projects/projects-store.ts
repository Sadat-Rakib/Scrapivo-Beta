// Projects store (Workstream 3) — the DB logic behind
// src/lib/projects.functions.ts, split out so it is unit-testable offline
// (same pattern as src/lib/jobs/search-jobs.server.ts). Server fns own
// auth + ownership scoping; every query here is already scoped by the
// caller passing an owned id (server fns verify ownership first).
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectContextRow = {
  id: string;
  project_id: string;
  context_version: number;
  default_icp_id: string | null;
  offer_profile: Record<string, unknown>;
  preferred_geographies: unknown[];
  exclusions: unknown[];
  preferred_signals: unknown[];
  messaging_preferences: Record<string, unknown>;
  custom_context: Record<string, unknown>;
  updated_at: string;
};

export type ContextPatch = Partial<
  Pick<
    ProjectContextRow,
    "default_icp_id" | "offer_profile" | "preferred_geographies" | "exclusions" | "preferred_signals" | "messaging_preferences" | "custom_context"
  >
>;

/**
 * Update project_context, bumping context_version on EVERY update
 * (app-level per the migration note — the server fn owns the bump so the
 * UI can warn about running search_jobs in the same request).
 */
export async function updateProjectContext(
  client: SupabaseClient,
  projectId: string,
  patch: ContextPatch,
): Promise<ProjectContextRow> {
  const cur = await client
    .from("project_context")
    .select("context_version")
    .eq("project_id", projectId)
    .maybeSingle();
  if (cur.error) throw new Error(cur.error.message);
  const nextVersion = ((cur.data as { context_version?: number } | null)?.context_version ?? 0) + 1;

  const res = await client
    .from("project_context")
    .update({ ...patch, context_version: nextVersion, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .select("*")
    .single();
  if (res.error) throw new Error(res.error.message);
  return res.data as ProjectContextRow;
}

export type ListItemInput = {
  entity_id: string;
  source_job_id?: string | null;
  source_row?: Record<string, unknown> | null;
  note?: string | null;
};

/**
 * Add items to a list, deduped on (list_id, entity_id) by the DB unique
 * index. Idempotent: re-adding an existing entity is a no-op for that row
 * (onConflict ignoreDuplicates), never an error.
 */
export async function addListItems(
  client: SupabaseClient,
  listId: string,
  items: ListItemInput[],
): Promise<{ added: number }> {
  if (!items.length) return { added: 0 };
  const rows = items.map((i) => ({
    list_id: listId,
    entity_id: i.entity_id,
    source_job_id: i.source_job_id ?? null,
    source_row: i.source_row ?? null,
    note: i.note ?? null,
  }));
  const res = await client
    .from("project_list_items")
    .upsert(rows, { onConflict: "list_id,entity_id", ignoreDuplicates: true })
    .select("entity_id");
  if (res.error) throw new Error(res.error.message);
  const back = res.data as Array<{ entity_id: string }> | null;
  // upsert + ignoreDuplicates returns only the rows actually inserted.
  return { added: back?.length ?? 0 };
}

/**
 * Flip is_default exclusively: the named ICP becomes the only default for
 * its project (one UPDATE clearing current defaults + one setting target).
 */
export async function setDefaultIcp(
  client: SupabaseClient,
  projectId: string,
  icpId: string,
): Promise<{ ok: true }> {
  const clear = await client
    .from("project_icps")
    .update({ is_default: false })
    .eq("project_id", projectId)
    .eq("is_default", true)
    .select("id");
  if (clear.error) throw new Error(clear.error.message);
  const set = await client
    .from("project_icps")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", icpId)
    .eq("project_id", projectId)
    .select("id");
  if (set.error) throw new Error(set.error.message);
  return { ok: true };
}
