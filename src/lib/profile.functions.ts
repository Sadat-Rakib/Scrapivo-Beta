import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireMyAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

const PatchSchema = z.object({
  full_name: z.string().optional(),
  job_title: z.string().optional(),
  years_experience: z.number().int().optional().nullable(),
  rate_range: z.string().optional(),
  work_preference: z.string().optional(),
  location: z.string().optional(),
  skills: z.array(z.string()).optional(),
  notify_email: z.boolean().optional(),
  slack_webhook: z.string().optional(),
  sender_name: z.string().max(120).optional(),
  sender_physical_address: z.string().max(500).optional(),
  outreach_from_email: z.string().max(200).optional(),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => PatchSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Upsert, not update: users without an existing profiles row got a silent
    // 0-row UPDATE (client toasted success, nothing persisted). onConflict on
    // id merges into an existing row so columns omitted from the payload
    // (plan, usage counters, outreach settings) are preserved, and .select()
    // returns the row so the client can verify the write actually landed.
    const { data: row, error } = await context.supabase
      .from("profiles")
      .upsert({ id: context.userId, ...data }, { onConflict: "id" })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Profile save did not persist. Please try again.");
    return { ok: true as const, profile: row };
  });
