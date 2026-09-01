import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { runLocalBusinessSearch } from "@/lib/local-businesses.functions";
import type { LocalBusinessRow, OpportunityTag } from "@/lib/search/lead-segments";
import {
  buildGuidedQuestions,
  parseSearchIntent,
  type FlowAnswers,
  type FlowQuestion,
  type ParsedIntent,
} from "@/lib/search/guided-intent";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { EntityCard } from "@/components/shared/entity-card";
import { EntityTable, type ColumnDef } from "@/components/shared/entity-table";
import { PageComposer, ResultsBar } from "@/components/shared/search-dock";
import type { ComposerHandle } from "@/components/discover/unified-composer";
import { GuidedQuestionnaire, PageHeroCard } from "@/components/shared/guided-search";
import { LoadMoreSentinel } from "@/components/shared/load-more-sentinel";
import { useProgressiveCount } from "@/hooks/use-progressive-count";
import { saveRouteSearchState, loadRouteSearchState } from "@/lib/store/search-store";
import { friendlyErrorText } from "@/lib/friendly-error";
import { Store, Download, MapPin, Phone, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { UrlIntelBox } from "@/components/url-intel-box";
import { Company360View, type Company360Data } from "@/components/shared/company-360-view";
import { populatedFields } from "@/lib/records/populated-fields";
import { humanLabel, isInternalKey } from "@/lib/records/field-labels";

export const Route = createFileRoute("/_authenticated/local-businesses")({
  head: () => ({
    meta: [{ title: "Scrapivo — Local businesses" }],
  }),
  component: LocalBusinessesPage,
});

/** Composer autotype examples — businesses-only, never investors/jobs. */
const COMPOSER_EXAMPLES = [
  "dentists in Austin, TX…",
  "10 roofers in Toronto…",
  "med spas in Miami…",
  "law firms in London…",
  "gyms in New York…",
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

  const initialState = useMemo(
    () => loadRouteSearchState<LocalBusinessRow>("local-businesses"),
    [],
  );

  const [input, setInput] = useState("");
  const [category, setCategory] = useState(initialState?.filters?.category ?? "");
  const [location, setLocation] = useState(initialState?.filters?.location ?? "");
  const [rows, setRows] = useState<LocalBusinessRow[]>(initialState?.results ?? []);
  const [flow, setFlow] = useState<{
    input: string;
    parsed: ParsedIntent;
    questions: FlowQuestion[];
  } | null>(null);
  const [filter, setFilter] = useState<OpportunityTag | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [bookmarkedKeys, setBookmarkedKeys] = useState<Set<string>>(new Set());
  const [selectedEntity, setSelectedEntity] = useState<Company360Data | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  type BusinessSearchVars = {
    category: string;
    location: string;
    /** Contact-quality floor every delivered row must meet. */
    requirement: "contact" | "email" | "phone" | "website" | "any";
    /** Pain-signal the user is hunting (maps to OpportunityTag chips). */
    opportunity: OpportunityTag | "any";
    /** Exact list size the user asked for; null = as many as possible. */
    count: number | null;
    /** What the user sells — recorded for context in saved state. */
    service: string;
  };

  const OPPORTUNITY_VALUES: OpportunityTag[] = [
    "no_website",
    "poor_design",
    "not_mobile_friendly",
    "seo_poor",
    "has_email",
    "has_phone",
    "sales_ready",
  ];

  const meetsRequirement = (
    r: LocalBusinessRow,
    requirement: BusinessSearchVars["requirement"],
  ): boolean => {
    switch (requirement) {
      case "email":
        return Boolean(r.email);
      case "phone":
        return Boolean(r.phone);
      case "website":
        return Boolean(r.website);
      case "contact":
        return Boolean(r.email || r.phone);
      default:
        return true;
    }
  };

  // Guided flow: parse the free-form ask deterministically, then confirm the
  // missing target dimensions (category/location) plus the ICP questions
  // (service, contact requirement, pain signal, list size) which describe the
  // USER and are therefore always collected.
  const launchSearch = (parsed: ParsedIntent, answers?: FlowAnswers) => {
    const nextCategory = (answers?.category ?? parsed.category ?? "").trim();
    const nextLocation = (answers?.location ?? parsed.location ?? "").trim();
    if (nextCategory.length < 2 || nextLocation.length < 2) return;
    const rawCount = answers?.count ?? (parsed.count != null ? String(parsed.count) : "any");
    const rawOpportunity = answers?.opportunity ?? "any";
    setCategory(nextCategory);
    setLocation(nextLocation);
    setFlow(null);
    mut.mutate({
      category: nextCategory,
      location: nextLocation,
      requirement: (answers?.requirement ?? "any") as BusinessSearchVars["requirement"],
      opportunity: (OPPORTUNITY_VALUES.includes(rawOpportunity as OpportunityTag)
        ? rawOpportunity
        : "any") as BusinessSearchVars["opportunity"],
      count: /^\d+$/.test(rawCount) ? Number(rawCount) : null,
      service: (answers?.service ?? "").trim(),
    });
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;
    // Chat-style UX: the ask moves up into the flow/results area, the
    // composer clears for the next input.
    setInput("");
    const parsed = parseSearchIntent("businesses", text);
    const questions = buildGuidedQuestions("businesses", parsed);
    if (questions.length) {
      setFlow({ input: text, parsed, questions });
      return;
    }
    launchSearch(parsed);
  };

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.opportunity_tags?.includes(filter));
  }, [rows, filter]);

  // Progressive rendering: keep the mounted card count small and grow on scroll.
  const { visible, hasMore, loadMore, shown } = useProgressiveCount(filtered, 24);

  const mut = useMutation({
    mutationFn: (vars: BusinessSearchVars) =>
      searchFn({
        data: {
          category: vars.category.trim(),
          location: vars.location.trim(),
          enrichEmails: true,
        },
      }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["usage"] });
      if (res.error === "limit") {
        toast.error(res.message ?? "Search limit reached");
        return;
      }
      // Requirement and pain-signal first, then cap: deliver exactly the
      // requested list size from rows that actually meet the ICP floor.
      const fetched = res.businesses ?? [];
      const qualified = fetched
        .filter((r) => meetsRequirement(r, vars.requirement))
        .filter((r) =>
          vars.opportunity === "any" ? true : r.opportunity_tags?.includes(vars.opportunity),
        );
      const fetchedRows = vars.count != null ? qualified.slice(0, vars.count) : qualified;
      setRows(fetchedRows);
      setFilter(vars.opportunity === "any" ? "all" : vars.opportunity);
      saveRouteSearchState("local-businesses", {
        query: `${vars.category} in ${vars.location}`,
        filters: {
          category: vars.category,
          location: vars.location,
          requirement: vars.requirement,
          opportunity: vars.opportunity,
          count: vars.count,
          service: vars.service,
        },
        results: fetchedRows,
        timestamp: Date.now(),
      });
      if (!fetchedRows.length) {
        toast.message(
          fetched.length
            ? vars.opportunity === "any"
              ? "No businesses matched your contact requirement, try 'No requirement'"
              : "No businesses matched that signal, try 'Any business'"
            : res.message || "No live listings found",
        );
        return;
      }
      toast.success(`${fetchedRows.length} local businesses found`);
    },
    onError: (e: Error) => toast.error(friendlyErrorText(e, "Search failed")),
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
                    setFlow(null);
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

            {/* Guided questionnaire: opens after the user submits an ask that
                is missing a category or a location. */}
            {!mut.isPending && flow && (
              <GuidedQuestionnaire
                title="Find Businesses"
                input={flow.input}
                questions={flow.questions}
                pending={mut.isPending}
                onDone={(answers) => launchSearch(flow.parsed, answers)}
                onCancel={() => setFlow(null)}
              />
            )}

            {/* Compact entry card (home-page style) — only before a search. */}
            {!mut.isPending && !flow && !rows.length && (
              <PageHeroCard
                icon={Store}
                title="Find Businesses"
                description="Describe what you need — we'll ask a couple of quick questions, then pull live listings with emails and phone numbers."
                onStart={() => composerRef.current?.focus()}
              />
            )}

            {/* Paste-a-URL intelligence — docked above composer. */}
          </div>
        </div>

        {!mut.isPending && (
          <div className="shrink-0 border-t border-white/5 px-4 md:px-6 pt-2">
            <UrlIntelBox
              variant="local"
              collapsed={rows.length > 0}
              onConfirm={(intel) => {
                const category = (intel.industry || intel.sectors[0] || intel.name || "").trim();
                const location = (intel.location || "").trim();
                if (category.length < 2 || location.length < 2) {
                  toast.message(
                    "Need both an industry and a location from that URL — edit them in and search again.",
                  );
                  return;
                }
                setCategory(category);
                setLocation(location);
                mut.mutate({
                  category,
                  location,
                  requirement: "any",
                  opportunity: "any",
                  count: null,
                  service: "",
                });
              }}
            />
          </div>
        )}

        {/* Bottom-docked composer */}
        <PageComposer
          ref={composerRef}
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          pending={mut.isPending}
          examples={COMPOSER_EXAMPLES}
        />
      </div>

      {/* Detail View Drawer */}
      <Company360View data={selectedEntity} onClose={() => setSelectedEntity(null)} />
    </div>
  );
}
