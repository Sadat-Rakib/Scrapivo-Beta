import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  Search,
  Bookmark,
  Settings,
  LogOut,
  HelpCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Bell,
  Store,
  Landmark,
  Briefcase,
  Plus,
  ChevronLeft,
  ChevronRight,
  User,
  History as HistoryIcon,
} from "lucide-react";
import { mySupabase } from "@/integrations/my-supabase/client";
import { getRemainingSearches } from "@/lib/search.functions";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ChatHistoryPanel } from "@/components/discover/chat-history-panel";

const LOGO_SRC =
  "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/unnamed__1_-removebg-preview.png";

// §5: Renamed nav items — "Discover" → "Home", "Local businesses" → "Businesses"
// §4.1: Removed "History" and "Pipeline" from the left sidebar nav
const navItems = [
  { to: "/discover", label: "Home", icon: Search },
  { to: "/local-businesses", label: "Businesses", icon: Store },
  { to: "/investors", label: "Investors", icon: Landmark },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/watches", label: "Watches", icon: Bell },
  { to: "/saved", label: "Saved", icon: Bookmark },
] as const;

const secondaryItems = [
  { to: "/profile", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: HelpCircle },
] as const;

const LEFT_STORAGE_KEY = "scrapivo:left-sidebar-collapsed";
const RIGHT_STORAGE_KEY = "scrapivo:right-sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const getUsage = useServerFn(getRemainingSearches);
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => getUsage(), staleTime: 30_000 });
  const [email, setEmail] = useState<string>("");
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);

  // §4.2: Account popover state
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  const accountPopoverRef = useRef<HTMLDivElement>(null);

  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(LEFT_STORAGE_KEY) === "1";
  });

  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(RIGHT_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    setMobileLeftOpen(false);
    setMobileRightOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LEFT_STORAGE_KEY, leftCollapsed ? "1" : "0");
    }
  }, [leftCollapsed]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RIGHT_STORAGE_KEY, rightCollapsed ? "1" : "0");
    }
  }, [rightCollapsed]);

  useEffect(() => {
    mySupabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  // Close account popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountPopoverRef.current && !accountPopoverRef.current.contains(e.target as Node)) {
        setAccountPopoverOpen(false);
      }
    };
    if (accountPopoverOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [accountPopoverOpen]);

  const signOut = async () => {
    await mySupabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  // §5: Updated page context label mapping
  const getPageLabel = () => {
    if (location.pathname === "/discover") return "Home";
    if (location.pathname === "/local-businesses") return "Businesses";
    if (location.pathname === "/jobs") return "Jobs";
    return location.pathname.slice(1).replace(/-/g, " ");
  };

  // §1.1: Nav items with overflow-hidden on container, position-relative on each item
  const renderNavGroup = (
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
          className={`relative flex items-center ${
            isCollapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
          } rounded-xl text-xs font-medium transition-all ${
            active
              ? "bg-white/10 text-white border border-white/15 shadow-sm"
              : "text-white/60 hover:text-white hover:bg-white/[0.05]"
          }`}
        >
          <Icon className="size-4 shrink-0" />
          {!isCollapsed && <span className="truncate">{label}</span>}
        </Link>
      );
    });

  // §4.2: Account popover — glass card is anchored to the sidebar's own bounds so it
  // can never escape the rail: contained inside when expanded, edge-flyout when collapsed.
  const renderAccountPopover = (positionClass: string) => (
    <div
      className={`fixed sm:absolute bottom-16 left-3 w-64 max-w-[calc(100vw-2rem)] mb-2 bg-[#141418] border border-white/20 rounded-xl shadow-2xl p-4 space-y-3 z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-200 backdrop-blur-xl ${positionClass}`}
    >
      <div className="flex items-center gap-3 pb-3 border-b border-white/10">
        <div className="size-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
          <User className="size-5 text-white/70" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-white truncate">{email || "User"}</div>
          <div className="text-[11px] text-white/40">
            {usage.data?.cap
              ? `Free plan — ${usage.data.used}/${usage.data.cap} searches`
              : "Free plan"}
          </div>
        </div>
      </div>

      <Link
        to="/profile"
        onClick={() => setAccountPopoverOpen(false)}
        className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-xs text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
      >
        <Settings className="size-3.5" />
        <span>Settings</span>
      </Link>

      <button
        type="button"
        onClick={() => {
          setAccountPopoverOpen(false);
          signOut();
        }}
        className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-xs text-red-400/90 hover:text-red-300 hover:bg-red-400/10 transition-colors w-full"
      >
        <LogOut className="size-3.5" />
        <span>Sign out</span>
      </button>
    </div>
  );

  const renderLeftSidebarContent = (isCollapsed: boolean, showToggle: boolean) => (
    <div className="flex flex-col h-full w-full min-w-0 text-white">
      {/* Brand Header — §1.2: Toggle now positioned via dedicated straddling button */}
      <div
        className={`h-16 flex items-center justify-between px-3 border-b border-white/10 shrink-0`}
      >
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          <img src={LOGO_SRC} alt="Scrapivo" className="h-7 w-auto shrink-0" />
          {!isCollapsed && (
            <span
              style={{
                fontFamily: '"Instrument Serif", "Times New Roman", serif',
                fontStyle: "italic",
                fontSize: 22,
                letterSpacing: "-0.03em",
              }}
              className="text-white font-medium truncate"
            >
              Scrapivo
            </span>
          )}
        </div>
      </div>

      {/* Nav Links — §1.1: overflow-hidden on container for glass overlay containment */}
      <nav
        className={`flex-1 overflow-y-auto overflow-x-hidden ${isCollapsed ? "px-2" : "px-3"} py-4 space-y-1 no-scrollbar`}
      >
        {renderNavGroup(navItems, isCollapsed)}
        {!isCollapsed && (
          <div className="pt-5 pb-1 px-3 text-[10px] uppercase tracking-wider text-white/40 font-semibold">
            Support & Account
          </div>
        )}
        {isCollapsed && <div className="my-3 mx-2 border-t border-white/10" />}
        {renderNavGroup(secondaryItems, isCollapsed)}
      </nav>

      {/* Usage & User Footer — §4.2: Clickable account box opens popover */}
      <div className={`p-3 border-t border-white/10 space-y-3 shrink-0`}>
        {!isCollapsed && usage.data && (
          <div className="px-1 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-white/50">
              <span>Searches today</span>
              <span className="font-mono text-white/80">
                {usage.data.used}
                {usage.data.cap ? `/${usage.data.cap}` : ""}
              </span>
            </div>
            {usage.data.cap && (
              <Progress
                value={(usage.data.used / usage.data.cap) * 100}
                className="h-1 bg-white/10"
              />
            )}
          </div>
        )}

        {isCollapsed ? (
          // No `relative` here: the popover's containing block becomes the <aside>,
          // so left-full anchors the flyout exactly to the rail's right edge.
          <div ref={accountPopoverRef}>
            <button
              type="button"
              onClick={() => setAccountPopoverOpen((v) => !v)}
              title={email || "Account"}
              className="size-9 mx-auto rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white text-xs font-semibold hover:bg-white/20 transition-colors"
            >
              {email ? email[0]?.toUpperCase() : "S"}
            </button>
            {/* Collapsed: flyout anchored to the rail's right edge */}
            {accountPopoverOpen && renderAccountPopover("sm:bottom-2 sm:left-full sm:ml-3")}
          </div>
        ) : (
          <div className="relative" ref={accountPopoverRef}>
            <button
              type="button"
              onClick={() => setAccountPopoverOpen((v) => !v)}
              className="w-full flex items-center gap-2.5 p-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
            >
              <div className="size-8 rounded-full bg-white/15 border border-white/20 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                {email ? email[0]?.toUpperCase() : "S"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white truncate">{email || "Account"}</div>
                <div className="text-[11px] text-white/40 mt-0.5">Manage account</div>
              </div>
            </button>

            {/* Account Popover — contained within the sidebar's own width */}
            {accountPopoverOpen &&
              renderAccountPopover("sm:bottom-full sm:left-0 sm:right-0 sm:w-auto")}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-[100dvh] md:h-screen flex overflow-hidden bg-[#0a0a0b] text-white selection:bg-white/20">
      {/* Persistent Left Sidebar */}
      <aside
        className={`hidden md:flex relative shrink-0 liquid-glass rounded-r-2xl border-r border-white/10 z-20 transition-all duration-300 ${
          leftCollapsed ? "w-16" : "w-60 max-w-[25vw]"
        }`}
      >
        {renderLeftSidebarContent(leftCollapsed, true)}

        {/* Left sidebar collapse toggle — 28px glass circle straddling sidebar right border */}
        <button
          type="button"
          onClick={() => setLeftCollapsed((c) => !c)}
          aria-label={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute top-1/2 -translate-y-1/2 -right-3.5 z-30 size-7 rounded-full bg-[#141418] border border-white/20 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition-all shadow-lg hover:scale-105"
        >
          {leftCollapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <ChevronLeft className="size-3.5" />
          )}
        </button>
      </aside>

      {/* Main Column */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden relative">
        {/* Persistent TopBar */}
        <header className="h-14 min-h-[56px] px-4 border-b border-white/10 bg-black/40 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 z-10">
          {/* Mobile Left Drawer Trigger */}
          <div className="md:hidden flex items-center gap-2">
            <Sheet open={mobileLeftOpen} onOpenChange={setMobileLeftOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open navigation"
                  className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Menu className="size-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64 bg-[#0a0a0b] border-r border-white/10">
                {renderLeftSidebarContent(false, false)}
              </SheetContent>
            </Sheet>

            <div className="flex items-center gap-2">
              <img src={LOGO_SRC} alt="" className="h-6 w-auto" />
              <span
                style={{
                  fontFamily: '"Instrument Serif", "Times New Roman", serif',
                  fontStyle: "italic",
                  fontSize: 18,
                }}
                className="text-white font-medium"
              >
                Scrapivo
              </span>
            </div>
          </div>

          {/* Desktop Left Action / Page Context */}
          <div className="hidden md:flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-white/70 tracking-wide uppercase">
              {getPageLabel()}
            </span>
          </div>

          {/* Center/Right TopBar Actions */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => navigate({ to: "/discover" })}
              className="glass-pill px-3.5 py-1.5 text-xs font-medium text-white flex items-center gap-1.5 hover:bg-white/15"
            >
              <Plus className="size-3.5" />
              <span>New chat</span>
            </button>

            {/* Mobile Right Drawer Trigger */}
            <div className="lg:hidden">
              <Sheet open={mobileRightOpen} onOpenChange={setMobileRightOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open history"
                    className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <HistoryIcon className="size-5" />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="p-0 w-80 bg-[#0a0a0b] border-l border-white/10"
                >
                  <ChatHistoryPanel />
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        {/* Main Route Content */}
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden relative">{children}</main>
      </div>

      {/* Persistent Right Sidebar (Chat History) */}
      <aside
        className={`hidden lg:flex relative shrink-0 liquid-glass rounded-l-2xl border-l border-white/10 z-20 transition-all duration-300 ${
          rightCollapsed
            ? "w-0 overflow-hidden border-none opacity-0 pointer-events-none"
            : "w-72 max-w-[28vw] opacity-100"
        }`}
      >
        <div className="w-72 max-w-full h-full">
          <ChatHistoryPanel />
        </div>

        {/* Right sidebar collapse toggle when expanded */}
        {!rightCollapsed && (
          <button
            type="button"
            onClick={() => setRightCollapsed(true)}
            aria-label="Collapse history panel"
            title="Collapse history panel"
            className="absolute top-1/2 -translate-y-1/2 -left-3.5 z-30 size-7 rounded-full bg-[#141418] border border-white/20 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition-all shadow-lg hover:scale-105"
          >
            <ChevronRight className="size-3.5" />
          </button>
        )}
      </aside>

      {/* Right sidebar toggle when collapsed — floats at edge of viewport */}
      {rightCollapsed && (
        <button
          type="button"
          onClick={() => setRightCollapsed(false)}
          aria-label="Expand history panel"
          title="Expand history panel"
          className="hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 size-7 rounded-l-full bg-[#141418] border border-r-0 border-white/20 items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition-all shadow-lg hover:scale-105"
        >
          <ChevronLeft className="size-3.5" />
        </button>
      )}
    </div>
  );
}
