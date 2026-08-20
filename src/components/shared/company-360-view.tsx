/**
 * Scrapivo — Company 360 Detail View
 *
 * Unified detail drawer component opened when clicking any card/row across
 * Businesses, Investors, and Jobs. This is the shared destination described
 * in §34 of the master PRD, designed with 12 extensible sections.
 *
 * Initial pass populates fields from card-level data. Sections are structured
 * to accept richer data as enrichment pipelines come online.
 */

import {
  X,
  MapPin,
  Globe,
  Mail,
  Phone,
  Briefcase,
  Users,
  TrendingUp,
  Shield,
  ExternalLink,
  Send,
  Building2,
  Zap,
  AlertTriangle,
  Copy,
  RefreshCw,
} from "lucide-react";

export type DetailViewDomain = "business" | "investor" | "job";

export interface Company360Data {
  domain: DetailViewDomain;
  // Core fields (populated from card data)
  name: string;
  subtitle?: string;
  category?: string;
  location?: string;
  description?: string;
  website?: string;
  email?: string;
  phone?: string;
  logo_url?: string;

  // Investor-specific
  stage?: string;
  check_size?: string;
  sectors?: string[];
  firm_type?: string;
  investment_count?: number;
  firm?: string;
  investor_type?: string;
  thesis?: string;

  // Job-specific
  role_title?: string;
  company_name?: string;
  seniority?: string;
  salary?: string;
  source?: string;
  job_url?: string;
  remote?: boolean;

  // Business-specific
  rating?: number;
  review_count?: number;
  opportunity_tags?: string[];

  // Shared
  tags?: string[];
  stats?: { label: string; value: string | number }[];

  // Enrichment data (placeholder for future)
  technologies?: string[];
  signals?: { type: string; description: string; confidence: number }[];
  contacts?: { name: string; title?: string; email?: string }[];
}

interface Company360ViewProps {
  data: Company360Data | null;
  onClose: () => void;
}

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { draftEntityOutreach } from "@/lib/outreach.functions";

export function Company360View({ data, onClose }: Company360ViewProps) {
  const [showFullDesc, setShowFullDesc] = useState(false);
  const draftFn = useServerFn(draftEntityOutreach);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const entityKey = data
    ? [data.domain, data.name, data.email, data.website, data.job_url].filter(Boolean).join("|")
    : "";

  const draftMut = useMutation({
    mutationFn: () => {
      if (!data) throw new Error("No entity selected");
      return draftFn({ data: { domain: data.domain, entity: data } });
    },
    onSuccess: (res) => {
      if (res.error) {
        setDraftError(res.error);
        return;
      }
      setDraftError(null);
      setDraftSubject(res.subject);
      setDraftBody(res.body);
    },
    onError: (e: Error) => setDraftError(e.message || "Could not draft outreach"),
  });

  // Reset draft state when a different entity is opened, so a draft
  // generated for one card can never leak into another card's drawer.
  useEffect(() => {
    setShowFullDesc(false);
    setDraftOpen(false);
    setDraftError(null);
    setDraftSubject("");
    setDraftBody("");
    draftMut.reset();
    // Intentionally keyed on entity identity only — draftMut is not stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey]);

  if (!data) return null;

  const draftLabel =
    data.domain === "job"
      ? "Draft Application"
      : data.domain === "investor"
        ? "Draft Investor Outreach"
        : "Draft Outreach";

  const openDraft = () => {
    setDraftOpen(true);
    setDraftError(null);
    draftMut.mutate();
  };

  const copyDraft = async () => {
    const text = draftSubject ? `${draftSubject}\n\n${draftBody}` : draftBody;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Draft copied to clipboard");
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  };

  const desc = data.description ?? "";
  const isLongDesc = desc.length > 280;
  const displayDesc = isLongDesc && !showFullDesc ? `${desc.slice(0, 280)}...` : desc;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-lg bg-[#0e0e10] border-l border-white/10 h-full overflow-y-auto overflow-x-hidden animate-in slide-in-from-right-full duration-300 flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#0e0e10]/95 backdrop-blur-md border-b border-white/10 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {data.logo_url ? (
                <img
                  src={data.logo_url}
                  alt={data.name}
                  className="size-12 rounded-xl object-cover border border-white/10 shrink-0"
                />
              ) : (
                <div className="size-12 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-white text-lg font-semibold shrink-0">
                  {data.name[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white truncate">{data.name}</h2>
                {data.subtitle && (
                  <p className="text-xs text-white/50 truncate mt-0.5">{data.subtitle}</p>
                )}
                {data.location && (
                  <div className="flex items-center gap-1 text-xs text-white/40 mt-1">
                    <MapPin className="size-3 shrink-0" />
                    <span className="truncate">{data.location}</span>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6 min-w-0 max-w-full overflow-x-hidden">
          {/* § Overview */}
          <Section title="Overview" icon={<Building2 className="size-4" />}>
            {desc ? (
              <div className="space-y-2">
                <p className="text-xs text-white/70 leading-relaxed break-words whitespace-pre-line">
                  {displayDesc}
                </p>
                {isLongDesc && (
                  <button
                    type="button"
                    onClick={() => setShowFullDesc(!showFullDesc)}
                    className="text-[11px] font-medium text-emerald-400 hover:underline"
                  >
                    {showFullDesc ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-white/40 italic">No description provided.</p>
            )}

            {/* Stats grid */}
            {data.stats && data.stats.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {data.stats.map((s, i) => (
                  <div key={i} className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-white/40">
                      {s.label}
                    </div>
                    <div className="text-sm font-semibold text-white mt-1">{s.value || "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* § Contacts */}
          <Section title="Contact Information" icon={<Users className="size-4" />}>
            <div className="space-y-2">
              {data.email && (
                <ContactRow
                  icon={<Mail className="size-3.5 text-emerald-400" />}
                  value={data.email}
                  href={`mailto:${data.email}`}
                />
              )}
              {data.phone && (
                <ContactRow
                  icon={<Phone className="size-3.5 text-blue-400" />}
                  value={data.phone}
                  href={`tel:${data.phone}`}
                />
              )}
              {data.website && (
                <ContactRow
                  icon={<Globe className="size-3.5 text-violet-400" />}
                  value={data.website.replace(/^https?:\/\//, "")}
                  href={data.website}
                  external
                />
              )}
              {!data.email && !data.phone && !data.website && (
                <p className="text-xs text-white/40 italic">
                  No contact info found. Use enrichment to discover contacts.
                </p>
              )}
            </div>

            {/* People to contact (future enrichment) */}
            {data.contacts && data.contacts.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-white/40">
                  People to Contact
                </div>
                {data.contacts.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-white/70 p-2 rounded-lg bg-white/[0.02] border border-white/5"
                  >
                    <div className="size-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-semibold text-white shrink-0">
                      {c.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">{c.name}</div>
                      {c.title && (
                        <div className="text-[11px] text-white/40 truncate">{c.title}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* § Technology Stack (Local Businesses & Jobs only, when data exists) */}
          {data.domain !== "investor" && data.technologies && data.technologies.length > 0 && (
            <Section title="Technology Stack" icon={<Zap className="size-4" />}>
              <div className="flex flex-wrap gap-1.5">
                {data.technologies.map((t, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-2.5 py-1 rounded-full bg-white/[0.04] text-white/70 border border-white/10"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* § Intent Signals (rendered only when backed by real data) */}
          {((data.signals && data.signals.length > 0) ||
            (data.opportunity_tags && data.opportunity_tags.length > 0)) && (
            <Section title="Intent Signals" icon={<TrendingUp className="size-4" />}>
              {data.signals && data.signals.length > 0 ? (
                <div className="space-y-2">
                  {data.signals.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/5"
                    >
                      <div
                        className={`size-2 rounded-full mt-1.5 shrink-0 ${
                          s.confidence > 0.7
                            ? "bg-emerald-400"
                            : s.confidence > 0.4
                              ? "bg-amber-400"
                              : "bg-white/30"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white/80">
                          {s.type.replace(/_/g, " ")}
                        </div>
                        <div className="text-[11px] text-white/50 mt-0.5">{s.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.opportunity_tags?.map((t, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20"
                    >
                      <AlertTriangle className="size-2.5 inline mr-1" />
                      {t.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* § Tags / Sectors */}
          {data.tags && data.tags.length > 0 && (
            <Section
              title={data.domain === "investor" ? "Investment Focus" : "Categories"}
              icon={<Shield className="size-4" />}
            >
              <div className="flex flex-wrap gap-1.5">
                {data.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-2.5 py-1 rounded-full bg-white/[0.04] text-white/70 border border-white/10"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* § Job Details (Jobs domain only) */}
          {data.domain === "job" && (
            <Section title="Job Details" icon={<Briefcase className="size-4" />}>
              <div className="space-y-2 text-xs">
                {data.role_title && <DetailRow label="Role" value={data.role_title} />}
                {data.company_name && <DetailRow label="Company" value={data.company_name} />}
                {data.seniority && <DetailRow label="Seniority" value={data.seniority} />}
                {data.salary && <DetailRow label="Salary" value={data.salary} />}
                {data.source && <DetailRow label="Source" value={data.source} />}
                {data.remote !== undefined && (
                  <DetailRow label="Remote" value={data.remote ? "Yes" : "No"} />
                )}
              </div>
            </Section>
          )}

          {/* § Draft Outreach Action */}
          <div className="pt-2">
            <button
              type="button"
              onClick={openDraft}
              disabled={draftMut.isPending}
              className="w-full glass-pill py-3 px-4 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {draftMut.isPending ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              <span>{draftMut.isPending ? "Drafting…" : draftLabel}</span>
            </button>

            {data.job_url && (
              <a
                href={data.job_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 w-full glass-pill py-2.5 px-4 text-xs font-medium text-white/80 hover:text-white flex items-center justify-center gap-1.5 transition-all"
              >
                <ExternalLink className="size-3" />
                <span>View Original Posting</span>
              </a>
            )}

            {data.website && data.domain !== "job" && (
              <a
                href={data.website}
                target="_blank"
                rel="noreferrer"
                className="mt-2 w-full glass-pill py-2.5 px-4 text-xs font-medium text-white/80 hover:text-white flex items-center justify-center gap-1.5 transition-all"
              >
                <ExternalLink className="size-3" />
                <span>Visit Website</span>
              </a>
            )}
          </div>

          {/* § Source Evidence (provenance) */}
          <Section title="Source Evidence" icon={<Shield className="size-4" />}>
            <p className="text-xs text-white/70 leading-relaxed font-mono text-[11px] bg-white/[0.02] p-2.5 rounded-lg border border-white/5">
              {data.source
                ? `Ingested via ${data.source}`
                : data.domain === "investor"
                  ? "Verified through multiple sources"
                  : data.domain === "job"
                    ? "Aggregated ATS Provider Pipeline"
                    : "Local Business Directory & Web Scraper"}
            </p>
          </Section>
        </div>
      </div>

      {/* § Outreach Draft Modal */}
      {draftOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDraftOpen(false)}
          />
          <div className="relative w-full max-w-md bg-[#131316] border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white truncate">{draftLabel}</h3>
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="size-4" />
              </button>
            </div>

            {draftMut.isPending ? (
              <div className="py-10 text-center text-xs text-white/60">
                <RefreshCw className="size-4 animate-spin mx-auto mb-3 text-white/40" />
                <p>Drafting with AI…</p>
              </div>
            ) : draftError ? (
              <div className="space-y-3">
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3 leading-relaxed">
                  {draftError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDraftError(null);
                    draftMut.mutate();
                  }}
                  className="w-full glass-pill py-2 px-3 text-xs font-medium text-white/80 hover:text-white flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="size-3.5" />
                  <span>Try again</span>
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-white/40">
                    Subject
                  </label>
                  <input
                    value={draftSubject}
                    onChange={(e) => setDraftSubject(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white outline-none focus:border-white/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-white/40">
                    Email (editable)
                  </label>
                  <textarea
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    rows={11}
                    className="w-full px-3 py-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-white leading-relaxed outline-none focus:border-white/30 resize-y min-h-44"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={copyDraft}
                    className="flex-1 glass-pill py-2 px-3 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 flex items-center justify-center gap-1.5"
                  >
                    <Copy className="size-3.5" />
                    <span>Copy draft</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => draftMut.mutate()}
                    disabled={draftMut.isPending}
                    className="flex-1 glass-pill py-2 px-3 text-xs font-medium text-white/80 hover:text-white flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    <RefreshCw className="size-3.5" />
                    <span>Regenerate</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-xs font-semibold text-white/60 uppercase tracking-wider">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function ContactRow({
  icon,
  value,
  href,
  external,
}: {
  icon: React.ReactNode;
  value: string;
  href: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-colors group"
    >
      {icon}
      <span className="text-xs text-white/80 truncate group-hover:text-white">{value}</span>
      {external && <ExternalLink className="size-3 text-white/30 ml-auto shrink-0" />}
    </a>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-white/40 shrink-0">{label}</span>
      <span className="text-white/80 text-right truncate">{value}</span>
    </div>
  );
}
