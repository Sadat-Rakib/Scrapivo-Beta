import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { runLocalBusinessSearch } from "@/lib/local-businesses.functions";
import type { LocalBusinessRow, OpportunityTag } from "@/lib/search/lead-segments";
import { LocalBusinessesGrid } from "@/components/discover/result-tabs";
import { Button } from "@/components/ui/button";
import { Store, Search, Download } from "lucide-react";
import { toast } from "sonner";

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
  "auto repair",
  "real estate agents",
  "accountants",
  "chiropractors",
];

const LOCATION_SUGGESTIONS = [
  "Austin TX",
  "Toronto",
  "London",
  "New York",
  "Los Angeles",
  "Chicago",
  "Miami",
  "Vancouver",
  "San Francisco",
  "Dallas",
];

const FILTERS: { id: OpportunityTag | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "no_website", label: "No website" },
  { id: "seo_poor", label: "SEO poor" },
  { id: "has_email", label: "Has email" },
  { id: "has_phone", label: "Has phone" },
  { id: "sales_ready", label: "Sales ready" },
  { id: "has_website", label: "Has website" },
];

function chipClass(active: boolean) {
  return `text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
    active
      ? "border-primary bg-primary/10 text-foreground"
      : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
  }`;
}

function LocalBusinessesPage() {
  const qc = useQueryClient();
  const searchFn = useServerFn(runLocalBusinessSearch);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [rows, setRows] = useState<LocalBusinessRow[]>([]);
  const [filter, setFilter] = useState<OpportunityTag | "all">("all");

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.opportunity_tags?.includes(filter));
  }, [rows, filter]);

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
      setRows(res.businesses ?? []);
      setFilter("all");
      const withEmail = (res.businesses ?? []).filter((b) => b.email).length;
      const withPhone = (res.businesses ?? []).filter((b) => b.phone).length;
      const noWeb = (res.businesses ?? []).filter((b) =>
        b.opportunity_tags?.includes("no_website"),
      ).length;
      toast.success(
        `${res.businesses?.length ?? 0} local businesses` +
          (withEmail ? ` · ${withEmail} with email` : "") +
          (withPhone ? ` · ${withPhone} with phone` : "") +
          (noWeb ? ` · ${noWeb} no website` : ""),
      );
    },
    onError: (e: Error) => toast.error(e.message || "Search failed"),
  });

  const exportCsv = () => {
    if (!filtered.length) return;
    const header = [
      "name",
      "category",
      "phone",
      "email",
      "verified",
      "website",
      "tags",
      "description",
    ];
    const lines = [
      header.join(","),
      ...filtered.map((r) =>
        [
          r.name,
          r.category ?? "",
          r.phone ?? "",
          r.email ?? "",
          r.email_verified ? "yes" : "",
          r.website ?? "",
          (r.opportunity_tags ?? []).join("|"),
          (r.description ?? "").replace(/"/g, '""'),
        ]
          .map((c) => `"${String(c).replace(/\n/g, " ")}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scrapivo-local-${category.replace(/\s+/g, "-")}-${location.replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto p-6 sm:p-8 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 text-muted-foreground mb-2">
          <Store className="size-4" />
          <span className="text-xs uppercase tracking-wide">Local business leads</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Local businesses</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          Pick a category and place — Scrapivo finds live listings, scrapes emails and phones, and
          tags opportunities so you can filter for the right pitch.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 mb-8">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Business category</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. dentists, roofers, marketing agencies"
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Where to look</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Austin TX, Toronto, London"
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
            />
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Quick categories
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={chipClass(category.toLowerCase() === c.toLowerCase())}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Quick locations
          </p>
          <div className="flex flex-wrap gap-1.5">
            {LOCATION_SUGGESTIONS.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocation(loc)}
                className={chipClass(location.toLowerCase() === loc.toLowerCase())}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              if (category.trim().length < 2 || location.trim().length < 2) {
                toast.error("Enter a category and a location");
                return;
              }
              mut.mutate();
            }}
            disabled={mut.isPending}
          >
            <Search className={`size-3.5 mr-1.5 ${mut.isPending ? "animate-pulse" : ""}`} />
            {mut.isPending ? "Searching live…" : "Find local businesses"}
          </Button>
          {rows.length > 0 && (
            <Button type="button" variant="outline" onClick={exportCsv}>
              <Download className="size-3.5 mr-1.5" />
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {mut.isPending && (
        <p className="text-sm text-muted-foreground mb-4">
          Collecting listings and harvesting contacts — this can take up to a minute…
        </p>
      )}

      {!mut.isPending && rows.length > 0 && (
        <div className="space-y-3 pb-8">
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Opportunity filters
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={chipClass(filter === f.id)}
                >
                  {f.label}
                  {f.id !== "all" && (
                    <span className="opacity-60 ml-1">
                      {rows.filter((r) => r.opportunity_tags?.includes(f.id as OpportunityTag)).length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {filtered.length} businesses
            {filtered.filter((r) => r.email).length
              ? ` · ${filtered.filter((r) => r.email).length} with email`
              : ""}
            {filtered.filter((r) => r.phone).length
              ? ` · ${filtered.filter((r) => r.phone).length} with phone`
              : ""}
          </p>
          <LocalBusinessesGrid rows={filtered} />
        </div>
      )}

      {!mut.isPending && !rows.length && (
        <p className="text-sm text-muted-foreground">
          Tap a category and location above, then search. After results load, filter by no website /
          SEO poor to find businesses that need your services.
        </p>
      )}
    </div>
  );
}
