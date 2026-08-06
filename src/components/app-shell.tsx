import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import {
  Search,
  Bookmark,
  History,
  Settings,
  LogOut,
  HelpCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  Columns3,
} from "lucide-react";
import { mySupabase } from "@/integrations/my-supabase/client";
import { getRemainingSearches } from "@/lib/search.functions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const nav = [
  { to: "/discover", label: "Discover", icon: Search },
  { to: "/watches", label: "Watches", icon: Bell },
  { to: "/pipeline", label: "Pipeline", icon: Columns3 },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/history", label: "History", icon: History },
] as const;

const secondary = [
  { to: "/profile", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: HelpCircle },
] as const;

const STORAGE_KEY = "scrapivo:sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const getUsage = useServerFn(getRemainingSearches);
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => getUsage(), staleTime: 30_000 });
  const [email, setEmail] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    }
  }, [collapsed]);

  useEffect(() => {
    mySupabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const signOut = async () => {
    await mySupabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const renderNav = (
    items: readonly { to: string; label: string; icon: typeof Search }[],
    isCollapsed: boolean,
  ) =>
    items.map(({ to, label, icon: Icon }) => {
      const active = location.pathname === to || location.pathname.startsWith(to + "/");
      return (
        <Link
          key={to}
          to={to}
          title={isCollapsed ? label : undefined}
          className={`flex items-center ${isCollapsed ? "justify-center px-0" : "gap-2.5 px-3"} py-2 rounded-lg text-sm transition-colors ${
            active
              ? "bg-sidebar-accent text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
          }`}
        >
          <Icon className="size-4" />
          {!isCollapsed && <span>{label}</span>}
        </Link>
      );
    });

  const renderSidebar = (isCollapsed: boolean) => (
    <>
      <div
        className={`h-16 flex items-center ${isCollapsed ? "justify-center px-0" : "gap-2 px-5"}`}
      >
        <div className="size-7 rounded-md bg-primary flex items-center justify-center shrink-0">
          <Search className="size-4 text-primary-foreground" />
        </div>
        {!isCollapsed && <span className="font-semibold tracking-tight text-base">Scrapivo</span>}
      </div>
      <nav className={`${isCollapsed ? "px-2" : "px-3"} flex-1 space-y-1`}>
        {renderNav(nav, isCollapsed)}
        {!isCollapsed && (
          <div className="pt-5 pb-1 px-3 text-[11px] uppercase tracking-wider text-muted-foreground/70">
            Settings & Help
          </div>
        )}
        {isCollapsed && <div className="my-3 mx-2 border-t border-border/60" />}
        {renderNav(secondary, isCollapsed)}
      </nav>
      <div className={`${isCollapsed ? "p-2" : "p-3"} space-y-3`}>
        {!isCollapsed && usage.data && (
          <div className="px-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Searches today</span>
              <span className="font-mono">
                {usage.data.used}
                {usage.data.cap ? `/${usage.data.cap}` : ""}
              </span>
            </div>
            {usage.data.cap && (
              <Progress value={(usage.data.used / usage.data.cap) * 100} className="h-1" />
            )}
          </div>
        )}
        {isCollapsed ? (
          <button
            onClick={signOut}
            title={email || "Sign out"}
            className="size-10 mx-auto rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-xs font-semibold"
          >
            {email ? email[0]?.toUpperCase() : "S"}
          </button>
        ) : (
          <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card min-w-0">
            <div className="size-8 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-xs font-semibold">
              {email ? email[0]?.toUpperCase() : "S"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{email || "You"}</div>
              <button
                onClick={signOut}
                className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <LogOut className="size-3" /> Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside
        className={`hidden md:flex relative shrink-0 border-r border-border bg-sidebar flex-col transition-[width] duration-200 ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        {renderSidebar(collapsed)}
        {/* NOTE: there used to be a second collapse button floating on the
            sidebar's right edge (`absolute -right-3`). With the topbar toggle
            below it rendered two chevrons a few pixels apart, which read as two
            separate sidebars. One control, in the topbar, is enough. */}
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden h-14 flex items-center gap-2 px-3 border-b border-border bg-background sticky top-0 z-30">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72 bg-sidebar flex flex-col">
              {renderSidebar(false)}
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-md bg-primary flex items-center justify-center">
              <Search className="size-3.5 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight text-sm">Scrapivo</span>
          </div>
        </div>
        <div className="hidden md:flex h-11 items-center px-3 border-b border-border bg-background sticky top-0 z-20">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        </div>
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
