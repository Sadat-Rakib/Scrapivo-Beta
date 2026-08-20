import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { runInvestorSearch, refreshInvestorVerification } from "@/lib/investors.functions";
import type { InvestorWithMetadata } from "@/lib/investors/search";
import { getInvestorSectors, getInvestorStages } from "@/lib/investors/types";
import { effectiveInvestLocations } from "@/lib/investors/location-hierarchy";
import { generateRelevantBecause, type SearchFilters } from "@/lib/investors/relevance-explainer";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { EntityCard } from "@/components/shared/entity-card";
import { EntityTable, type ColumnDef } from "@/components/shared/entity-table";
import { FilterPanel } from "@/components/shared/filter-panel";
import { getRemainingSearches } from "@/lib/search.functions";
import {
  Landmark,
  Search,
  RefreshCw,
  Download,
  MapPin,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Company360View, type Company360Data } from "@/components/shared/company-360-view";

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

const CATEGORY_CHIPS = [
  "All",
  "AI",
  "Fintech",
  "Climate",
  "Healthcare",
  "SaaS",
  "Consumer",
  "Web3",
]; // leaving the comment to not break line nums

import { saveRouteSearchState, loadRouteSearchState } from "@/lib/store/search-store";

function InvestorsPage() {
  const searchFn = useServerFn(runInvestorSearch);
  const verifyFn = useServerFn(refreshInvestorVerification);
  const getUsage = useServerFn(getRemainingSearches);
  const usageQuery = useQuery({ queryKey: ["usage"], queryFn: () => getUsage() });

  const initialState = useMemo(() => loadRouteSearchState<InvestorWithMetadata>("investors"), []);

  const [query, setQuery] = useState(initialState?.filters?.query ?? "");
  const [stage, setStage] = useState(initialState?.filters?.stage ?? "any");
  const [sector, setSector] = useState(initialState?.filters?.sector ?? "");
  const [checkBand, setCheckBand] = useState<"angel" | "seed" | "growth" | "any">(
    initialState?.filters?.checkBand ?? "any",
  );
  const [location, setLocation] = useState(initialState?.filters?.location ?? "");
  const [rows, setRows] = useState<InvestorWithMetadata[]>(initialState?.results ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(initialState?.filters ?? {});
  const [searched, setSearched] = useState(Boolean(initialState?.results?.length));
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [selectedEntity, setSelectedEntity] = useState<Company360Data | null>(null);

  const [filtersCollapsed, setFiltersCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("scrapivo:investors-filters-collapsed") === "1";
  });

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      "scrapivo:investors-filters-collapsed",
      filtersCollapsed ? "1" : "0",
    );
  }

  const runSearch = () => {
    const filters: SearchFilters = {
      query: query.trim(),
      stage: stage === "any" ? undefined : stage,
      location: location.trim() || undefined,
      sector: sector.trim() || undefined,
      checkBand,
    };
    setSearchFilters(filters);
    mut.mutate();
  };

  const mut = useMutation({
    mutationFn: () =>
      searchFn({
        data: {
          query: query.trim(),
          stage: stage === "any" ? undefined : stage,
          location: location.trim() || undefined,
          sector: sector.trim() || undefined,
          checkBand,
          limit: 5000,
        },
      }),
    onSuccess: (res) => {
      const fetchedRows = res.investors ?? [];
      setRows(fetchedRows);
      setSearched(true);
      saveRouteSearchState("investors", {
        query: query.trim(),
        filters: { query, stage, sector, checkBand, location },
        results: fetchedRows,
        timestamp: Date.now(),
      });
      toast.success(`${fetchedRows.length} investors matched`);
    },
    onError: (e: Error) => toast.error(e.message || "Search failed"),
  });

  const verifyMut = useMutation({
    mutationFn: () => verifyFn(),
    onSuccess: (res) => {
      toast.success(`Checked ${res.checked}: ${res.active} active`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleBookmark = (id: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDetailView = (r: InvestorWithMetadata) => {
    const isFirm = "type" in r && r.type === "firm";
    const firm = "firm" in r ? r.firm : "";
    const role = "role" in r ? r.role : "title" in r ? r.title : "";
    const email = "email" in r ? r.email : undefined;
    const website = "website" in r ? r.website : undefined;
    const linkedIn = r.links?.linkedin || undefined;
    const physicalLocation =
      "location" in r && typeof r.location === "string" ? r.location : undefined;
    const categories = getInvestorSectors(r).slice(0, 3);
    const stages = getInvestorStages(r);
    const investorType =
      "entity_type" in r
        ? String(r.entity_type)
        : "investor_type" in r
          ? r.investor_type
          : undefined;
    const thesis =
      ("thesis" in r && r.thesis) || ("investment_thesis" in r && r.investment_thesis) || undefined;
    const checkRange =
      "sweet_spot" in r && r.sweet_spot
        ? `${r.sweet_spot.range_min}–${r.sweet_spot.range_max}`
        : "check_min_usd" in r && "check_max_usd" in r
          ? `${formatUsd(r.check_min_usd)}–${formatUsd(r.check_max_usd)}`
          : "—";

    const description =
      ("bio" in r && r.bio) ||
      ("description" in r && r.description) ||
      ("thesis" in r && r.thesis) ||
      ("investment_thesis" in r && r.investment_thesis) ||
      `${r.name} is ${isFirm ? "a venture capital firm" : "an angel investor"} focusing on ${categories.slice(0, 3).join(", ") || "technology investments"}.`;

    const descriptionStr =
      typeof description === "string"
        ? description
        : `${r.name} is ${isFirm ? "a venture capital firm" : "an angel investor"}.`;

    setSelectedEntity({
      domain: "investor",
      name: r.name,
      subtitle: isFirm ? "VC Firm" : `${role}${firm ? ` · ${firm}` : ""}`,
      category: isFirm ? "Firm" : "Angel",
      location: physicalLocation || undefined,
      description: descriptionStr,
      email,
      website,
      tags: categories,
      check_size: checkRange,
      sectors: categories,
      firm: firm || undefined,
      investor_type: investorType,
      stage: stages.length ? stages.join(", ") : undefined,
      thesis: typeof thesis === "string" ? thesis : undefined,
      stats: [
        { label: "Check Size", value: checkRange },
        { label: "Type", value: isFirm ? "Firm" : "Individual" },
        { label: "Status", value: "Verified" },
      ],
    });
  };

  const exportCsv = () => {
    if (!rows.length) return;
    const header = [
      "name",
      "firm",
      "role",
      "check_range",
      "location",
      "email",
      "website",
      "linkedin",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) => {
        const isFirm = "type" in r && r.type === "firm";
        const firm = "firm" in r ? r.firm : "";
        const role = "role" in r ? r.role : "title" in r ? r.title : "";
        const email = "email" in r ? r.email : "";
        const website = "website" in r ? r.website : "";
        const linkedIn = r.links?.linkedin || "";
        const physicalLocation =
          "location" in r && typeof r.location === "string" ? r.location : "";
        const checkRange =
          "sweet_spot" in r && r.sweet_spot
            ? `${r.sweet_spot.range_min}–${r.sweet_spot.range_max}`
            : "check_min_usd" in r && "check_max_usd" in r
              ? `${formatUsd(r.check_min_usd)}–${formatUsd(r.check_max_usd)}`
              : "";
        return [r.name, firm, role, checkRange, physicalLocation, email, website, linkedIn]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(",");
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scrapivo-investors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tableColumns: ColumnDef<InvestorWithMetadata>[] = [
    {
      header: "Investor / Firm",
      accessor: (r) => {
        const isFirm = "type" in r && r.type === "firm";
        const role = "role" in r ? r.role : "title" in r ? r.title : "";
        const firm = "firm" in r ? r.firm : "";
        return (
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center font-semibold text-white text-xs shrink-0">
              {r.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-white truncate flex items-center gap-1.5">
                <span>{r.name}</span>
                {isFirm && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-medium">
                    Firm
                  </span>
                )}
              </div>
              <div className="text-[11px] text-white/50 truncate">
                {isFirm ? "VC Firm" : `${role}${firm ? ` · ${firm}` : ""}`}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      header: "Location",
      accessor: (r) => {
        const physicalLocation =
          "location" in r && typeof r.location === "string" ? r.location : "";
        return (
          <div className="text-xs text-white/70 truncate flex items-center gap-1">
            <MapPin className="size-3 text-white/40" />
            <span>{physicalLocation || "Not specified"}</span>
          </div>
        );
      },
    },
    {
      header: "Check Size",
      accessor: (r) => {
        const checkRange =
          "sweet_spot" in r && r.sweet_spot
            ? `${r.sweet_spot.range_min}–${r.sweet_spot.range_max}`
            : "check_min_usd" in r && "check_max_usd" in r
              ? `${formatUsd(r.check_min_usd)}–${formatUsd(r.check_max_usd)}`
              : "—";
        return <span className="font-mono text-xs text-white/90">{checkRange}</span>;
      },
    },
    {
      header: "Sectors",
      accessor: (r) => {
        const categories = getInvestorSectors(r).slice(0, 2);
        return (
          <div className="flex flex-wrap gap-1">
            {categories.map((c, i) => (
              <span
                key={i}
                className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/70 border border-white/10"
              >
                {c}
              </span>
            ))}
          </div>
        );
      },
    },
  ];

  const FilterForm = (
    <>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Keyword Search</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Enterprise, Health, DevTools"
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Sector / Focus</span>
        <input
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          placeholder="e.g. AI, Fintech, Climate"
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Stage</span>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-[#131316] text-xs text-white outline-none focus:border-white/30"
        >
          <option value="any">Any stage</option>
          <option value="Pre-seed">Pre-seed</option>
          <option value="Seed">Seed</option>
          <option value="Series A">Series A</option>
          <option value="Series B">Series B</option>
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Check Size</span>
        <select
          value={checkBand}
          onChange={(e) => setCheckBand(e.target.value as typeof checkBand)}
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-[#131316] text-xs text-white outline-none focus:border-white/30"
        >
          <option value="any">Any check size</option>
          <option value="angel">Angel (&lt;$100K)</option>
          <option value="seed">$100K–$5M</option>
          <option value="growth">$5M+</option>
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Location / Region</span>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Dhaka, New York, Asia..."
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
        />
      </label>

      <button
        type="button"
        onClick={() => verifyMut.mutate()}
        disabled={verifyMut.isPending}
        className="w-full glass-pill py-2 px-3 text-xs font-medium text-white/70 hover:text-white flex items-center justify-center gap-1.5 mt-2"
      >
        <RefreshCw className={`size-3.5 ${verifyMut.isPending ? "animate-spin" : ""}`} />
        <span>Refresh Status</span>
      </button>
    </>
  );

  return (
    <div className="h-full flex overflow-hidden bg-[#0a0a0b] text-white">
      {/* Main Content Area */}
      <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Header Title & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
              <Landmark className="size-3.5" />
              <span>VC & Angel Outreach</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Investors Directory
            </h1>
            <p className="text-xs text-white/60 mt-1 max-w-xl">
              Match VCs and angels by sector, stage, check size, and geographic focus.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {rows.length > 0 && (
              <button
                type="button"
                onClick={exportCsv}
                className="glass-pill px-3.5 py-1.5 text-xs font-medium text-white/80 hover:text-white flex items-center gap-1.5"
              >
                <Download className="size-3.5" />
                <span>Export CSV</span>
              </button>
            )}
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          </div>
        </div>

        {/* Removed Category Chips */}

        {/* Loading / Searching State */}
        {mut.isPending && (
          <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/60">
            <RefreshCw className="size-5 animate-spin mx-auto mb-3 text-white/40" />
            <p>Searching investors directory...</p>
          </div>
        )}

        {/* Results */}
        {!mut.isPending && searched && rows.length > 0 && (
          <div>
            <div className="text-xs text-white/50 mb-3">{rows.length} investors matched</div>
            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rows.map((r) => {
                  const isFirm = "type" in r && r.type === "firm";
                  const firm = "firm" in r ? r.firm : "";
                  const role = "role" in r ? r.role : "title" in r ? r.title : "";
                  const email = "email" in r ? r.email : undefined;
                  const website = "website" in r ? r.website : undefined;
                  const linkedIn = r.links?.linkedin || undefined;
                  const physicalLocation =
                    "location" in r && typeof r.location === "string" ? r.location : "";
                  const categories = getInvestorSectors(r).slice(0, 3);
                  const checkRange =
                    "sweet_spot" in r && r.sweet_spot
                      ? `${r.sweet_spot.range_min}–${r.sweet_spot.range_max}`
                      : "check_min_usd" in r && "check_max_usd" in r
                        ? `${formatUsd(r.check_min_usd)}–${formatUsd(r.check_max_usd)}`
                        : "—";
                  const relevantBecause = generateRelevantBecause(
                    r,
                    searchFilters,
                    r._matchMetadata || {},
                  );

                  return (
                    <EntityCard
                      key={r.id}
                      id={r.id}
                      title={r.name}
                      subtitle={isFirm ? "VC Firm" : `${role}${firm ? ` · ${firm}` : ""}`}
                      category={isFirm ? "Firm" : "Angel"}
                      location={physicalLocation || undefined}
                      stats={[
                        { label: "Check Size", value: checkRange },
                        { label: "Type", value: isFirm ? "Firm" : "Individual" },
                        { label: "Status", value: "Verified" },
                      ]}
                      tags={categories}
                      relevantBecause={searchFilters.location ? relevantBecause : undefined}
                      saved={bookmarkedIds.has(r.id)}
                      onSaveToggle={() => toggleBookmark(r.id)}
                      primaryActionLabel="View Details"
                      onViewDetails={() => openDetailView(r)}
                      onClick={() => openDetailView(r)}
                    />
                  );
                })}
              </div>
            ) : (
              <EntityTable
                rows={rows}
                keyExtractor={(r) => r.id}
                columns={tableColumns}
                onBookmark={(r) => toggleBookmark(r.id)}
                isBookmarked={(r) => bookmarkedIds.has(r.id)}
                onRowClick={openDetailView}
              />
            )}
          </div>
        )}

        {!mut.isPending && searched && !rows.length && (
          <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/50">
            No investors matched those filters. Try broadening location or check size.
          </div>
        )}

        {!mut.isPending && !searched && (
          <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/60 space-y-3">
            <Landmark className="size-8 mx-auto text-white/30" />
            <h3 className="text-base font-semibold text-white">Find Active Investors</h3>
            <p className="max-w-md mx-auto text-xs text-white/50 leading-relaxed">
              Use the filter panel on the right (or tap Search) to browse VCs and angels.
            </p>
            <button
              type="button"
              onClick={runSearch}
              className="glass-pill px-5 py-2 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 inline-flex items-center gap-2"
            >
              <Search className="size-3.5" />
              <span>Browse All Investors</span>
            </button>
          </div>
        )}
      </div>

      {/* Right Rail Filter Panel */}
      <div
        className={`hidden lg:block relative shrink-0 border-l border-white/10 bg-black/20 transition-all duration-300 ${
          filtersCollapsed ? "w-48 p-4" : "w-80 max-w-[28vw] p-5"
        }`}
      >
        <div className="w-full h-full">
          <FilterPanel
            title="Filter Investors"
            subtitle="Refine stage, check size, & region"
            onApply={runSearch}
            isPending={mut.isPending}
            applyLabel="Find Investors"
            usage={usageQuery.data ?? undefined}
            onToggleCollapse={() => setFiltersCollapsed(!filtersCollapsed)}
            isCollapsed={filtersCollapsed}
          >
            {FilterForm}
          </FilterPanel>
        </div>
      </div>

      {/* Detail View Drawer */}
      <Company360View data={selectedEntity} onClose={() => setSelectedEntity(null)} />
    </div>
  );
}
