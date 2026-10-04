import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import { registerDerivativeAttachment, registerVerifiedAttachment } from "./attachment-store.server";

/** Client calls this after a successful storage upload. The server verifies
 *  the object exists under the caller's own prefix before registering it. */
export const registerAttachment = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        attachmentId: z.string().uuid(),
        name: z.string().min(1).max(120),
        mime: z.string().max(120).default(""),
        size: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return registerVerifiedAttachment(context.supabase, context.userId, data);
  });

/** Client calls this for scanned-PDF page derivatives (P4). The derivative is
 *  registered with parent linkage; the server re-verifies the parent. */
export const registerAttachmentDerivative = createServerFn({ method: "POST" })
  .middleware([requireMyAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        attachmentId: z.string().uuid(),
        parentAttachmentId: z.string().uuid(),
        name: z.string().min(1).max(120),
        mime: z.string().max(120).default(""),
        size: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return registerDerivativeAttachment(context.supabase, context.userId, data);
  });
