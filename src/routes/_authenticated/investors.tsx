import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { runInvestorSearch, refreshInvestorVerification } from "@/lib/investors.functions";
import type { InvestorWithMetadata } from "@/lib/investors/search";
import { hasProfileImage, investorImageUrl } from "@/lib/investors/search";
import {
  buildInvestorCardModel,
  checkSizeOf,
  generateRelevantBecause,
  hasExplicitAngel,
  investorRowKey,
  isFirmRecord,
  populatedFields,
  type SearchFilters,
} from "@/lib/investors/card-adapters";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { EntityCard } from "@/components/shared/entity-card";
import { EntityTable, type ColumnDef } from "@/components/shared/entity-table";
import { FilterPanel } from "@/components/shared/filter-panel";
import { MobileFilterSheet } from "@/components/shared/mobile-filter-sheet";
import { LoadMoreSentinel } from "@/components/shared/load-more-sentinel";
import { useProgressiveCount } from "@/hooks/use-progressive-count";
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
import { humanLabel, isInternalKey } from "@/lib/records/field-labels";

export const Route = createFileRoute("/_authenticated/investors")({
  head: () => ({
    meta: [{ title: "Scrapivo — Investors" }],
  }),
  component: InvestorsPage,
});

function buildInvestorEntity(r: InvestorWithMetadata): Company360Data {
  const m = buildInvestorCardModel(r);
  return {
    domain: "investor",
    name: r.name,
    subtitle: m.subtitle,
    category: m.category,
    location: m.location,
    description: m.description,
    email: m.email,
    website: m.website,
    phone: m.phone,
    logo_url: investorImageUrl(r) ?? undefined,
    tags: m.tags,
    check_size: m.checkSize,
    sectors: m.sectors,
    firm: m.isFirm ? undefined : m.firmName,
    investor_type: m.typeBadges.join(", ") || undefined,
    stage: m.stages.length ? m.stages.join(", ") : undefined,
    stats: m.detailStats,
    links: m.links,
    // Full Record: every populated field with human-friendly labels; internal
    // parser metadata (id, record_type, source_file, image_url, score) is
    // surfaced via badges/images, never as raw rows.
    record_fields: populatedFields(r)
      .filter((f) => !isInternalKey(f.key))
      .map((f) => ({ label: humanLabel(f.key), value: f.value })),
  };
}

// Memoized grid card: with up to thousands of rows, per-card derived values
// (sectors, relevance text) must only recompute when this row's own props change.
const InvestorGridCard = memo(function InvestorGridCard({
  row,
  saved,
  searchFilters,
  onToggleBookmark,
  onOpen,
  onAvatarError,
}: {
  row: InvestorWithMetadata;
  saved: boolean;
  searchFilters: SearchFilters;
  onToggleBookmark: (id: string) => void;
  onOpen: (row: InvestorWithMetadata) => void;
  onAvatarError: (id: string) => void;
}) {
  // Data-driven card model: classification, badges, stats, and tags all
  // come from the record's own fields (record_type first) — never defaults.
  const model = buildInvestorCardModel(row);
  const relevantBecause = generateRelevantBecause(row, searchFilters, row._matchMetadata || {});
  const avatarUrl = investorImageUrl(row);

  return (
    <EntityCard
      id={model.key}
      title={row.name}
      subtitle={model.subtitle}
      category={model.category}
      location={model.location}
      avatarUrl={avatarUrl ?? undefined}
      onAvatarError={() => onAvatarError(model.key)}
      stats={model.cardStats}
      tags={model.tags}
      description={model.description}
      relevantBecause={searchFilters.location ? relevantBecause : undefined}
      saved={saved}
      onSaveToggle={() => onToggleBookmark(model.key)}
      primaryActionLabel="View Details"
      onViewDetails={() => onOpen(row)}
      onClick={() => onOpen(row)}
    />
  );
});

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

  // Reset clears the form fields without firing a search (searches are quota-limited).
  const resetFilters = () => {
    setQuery("");
    setStage("any");
    setSector("");
    setCheckBand("any");
    setLocation("");
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
        // Cap what we persist: serializing thousands of rich investor objects
        // into sessionStorage on every search was a major source of lag.
        results: fetchedRows.slice(0, 300),
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

  // Records whose profile image failed to load drop into the no-image
  // group (initials fallback shown); re-rank with the server's _ranking
  // scores so the strict image → completeness → relevance → name order holds.
  const [brokenImages, setBrokenImages] = useState<ReadonlySet<string>>(() => new Set());
  const markBrokenImage = useCallback((id: string) => {
    setBrokenImages((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const rankedRows = useMemo(() => {
    if (brokenImages.size === 0) return rows;
    const key = (r: InvestorWithMetadata) => ({
      img: hasProfileImage(r) && !brokenImages.has(investorRowKey(r)) ? 1 : 0,
      comp: r._ranking?.completeness ?? 0,
      rel: r._ranking?.relevance ?? 0,
    });
    return [...rows].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (
        kb.img - ka.img || kb.comp - ka.comp || kb.rel - ka.rel || a.name.localeCompare(b.name)
      );
    });
  }, [rows, brokenImages]);

  // Debug check (dev only): log the first 20 rendered records with their
  // source classification and the badges actually rendered, then verify two
  // invariants over the full result set — no firm record renders an
  // Angel/Individual badge, and no individual renders Angel unless the
  // source investor_type explicitly includes it — plus the image-first order.
  useEffect(() => {
    if (!import.meta.env.DEV || rankedRows.length === 0) return;
    let lastImg = -1;
    let firstNoImg = -1;
    rankedRows.forEach((r, i) => {
      if (hasProfileImage(r)) lastImg = i;
      else if (firstNoImg < 0) firstNoImg = i;
    });
    let badgeViolations = 0;
    let uncoveredFields = 0;
    for (const r of rankedRows) {
      const m = buildInvestorCardModel(r);
      const rendered = [m.category, ...m.typeBadges].filter(Boolean);
      if (m.isFirm && rendered.some((b) => b === "Angel" || b === "Individual")) {
        badgeViolations++;
      }
      if (!m.isFirm && rendered.includes("Angel") && !hasExplicitAngel(r)) {
        badgeViolations++;
      }
      // Field audit: every populated source field must be rendered in the
      // Details drawer (record_fields) or surfaced on the card/list model.
      const fields = populatedFields(r);
      const detailKeys = new Set(fields.map((f) => f.key));
      const cardJson = JSON.stringify(m);
      for (const f of fields) {
        // Internal metadata is intentionally rendered as badges/images,
        // not as rows — exclude it from the coverage audit.
        if (isInternalKey(f.key)) continue;
        const snippet = f.value.length > 32 ? f.value.slice(0, 32) : f.value;
        if (!detailKeys.has(f.key) && !cardJson.includes(snippet)) {
          uncoveredFields++;
          if (uncoveredFields <= 5) {
            console.warn(`[investors-audit] populated field not rendered: ${r.name} → ${f.key}`);
          }
        }
      }
    }
    console.info(
      "[investors-cards] first 20:",
      rankedRows.slice(0, 20).map((r) => {
        const rec = r as Record<string, unknown>;
        const m = buildInvestorCardModel(r);
        return {
          name: r.name,
          record_type: rec.record_type ?? null,
          investor_type: rec.investor_type ?? rec.investor_types ?? null,
          firm_type: rec.firm_type ?? null,
          title: rec.title ?? null,
          current_role: rec.current_role ?? null,
          firm_name: rec.firm_name ?? null,
          image_url: investorImageUrl(r),
          populatedFields: populatedFields(r).map((f) => f.key),
          renderedBadges: [m.category, ...m.typeBadges].filter(Boolean),
        };
      }),
      badgeViolations === 0
        ? "| OK: no firm renders Angel/Individual; Angel only when the source says so"
        : `| BADGE VIOLATIONS: ${badgeViolations}`,
      uncoveredFields === 0
        ? "| OK: every populated source field is rendered"
        : `| UNRENDERED FIELDS: ${uncoveredFields}`,
      firstNoImg >= 0 && lastImg > firstNoImg
        ? `ORDERING VIOLATION at index ${firstNoImg}`
        : "| OK: no image-less record before an image-backed one",
    );
  }, [rankedRows]);

  // Progressive rendering: only mount a window of cards and grow it as the
  // user scrolls, instead of rendering thousands of cards at once.
  const { visible, hasMore, loadMore, shown } = useProgressiveCount(rankedRows, 24);

  // Stable callbacks so memoized cards don't re-render on unrelated state changes.
  const toggleBookmark = useCallback((id: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openDetailView = useCallback((r: InvestorWithMetadata) => {
    setSelectedEntity(buildInvestorEntity(r));
  }, []);

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
        const m = buildInvestorCardModel(r);
        const firm = m.isFirm ? "" : (m.firmName ?? "");
        const role = m.isFirm ? (m.subtitle ?? "") : (m.role ?? m.title ?? "");
        const email = m.email ?? "";
        const website = m.website ?? "";
        const linkedIn = m.linkedin ?? "";
        const physicalLocation = m.location ?? "";
        const checkRange = m.checkSize ?? "";
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
        const m = buildInvestorCardModel(r);
        const avatarUrl = investorImageUrl(r);
        return (
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={r.name}
                loading="lazy"
                className="size-9 rounded-xl object-cover border border-white/15 shrink-0"
              />
            ) : (
              <div className="size-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center font-semibold text-white text-xs shrink-0">
                {r.name[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold text-white truncate flex items-center gap-1.5">
                <span>{r.name}</span>
                {m.isFirm && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-medium">
                    Firm
                  </span>
                )}
              </div>
              <div className="text-[11px] text-white/50 truncate">{m.subtitle ?? ""}</div>
            </div>
          </div>
        );
      },
    },
    {
      header: "Location",
      accessor: (r) => {
        const m = buildInvestorCardModel(r);
        return (
          <div className="text-xs text-white/70 truncate flex items-center gap-1">
            <MapPin className="size-3 text-white/40" />
            <span>{m.location ?? "Not specified"}</span>
          </div>
        );
      },
    },
    {
      header: "Check Size",
      accessor: (r) => {
        const checkRange = checkSizeOf(r) ?? "—";
        return <span className="font-mono text-xs text-white/90">{checkRange}</span>;
      },
    },
    {
      header: "Sectors",
      accessor: (r) => {
        const categories = buildInvestorCardModel(r).sectors.slice(0, 2);
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

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            {/* Mobile filter entry — desktop uses the persistent right rail below */}
            <MobileFilterSheet
              title="Filter Investors"
              subtitle="Refine stage, check size, & region"
              onApply={runSearch}
              onReset={resetFilters}
              isPending={mut.isPending}
              applyLabel="Find Investors"
              usage={usageQuery.data ?? undefined}
            >
              {FilterForm}
            </MobileFilterSheet>
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
            <div className="text-xs text-white/50 mb-3">
              {rows.length} investors matched{hasMore ? ` — showing ${shown}` : ""}
            </div>
            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visible.map((r) => (
                  <InvestorGridCard
                    key={investorRowKey(r)}
                    row={r}
                    saved={bookmarkedIds.has(investorRowKey(r))}
                    searchFilters={searchFilters}
                    onToggleBookmark={toggleBookmark}
                    onOpen={openDetailView}
                    onAvatarError={markBrokenImage}
                  />
                ))}
              </div>
            ) : (
              <EntityTable
                rows={visible}
                keyExtractor={(r) => investorRowKey(r)}
                columns={tableColumns}
                onBookmark={(r) => toggleBookmark(investorRowKey(r))}
                isBookmarked={(r) => bookmarkedIds.has(investorRowKey(r))}
                onRowClick={openDetailView}
              />
            )}
            <LoadMoreSentinel
              hasMore={hasMore}
              onLoadMore={loadMore}
              shown={shown}
              total={rows.length}
            />
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
              Use the Filters panel (or tap Browse) to search VCs and angels by sector, stage, and
              location.
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
            onReset={resetFilters}
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
