import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Search,
  Bell,
  Bookmark,
  Settings,
  History,
  Sparkles,
  Mail,
  ChevronDown,
  HelpCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({
    meta: [{ title: "Scrapivo — Help" }],
  }),
  component: HelpPage,
});

const SECTIONS = [
  {
    icon: Sparkles,
    title: "Getting Started",
    body: "Complete the Scrapy setup once. It asks what you need help with (clients, jobs, or both), your craft, experience, and preferences. That context powers every search so you are not starting from zero each time.",
  },
  {
    icon: Search,
    title: "Discover & Intent Signals",
    body: "Type a buying signal or skill in plain English. Scrapivo scans live public activity, ranks Hot and Warm opportunities, and groups Posts, Companies, and People. Open any card for the original public link and outreach drafts.",
  },
  {
    icon: Bell,
    title: "Signal Watches",
    body: "Save a signal and set Daily or Weekly. Scrapivo re-runs that hunt on schedule. Use 'Run due' to process anything that is ready. Results land back in Discover so you can review and act — nothing sends without you.",
  },
  {
    icon: Bookmark,
    title: "Saved Leads & History",
    body: "Bookmark leads you want to revisit under Saved. History keeps past searches so you can jump back into a query without retyping it.",
  },
  {
    icon: Settings,
    title: "Settings & Notifications",
    body: "Keep your name, craft, experience, location, and skills up to date — onboarding writes here too. Turn on email notifications and add a Slack webhook for digests. Telegram and WhatsApp delivery are on the roadmap.",
  },
  {
    icon: History,
    title: "Search Filters & Precision",
    body: "Use 24h when you only want the freshest activity, or All for a wider window. Experience from setup filters senior vs entry roles — keep Years of experience accurate so you do not see staff-level jobs when you are 0–1 YoE.",
  },
];

function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggleAccordion = (idx: number) => {
    setOpenIdx((current) => (current === idx ? null : idx));
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto w-full space-y-6 text-white">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
          <HelpCircle className="size-3.5" />
          <span>Knowledge & Support</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Help Center</h1>
        <p className="text-xs text-white/60 mt-1 leading-relaxed">
          How Scrapivo works — from initial project setup to signal watches and outreach.
        </p>
      </div>

      {/* Accordion Cards */}
      <div className="space-y-3">
        {SECTIONS.map(({ icon: Icon, title, body }, idx) => {
          const isOpen = openIdx === idx;
          return (
            <div
              key={title}
              onClick={() => toggleAccordion(idx)}
              className="liquid-glass rounded-2xl p-5 space-y-3 cursor-pointer hover:bg-white/[0.03] transition-all group"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white shrink-0">
                    <Icon className="size-4" />
                  </div>
                  <h2 className="text-sm font-semibold text-white tracking-tight group-hover:text-white/90">
                    {title}
                  </h2>
                </div>

                <div
                  className={`size-7 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/70 transition-transform duration-200 ${
                    isOpen ? "rotate-180 text-white bg-white/20" : ""
                  }`}
                >
                  <ChevronDown className="size-4" />
                </div>
              </div>

              {isOpen && (
                <div className="pt-2 border-t border-white/10 text-xs text-white/70 leading-relaxed pl-12 animate-in fade-in-50 duration-200">
                  {body}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Support Contact Footer */}
      <div className="liquid-glass rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Mail className="size-4 mt-0.5 text-white/60 shrink-0" />
          <div>
            <div className="text-xs font-semibold text-white">Still have questions?</div>
            <div className="text-[11px] text-white/50 mt-0.5">
              Email us and we will help you get set up.
            </div>
          </div>
        </div>
        <a
          href="mailto:mirsadat@scrapivo.com"
          className="glass-pill px-4 py-2 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/20 text-center shrink-0"
        >
          mirsadat@scrapivo.com
        </a>
      </div>

      <p className="text-xs text-white/40">
        Ready to search? Jump to{" "}
        <Link to="/discover" className="underline underline-offset-2 text-white/70 hover:text-white">
          Discover
        </Link>{" "}
        or{" "}
        <Link to="/watches" className="underline underline-offset-2 text-white/70 hover:text-white">
          Signal Watches
        </Link>
        .
      </p>
    </div>
  );
}
