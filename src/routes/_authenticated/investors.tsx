import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runInvestorSearch, refreshInvestorVerification } from "@/lib/investors.functions";
import type { InvestorWithMetadata } from "@/lib/investors/search";
import { hasProfileImage, investorImageUrl } from "@/lib/investors/search";
import {
  buildInvestorCardModel,
  checkSizeOf,
  generateRelevantBecause,
  hasExplicitAngel,
  investorRowKey,
  populatedFields,
  type SearchFilters,
} from "@/lib/investors/card-adapters";
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
import { Landmark, RefreshCw, Download, MapPin, SearchCheck } from "lucide-react";
import { toast } from "sonner";
import { UrlIntelBox } from "@/components/url-intel-box";
import { Company360View, type Company360Data } from "@/components/shared/company-360-view";
import { humanLabel, isInternalKey } from "@/lib/records/field-labels";

export const Route = createFileRoute("/_authenticated/investors")({
  head: () => ({
    meta: [{ title: "Scrapivo — Investors" }],
  }),
  component: InvestorsPage,
});

/** Composer autotype examples — investors-only, never businesses/jobs. */
const COMPOSER_EXAMPLES = [
  "seed VCs investing in AI startups…",
  "angel investors in New York…",
  "fintech investors with $100K–$5M checks…",
  "pre-seed investors in Europe…",
  "healthcare VCs in Boston…",
];

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

function InvestorsPage() {
  const searchFn = useServerFn(runInvestorSearch);
  const verifyFn = useServerFn(refreshInvestorVerification);

  const initialState = useMemo(() => loadRouteSearchState<InvestorWithMetadata>("investors"), []);

  const [input, setInput] = useState("");
  const [rows, setRows] = useState<InvestorWithMetadata[]>(initialState?.results ?? []);
  const [flow, setFlow] = useState<{
    input: string;
    parsed: ParsedIntent;
    questions: FlowQuestion[];
  } | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(initialState?.filters ?? {});
  const [searched, setSearched] = useState(Boolean(initialState?.results?.length));
  const [broadened, setBroadened] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [selectedEntity, setSelectedEntity] = useState<Company360Data | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  type InvestorSearchVars = SearchFilters & {
    checkBand: "angel" | "seed" | "growth" | "any";
    entityType: "individual" | "firm" | "any";
  };

  // Guided flow: parse the free-form ask deterministically, then ask ONLY for
  // the dimensions the text did not state (stage, check size, geography…).
  const launchSearch = (parsed: ParsedIntent, answers?: FlowAnswers) => {
    const stage = answers?.stage ?? parsed.stage ?? "any";
    const checkBand = (answers?.checkBand ??
      parsed.checkBand ??
      "any") as InvestorSearchVars["checkBand"];
    const location = (answers?.location ?? parsed.location ?? "").trim();
    const sector = (answers?.sector ?? parsed.sector ?? "").trim();
    const entityType = (answers?.entityType ??
      parsed.entityType ??
      "any") as InvestorSearchVars["entityType"];
    const vars: InvestorSearchVars = {
      query: (parsed.query ?? "").trim(),
      stage: stage === "any" ? undefined : stage,
      location: location || undefined,
      sector: sector || undefined,
      checkBand,
      entityType,
    };
    setSearchFilters(vars);
    setFlow(null);
    mut.mutate(vars);
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;
    // Chat-style UX: the ask moves up into the flow/results area, the
    // composer clears for the next input.
    setInput("");
    const parsed = parseSearchIntent("investors", text);
    const questions = buildGuidedQuestions("investors", parsed);
    if (questions.length) {
      setFlow({ input: text, parsed, questions });
      return;
    }
    launchSearch(parsed);
  };

  const mut = useMutation({
    mutationFn: (vars: InvestorSearchVars) =>
      searchFn({
        data: {
          query: vars.query ?? "",
          stage: vars.stage,
          location: vars.location,
          sector: vars.sector,
          checkBand: vars.checkBand,
          entityType: vars.entityType,
          limit: 5000,
        },
      }),
    onSuccess: (res, vars) => {
      const fetchedRows = res.investors ?? [];
      setRows(fetchedRows);
      setSearched(true);
      setBroadened(res.broadened ?? []);
      saveRouteSearchState("investors", {
        query: vars.query ?? "",
        filters: vars,
        // Cap what we persist: serializing thousands of rich investor objects
        // into sessionStorage on every search was a major source of lag.
        results: fetchedRows.slice(0, 300),
        timestamp: Date.now(),
      });
      if (fetchedRows.length) toast.success(`${fetchedRows.length} investors matched`);
    },
    onError: (e: Error) => toast.error(friendlyErrorText(e, "Search failed")),
  });

  const verifyMut = useMutation({
    mutationFn: () => verifyFn(),
    onSuccess: (res) => {
      toast.success(`Checked ${res.checked}: ${res.active} active`);
    },
    onError: (e: Error) => toast.error(friendlyErrorText(e)),
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
                <button
                  type="button"
                  onClick={() => verifyMut.mutate()}
                  disabled={verifyMut.isPending}
                  className="glass-pill px-3.5 py-1.5 text-xs font-medium text-white/80 hover:text-white flex items-center gap-1.5 disabled:opacity-60"
                >
                  <RefreshCw className={`size-3.5 ${verifyMut.isPending ? "animate-spin" : ""}`} />
                  <span>Refresh Status</span>
                </button>
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

            {/* Loading / Searching State */}
            {mut.isPending && (
              <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/60">
                <RefreshCw className="size-5 animate-spin mx-auto mb-3 text-white/40" />
                <p>Searching investors directory...</p>
              </div>
            )}

            {/* Results */}
            {!mut.isPending && searched && rows.length > 0 && (
              <div className="space-y-3">
                <ResultsBar
                  count={rows.length}
                  unit="investors matched"
                  shown={shown}
                  hasMore={hasMore}
                  onClear={() => {
                    setRows([]);
                    setSearched(false);
                    setFlow(null);
                    setBroadened([]);
                    composerRef.current?.focus();
                  }}
                />
                {broadened.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-200/90">
                    <SearchCheck className="size-3.5 shrink-0" />
                    <span>
                      No exact matches for every filter, so we relaxed{" "}
                      {broadened.length === 1
                        ? broadened[0]
                        : `${broadened.slice(0, -1).join(", ")} and ${broadened[broadened.length - 1]}`}
                      . These are real dataset entries ranked by fit.
                    </span>
                  </div>
                )}
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
                No investors matched even after relaxing stage, sector, and check size. Try a
                broader location.
              </div>
            )}

            {/* Guided questionnaire: opens after the user submits an ask that
                is missing stage / check size / geography. */}
            {!mut.isPending && flow && (
              <GuidedQuestionnaire
                title="Find Investors"
                input={flow.input}
                questions={flow.questions}
                pending={mut.isPending}
                onDone={(answers) => launchSearch(flow.parsed, answers)}
                onCancel={() => setFlow(null)}
              />
            )}

            {/* Compact entry card (home-page style) — only before a search. */}
            {!mut.isPending && !flow && !searched && (
              <PageHeroCard
                icon={Landmark}
                title="Find Investors"
                description="Describe your raise — we'll ask a couple of quick questions, then match you with active VCs & angels."
                onStart={() => composerRef.current?.focus()}
              />
            )}

            {/* Paste-a-URL intelligence — under the cards: confirm the extracted
                fund/startup profile, then run a real investor search with it. */}
            {!mut.isPending && (
              <UrlIntelBox
                variant="investors"
                onConfirm={(intel) => {
                  const sector = (intel.sectors[0] || intel.industry || "").trim();
                  if (!sector && !(intel.location || "").trim()) {
                    toast.message(
                      "No sector or location found in that URL — edit them in and search again.",
                    );
                    return;
                  }
                  const stageHint = (intel.stage_hint || "").trim().toLowerCase();
                  const checkBand = /pre.?seed|angel/.test(stageHint)
                    ? ("angel" as const)
                    : /seed/.test(stageHint)
                      ? ("seed" as const)
                      : /series [b-c]|growth|later/.test(stageHint)
                        ? ("growth" as const)
                        : ("any" as const);
                  const vars = {
                    query: "",
                    sector: sector || undefined,
                    location: (intel.location || "").trim() || undefined,
                    stage: /pre.?seed|seed|series [a-c]/.test(stageHint) ? stageHint : undefined,
                    checkBand,
                    entityType: "any" as const,
                  };
                  setSearchFilters(vars);
                  mut.mutate(vars);
                }}
              />
            )}
          </div>
        </div>

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
