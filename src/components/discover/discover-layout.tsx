import { useState, type ReactNode } from "react";
import { Menu, History } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { DiscoverLeftSidebar } from "./discover-left-sidebar";
import { ChatHistoryPanel } from "./chat-history-panel";

type DiscoverLayoutProps = {
  children: ReactNode;
  email: string;
  fullName: string;
  plan: string;
  usage?: { used: number; cap: number | null };
  onSignOut: () => void;
};

const LOGO_SRC =
  "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/unnamed__1_-removebg-preview.png";

export function DiscoverLayout({
  children,
  email,
  fullName,
  plan,
  usage,
  onSignOut,
}: DiscoverLayoutProps) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex overflow-hidden bg-background text-foreground">
      {/* Desktop Left Sidebar */}
      <aside className="hidden md:flex relative shrink-0 w-[240px]">
        <div className="absolute inset-0">
          <DiscoverLeftSidebar
            email={email}
            fullName={fullName}
            plan={plan}
            usage={usage}
            onSignOut={onSignOut}
          />
        </div>
      </aside>

      {/* Center Content */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden relative">
        {/* Mobile Header */}
        <div className="md:hidden h-14 flex items-center justify-between px-3 border-b border-border bg-sidebar shrink-0 z-30">
          <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[260px] bg-sidebar flex flex-col">
              <DiscoverLeftSidebar
                email={email}
                fullName={fullName}
                plan={plan}
                usage={usage}
                onSignOut={onSignOut}
                onNavClick={() => setLeftOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <img src={LOGO_SRC} alt="" className="h-6 w-auto" />
            <span
              style={{
                fontFamily: '"Instrument Serif", "Times New Roman", serif',
                fontStyle: "italic",
                fontSize: 18,
                letterSpacing: "-0.04em",
              }}
            >
              Scrapivo
            </span>
          </div>
          <Sheet open={rightOpen} onOpenChange={setRightOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open history">
                <History className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 w-80 bg-sidebar flex flex-col">
              <ChatHistoryPanel />
            </SheetContent>
          </Sheet>
        </div>

        {/* Main scrollable area */}
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">{children}</main>
      </div>

      {/* Desktop Right Sidebar */}
      <aside className="hidden lg:flex relative shrink-0 w-[300px]">
        <div className="absolute inset-0">
          <ChatHistoryPanel />
        </div>
      </aside>
    </div>
  );
}
