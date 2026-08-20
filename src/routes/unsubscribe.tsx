import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { processUnsubscribe } from "@/lib/outreach/unsub.functions";

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (s: Record<string, unknown>) => ({
    t: typeof s.t === "string" ? s.t : "",
  }),
  server: {
    handlers: {
      /** RFC 8058 one-click: POST List-Unsubscribe=One-Click */
      POST: async ({ request }) => {
        const { applyUnsubscribe } = await import("@/lib/outreach/unsub-apply.server");
        const url = new URL(request.url);
        const token = url.searchParams.get("t") || "";
        if (!token) {
          return new Response("Missing token", { status: 400 });
        }
        const result = await applyUnsubscribe(token);
        if (!result.ok) {
          return new Response(result.error, { status: 400 });
        }
        return new Response("Unsubscribed", { status: 200 });
      },
    },
  },
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { t } = Route.useSearch();
  const unsub = useServerFn(processUnsubscribe);
  const [done, setDone] = useState<{ ok: boolean; email?: string; error?: string } | null>(null);

  const mut = useMutation({
    mutationFn: () => unsub({ data: { token: t } }),
    onSuccess: (r) => setDone(r),
    onError: (e: Error) => setDone({ ok: false, error: e.message }),
  });

  useEffect(() => {
    if (t && !done && !mut.isPending && !mut.isSuccess) {
      mut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Unsubscribe</h1>
        {!t ? (
          <p className="text-sm text-muted-foreground">
            Missing token. Use the link from the email you received.
          </p>
        ) : mut.isPending && !done ? (
          <p className="text-sm text-muted-foreground">Processing…</p>
        ) : done?.ok ? (
          <p className="text-sm text-foreground">
            You&apos;ve been unsubscribed
            {done.email ? (
              <>
                {" "}
                (<span className="font-medium">{done.email}</span>)
              </>
            ) : null}
            . You won&apos;t receive further commercial messages from this sender.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {done?.error || "Could not process unsubscribe."}
          </p>
        )}
      </div>
    </div>
  );
}
