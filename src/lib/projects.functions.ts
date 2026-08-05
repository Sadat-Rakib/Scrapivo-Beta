// Projects: saved search contexts collected by onboarding ("who I am, who I
// need"). The active project's fields are merged into every search as
// structured input. All functions degrade gracefully when the projects table
// hasn't been migrated yet (returns needs_migration so the UI can say so).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

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
};

const MISSING_TABLE_RE = /relation .*projects.* does not exist|Could not find the table/i;

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("user_id", context.userId)
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
  kind: z.enum(["business", "freelance"]),
  business_name: z.string().max(120).optional(),
  website: z.string().max(200).optional(),
  about_doc: z.string().max(8000).optional(),
  niche: z.string().max(200).optional(),
  service: z.string().max(200).optional(),
  location: z.string().max(120).optional(),
  audience: z.enum(["companies", "agencies", "people", "all"]),
  goal: z.enum(["jobs", "clients", "both"]),
  experience_level: z.enum(["0-1", "2-4", "5+"]).optional(),
  work_style: z.enum(["remote", "onsite", "any"]).optional(),
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
    return { project: row as Project, needs_migration: false };
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
