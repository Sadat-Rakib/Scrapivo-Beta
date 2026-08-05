import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import {
  runLeadResearch,
  type LeadResearch,
} from "@/lib/research/run-research.server";
import type { VerifiedHook } from "@/lib/research/company-dossier.server";

export type { LeadResearch, VerifiedHook };

const Input = z.object({
  leadUrl: z.string().url(),
  leadTitle: z.string(),
  leadSnippet: z.string(),
  leadPlatform: z.string(),
  leadAuthor: z.string().optional(),
});

export const researchLead = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<LeadResearch> => {
    return runLeadResearch(context.supabase, context.userId, data);
  });
