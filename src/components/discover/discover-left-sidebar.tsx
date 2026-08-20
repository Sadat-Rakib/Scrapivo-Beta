import { Link, useLocation } from "@tanstack/react-router";
import {
  Search,
  Briefcase,
  Store,
  Landmark,
  Bell,
  Bookmark,
  Settings,
  HelpCircle,
  LogOut,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";

const LOGO_SRC =
  "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/unnamed__1_-removebg-preview.png";

const primaryNav = [
  { to: "/discover", label: "Home", icon: Search },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/local-businesses", label: "Businesses", icon: Store },
  { to: "/investors", label: "Investors", icon: Landmark },
  { to: "/watches", label: "Notifications", icon: Bell },
  { to: "/saved", label: "Saved", icon: Bookmark },
] as const;

const secondaryNav = [
  { to: "/profile", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: HelpCircle },
] as const;

export function DiscoverLeftSidebar({
  email,
  fullName,
  plan,
  usage,
  onSignOut,
  onNavClick,
}: {
  email: string;
  fullName: string;
  plan: string;
  usage?: { used: number; cap: number | null };
  onSignOut: () => void;
  onNavClick?: () => void;
}) {
  const location = useLocation();

  const renderNav = (items: typeof primaryNav | typeof secondaryNav) =>
    items.map(({ to, label, icon: Icon }) => {
      const active = location.pathname === to || location.pathname.startsWith(to + "/");
      return (
        <Link
          key={to}
          to={to}
          onClick={onNavClick}
          className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
            active
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <Icon className="size-[18px]" />
          <span>{label}</span>
        </Link>
      );
    });

  const displayInitials = fullName
    ? fullName[0].toUpperCase()
    : email
      ? email[0].toUpperCase()
      : "S";
  const displayName = fullName || "You";

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-border text-sidebar-foreground">
      <div className="h-16 px-6 flex items-center gap-3 shrink-0">
        <img src={LOGO_SRC} alt="" className="h-7 w-auto" />
        <span
          style={{
            fontFamily: '"Instrument Serif", "Times New Roman", serif',
            fontStyle: "italic",
            fontSize: 22,
            letterSpacing: "-0.04em",
          }}
        >
          Scrapivo
        </span>
      </div>

      <nav className="flex-1 px-3 space-y-1 mt-4 overflow-y-auto">
        {renderNav(primaryNav)}

        <div className="my-4 mx-3 border-t border-border/60" />

        {renderNav(secondaryNav)}
      </nav>

      <div className="p-4 shrink-0">
        <Popover>
          <PopoverTrigger asChild>
            <button className="w-full flex items-center gap-3 p-2 rounded-xl border border-transparent hover:border-border hover:bg-sidebar-accent/30 transition-all text-left">
              <div className="size-10 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-sm font-semibold shrink-0">
                {displayInitials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{displayName}</div>
                {email && <div className="text-xs text-muted-foreground truncate">{email}</div>}
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-64 p-3 mb-2" sideOffset={0}>
            {usage && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span>Searches today</span>
                  <span className="font-mono">
                    {usage.used}
                    {usage.cap ? `/${usage.cap}` : ""}
                  </span>
                </div>
                {usage.cap && (
                  <Progress value={(usage.used / usage.cap) * 100} className="h-1.5" />
                )}
              </div>
            )}
            <div className="space-y-1">
              <Link
                to="/profile"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors"
              >
                <Settings className="size-4 text-muted-foreground" />
                Profile & Settings
              </Link>
              <button
                onClick={onSignOut}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors text-left"
              >
                <LogOut className="size-4 text-muted-foreground" />
                Sign out
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {plan === "free" && (
          <Link
            to="/profile"
            className="mt-3 block w-full text-center px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Upgrade Now
          </Link>
        )}
      </div>
    </div>
  );
}
