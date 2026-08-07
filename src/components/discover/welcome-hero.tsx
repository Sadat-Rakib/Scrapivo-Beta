import {
  Search,
  Sparkles,
  Bookmark,
  History,
  Plus,
  Briefcase,
  Newspaper,
  Globe,
  FileText,
  Users,
  Building2,
  Bell,
  Layers,
  Store,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

const tiles = [
  { id: "search", label: "New search", icon: Search, tone: "bg-white/10 text-white" },
  { id: "chat", label: "AI chat", icon: Sparkles, tone: "bg-white/[0.07] text-white/90" },
  { id: "saved", label: "View saved", icon: Bookmark, tone: "bg-white/[0.05] text-white/85" },
  { id: "history", label: "View history", icon: History, tone: "bg-white/[0.04] text-white/80" },
] as const;

/** Static capability pills — what Scrapivo surfaces. Display-only, not clickable. */
const CAPABILITY_PILLS = [
  { label: "Jobs", icon: Briefcase },
  { label: "People", icon: Users },
  { label: "Companies", icon: Building2 },
  { label: "Businesses", icon: Store },
  { label: "Posts", icon: FileText },
  { label: "Sites", icon: Globe },
  { label: "News", icon: Newspaper },
  { label: "Updates", icon: Bell },
  { label: "Platforms", icon: Layers },
] as const;

export function WelcomeHero({
  onFocusComposer,
  onChooseChat,
  projectQuery,
  onFindLeads,
  onOpenWizard,
  greetingName,
}: {
  onFocusComposer: () => void;
  onChooseChat: () => void;
  /** Compiled query from the active project — enables one-tap search. */
  projectQuery?: string;
  onFindLeads?: () => void;
  /** Re-opens the Scrapy setup Q&A. */
  onOpenWizard?: () => void;
  /** When set, greets a returning user by name. */
  greetingName?: string;
}) {
  const navigate = useNavigate();
  const handle = (id: (typeof tiles)[number]["id"]) => {
    if (id === "search") onFocusComposer();
    else if (id === "chat") onChooseChat();
    else if (id === "saved") navigate({ to: "/saved" });
    else if (id === "history") navigate({ to: "/history" });
  };

  const title = greetingName?.trim()
    ? `Welcome back, ${greetingName.trim()}`
    : "Welcome to Scrapivo";

  return (
    <div className="max-w-2xl mx-auto w-full text-center px-6">
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-balance break-words">
        {title}
      </h1>
      <p className="mt-4 text-base text-muted-foreground">
        {greetingName?.trim()
          ? "What are you looking for now — a buying signal, niche, or role?"
          : "Describe a buying signal in plain English — or search for roles, skills, and agencies."}
      </p>

      {projectQuery && onFindLeads && (
        <div className="mt-7">
          <button
            type="button"
            onClick={onFindLeads}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Search className="size-4" />
            Find my leads
          </button>
          <p className="mt-2 text-[11px] text-muted-foreground truncate max-w-md mx-auto">
            From your project brief — no typing needed
          </p>
          {onOpenWizard && (
            <button
              type="button"
              onClick={onOpenWizard}
              className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Redo the setup Q&A
            </button>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-2" aria-hidden="true">
        {CAPABILITY_PILLS.map(({ label, icon: Icon }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-xs text-foreground select-none cursor-default"
          >
            <Icon className="size-3.5 text-muted-foreground" />
            {label}
          </span>
        ))}
      </div>

      <div className="mt-10 grid grid-cols-2 gap-3">
        {tiles.map(({ id, label, icon: Icon, tone }) => (
          <button
            key={id}
            onClick={() => handle(id)}
            className="group flex items-center gap-3 p-4 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all text-left"
          >
            <div className={`size-10 rounded-xl flex items-center justify-center ${tone}`}>
              <Icon className="size-5" />
            </div>
            <div className="flex-1 font-medium text-sm">{label}</div>
            <Plus className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
