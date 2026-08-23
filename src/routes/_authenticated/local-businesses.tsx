import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { runLocalBusinessSearch } from "@/lib/local-businesses.functions";
import type { LocalBusinessRow, OpportunityTag } from "@/lib/search/lead-segments";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { EntityCard } from "@/components/shared/entity-card";
import { EntityTable, type ColumnDef } from "@/components/shared/entity-table";
import { PageComposer, ResultsBar } from "@/components/shared/search-dock";
import type { ComposerHandle } from "@/components/discover/unified-composer";
import { LoadMoreSentinel } from "@/components/shared/load-more-sentinel";
import { useProgressiveCount } from "@/hooks/use-progressive-count";
import { getRemainingSearches } from "@/lib/search.functions";
import { saveRouteSearchState, loadRouteSearchState } from "@/lib/store/search-store";
import { Store, Search, Download, MapPin, Phone, Mail, Globe, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Company360View, type Company360Data } from "@/components/shared/company-360-view";
import { populatedFields } from "@/lib/records/populated-fields";
import { humanLabel, isInternalKey } from "@/lib/records/field-labels";

export const Route = createFileRoute("/_authenticated/local-businesses")({
  head: () => ({
    meta: [{ title: "Scrapivo — Local businesses" }],
  }),
  component: LocalBusinessesPage,
});

const CATEGORY_SUGGESTIONS = [
  "dentists",
  "roofers",
  "law firms",
  "gyms",
  "med spas",
  "plumbers",
  "electricians",
  "HVAC",
  "marketing agencies",
  "restaurants",
  "cafes",
  "salons",
];

const LOCATION_SUGGESTIONS = [
  "Dhaka",
  "Austin TX",
  "Toronto",
  "London",
  "New York",
  "Los Angeles",
  "Miami",
];

const OPPORTUNITY_FILTERS: { id: OpportunityTag | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "no_website", label: "No website" },
  { id: "poor_design", label: "Poor design" },
  { id: "not_mobile_friendly", label: "Not mobile" },
  { id: "seo_poor", label: "SEO poor" },
  { id: "has_email", label: "Has email" },
  { id: "has_phone", label: "Has phone" },
  { id: "sales_ready", label: "Sales ready" },
];

function LocalBusinessesPage() {
  const qc = useQueryClient();
  const searchFn = useServerFn(runLocalBusinessSearch);
  const getUsage = useServerFn(getRemainingSearches);
  const usageQuery = useQuery({ queryKey: ["usage"], queryFn: () => getUsage() });

  const initialState = useMemo(
    () => loadRouteSearchState<LocalBusinessRow>("local-businesses"),
    [],
  );

  const [category, setCategory] = useState(initialState?.filters?.category ?? "");
  const [location, setLocation] = useState(initialState?.filters?.location ?? "");
  const [rows, setRows] = useState<LocalBusinessRow[]>(initialState?.results ?? []);
  const [filter, setFilter] = useState<OpportunityTag | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [bookmarkedKeys, setBookmarkedKeys] = useState<Set<string>>(new Set());
  const [selectedEntity, setSelectedEntity] = useState<Company360Data | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);

  // How many guided-questionnaire answers differ from their defaults.
  const activeRefineCount = [location.trim() !== ""].filter(Boolean).length;

  // Composer submit + Refine "Search Businesses" share this entry point;
  // the server needs both a category and a location to scope listings.
  const runSearch = () => {
    if (category.trim().length < 2 || location.trim().length < 2) {
      toast.error("Enter a category and location");
      return;
    }
    mut.mutate();
  };

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.opportunity_tags?.includes(filter));
  }, [rows, filter]);

  // Progressive rendering: keep the mounted card count small and grow on scroll.
  const { visible, hasMore, loadMore, shown } = useProgressiveCount(filtered, 24);

  // Reset clears the form fields without firing a search (searches are quota-limited).
  const resetFilters = () => {
    setCategory("");
    setLocation("");
  };

  const mut = useMutation({
    mutationFn: () =>
      searchFn({
        data: {
          category: category.trim(),
          location: location.trim(),
          enrichEmails: true,
        },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["usage"] });
      if (res.error === "limit") {
        toast.error(res.message ?? "Search limit reached");
        return;
      }
      const fetchedRows = res.businesses ?? [];
      setRows(fetchedRows);
      setFilter("all");
      saveRouteSearchState("local-businesses", {
        query: `${category} in ${location}`,
        filters: { category, location },
        results: fetchedRows,
        timestamp: Date.now(),
      });
      if (!fetchedRows.length) {
        toast.message(res.message || "No live listings found");
        return;
      }
      toast.success(`${fetchedRows.length} local businesses found`);
    },
    onError: (e: Error) => toast.error(e.message || "Search failed"),
  });

  const toggleBookmark = (key: string) => {
    setBookmarkedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openDetailView = (r: LocalBusinessRow) => {
    // Full record: every populated business field reaches the drawer with a
    // human-friendly label; internal scoring metadata stays hidden.
    const recordFields = populatedFields(r)
      .filter((f) => !isInternalKey(f.key))
      .map((f) => ({ label: humanLabel(f.key), value: f.value }));
    setSelectedEntity({
      domain: "business",
      name: r.name,
      category: r.category || "Local Business",
      location: r.address || undefined,
      phone: r.phone || undefined,
      email: r.email || undefined,
      website: r.website || undefined,
      description: r.description || undefined,
      opportunity_tags: r.opportunity_tags || [],
      links: [
        ...(r.website ? [{ label: "Website", href: r.website }] : []),
        ...(r.sample_url ? [{ label: "Listing source", href: r.sample_url }] : []),
      ],
      record_fields: recordFields,
    });
  };

  const exportCsv = () => {
    if (!filtered.length) return;
    const header = ["name", "category", "address", "phone", "email", "website", "tags"];
    const lines = [
      header.join(","),
      ...filtered.map((r) =>
        [
          r.name,
          r.category ?? "",
          r.address ?? "",
          r.phone ?? "",
          r.email ?? "",
          r.website ?? "",
          (r.opportunity_tags ?? []).join("|"),
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scrapivo-local-${category || "businesses"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tableColumns: ColumnDef<LocalBusinessRow>[] = [
    {
      header: "Business Name",
      accessor: (r) => (
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center font-semibold text-white text-xs shrink-0">
            {r.name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-white truncate">{r.name}</div>
            <div className="text-[11px] text-white/50 truncate">
              {r.category || "Local Business"}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: "Address / Location",
      accessor: (r) => (
        <div className="text-xs text-white/70 truncate flex items-center gap-1">
          <MapPin className="size-3 text-white/40 shrink-0" />
          <span className="truncate">{r.address || "Not listed"}</span>
        </div>
      ),
    },
    {
      header: "Contact Info",
      accessor: (r) => (
        <div className="space-y-0.5 text-xs text-white/80">
          {r.email && (
            <div className="flex items-center gap-1 truncate text-emerald-400">
              <Mail className="size-3 shrink-0" />
              <span className="truncate">{r.email}</span>
            </div>
          )}
          {r.phone && (
            <div className="flex items-center gap-1 truncate text-white/60">
              <Phone className="size-3 shrink-0" />
              <span className="truncate">{r.phone}</span>
            </div>
          )}
          {!r.email && !r.phone && <span className="text-white/40">—</span>}
        </div>
      ),
    },
    {
      header: "Opportunity Tags",
      accessor: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.opportunity_tags || []).slice(0, 2).map((t, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/70 border border-white/10"
            >
              {t.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="h-full flex min-h-0 bg-[#0a0a0b] text-white">
      {/* Main column: scrollable results + bottom-docked composer (Discover-style) */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6">
          <div className="max-w-5xl mx-auto py-6 space-y-6">
            {/* Header Title & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
                  <Store className="size-3.5" />
                  <span>Business Lead Generation</span>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Businesses</h1>
                <p className="text-xs text-white/60 mt-1 max-w-xl">
                  Live listings with scraped emails, phone numbers, website status, and outreach
                  signals.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0 flex-wrap">
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

            {/* Opportunity Filter Chips */}
            {rows.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {OPPORTUNITY_FILTERS.map((f) => {
                  const active = filter === f.id;
                  const count =
                    f.id === "all"
                      ? rows.length
                      : rows.filter((r) => r.opportunity_tags?.includes(f.id as OpportunityTag))
                          .length;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      className={`glass-pill px-3 py-1.5 text-xs font-medium transition-all ${
                        active
                          ? "bg-white/20 text-white border-white/30"
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <span>{f.label}</span>
                      <span className="ml-1.5 text-[10px] opacity-60">({count})</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Loading State */}
            {mut.isPending && (
              <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/60">
                <RefreshCw className="size-5 animate-spin mx-auto mb-3 text-white/40" />
                <p>Collecting local listings & harvesting contacts...</p>
              </div>
            )}

            {/* Results */}
            {!mut.isPending && rows.length > 0 && (
              <div className="space-y-3">
                <ResultsBar
                  count={filtered.length}
                  unit="local businesses listed"
                  shown={shown}
                  hasMore={hasMore}
                  onClear={() => {
                    setRows([]);
                    setFilter("all");
                    composerRef.current?.focus();
                  }}
                />
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {visible.map((r, idx) => {
                      const key = `${r.name}-${r.address || idx}`;
                      const tags = (r.opportunity_tags || []).map((t) => t.replace(/_/g, " "));
                      return (
                        <EntityCard
                          key={key}
                          id={key}
                          title={r.name}
                          subtitle={r.category || "Local Business"}
                          category={r.email ? "Has Email" : "Listing"}
                          location={r.address || undefined}
                          stats={[
                            { label: "Phone", value: r.phone ? "Available" : "None" },
                            {
                              label: "Email",
                              value: r.email ? (r.email_verified ? "Verified" : "Listed") : "None",
                            },
                            { label: "Website", value: r.website ? "Yes" : "No" },
                          ]}
                          tags={tags}
                          description={r.description || undefined}
                          saved={bookmarkedKeys.has(key)}
                          onSaveToggle={() => toggleBookmark(key)}
                          primaryActionLabel="View Details"
                          onViewDetails={() => openDetailView(r)}
                          onClick={() => openDetailView(r)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <EntityTable
                    rows={visible}
                    keyExtractor={(r) => `${r.name}-${r.address || ""}`}
                    columns={tableColumns}
                    onBookmark={(r) => toggleBookmark(`${r.name}-${r.address || ""}`)}
                    isBookmarked={(r) => bookmarkedKeys.has(`${r.name}-${r.address || ""}`)}
                    onRowClick={openDetailView}
                  />
                )}
                <LoadMoreSentinel
                  hasMore={hasMore}
                  onLoadMore={loadMore}
                  shown={shown}
                  total={filtered.length}
                />
              </div>
            )}

            {!mut.isPending && !rows.length && (
              <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/60 space-y-3">
                <Store className="size-8 mx-auto text-white/30" />
                <h3 className="text-base font-semibold text-white">Find Businesses</h3>
                <p className="max-w-md mx-auto text-xs text-white/50 leading-relaxed">
                  Search a category and city below to discover businesses with public contact info —
                  refine with the guided questions.
                </p>
                <button
                  type="button"
                  onClick={() => composerRef.current?.focus()}
                  className="glass-pill px-5 py-2 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 inline-flex items-center gap-2"
                >
                  <Search className="size-3.5" />
                  <span>Start Searching</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bottom-docked composer + guided questionnaire */}
        <PageComposer
          ref={composerRef}
          value={category}
          onChange={setCategory}
          onSubmit={runSearch}
          pending={mut.isPending}
          refine={
            <>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-white/70">City / Location</span>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Austin TX, Toronto, Dhaka..."
                  className="w-full h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch();
                  }}
                />
              </label>

              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">
                  Quick Categories
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto no-scrollbar">
                  {CATEGORY_SUGGESTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`glass-pill px-2.5 py-1 text-[11px] font-medium ${
                        category.toLowerCase() === c.toLowerCase()
                          ? "bg-white/20 text-white"
                          : "text-white/60 hover:text-white"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </>
          }
          refineOpen={refineOpen}
          onToggleRefine={() => setRefineOpen(!refineOpen)}
          activeRefineCount={activeRefineCount}
          onApplyRefine={() => {
            setRefineOpen(false);
            runSearch();
          }}
          onResetRefine={resetFilters}
          applyLabel="Search Businesses"
          applyPending={mut.isPending}
          usage={usageQuery.data ?? undefined}
        />
      </div>

      {/* Detail View Drawer */}
      <Company360View data={selectedEntity} onClose={() => setSelectedEntity(null)} />
    </div>
  );
}
