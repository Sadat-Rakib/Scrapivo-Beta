import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { runLocalBusinessSearch } from "@/lib/local-businesses.functions";
import type { LocalBusinessRow } from "@/lib/search/lead-segments";
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
  "marketing agencies",
  "restaurants",
];

function LocalBusinessesPage() {
  const qc = useQueryClient();
  const searchFn = useServerFn(runLocalBusinessSearch);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [rows, setRows] = useState<LocalBusinessRow[]>([]);

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
      const withEmail = (res.businesses ?? []).filter((b) => b.email).length;
      const withPhone = (res.businesses ?? []).filter((b) => b.phone).length;
      toast.success(
        `${res.businesses?.length ?? 0} local businesses` +
          (withEmail ? ` · ${withEmail} with email` : "") +
          (withPhone ? ` · ${withPhone} with phone` : ""),
      );
    },
    onError: (e: Error) => toast.error(e.message || "Search failed"),
  });

  const exportCsv = () => {
    if (!rows.length) return;
    const header = ["name", "category", "phone", "email", "verified", "website", "description"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.name,
          r.category ?? "",
          r.phone ?? "",
          r.email ?? "",
          r.email_verified ? "yes" : "",
          r.website ?? "",
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
          Pick a business category and a place. Scrapivo finds live local businesses that match,
          monitors their public listings, and gathers published contact details—emails, phones,
          websites, and addresses—then verifies deliverability so your outreach list is ready.
          Separate from Discover buyer-intent search.
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
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_SUGGESTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className="text-[11px] px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
            >
              {c}
            </button>
          ))}
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
        <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Describe category + territory</li>
          <li>We find matching local businesses live and collect public contact info from their sites</li>
          <li>Verify and download for outreach</li>
        </ol>
      </div>

      {mut.isPending && (
        <p className="text-sm text-muted-foreground mb-4">
          Collecting listings and gathering contact details from websites — this can take up to a
          minute…
        </p>
      )}

      {!mut.isPending && rows.length > 0 && (
        <div className="space-y-3 pb-8">
          <p className="text-sm text-muted-foreground">
            {rows.length} businesses
            {rows.filter((r) => r.email).length
              ? ` · ${rows.filter((r) => r.email).length} with email`
              : ""}
            {rows.filter((r) => r.phone).length
              ? ` · ${rows.filter((r) => r.phone).length} with phone`
              : ""}
          </p>
          <LocalBusinessesGrid rows={rows} />
        </div>
      )}

      {!mut.isPending && !rows.length && (
        <p className="text-sm text-muted-foreground">
          Results appear here after you run a search. We’ll surface matching local businesses and
          their public contact details.
        </p>
      )}
    </div>
  );
}
