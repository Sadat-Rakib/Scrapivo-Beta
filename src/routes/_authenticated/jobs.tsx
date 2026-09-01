import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo, useRef } from "react";
import { runJobSearch } from "@/lib/jobs.functions";
import type { JobPosting, JobRegion } from "@/lib/jobs/types";
import { ALL_JOB_SOURCE_IDS } from "@/lib/jobs/types";
import {
  buildGuidedQuestions,
  parseSearchIntent,
  REMOTE_OPTION,
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
import { Briefcase, Download, ExternalLink, MapPin, RefreshCw, SearchCheck } from "lucide-react";
import { toast } from "sonner";
import { Company360View, type Company360Data } from "@/components/shared/company-360-view";
import { UrlIntelBox } from "@/components/url-intel-box";

export const Route = createFileRoute("/_authenticated/jobs")({
  head: () => ({
    meta: [{ title: "Scrapivo — Jobs" }],
  }),
  component: JobsPage,
});

/** Composer autotype examples — jobs-only, never businesses/investors. */
const COMPOSER_EXAMPLES = [
  "senior designer roles in New York…",
  "remote React developer jobs…",
  "marketing jobs in London…",
  "junior data analyst jobs in Toronto…",
  "nurse practitioner jobs in Austin, TX…",
];

type JobSearchVars = {
  query: string;
  location: string;
  remoteOnly: boolean;
  seniority: string;
  employmentType: string;
  region: JobRegion;
};

const fmtDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function JobsPage() {
  const searchFn = useServerFn(runJobSearch);

  const initialState = useMemo(() => loadRouteSearchState<JobPosting>("jobs"), []);

  const [input, setInput] = useState("");
  const [rows, setRows] = useState<JobPosting[]>(initialState?.results ?? []);
  const [searched, setSearched] = useState(!!initialState?.results?.length);
  const [flow, setFlow] = useState<{
    input: string;
    parsed: ParsedIntent;
    questions: FlowQuestion[];
  } | null>(null);
  const [broadened, setBroadened] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [selectedEntity, setSelectedEntity] = useState<Company360Data | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // Guided flow: parse the free-form ask deterministically, then ask ONLY for
  // the dimensions the text did not state (role, place, seniority…).
  const launchSearch = (parsed: ParsedIntent, answers?: FlowAnswers) => {
    const rawLocation = (answers?.location ?? parsed.location ?? "").trim();
    const wantsRemote =
      rawLocation === REMOTE_OPTION ||
      rawLocation.toLowerCase() === "remote" ||
      parsed.remoteOnly === true;
    const seniority = answers?.seniority ?? parsed.seniority ?? "any";
    const vars: JobSearchVars = {
      query: (answers?.query ?? parsed.query ?? "").trim(),
      location: wantsRemote || rawLocation === "" ? "" : rawLocation,
      remoteOnly: wantsRemote,
      seniority,
      employmentType:
        answers?.employmentType ??
        parsed.employmentType ??
        (seniority === "intern" ? "internship" : "any"),
      region: wantsRemote ? "remote" : (parsed.region ?? "any"),
    };
    setFlow(null);
    mut.mutate(vars);
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;
    // Chat-style UX: the ask moves up into the flow/results area, the
    // composer clears for the next input.
    setInput("");
    const parsed = parseSearchIntent("jobs", text);
    const questions = buildGuidedQuestions("jobs", parsed);
    if (questions.length) {
      setFlow({ input: text, parsed, questions });
      return;
    }
    launchSearch(parsed);
  };

  const mut = useMutation({
    mutationFn: (vars: JobSearchVars) =>
      searchFn({
        data: {
          query: vars.query.trim(),
          location: vars.location.trim(),
          remoteOnly: vars.remoteOnly,
          seniority: vars.seniority,
          employmentType: vars.employmentType,
          region: vars.region,
          sources: [...ALL_JOB_SOURCE_IDS],
          limit: 200,
        },
      }),
    onSuccess: (res, vars) => {
      const fetchedJobs = res.jobs ?? [];
      setRows(fetchedJobs);
      setSearched(true);
      setBroadened(res.relaxed ?? []);
      saveRouteSearchState("jobs", {
        query: vars.query,
        filters: vars,
        results: fetchedJobs,
        timestamp: Date.now(),
      });
      if (!fetchedJobs.length) {
        toast.message("No active jobs matched");
      } else {
        toast.success(`${fetchedJobs.length} active jobs fetched`);
      }
    },
    onError: (e: Error) => toast.error(friendlyErrorText(e, "Job search failed")),
  });

  // Progressive rendering: keep the mounted card count small and grow on scroll.
  const { visible, hasMore, loadMore, shown } = useProgressiveCount(rows, 24);

  const toggleBookmark = (id: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDetailView = (j: JobPosting) => {
    // Full normalized job record — every populated field reaches the drawer.
    // Ingest metadata (board_id, updated_at, fetched_at) stays internal:
    // users get a single "Posted" date, not pipeline bookkeeping.
    const recordFields = [
      { label: "Title", value: j.title },
      { label: "Company", value: j.company },
      ...(j.location ? [{ label: "Location", value: j.location }] : []),
      { label: "Remote", value: j.remote ? "Yes" : "No" },
      ...(j.seniority ? [{ label: "Seniority", value: j.seniority }] : []),
      ...(j.department ? [{ label: "Department", value: j.department }] : []),
      ...(j.employment_type ? [{ label: "Employment type", value: j.employment_type }] : []),
      ...(j.salary ? [{ label: "Compensation", value: j.salary }] : []),
      ...(fmtDate(j.posted_at) ? [{ label: "Posted", value: fmtDate(j.posted_at) as string }] : []),
    ];
    setSelectedEntity({
      domain: "job",
      name: j.title,
      subtitle: j.company,
      role_title: j.title,
      company_name: j.company,
      location: j.location || (j.remote ? "Remote" : undefined),
      seniority: j.seniority || undefined,
      salary: j.salary || undefined,
      job_url: j.url,
      remote: j.remote,
      description: j.description || undefined,
      links: [{ label: "Application URL", href: j.url }],
      record_fields: recordFields,
    });
  };

  const exportCsv = () => {
    if (!rows.length) return;
    const header = [
      "title",
      "company",
      "location",
      "remote",
      "seniority",
      "salary",
      "url",
      "source",
    ];
    const lines = [
      header.join(","),
      ...rows.map((j) =>
        [
          j.title,
          j.company,
          j.location ?? "",
          j.remote ? "yes" : "no",
          j.seniority ?? "",
          j.salary ?? "",
          j.url,
          j.source,
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scrapivo-jobs-${input.trim() || "postings"}.csv`.replace(/\s+/g, "-");
    a.click();
    URL.revokeObjectURL(url);
  };

  const tableColumns: ColumnDef<JobPosting>[] = [
    {
      header: "Role / Position",
      accessor: (j) => (
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center font-semibold text-white text-xs shrink-0">
            {j.company[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <a
              href={j.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-white hover:underline truncate inline-flex items-center gap-1"
            >
              <span>{j.title}</span>
              <ExternalLink className="size-3 text-white/40" />
            </a>
            <div className="text-[11px] text-white/50 truncate">{j.company}</div>
          </div>
        </div>
      ),
    },
    {
      header: "Location",
      accessor: (j) => (
        <div className="text-xs text-white/70 truncate flex items-center gap-1">
          <MapPin className="size-3 text-white/40 shrink-0" />
          <span>{j.location || (j.remote ? "Remote" : "Not specified")}</span>
        </div>
      ),
    },
    {
      header: "Seniority & Salary",
      accessor: (j) => (
        <div className="text-xs text-white/80">
          <div>{j.seniority || "Any level"}</div>
          {j.salary && <div className="text-[11px] text-white/50 font-mono">{j.salary}</div>}
        </div>
      ),
    },
    {
      header: "Posted",
      accessor: (j) => (
        <div className="text-xs text-white/70">{fmtDate(j.posted_at) ?? "Recent"}</div>
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
                  <Briefcase className="size-3.5" />
                  <span>Live Job Listings</span>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Jobs</h1>
                <p className="text-xs text-white/60 mt-1 max-w-xl">
                  Real-time active postings from company career pages, ATS Boards, Job sites, ATS
                  sites, etc.
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

            {/* Loading State */}
            {mut.isPending && (
              <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/60">
                <RefreshCw className="size-5 animate-spin mx-auto mb-3 text-white/40" />
                <p>Ingesting active postings across ATS sources...</p>
              </div>
            )}

            {/* Results */}
            {!mut.isPending && searched && rows.length > 0 && (
              <div className="space-y-3">
                <ResultsBar
                  count={rows.length}
                  unit="active jobs loaded"
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
                      Few exact matches, so we widened{" "}
                      {broadened.length === 1
                        ? broadened[0]
                        : `${broadened.slice(0, -1).join(", ")} and ${broadened[broadened.length - 1]}`}
                      . Results are ranked by relevance.
                    </span>
                  </div>
                )}
                {viewMode === "grid" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {visible.map((j) => (
                      <EntityCard
                        key={j.id}
                        id={j.id}
                        title={j.title}
                        subtitle={j.company}
                        category={j.remote ? "Remote" : "Job"}
                        location={j.location || (j.remote ? "Remote" : undefined)}
                        stats={[
                          ...(j.seniority ? [{ label: "Seniority", value: j.seniority }] : []),
                          ...(j.employment_type
                            ? [{ label: "Employment type", value: j.employment_type }]
                            : []),
                          ...(j.salary ? [{ label: "Compensation", value: j.salary }] : []),
                          ...(fmtDate(j.posted_at)
                            ? [{ label: "Posted", value: fmtDate(j.posted_at) as string }]
                            : []),
                        ]}
                        description={j.description || undefined}
                        saved={bookmarkedIds.has(j.id)}
                        onSaveToggle={() => toggleBookmark(j.id)}
                        primaryActionLabel="Apply"
                        primaryActionUrl={j.url}
                        onViewDetails={() => openDetailView(j)}
                        onClick={() => openDetailView(j)}
                      />
                    ))}
                  </div>
                ) : (
                  <EntityTable
                    rows={visible}
                    keyExtractor={(j) => j.id}
                    columns={tableColumns}
                    onBookmark={(j) => toggleBookmark(j.id)}
                    isBookmarked={(j) => bookmarkedIds.has(j.id)}
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
                No active jobs matched. Try broadening location or seniority.
              </div>
            )}

            {/* Guided questionnaire: opens after the user submits an ask that
                is missing a role, place, or seniority. */}
            {!mut.isPending && flow && (
              <GuidedQuestionnaire
                title="Find Jobs"
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
                icon={Briefcase}
                title="Find Jobs"
                description="Describe the role you want — we'll ask where and what level, then pull live postings from career pages and ATS boards."
                onStart={() => composerRef.current?.focus()}
              />
            )}

            {/* Paste-a-URL intelligence — docked above composer. */}
          </div>
        </div>

        {!mut.isPending && (
          <div className="shrink-0 border-t border-white/5 px-4 md:px-6 pt-2">
            <UrlIntelBox
              variant="jobs"
              collapsed={searched && rows.length > 0}
              onConfirm={(intel) => {
                const query =
                  intel.skills.slice(0, 3).join(" ") || intel.industry || intel.name || "";
                if (!query.trim()) {
                  toast.message("Nothing usable in that URL — type a role instead.");
                  return;
                }
                const remote =
                  /remote|global/i.test(intel.location || "") && intel.skills.length > 0;
                mut.mutate({
                  query,
                  location: remote ? "" : (intel.location || "").trim(),
                  remoteOnly: remote,
                  seniority: "any",
                  employmentType: "any",
                  region: remote ? "remote" : "any",
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
