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
    const { error } = await context.supabase.from("profiles").update(data).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
