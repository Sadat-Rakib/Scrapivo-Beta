import { createFileRoute } from "@tanstack/react-router";
import { isHeroTakeoverEnabled } from "@/lib/hero-flag";
import { LegacyMemoryPanel } from "@/components/memory/legacy-memory-panel";
import { MemoryHero } from "@/components/memory/memory-hero";

export const Route = createFileRoute("/_authenticated/memory")({
  validateSearch: (search): { legacy?: number } => ({
    legacy: search.legacy === 1 || search.legacy === "1" ? 1 : undefined,
  }),
  head: () => ({
    meta: [{ title: "Scrapivo — Memory" }],
  }),
  component: MemoryPage,
});

function MemoryPage() {
  const { legacy } = Route.useSearch();
  // Either the query param or the global kill-switch forces the legacy panel.
  // Both checks are synchronous — no flash or swap on initial paint.
  if (legacy === 1 || !isHeroTakeoverEnabled()) return <LegacyMemoryPanel />;
  return <MemoryHero />;
}
