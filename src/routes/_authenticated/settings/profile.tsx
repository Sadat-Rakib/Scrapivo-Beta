import { createFileRoute } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
// WS3: the profile/Memory editor wrapped under its new home — Settings →
// Profile & Defaults. /memory redirects here; /profile keeps working too.
import { ProfilePage } from "@/routes/_authenticated/profile";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  head: () => ({
    meta: [{ title: "Scrapivo — Profile & Defaults" }],
  }),
  component: ProfileDefaultsPage,
});

function ProfileDefaultsPage() {
  return (
    <div className="h-full overflow-y-auto no-scrollbar">
      <div className="max-w-2xl mx-auto w-full px-4 sm:px-6 lg:p-8 pt-6 space-y-1 text-white">
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold">
          <UserRound className="size-3.5" />
          <span>Settings</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile &amp; Defaults</h1>
        <p className="text-xs text-white/60">
          Your global research defaults — used by every project and search when nothing more
          specific overrides them.
        </p>
      </div>
      <ProfilePage heading="Profile & Defaults" />
    </div>
  );
}
