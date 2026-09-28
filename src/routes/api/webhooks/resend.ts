import { createFileRoute } from "@tanstack/react-router";

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { message?: string };
  };
};

export const Route = createFileRoute("/api/webhooks/resend")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // `.server` modules must be imported dynamically inside the handler —
        // a top-level import leaks node:crypto into the client route graph and
        // breaks the vite client build.
        const { getAdmin } = await import("@/integrations/my-supabase/admin.server");
        const { verifyResendWebhook } = await import("@/lib/outreach/webhook-verify.server");

        const payload = await request.text();
        const secret = process.env.RESEND_WEBHOOK_SECRET || "";

        const ok = verifyResendWebhook(
          payload,
          {
            id: request.headers.get("svix-id"),
            timestamp: request.headers.get("svix-timestamp"),
            signature: request.headers.get("svix-signature"),
          },
          secret,
        );

        // Allow unsigned in local/dev only when secret unset
        if (secret && !ok) {
          return new Response("Invalid signature", { status: 400 });
        }

        let event: ResendEvent;
        try {
          event = JSON.parse(payload) as ResendEvent;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const type = event.type || "";
        const resendId = event.data?.email_id;
        if (!resendId) {
          return Response.json({ ok: true, skipped: "no email_id" });
        }

        const admin = getAdmin();
        const { data: send } = await admin
          .from("email_sends")
          .select("id, user_id, to_email, saved_lead_id, status")
          .eq("resend_id", resendId)
          .maybeSingle();

        if (!send) {
          return Response.json({ ok: true, skipped: "unknown send" });
        }

        let status = send.status as string;
        let suppressReason: string | null = null;

        if (type === "email.delivered") status = "delivered";
        else if (type === "email.bounced" || type === "email.failed") {
          status = "bounced";
          suppressReason = "bounce";
        } else if (type === "email.complained") {
          status = "complained";
          suppressReason = "complaint";
        } else if (type === "email.received" || type.startsWith("email.")) {
          // ignore other types
        }

        if (status !== send.status) {
          await admin
            .from("email_sends")
            .update({
              status,
              error: type === "email.bounced" ? event.data?.bounce?.message || "bounced" : null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", send.id);

          await admin.from("lead_activity").insert({
            user_id: send.user_id,
            saved_lead_id: send.saved_lead_id,
            kind: `email_${status}`,
            detail: `Email ${status} (${resendId})`,
            metadata: { resend_id: resendId, event: type },
          });
        }

        if (suppressReason) {
          await admin.from("email_suppressions").upsert(
            {
              user_id: send.user_id,
              email: send.to_email.toLowerCase(),
              reason: suppressReason,
              source: `resend:${type}`,
            },
            { onConflict: "user_id,email" },
          );
        }

        return Response.json({ ok: true, status });
      },
    },
  },
});
