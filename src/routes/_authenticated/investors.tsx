import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { runInvestorSearch, refreshInvestorVerification } from "@/lib/investors.functions";
import type { InvestorRecord } from "@/lib/investors/types";
import { Button } from "@/components/ui/button";
import { Landmark, Search, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/investors")({
  head: () => ({
    meta: [{ title: "Scrapivo — Investors" }],
  }),
  component: InvestorsPage,
});

function formatUsd(n: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function InvestorsPage() {
  const searchFn = useServerFn(runInvestorSearch);
  const verifyFn = useServerFn(refreshInvestorVerification);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("any");
  const [checkBand, setCheckBand] = useState<"angel" | "seed" | "growth" | "any">("any");
  const [location, setLocation] = useState("");
  const [rows, setRows] = useState<InvestorRecord[]>([]);

  const mut = useMutation({
    mutationFn: () =>
      searchFn({
        data: {
          query: query.trim(),
          stage: stage === "any" ? undefined : stage,
          location: location.trim() || undefined,
          checkBand,
          limit: 80,
        },
      }),
    onSuccess: (res) => {
      setRows(res.investors ?? []);
      toast.success(`${res.investors?.length ?? 0} investors matched`);
    },
    onError: (e: Error) => toast.error(e.message || "Search failed"),
  });

  const verifyMut = useMutation({
    mutationFn: () => verifyFn(),
    onSuccess: (res) => {
      toast.success(
        `Checked ${res.checked}: ${res.active} active, ${res.needs_review} need review`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="h-full overflow-y-auto p-6 sm:p-8 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 text-muted-foreground mb-2">
          <Landmark className="size-4" />
          <span className="text-xs uppercase tracking-wide">VC & angel outreach</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Investors</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          Find VCs and angels by sector, stage, check size, and location — then reach out with a
          sharper pitch.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 mb-8">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">What kind of investor?</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. FinTech seed, climate, AI Series A"
            className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") mut.mutate();
            }}
          />
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Stage</span>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
            >
              <option value="any">Any</option>
              <option value="Pre-seed">Pre-seed</option>
              <option value="Seed">Seed</option>
              <option value="Series A">Series A</option>
              <option value="Series B">Series B</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Check size</span>
            <select
              value={checkBand}
              onChange={(e) => setCheckBand(e.target.value as typeof checkBand)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
            >
              <option value="any">Any</option>
              <option value="angel">Angel (&lt;$100K)</option>
              <option value="seed">$100K–$5M</option>
              <option value="growth">$5M+</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Location</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. London, California"
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            <Search className={`size-3.5 mr-1.5 ${mut.isPending ? "animate-pulse" : ""}`} />
            {mut.isPending ? "Searching…" : "Find investors"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => verifyMut.mutate()}
            disabled={verifyMut.isPending}
          >
            <RefreshCw className={`size-3.5 mr-1.5 ${verifyMut.isPending ? "animate-spin" : ""}`} />
            Refresh status
          </Button>
        </div>
      </div>

      {!mut.isPending && rows.length > 0 && (
        <div className="space-y-3 pb-8">
          <p className="text-sm text-muted-foreground">{rows.length} matches</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className="p-4 rounded-xl border border-border bg-card space-y-2 hover:border-primary/30 transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.title} · {r.firm}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                      r.status === "active"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-amber-500/10 text-amber-700"
                    }`}
                  >
                    {r.status.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Sweet spot {formatUsd(r.check_sweet_spot_usd)} ·{" "}
                  {formatUsd(r.check_min_usd)}–{formatUsd(r.check_max_usd)}
                </div>
                {!!r.locations.length && (
                  <div className="text-xs text-muted-foreground truncate">
                    {r.locations.join(" · ")}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {r.focus_areas.slice(0, 4).map((f, i) => (
                    <span
                      key={`${f.sector}-${f.stage}-${i}`}
                      className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground"
                    >
                      {f.sector} ({f.stage})
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!mut.isPending && !rows.length && (
        <p className="text-sm text-muted-foreground">
          Search by niche, stage, or location — or ask on Discover: “I need a seed investor for
          FinTech.”
        </p>
      )}
    </div>
  );
}
