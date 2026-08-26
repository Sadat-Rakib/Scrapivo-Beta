/**
 * Inline "Paste a URL" intelligence — shared by Jobs / Local Businesses /
 * Investors pages, placed under the results cards.
 *
 * Flow: paste → Extract → "Here's what I found" (editable Name / Industry /
 * Location) → confirm triggers a REAL search through the page's own pipeline
 * via onConfirm(). No dash/bullet decorations anywhere.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Loader2, RotateCcw, Search, Sparkles } from "lucide-react";
import { extractWebsiteIntelFn } from "@/lib/url-intel.functions";

export type UrlIntel = {
  name: string | null;
  kind: string;
  industry: string | null;
  description: string | null;
  location: string | null;
  emails: string[];
  phones: string[];
  linkedin: string | null;
  twitter: string | null;
  github: string | null;
  skills: string[];
  sectors: string[];
  stage_hint: string | null;
};

type ExtractResponse = {
  error: "limit" | "failed" | null;
  message?: string;
  intel?: UrlIntel;
};

const PLACEHOLDER: Record<"jobs" | "local" | "investors", string> = {
  jobs: "Paste your portfolio / resume / LinkedIn URL…",
  local: "Paste a business website URL…",
  investors: "Paste a fund or startup website URL…",
};

const CONFIRM_LABEL: Record<"jobs" | "local" | "investors", string> = {
  jobs: "Find matching jobs",
  local: "Find similar businesses",
  investors: "Find matching investors",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm text-white/85">{children}</div>
    </div>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/70">
      {text}
    </span>
  );
}

export function UrlIntelBox({
  variant,
  onConfirm,
}: {
  variant: "jobs" | "local" | "investors";
  onConfirm: (intel: UrlIntel) => void;
}) {
  const extractFn = useServerFn(extractWebsiteIntelFn);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [intel, setIntel] = useState<UrlIntel | null>(null);

  // Editable copies of the fields users most often correct.
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");

  const run = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = (await extractFn({ data: { url: url.trim(), variant } })) as ExtractResponse;
      if (res.error === "limit") {
        setNote(res.message ?? "Daily limit reached");
      } else if (res.error === "failed") {
        setNote(res.message ?? "Could not fetch that URL");
      } else if (res.intel) {
        setIntel(res.intel);
        setName(res.intel.name ?? "");
        setIndustry(res.intel.industry ?? "");
        setLocation(res.intel.location ?? "");
        setNote(null);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setIntel(null);
    setUrl("");
    setNote(null);
  };

  const confirm = () => {
    if (!intel) return;
    onConfirm({
      ...intel,
      name: name.trim() || intel.name,
      industry: industry.trim() || intel.industry,
      location: location.trim() || intel.location,
    });
  };

  // ── Step A: paste URL ────────────────────────────────────────────────────
  if (!intel) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center gap-2">
          <Link2 className="size-4 shrink-0 text-white/40" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder={PLACEHOLDER[variant]}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
          />
          <button
            onClick={run}
            disabled={busy || !url.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Extract
          </button>
        </div>
        {note && <p className="mt-2 text-[12px] text-white/60">{note}</p>}
      </div>
    );
  }

  // ── Steps B+C: what I found → confirm → act ─────────────────────────────
  const socials = [
    { label: "LinkedIn", href: intel.linkedin },
    { label: "Twitter", href: intel.twitter },
    { label: "GitHub", href: intel.github },
  ].filter((s) => !!s.href);

  const pills = [...intel.skills.slice(0, 6), ...intel.sectors.slice(0, 4)].filter(Boolean);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-sm font-medium text-white/90">
          <Sparkles className="size-4 text-emerald-300" />
          Here&apos;s what I found
        </div>
        <button
          onClick={reset}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/50 hover:bg-white/[0.06] hover:text-white/80"
        >
          <RotateCcw className="size-3" />
          Start over
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Not detected"
            className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
          />
        </label>
        <label className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Industry
          </span>
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="Not detected"
            className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
          />
        </label>
        <label className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Location
          </span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Not detected"
            className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
          />
        </label>
      </div>

      {intel.description && (
        <p className="mt-3 text-[13px] leading-relaxed text-white/70">{intel.description}</p>
      )}

      {(socials.length > 0 || intel.emails.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.href!}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sky-300/90 hover:text-sky-200 hover:underline"
            >
              {s.label}
            </a>
          ))}
          {intel.emails.slice(0, 2).map((em) => (
            <a key={em} href={`mailto:${em}`} className="text-white/60 hover:text-white/85">
              {em}
            </a>
          ))}
        </div>
      )}

      {pills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <Pill key={p} text={p} />
          ))}
        </div>
      )}

      <button
        onClick={confirm}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/25 sm:w-auto"
      >
        <Search className="size-4" />
        {CONFIRM_LABEL[variant]}
      </button>
      <p className="mt-1.5 text-[11px] text-white/40">
        Edit anything above if it looks off, then search with it.
      </p>

      {note && <p className="mt-2 text-[12px] text-white/60">{note}</p>}
    </div>
  );
}

// Field helper kept for potential reuse in future inline displays.
void Field;
