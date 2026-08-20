import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { runJobSearch } from "@/lib/jobs.functions";
import type { JobPosting, JobRegion } from "@/lib/jobs/types";
import { ALL_JOB_SOURCE_IDS } from "@/lib/jobs/types";
import { ViewToggle, type ViewMode } from "@/components/shared/view-toggle";
import { EntityCard } from "@/components/shared/entity-card";
import { EntityTable, type ColumnDef } from "@/components/shared/entity-table";
import { FilterPanel } from "@/components/shared/filter-panel";
import { getRemainingSearches } from "@/lib/search.functions";
import { Briefcase, Search, Download, ExternalLink, MapPin, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Company360View, type Company360Data } from "@/components/shared/company-360-view";

import { saveRouteSearchState, loadRouteSearchState } from "@/lib/store/search-store";

export const Route = createFileRoute("/_authenticated/jobs")({
  head: () => ({
    meta: [{ title: "Scrapivo — Jobs" }],
  }),
  component: JobsPage,
});

const REGIONS: { id: JobRegion; label: string }[] = [
  { id: "any", label: "All Regions" },
  { id: "remote", label: "Remote" },
  { id: "north_america", label: "North America" },
  { id: "europe", label: "Europe" },
  { id: "asia", label: "Asia" },
];

function JobsPage() {
  const searchFn = useServerFn(runJobSearch);
  const getUsage = useServerFn(getRemainingSearches);
  const usageQuery = useQuery({ queryKey: ["usage"], queryFn: () => getUsage() });

  const initialState = useMemo(() => loadRouteSearchState<JobPosting>("jobs"), []);

  const [query, setQuery] = useState(initialState?.filters?.query ?? "");
  const [location, setLocation] = useState(initialState?.filters?.location ?? "");
  const [remoteOnly, setRemoteOnly] = useState(initialState?.filters?.remoteOnly ?? false);
  const [seniority, setSeniority] = useState(initialState?.filters?.seniority ?? "any");
  const [contactRoles, setContactRoles] = useState(initialState?.filters?.contactRoles ?? "");
  const [region, setRegion] = useState<JobRegion>(initialState?.filters?.region ?? "any");
  const [rows, setRows] = useState<JobPosting[]>(initialState?.results ?? []);
  const [searched, setSearched] = useState(!!initialState?.results?.length);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [selectedEntity, setSelectedEntity] = useState<Company360Data | null>(null);

  const [filtersCollapsed, setFiltersCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("scrapivo:jobs-filters-collapsed") === "1";
  });

  if (typeof window !== "undefined") {
    window.localStorage.setItem("scrapivo:jobs-filters-collapsed", filtersCollapsed ? "1" : "0");
  }

  const mut = useMutation({
    mutationFn: () =>
      searchFn({
        data: {
          query: query.trim(),
          location: location.trim(),
          remoteOnly,
          seniority,
          region,
          sources: [...ALL_JOB_SOURCE_IDS],
          limit: 120,
          contactRoles: contactRoles
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
            .slice(0, 8),
        },
      }),
    onSuccess: (res) => {
      const fetchedJobs = res.jobs ?? [];
      setRows(fetchedJobs);
      setSearched(true);
      saveRouteSearchState("jobs", {
        query,
        filters: { query, location, remoteOnly, seniority, region, contactRoles },
        results: fetchedJobs,
        timestamp: Date.now(),
      });
      if (!fetchedJobs.length) {
        toast.message("No active jobs matched those filters");
      } else {
        toast.success(`${fetchedJobs.length} active jobs fetched`);
      }
    },
    onError: (e: Error) => toast.error(e.message || "Job search failed"),
  });

  const toggleBookmark = (id: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDetailView = (j: JobPosting) => {
    setSelectedEntity({
      domain: "job",
      name: j.company,
      role_title: j.title,
      company_name: j.company,
      location: j.location || (j.remote ? "Remote" : undefined),
      seniority: j.seniority || undefined,
      salary: j.salary || undefined,
      source: j.source,
      job_url: j.url,
      remote: j.remote,
      description: j.description || undefined,
    });
  };

  const exportCsv = () => {
    if (!rows.length) return;
    const header = ["title", "company", "location", "remote", "seniority", "salary", "url", "source"];
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
    a.download = `scrapivo-jobs-${query || "postings"}.csv`;
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
      header: "Source",
      accessor: (j) => (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/70 border border-white/10 uppercase tracking-wider font-mono">
          {j.source.replace(/^source-(ats-)?/, "")}
        </span>
      ),
    },
  ];

  const FilterForm = (
    <>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Role / Skill</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="engineer, designer, product..."
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          onKeyDown={(e) => {
            if (e.key === "Enter") mut.mutate();
          }}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Location</span>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Remote, New York, San Francisco..."
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          onKeyDown={(e) => {
            if (e.key === "Enter") mut.mutate();
          }}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Seniority Level</span>
        <select
          value={seniority}
          onChange={(e) => setSeniority(e.target.value)}
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-[#131316] text-xs text-white outline-none focus:border-white/30"
        >
          <option value="any">Any seniority</option>
          <option value="junior">Junior</option>
          <option value="mid">Mid</option>
          <option value="senior">Senior</option>
          <option value="lead">Lead / Manager</option>
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-white/70">Region</span>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value as JobRegion)}
          className="w-full h-9 px-3 rounded-lg border border-white/10 bg-[#131316] text-xs text-white outline-none focus:border-white/30"
        >
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={remoteOnly}
          onChange={(e) => setRemoteOnly(e.target.checked)}
          className="rounded border-white/20 bg-white/5 text-white"
        />
        <span>Remote jobs only</span>
      </label>
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
              <Briefcase className="size-3.5" />
              <span>Live Job Listings</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Jobs</h1>
            <p className="text-xs text-white/60 mt-1 max-w-xl">
              Real-time active postings from company career pages, ATS Boards, Job sites, ATS sites, etc.
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

        {/* Loading State */}
        {mut.isPending && (
          <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/60">
            <RefreshCw className="size-5 animate-spin mx-auto mb-3 text-white/40" />
            <p>Ingesting active postings across ATS sources...</p>
          </div>
        )}

        {/* Results */}
        {!mut.isPending && searched && rows.length > 0 && (
          <div>
            <div className="text-xs text-white/50 mb-3">{rows.length} active jobs loaded</div>
            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rows.map((j) => (
                  <EntityCard
                    key={j.id}
                    id={j.id}
                    title={j.title}
                    subtitle={j.company}
                    category={j.remote ? "Remote" : "Job"}
                    location={j.location || (j.remote ? "Remote" : undefined)}
                    stats={[
                      { label: "Seniority", value: j.seniority || "Any" },
                      { label: "Salary", value: j.salary || "—" },
                      { label: "Source", value: j.source.replace(/^source-(ats-)?/, "") },
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
                rows={rows}
                keyExtractor={(j) => j.id}
                columns={tableColumns}
                onBookmark={(j) => toggleBookmark(j.id)}
                isBookmarked={(j) => bookmarkedIds.has(j.id)}
                onRowClick={openDetailView}
              />
            )}
          </div>
        )}

        {!mut.isPending && searched && !rows.length && (
          <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/50">
            No active jobs matched those filters. Try broadening location or seniority.
          </div>
        )}

        {!mut.isPending && !searched && (
          <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/60 space-y-3">
            <Briefcase className="size-8 mx-auto text-white/30" />
            <h3 className="text-base font-semibold text-white">Search Active Job Postings</h3>
            <p className="max-w-md mx-auto text-xs text-white/50 leading-relaxed">
              Use the filter panel on the right to search across company ATS boards and career pages.
            </p>
            <button
              type="button"
              onClick={() => mut.mutate()}
              className="glass-pill px-5 py-2 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 inline-flex items-center gap-2"
            >
              <Search className="size-3.5" />
              <span>Fetch Live Jobs</span>
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
            title="Filter Jobs"
            subtitle="Refine role, seniority & region"
            onApply={() => mut.mutate()}
            isPending={mut.isPending}
            applyLabel="Find Jobs"
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
