import { createFileRoute } from "@tanstack/react-router";
import { isHeroTakeoverEnabled } from "@/lib/hero-flag";
import { LegacyWatchesPanel } from "@/components/watches/legacy-watches-panel";
import { WatchesHero } from "@/components/watches/watches-hero";

export const Route = createFileRoute("/_authenticated/watches")({
  validateSearch: (search): { legacy?: number } => ({
    legacy: search.legacy === 1 || search.legacy === "1" ? 1 : undefined,
  }),
  head: () => ({
    meta: [{ title: "Scrapivo — Signal watches" }],
  }),
  component: WatchesPage,
});

function WatchesPage() {
  const { legacy } = Route.useSearch();
  // Either the query param or the global kill-switch forces the legacy panel.
  // Both checks are synchronous — no flash or swap on initial paint.
  if (legacy === 1 || !isHeroTakeoverEnabled()) return <LegacyWatchesPanel />;
  return <WatchesHero />;
}
