import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { mySupabase } from "@/integrations/my-supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Scrapivo" }],
  }),
  beforeLoad: async () => {
    const { data } = await mySupabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
    return { userId: data.session.user.id };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
