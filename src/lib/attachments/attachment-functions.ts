import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMyAuth } from "@/integrations/my-supabase/auth-middleware";
import {
  createStage1DerivativeTicket,
  createStage1UploadTicket,
} from "./attachment-store.server";

/** Stage-1 upload: the server validates the descriptor, builds the path from
 *  the SESSION user's id, and returns a short-lived signed upload URL. The
 *  client PUTs the bytes there and never sends a path. */
export const createAttachmentUpload = createServerFn({ method: "POST" })
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
    return createStage1UploadTicket(context.userId, data);
  });

/** Stage-1 DERIVATIVE upload (scanned-PDF page images): parent verified
 *  server-side; the derivative path embeds the parent id. */
export const createAttachmentDerivativeUpload = createServerFn({ method: "POST" })
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
    return createStage1DerivativeTicket(context.userId, data);
  });
