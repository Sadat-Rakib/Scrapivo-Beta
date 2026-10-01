// Projects: saved search contexts collected by onboarding ("who I am, who I
// need"). The active project's fields are merged into every search as
// structured input. All functions degrade gracefully when the projects table
// hasn't been migrated yet (returns needs_migration so the UI can say so).
//
// Workstream 3 adds the research-context layer on top (additively — the four
// original exports below keep their signatures): project_context, ICPs,
// saved searches, lists, activity, and the global-defaults resolver layer.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import {
  addListItems,
  setDefaultIcp,
  updateProjectContext,
  type ContextPatch,
} from "@/lib/projects/projects-store";
import { loadGlobalDefaults } from "@/lib/projects/global-defaults";
import { resolveContext, applySpecOverrides, type ContextLayer, type SpecLike } from "@/lib/projects/context-resolver";

export type Project = {
  id: string;
  name: string;
  kind: "business" | "freelance";
  business_name: string | null;
  website: string | null;
  about_doc: string | null;
  niche: string | null;
  service: string | null;
  location: string | null;
  audience: "companies" | "agencies" | "people" | "all";
  goal: "jobs" | "clients" | "both";
  experience_level?: "0-1" | "2-4" | "5+" | null;
  work_style?: "remote" | "onsite" | "any" | null;
  is_active: boolean;
  created_at: string;
  // WS3 additive columns.
  description?: string | null;
  purpose?: string | null;
  status?: string | null;
};

const MISSING_TABLE_RE = /relation .*projects.* does not exist|Could not find the table/i;

/** Recursively JSON-safe wire type (TanStack Start validates fn returns). */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** jsonb payloads go over the wire as plain JSON (repo convention: WS1's
 *  search-jobs.functions.ts) — Record<string, unknown> is NOT serializable. */
type WireContext = {
  id?: string;
  project_id: string;
  context_version: number;
  default_icp_id: string | null;
  offer_profile: Json;
  preferred_geographies: Json;
  exclusions: Json;
  preferred_signals: Json;
  messaging_preferences: Json;
  custom_context: Json;
  updated_at: string;
};

type WireIcp = {
  id: string;
  name: string;
  definition: Json;
  is_default: boolean;
  created_at: string;
};

const toWireContext = (row: unknown): WireContext => row as unknown as WireContext;
const toWireIcps = (rows: unknown): WireIcp[] => rows as unknown as WireIcp[];

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("user_id", context.userId)
      .neq("status", "archived")
      .order("created_at", { ascending: true });
    if (error) {
      if (MISSING_TABLE_RE.test(error.message)) {
        return { projects: [] as Project[], needs_migration: true };
      }
      throw new Error(error.message);
    }
    return { projects: (data ?? []) as Project[], needs_migration: false };
  });

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["business", "freelance"]).default("freelance"),
  business_name: z.string().max(120).optional(),
  website: z.string().max(200).optional(),
  about_doc: z.string().max(8000).optional(),
  niche: z.string().max(200).optional(),
  service: z.string().max(200).optional(),
  location: z.string().max(120).optional(),
  audience: z.enum(["companies", "agencies", "people", "all"]).default("companies"),
  goal: z.enum(["jobs", "clients", "both"]).default("both"),
  experience_level: z.enum(["0-1", "2-4", "5+"]).optional(),
  work_style: z.enum(["remote", "onsite", "any"]).optional(),
  // WS3: description/purpose from the "+ New Project" dialog.
  description: z.string().max(2000).optional(),
  purpose: z.string().max(2000).optional(),
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Every new project (including Redo Q&A) becomes the active search context.
    await supabase.from("projects").update({ is_active: false }).eq("user_id", userId);
    const { data: row, error } = await supabase
      .from("projects")
      .insert({ ...data, user_id: userId, is_active: true })
      .select("*")
      .single();
    if (error) {
      if (MISSING_TABLE_RE.test(error.message)) {
        return { project: null, needs_migration: true };
      }
      throw new Error(error.message);
    }
    const project = row as Project;
    // Upsert-on-create: exactly one project_context row per project.
    await supabase.from("project_context").upsert(
      { project_id: project.id },
      { onConflict: "project_id" },
    );
    await recordActivity(supabase, project.id, "project_created", { name: project.name });
    return { project, needs_migration: false };
  });

const UpdateSchema = CreateSchema.partial().extend({ id: z.string().uuid() });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("projects")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Delete a project as a SOFT ARCHIVE — the status column exists in code usage
 * (Project type + projects_ext migration, default 'active'), so archived rows
 * stay recoverable instead of cascading away ICPs/lists/saved searches.
 * Hidden from listProjects / getProjectsOverview. Owner-scoped like
 * updateProject (id + user_id in one filter).
 */
export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update({ status: "archived", is_active: false, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setActiveProject = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("projects").update({ is_active: false }).eq("user_id", userId);
    const { error } = await supabase
      .from("projects")
      .update({ is_active: true })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// WS3 helpers
// ---------------------------------------------------------------------------

/** Direct-insert activity write (caller has already verified ownership). */
async function recordActivity(
  supabase: SupabaseClient,
  projectId: string,
  kind: string,
  detail: Record<string, unknown>,
) {
  const { error } = await supabase.from("project_activity").insert({ project_id: projectId, kind, detail });
  if (error) throw new Error(error.message);
}

/** Verify the project belongs to the caller; returns its id. */
async function requireOwnedProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    // Ownership + existence in one filter — no info leak on foreign ids.
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Project not found");
  return data as { id: string };
}

// ---------------------------------------------------------------------------
// WS3: project read / context
// ---------------------------------------------------------------------------

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { project: null, context: null, icps: [], counts: null };
    const project = row as Project;
    const [ctxRes, icpRes, listRes, savedRes, projListRes] = await Promise.all([
      supabase.from("project_context").select("*").eq("project_id", project.id).maybeSingle(),
      supabase.from("project_icps").select("*").eq("project_id", project.id).order("created_at", { ascending: true }),
      supabase.from("project_lists").select("id,name,description,created_at").eq("project_id", project.id).order("created_at", { ascending: false }),
      supabase.from("project_saved_searches").select("id,name,created_at").eq("project_id", project.id).order("created_at", { ascending: false }),
      supabase.from("project_lists").select("id").eq("project_id", project.id),
    ]);
    if (icpRes.error) throw new Error(icpRes.error.message);
    if (ctxRes.error) throw new Error(ctxRes.error.message);
    if (listRes.error) throw new Error(listRes.error.message);
    if (savedRes.error) throw new Error(savedRes.error.message);
    if (projListRes.error) throw new Error(projListRes.error.message);
    const icps = (icpRes.data ?? []) as Array<Record<string, unknown>>;
    const lists = (listRes.data ?? []) as Array<{ id: string; name: string; description: string | null; created_at: string }>;
    const savedSearches = (savedRes.data ?? []) as Array<{ id: string; name: string; created_at: string }>;
    const listIds = ((projListRes.data ?? []) as Array<{ id: string }>).map((l) => l.id);
    const itemCounts = new Map<string, number>();
    let totalItems = 0;
    if (listIds.length) {
      const itemsRes = await supabase.from("project_list_items").select("id,list_id").in("list_id", listIds);
      if (itemsRes.error) throw new Error(itemsRes.error.message);
      for (const it of (itemsRes.data ?? []) as Array<{ list_id: string }>) {
        itemCounts.set(it.list_id, (itemCounts.get(it.list_id) ?? 0) + 1);
      }
      totalItems = [...itemCounts.values()].reduce((a, b) => a + b, 0);
    }
    return {
      project,
      context: ctxRes.data ? toWireContext(ctxRes.data) : null,
      icps: toWireIcps(icps),
      lists,
      savedSearches,
      counts: {
        lists: lists.length,
        savedSearches: savedSearches.length,
        listItems: totalItems,
        perList: Object.fromEntries(itemCounts),
      },
    };
  });

export const getProjectsOverview = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const projRes = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .neq("status", "archived")
      .order("created_at", { ascending: true });
    if (projRes.error) {
      if (MISSING_TABLE_RE.test(projRes.error.message)) {
        return { projects: [], needs_migration: true };
      }
      throw new Error(projRes.error.message);
    }
    const projects = (projRes.data ?? []) as Project[];
    const ids = projects.map((p) => p.id);
    if (!ids.length) return { projects, needs_migration: false };

    const [listRes, savedRes] = await Promise.all([
      supabase.from("project_lists").select("id,project_id").in("project_id", ids),
      supabase.from("project_saved_searches").select("id,project_id").in("project_id", ids),
    ]);
    if (listRes.error) throw new Error(listRes.error.message);
    if (savedRes.error) throw new Error(savedRes.error.message);
    const lists = (listRes.data ?? []) as Array<{ id: string; project_id: string }>;
    const saved = (savedRes.data ?? []) as Array<{ id: string; project_id: string }>;
    const listIds = lists.map((l) => l.id);
    const items: Array<{ list_id: string }> = [];
    if (listIds.length) {
      const itemRes = await supabase.from("project_list_items").select("id,list_id").in("list_id", listIds);
      if (itemRes.error) throw new Error(itemRes.error.message);
      items.push(...((itemRes.data ?? []) as Array<{ list_id: string }>));
    }
    const listProject = new Map(lists.map((l) => [l.id, l.project_id]));
    const stats = new Map<string, { lists: number; savedSearches: number; prospects: number }>(
      projects.map((p) => [p.id, { lists: 0, savedSearches: 0, prospects: 0 }]),
    );
    for (const l of lists) {
      const s = stats.get(l.project_id);
      if (s) s.lists += 1;
    }
    for (const s of saved) {
      const st = stats.get(s.project_id);
      if (st) st.savedSearches += 1;
    }
    for (const it of items) {
      const pid = listProject.get(it.list_id);
      const st = pid ? stats.get(pid) : undefined;
      if (st) st.prospects += 1;
    }
    return {
      projects: projects.map((p) => ({ ...p, stats: stats.get(p.id) ?? { lists: 0, savedSearches: 0, prospects: 0 } })),
      needs_migration: false,
    };
  });

const ContextPatchSchema = z.object({
  project_id: z.string().uuid(),
  offer_profile: z.record(z.string(), z.unknown()).optional(),
  preferred_geographies: z.array(z.string()).optional(),
  exclusions: z.array(z.string()).optional(),
  preferred_signals: z.array(z.string()).optional(),
  messaging_preferences: z.record(z.string(), z.unknown()).optional(),
  custom_context: z.record(z.string(), z.unknown()).optional(),
  default_icp_id: z.string().uuid().nullable().optional(),
});

export const updateProjectContextFn = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => ContextPatchSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { project_id, ...patch } = data;
    await requireOwnedProject(supabase, userId, project_id);
    // Version bump lives in the store (read-modify-write). If running or
    // queued search_jobs reference this project the UI prompts first — the
    // server only stores the new version.
    const row = await updateProjectContext(supabase, project_id, patch as ContextPatch);
    await recordActivity(supabase, project_id, "context_updated", { context_version: row.context_version });
    return { context: toWireContext(row) };
  });

// ---------------------------------------------------------------------------
// WS3: ICPs
// ---------------------------------------------------------------------------

const IcpSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  definition: z.record(z.string(), z.unknown()).default({}),
});

export const upsertIcp = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => IcpSchema.extend({ id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const payload = {
      project_id: data.project_id,
      name: data.name,
      definition: data.definition,
      updated_at: new Date().toISOString(),
    };
    const { data: row, error } = data.id
      ? await supabase.from("project_icps").update(payload).eq("id", data.id).eq("project_id", data.project_id).select("*").single()
      : await supabase.from("project_icps").insert(payload).select("*").single();
    if (error) throw new Error(error.message);
    await recordActivity(supabase, data.project_id, data.id ? "icp_updated" : "icp_created", { name: data.name });
    return { icp: row };
  });

export const deleteIcp = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const { error } = await supabase
      .from("project_icps")
      .delete()
      .eq("id", data.id)
      .eq("project_id", data.project_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setDefaultIcpFn = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid(), icp_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const out = await setDefaultIcp(supabase, data.project_id, data.icp_id);
    // Keep project_context.default_icp_id in sync (best effort — context row
    // may not exist for pre-migration projects).
    await supabase
      .from("project_context")
      .update({ default_icp_id: data.icp_id })
      .eq("project_id", data.project_id);
    await recordActivity(supabase, data.project_id, "icp_default_set", { icp_id: data.icp_id });
    return out;
  });

// ---------------------------------------------------------------------------
// WS3: saved searches
// ---------------------------------------------------------------------------

export const saveSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        name: z.string().min(1).max(120),
        spec: z.record(z.string(), z.unknown()),
        icp_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const { data: row, error } = await supabase
      .from("project_saved_searches")
      .insert({
        project_id: data.project_id,
        name: data.name,
        spec: data.spec,
        icp_id: data.icp_id ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await recordActivity(supabase, data.project_id, "search_saved", { name: data.name });
    return { savedSearch: row };
  });

export const listSavedSearches = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const { data: rows, error } = await supabase
      .from("project_saved_searches")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { savedSearches: rows ?? [] };
  });

export const deleteSavedSearch = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const { error } = await supabase
      .from("project_saved_searches")
      .delete()
      .eq("id", data.id)
      .eq("project_id", data.project_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// WS3: lists
// ---------------------------------------------------------------------------

export const createList = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const { data: row, error } = await supabase
      .from("project_lists")
      .insert({ project_id: data.project_id, name: data.name, description: data.description ?? null })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await recordActivity(supabase, data.project_id, "list_created", { name: data.name });
    return { list: row };
  });

export const listLists = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const { data: rows, error } = await supabase
      .from("project_lists")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { lists: rows ?? [] };
  });

/** Cross-project lists for the "Add to list…" menu in the results drawer. */
export const listAllLists = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("project_lists")
      .select("id,project_id,name,projects!inner(name)")
      .eq("projects.user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { lists: rows ?? [] };
  });

export const deleteList = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const { error } = await supabase
      .from("project_lists")
      .delete()
      .eq("id", data.id)
      .eq("project_id", data.project_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addListItemsFn = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        list_id: z.string().uuid(),
        items: z
          .array(
            z.object({
              entity_id: z.string().min(1).max(300),
              source_job_id: z.string().uuid().nullable().optional(),
              source_row: z.record(z.string(), z.unknown()).nullable().optional(),
              note: z.string().max(500).nullable().optional(),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const out = await addListItems(supabase, data.list_id, data.items);
    if (out.added > 0) {
      await recordActivity(supabase, data.project_id, "list_items_added", {
        list_id: data.list_id,
        added: out.added,
      });
    }
    return out;
  });

export const listListItems = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        list_id: z.string().uuid(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(25),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Ownership through the join: list → project → user.
    const listRes = await supabase
      .from("project_lists")
      .select("id,project_id,projects!inner(user_id)")
      .eq("id", data.list_id)
      .eq("projects.user_id", userId)
      .maybeSingle();
    if (listRes.error) throw new Error(listRes.error.message);
    if (!listRes.data) throw new Error("List not found");
    const from = data.page * data.pageSize;
    const { data: rows, error, count } = await supabase
      .from("project_list_items")
      .select("*", { count: "exact" })
      .eq("list_id", data.list_id)
      .order("added_at", { ascending: false })
      .range(from, from + data.pageSize - 1);
    if (error) throw new Error(error.message);
    return {
      items: rows ?? [],
      total: count ?? rows?.length ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const removeListItem = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z.object({ list_id: z.string().uuid(), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const listRes = await supabase
      .from("project_lists")
      .select("id,projects!inner(user_id)")
      .eq("id", data.list_id)
      .eq("projects.user_id", userId)
      .maybeSingle();
    if (listRes.error) throw new Error(listRes.error.message);
    if (!listRes.data) throw new Error("List not found");
    const { error } = await supabase
      .from("project_list_items")
      .delete()
      .eq("id", data.id)
      .eq("list_id", data.list_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// WS3: activity
// ---------------------------------------------------------------------------

export const recordProjectActivity = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        kind: z.string().min(1).max(60),
        detail: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    await recordActivity(supabase, data.project_id, data.kind, data.detail);
    return { ok: true };
  });

export const listProjectActivity = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z.object({ project_id: z.string().uuid(), limit: z.number().int().min(1).max(100).default(20) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwnedProject(supabase, userId, data.project_id);
    const { data: rows, error } = await supabase
      .from("project_activity")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { activity: rows ?? [] };
  });

// ---------------------------------------------------------------------------
// WS3: global defaults + resolver plumbing
// ---------------------------------------------------------------------------

export const getGlobalDefaults = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const defaults = await loadGlobalDefaults(supabase, userId);
    // ContextLayer's object fields are jsonb on the wire — Json is the
    // serializable representation.
    return { defaults: defaults as unknown as { [k: string]: Json } };
  });

const ResolveSchema = z.object({
  project_id: z.string().uuid().optional(),
  explicit: z.record(z.string(), z.unknown()).nullable().optional(),
  spec: z.record(z.string(), z.unknown()).nullable().optional(),
});

/**
 * Resolve context for a (project, explicit) pair and optionally merge it
 * into a SearchSpec. Pure resolver logic lives in context-resolver.ts;
 * this fn only gathers the layers.
 */
export const resolveProjectContext = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => ResolveSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const global = await loadGlobalDefaults(supabase, userId);
    let project: ContextLayer | null = null;
    if (data.project_id) {
      await requireOwnedProject(supabase, userId, data.project_id);
      const ctx = await supabase
        .from("project_context")
        .select("*")
        .eq("project_id", data.project_id)
        .maybeSingle();
      if (ctx.error) throw new Error(ctx.error.message);
      const row = (ctx.data ?? null) as Record<string, unknown> | null;
      if (row) {
        project = {
          geography: (row.preferred_geographies as string[] | null)?.[0] ?? null,
          industry: null,
          icp: null,
          exclusions: (row.exclusions as string[] | null) ?? null,
          signals: (row.preferred_signals as string[] | null) ?? null,
          offer: (row.offer_profile as Record<string, unknown> | null) ?? null,
          messaging: (row.messaging_preferences as Record<string, unknown> | null) ?? null,
          custom: (row.custom_context as Record<string, unknown> | null) ?? null,
        };
      }
    }
    const explicit = (data.explicit ?? null) as ContextLayer | null;
    const { resolved, provenance } = resolveContext({ explicit, project, global });
    const spec = data.spec ? applySpecOverrides(data.spec as unknown as SpecLike, resolved) : null;
    return {
      resolved: resolved as unknown as { [k: string]: Json },
      provenance,
      spec: spec as unknown as Json | null,
    };
  });

/* WS3 note for parent: search-jobs creation wiring. search_jobs.project_id
 * exists (plain uuid, no FK). When launching a search inside a project,
 * pass projectId through createSearchJob's payload (src/lib/search-jobs.functions.ts,
 * parent-owned) and stamp project_context_version from
 * getProject().context.context_version — that file is intentionally NOT
 * edited by WS3. */
