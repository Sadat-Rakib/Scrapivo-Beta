import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Search,
  Bell,
  Bookmark,
  Settings,
  History,
  Sparkles,
  Mail,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/help")({
  component: HelpPage,
});

const SECTIONS = [
  {
    icon: Sparkles,
    title: "Getting started",
    body: "Complete the Scrapy setup once. It asks what you need help with (clients, jobs, or both), your craft, experience, and preferences. That context powers every search so you are not starting from zero each time.",
  },
  {
    icon: Search,
    title: "Discover",
    body: "Type a buying signal or skill in plain English. Scrapivo scans live public activity, ranks Hot and Warm opportunities, and groups Posts, Companies, and People. Open any card for the original public link and outreach drafts.",
  },
  {
    icon: Bell,
    title: "Watches",
    body: "Save a signal and set Daily or Weekly. Scrapivo re-runs that hunt on schedule. Use Run due to process anything that is ready. Results land back in Discover so you can review and act — nothing sends without you.",
  },
  {
    icon: Bookmark,
    title: "Saved & History",
    body: "Bookmark leads you want to revisit under Saved. History keeps past searches so you can jump back into a query without retyping it.",
  },
  {
    icon: Settings,
    title: "Settings",
    body: "Keep your name, craft, experience, location, and skills up to date — onboarding writes here too. Turn on email notifications and add a Slack webhook for digests. Telegram and WhatsApp delivery are on the roadmap.",
  },
  {
    icon: History,
    title: "Filters that matter",
    body: "Use 24h when you only want the freshest activity, or All for a wider window. Experience from setup filters senior vs entry roles — keep Years of experience accurate so you do not see staff-level jobs when you are 0–1 YoE.",
  },
];

function HelpPage() {
  return (
    <div className="p-6 sm:p-8 max-w-2xl mx-auto w-full space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          How Scrapivo works — from first setup to watches and outreach. Still stuck? Reach out below.
        </p>
      </div>

      <div className="space-y-3">
        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <section
            key={title}
            className="rounded-2xl border border-border/80 bg-card/50 p-5 space-y-2"
          >
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <Icon className="size-4 text-muted-foreground" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed pl-10">{body}</p>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-start gap-3">
          <Mail className="size-4 mt-0.5 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Still have questions?</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Email us and we will help you get set up.
            </div>
          </div>
        </div>
        <a
          href="mailto:mirsadat@scrapivo.com"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          mirsadat@scrapivo.com
        </a>
      </section>

      <p className="text-xs text-muted-foreground">
        Prefer the app? Jump to{" "}
        <Link to="/discover" className="underline underline-offset-2 hover:text-foreground">
          Discover
        </Link>{" "}
        or{" "}
        <Link to="/watches" className="underline underline-offset-2 hover:text-foreground">
          Watches
        </Link>
        .
      </p>
    </div>
  );
}
