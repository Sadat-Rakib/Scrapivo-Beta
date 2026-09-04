import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/guides")({
  head: () => ({
    meta: [{ title: "Scrapivo — Guides" }],
  }),
  component: GuidesPage,
});

// Placeholder entries only — full guide content is a separate future task.
const GUIDES = [
  {
    title: "Cold Email Frameworks That Convert",
    description: "Proven structures for first-touch emails that get replies.",
  },
  {
    title: "DM Scripts for Cold Outreach",
    description: "Short, human openers for LinkedIn and X that start conversations.",
  },
  {
    title: "Outreach Frameworks That Scale",
    description: "Follow-up cadences and sequencing for busy pipelines.",
  },
  {
    title: "Finding Decision-Makers Fast",
    description: "How to identify the right person to contact at any company.",
  },
  {
    title: "How to Find Warm Local Leads",
    description: "Spotting high-intent local businesses worth pitching today.",
  },
  {
    title: "Signal Watches That Run Themselves",
    description:
      "Save a hunt once and Scrapivo re-runs it on schedule, fresh matches land in Discover.",
  },
];

function GuidesPage() {
  return (
    <div className="h-full overflow-y-auto no-scrollbar p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto w-full space-y-6 text-white">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
          <BookOpen className="size-3.5" />
          <span>Learn</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Guides</h1>
        <p className="text-xs text-white/60 mt-1 leading-relaxed">
          Short reference playbooks for cold outreach — more guides ship soon.
        </p>
      </div>

      <div className="space-y-3">
        {GUIDES.map(({ title, description }) => (
          <div key={title} className="liquid-glass rounded-2xl p-5 flex items-start gap-3 group">
            <div className="size-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white shrink-0">
              <BookOpen className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-white tracking-tight">{title}</h2>
              <p className="text-xs text-white/50 mt-1 leading-relaxed">{description}</p>
              <span className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium text-white/40">
                Coming soon <ArrowUpRight className="size-3" />
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-white/40">
        Ready to search? Jump to{" "}
        <Link
          to="/discover"
          className="underline underline-offset-2 text-white/70 hover:text-white"
        >
          Discover
        </Link>
        .
      </p>
    </div>
  );
}
