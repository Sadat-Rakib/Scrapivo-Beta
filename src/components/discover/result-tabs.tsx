import type { Lead } from "@/lib/scoring";
import type {
  CompanyRow,
  PersonRow,
  InlineContacts,
  LocalBusinessRow,
} from "@/lib/search/lead-segments";
import { LeadCard } from "@/components/lead-card";
import { IntentBadge } from "@/components/discover/intent-badge";
import type { SignalTier } from "@/lib/intent/strategy";
import { Button } from "@/components/ui/button";
import { ensureHttpUrl } from "@/lib/search/site-url";

/** Verified-intent badge input (null/undefined = no badge, never shown). */
export type IntentBadgeInput = { tier: SignalTier; confidence?: number } | null | undefined;
import {
  Building2,
  FileText,
  Users,
  Mail,
  MessageSquare,
  Phone,
  ExternalLink,
  Linkedin,
  Globe,
  Twitter,
  Facebook,
  Github,
  MapPin,
  Clock,
  BadgeCheck,
  Store,
} from "lucide-react";

export type ResultTab = "posts" | "companies" | "people" | "local";

export type ResolvedContactInfo = {
  email?: string;
  phone?: string;
  domain?: string;
  note?: string;
  /** MX / ZeroBounce / MillionVerifier / pattern verification label */
  verifyNote?: string;
  socials?: {
    linkedin?: string;
    twitter?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
    github?: string;
  };
  status: "ok" | "none";
};

function SocialRow({ socials }: { socials?: ResolvedContactInfo["socials"] }) {
  if (!socials) return null;
  const entries: Array<[string, string | undefined, typeof Globe]> = [
    ["LinkedIn", socials.linkedin, Linkedin],
    ["X", socials.twitter, Twitter],
    ["Facebook", socials.facebook, Facebook],
    ["Instagram", socials.instagram, Globe],
    ["YouTube", socials.youtube, Globe],
    ["TikTok", socials.tiktok, Globe],
    ["GitHub", socials.github, Github],
  ];
  const present = entries.filter(([, url]) => !!url);
  if (!present.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5 pt-1">
      {present.map(([label, url, Icon]) => (
        <IconLink key={label} href={url!} label={label} icon={Icon} />
      ))}
    </div>
  );
}

export function ResultTabPills({
  tab,
  onChange,
  counts,
  visible,
}: {
  tab: ResultTab;
  onChange: (t: ResultTab) => void;
  counts: { posts: number; companies: number; people: number; local?: number };
  /** When set, only these tabs are shown (audience-scoped Discover). */
  visible?: ResultTab[];
}) {
  const items: Array<{ id: ResultTab; label: string; icon: typeof FileText; n: number }> = (
    [
      { id: "posts" as const, label: "Posts", icon: FileText, n: counts.posts },
      { id: "companies" as const, label: "Companies", icon: Building2, n: counts.companies },
      { id: "people" as const, label: "People", icon: Users, n: counts.people },
      { id: "local" as const, label: "Local", icon: Store, n: counts.local ?? 0 },
    ] as const
  ).filter((it) => !visible || visible.includes(it.id));
  if (!items.length) return null;
  return (
    <div className="inline-flex rounded-full border border-border p-0.5 bg-muted/40">
      {items.map(({ id, label, icon: Icon, n }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors ${
            tab === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="size-3.5" />
          {label}
          <span className="text-[10px] opacity-70">{n}</span>
        </button>
      ))}
    </div>
  );
}

/** Contact details the poster published inside the post itself — highest trust. */
function InPostContacts({ ic }: { ic?: InlineContacts }) {
  if (!ic) return null;
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 space-y-0.5">
      {ic.emails.map((e) => (
        <div key={e} className="flex items-center gap-1.5 text-xs">
          <Mail className="size-3 text-primary shrink-0" />
          <a
            href={`mailto:${e}`}
            className="hover:underline truncate"
            onClick={(ev) => ev.stopPropagation()}
          >
            {e}
          </a>
        </div>
      ))}
      {ic.phones.map((p) => (
        <div key={p} className="flex items-center gap-1.5 text-xs">
          <Phone className="size-3 text-primary shrink-0" />
          <span className="truncate">{p}</span>
        </div>
      ))}
      {ic.links.map((l) => (
        <div key={l} className="flex items-center gap-1.5 text-xs">
          <ExternalLink className="size-3 text-primary shrink-0" />
          <a
            href={l}
            target="_blank"
            rel="noreferrer"
            className="hover:underline truncate"
            onClick={(ev) => ev.stopPropagation()}
          >
            {l.replace(/^https?:\/\//, "")}
          </a>
        </div>
      ))}
      <div className="text-[10px] text-muted-foreground">published in the post</div>
    </div>
  );
}

function IconLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Globe;
}) {
  // Website href safety: schemeless stored URLs are qualified here so every
  // icon link opens the site instead of navigating inside the app.
  const safe = ensureHttpUrl(href) ?? href;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
    >
      <Icon className="size-3" /> {label}
    </a>
  );
}

export function CompanyCard({
  row,
  onOpen,
  contact,
  onGenerate,
  intent,
  relevance,
}: {
  row: CompanyRow;
  onOpen: (row: CompanyRow) => void;
  contact?: ResolvedContactInfo;
  onGenerate?: (row: CompanyRow, kind: "email" | "message") => void;
  intent?: IntentBadgeInput;
  /** Phase A3: stated-criteria relevance chips (derived, never invented). */
  relevance?: string[];
}) {
  return (
    <div className="w-full p-4 rounded-xl border border-border bg-card hover:border-primary/30 transition-all space-y-2">
      <button type="button" onClick={() => onOpen(row)} className="text-left w-full">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{row.name}</div>
            {row.domain && (
              <div className="text-xs text-muted-foreground truncate">{row.domain}</div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {intent ? <IntentBadge tier={intent.tier} confidence={intent.confidence} /> : null}
            <span className="text-[10px] text-muted-foreground">
              {row.signal_count} signal{row.signal_count === 1 ? "" : "s"}
            </span>
            {row.latest_signal && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="size-3" /> {row.latest_signal}
              </span>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-foreground/80 line-clamp-2">{row.why_now}</p>
        {relevance && relevance.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {relevance.map((chip) => (
              <span
                key={chip}
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        {row.description && (
          <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{row.description}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {row.platforms.slice(0, 4).map((p) => (
            <span
              key={p}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            >
              {p}
            </span>
          ))}
        </div>
      </button>
      {(row.linkedin_url || row.twitter_url || row.facebook_url || row.website) && (
        <div className="flex flex-wrap items-center gap-2.5">
          {row.linkedin_url && (
            <IconLink href={row.linkedin_url} label="LinkedIn" icon={Linkedin} />
          )}
          {row.twitter_url && <IconLink href={row.twitter_url} label="X" icon={Twitter} />}
          {row.facebook_url && (
            <IconLink href={row.facebook_url} label="Facebook" icon={Facebook} />
          )}
          {!row.linkedin_url && !row.twitter_url && !row.facebook_url && row.website && (
            <IconLink href={row.website} label="Site" icon={Globe} />
          )}
        </div>
      )}
      {onGenerate && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onGenerate(row, "email")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Mail className="size-3" /> Email
          </button>
          <button
            type="button"
            onClick={() => onGenerate(row, "message")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <MessageSquare className="size-3" /> Message
          </button>
        </div>
      )}
      {contact?.status !== "ok" && <InPostContacts ic={row.inline_contacts} />}
      {contact?.status === "ok" && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 space-y-1">
          {contact.email && (
            <div className="flex items-center gap-1.5 text-xs">
              <Mail className="size-3 text-emerald-400 shrink-0" />
              <a href={`mailto:${contact.email}`} className="hover:underline truncate">
                {contact.email}
              </a>
            </div>
          )}
          {contact.phone && (
            <div className="flex items-center gap-1.5 text-xs">
              <Phone className="size-3 text-emerald-400 shrink-0" />
              <span className="truncate">{contact.phone}</span>
            </div>
          )}
          {contact.domain && (
            <div className="flex items-center gap-1.5 text-xs">
              <Globe className="size-3 text-emerald-400 shrink-0" />
              <span className="truncate">{contact.domain}</span>
            </div>
          )}
          {contact.note && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <BadgeCheck className="size-3 shrink-0" /> {contact.note}
            </div>
          )}
          <SocialRow socials={contact.socials} />
        </div>
      )}
      {contact?.status === "none" &&
        !row.inline_contacts &&
        !(row.website || row.linkedin_url || row.twitter_url) && (
          <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
            No verified contact found yet — try Research on the lead.
          </div>
        )}
      {contact?.status === "none" &&
        !row.inline_contacts &&
        (row.website || row.linkedin_url || row.twitter_url) && (
          <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
            Profile available — email/phone not verified yet.
          </div>
        )}
    </div>
  );
}

export function PersonCard({
  row,
  onOpen,
  contact,
  intent,
  onGenerate,
}: {
  row: PersonRow;
  onOpen: (row: PersonRow) => void;
  contact?: ResolvedContactInfo;
  intent?: IntentBadgeInput;
  onGenerate?: (row: PersonRow, kind: "email" | "message") => void;
}) {
  return (
    <div className="w-full p-4 rounded-xl border border-border bg-card space-y-2">
      <button type="button" onClick={() => onOpen(row)} className="text-left w-full">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{row.name}</div>
            {row.role_hint && <div className="text-[11px] text-primary/90">{row.role_hint}</div>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {intent ? <IntentBadge tier={intent.tier} confidence={intent.confidence} /> : null}
            {row.platform && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[130px]">
                {row.platform}
              </span>
            )}
            {row.posted_at_relative ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="size-3" /> {row.posted_at_relative}
              </span>
            ) : null}
          </div>
        </div>
        {(row.company_hint || row.company_domain) && (
          <div className="mt-1 text-xs text-muted-foreground truncate">
            {[row.company_hint, row.company_domain].filter(Boolean).join(" · ")}
          </div>
        )}
        {row.title_hint && (
          <div className="mt-1 text-xs text-muted-foreground line-clamp-1">{row.title_hint}</div>
        )}
        {row.location_hint && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin className="size-3" /> {row.location_hint}
          </div>
        )}
        {row.why_match && (
          <p className="mt-1.5 text-xs text-foreground/80 line-clamp-2">{row.why_match}</p>
        )}
      </button>

      {(row.linkedin_url || row.github_url || row.author_url) && (
        <div className="flex flex-wrap items-center gap-2.5">
          {row.linkedin_url && (
            <IconLink href={row.linkedin_url} label="LinkedIn" icon={Linkedin} />
          )}
          {row.github_url && <IconLink href={row.github_url} label="GitHub" icon={Github} />}
          {!row.linkedin_url && !row.github_url && row.author_url && (
            <IconLink href={row.author_url} label="Profile" icon={ExternalLink} />
          )}
        </div>
      )}
      {contact?.status !== "ok" && <InPostContacts ic={row.inline_contacts} />}
      {contact?.status === "ok" && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 space-y-1">
          {contact.email && (
            <div className="flex items-center gap-1.5 text-xs">
              <Mail className="size-3 text-emerald-400 shrink-0" />
              <a href={`mailto:${contact.email}`} className="hover:underline truncate">
                {contact.email}
              </a>
            </div>
          )}
          {contact.phone && (
            <div className="flex items-center gap-1.5 text-xs">
              <Phone className="size-3 text-emerald-400 shrink-0" />
              <span className="truncate">{contact.phone}</span>
            </div>
          )}
          {contact.domain && !contact.email && (
            <div className="flex items-center gap-1.5 text-xs">
              <Globe className="size-3 text-emerald-400 shrink-0" />
              <span className="truncate">{contact.domain}</span>
            </div>
          )}
          {contact.note && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <BadgeCheck className="size-3 shrink-0" /> {contact.note}
            </div>
          )}
          <SocialRow socials={contact.socials} />
        </div>
      )}
      {contact?.status === "none" &&
        !row.inline_contacts &&
        !(row.author_url || row.linkedin_url || row.github_url) && (
          <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
            No verified email/phone found yet — try Research on the lead.
          </div>
        )}
      {contact?.status === "none" &&
        !row.inline_contacts &&
        !!(row.author_url || row.linkedin_url || row.github_url) && (
          <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
            Profile available — email/phone not verified yet.
          </div>
        )}
      {!contact &&
        !!(row.author_url || row.linkedin_url || row.github_url) &&
        !row.inline_contacts && (
          <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
            Profile available
          </div>
        )}
      {onGenerate && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onGenerate(row, "email")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Mail className="size-3" /> Email
          </button>
          <button
            type="button"
            onClick={() => onGenerate(row, "message")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <MessageSquare className="size-3" /> Message
          </button>
        </div>
      )}
    </div>
  );
}

// ── Bitscale-style table views ──────────────────────────────────────────────
export function ViewToggle({
  view,
  onChange,
}: {
  view: "cards" | "table";
  onChange: (v: "cards" | "table") => void;
}) {
  const labels = { cards: "Cards", table: "Lists" } as const;
  return (
    <div className="inline-flex rounded-full border border-border p-0.5 bg-muted/40">
      {(["cards", "table"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${
            view === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );
}

const th = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2 text-xs align-middle";

export function BusinessTable({
  rows,
  onOpen,
  onGenerate,
  relevanceByKey,
}: {
  rows: LocalBusinessRow[];
  onOpen?: (row: LocalBusinessRow) => void;
  onGenerate?: (row: LocalBusinessRow, kind: "email" | "message") => void;
  relevanceByKey?: Record<string, string[]>;
}) {
  return (
    <div className="rounded-xl border border-border overflow-x-auto pb-1">
      <table className="w-full min-w-[1020px] border-collapse">
        <thead className="bg-muted/40">
          <tr>
            <th className={th}>Business</th>
            <th className={th}>Category</th>
            <th className={th}>Location</th>
            <th className={th}>Phone</th>
            <th className={th}>Site status</th>
            <th className={th}>Why match</th>
            <th className={th}>Email</th>
            <th className={th}>Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const siteUrl = ensureHttpUrl(r.website);
            const why =
              (r.why_match && r.why_match.trim()) ||
              (relevanceByKey?.[r.key] ?? []).join(" · ") ||
              "";
            return (
              <tr
                key={r.key}
                onClick={() => onOpen?.(r)}
                className="border-t border-border hover:bg-accent/40 cursor-pointer"
              >
                <td className={`${td} font-medium whitespace-nowrap`}>
                  {r.name}
                  {r.soft_duplicate ? (
                    <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                      possible dup
                    </span>
                  ) : null}
                </td>
                <td className={`${td} text-muted-foreground`}>{r.category ?? "—"}</td>
                <td className={`${td} text-muted-foreground max-w-[220px] truncate`}>
                  {r.address ?? "—"}
                </td>
                <td className={td}>
                  {r.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3" /> {r.phone}
                    </span>
                  ) : r.phoneStatus === "mismatch-hidden" || r.phoneStatus === "invalid-hidden" ? (
                    <span className="text-muted-foreground/70">unverified</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className={td}>
                  {siteUrl ? (
                    <a
                      href={siteUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Globe className="size-3" /> Listed
                    </a>
                  ) : (
                    <span className="text-emerald-400">No site</span>
                  )}
                </td>
                <td className={`${td} text-muted-foreground max-w-[220px] truncate`}>
                  {why || null}
                </td>
                <td className={td} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onGenerate?.(r, "email")}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors whitespace-nowrap"
                  >
                    <Mail className="size-3" /> Email
                  </button>
                </td>
                <td className={td} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onGenerate?.(r, "message")}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors whitespace-nowrap"
                  >
                    <MessageSquare className="size-3" /> Msg
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CompanyTable({
  rows,
  onOpen,
  onGenerate,
  relevanceByKey,
}: {
  rows: CompanyRow[];
  onOpen: (row: CompanyRow) => void;
  onGenerate?: (row: CompanyRow, kind: "email" | "message") => void;
  relevanceByKey?: Record<string, string[]>;
}) {
  return (
    <div className="rounded-xl border border-border overflow-x-auto pb-1">
      <table className="w-full min-w-[860px] border-collapse">
        <thead className="bg-muted/40">
          <tr>
            <th className={th}>Company</th>
            <th className={th}>Domain</th>
            <th className={th}>Signals</th>
            <th className={th}>Latest</th>
            <th className={th}>Why match</th>
            <th className={th}>Links</th>
            <th className={th}>Generate Email</th>
            <th className={th}>Generate Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              onClick={() => onOpen(r)}
              className="border-t border-border hover:bg-accent/40 cursor-pointer"
            >
              <td className={`${td} font-medium`}>{r.name}</td>
              <td className={`${td} text-muted-foreground`}>{r.domain ?? "—"}</td>
              <td className={td}>{r.signal_count}</td>
              <td className={`${td} text-muted-foreground`}>{r.latest_signal ?? "—"}</td>
              <td className={`${td} text-muted-foreground max-w-[220px] truncate`}>
                {(relevanceByKey?.[r.key] ?? []).join(" · ") || "—"}
              </td>
              <td className={td} onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex items-center gap-2.5">
                  {r.website && <IconLink href={r.website} label="Site" icon={Globe} />}
                  {r.linkedin_url && <IconLink href={r.linkedin_url} label="LI" icon={Linkedin} />}
                  {r.twitter_url && <IconLink href={r.twitter_url} label="X" icon={Twitter} />}
                  <IconLink href={r.sample_url} label="Signal" icon={ExternalLink} />
                </span>
              </td>
              <td className={td} onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onGenerate?.(r, "email")}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors whitespace-nowrap"
                >
                  <Mail className="size-3" /> Email
                </button>
              </td>
              <td className={td} onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onGenerate?.(r, "message")}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors whitespace-nowrap"
                >
                  <MessageSquare className="size-3" /> Message
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PersonTable({
  rows,
  onOpen,
  onGenerate,
}: {
  rows: PersonRow[];
  onOpen: (row: PersonRow) => void;
  onGenerate?: (row: PersonRow, kind: "email" | "message") => void;
}) {
  return (
    <div className="rounded-xl border border-border overflow-x-auto pb-1">
      <table className="w-full min-w-[1020px] border-collapse">
        <thead className="bg-muted/40">
          <tr>
            <th className={th}>Name</th>
            <th className={th}>Role</th>
            <th className={th}>Company</th>
            <th className={th}>Location</th>
            <th className={th}>Email</th>
            <th className={th}>Social</th>
            <th className={th}>Why match</th>
            <th className={th}>Generate Email</th>
            <th className={th}>Generate Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              onClick={() => onOpen(r)}
              className="border-t border-border hover:bg-accent/40 cursor-pointer"
            >
              <td className={`${td} font-medium whitespace-nowrap`}>{r.name}</td>
              <td className={`${td} text-muted-foreground`}>{r.role_hint ?? "—"}</td>
              <td className={`${td} text-muted-foreground`}>
                {r.company_hint ?? r.company_domain ?? "—"}
              </td>
              <td className={`${td} text-muted-foreground max-w-[180px] truncate`}>
                {r.location_hint ?? "—"}
              </td>
              <td className={`${td} max-w-[220px] truncate`}>
                {r.inline_contacts?.emails?.[0] ? (
                  <a
                    href={`mailto:${r.inline_contacts.emails[0]}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-emerald-400 hover:underline"
                  >
                    {r.inline_contacts.emails[0]}
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={td} onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex items-center gap-2.5">
                  {r.linkedin_url && (
                    <IconLink href={r.linkedin_url} label="LinkedIn" icon={Linkedin} />
                  )}
                  {r.github_url && <IconLink href={r.github_url} label="GitHub" icon={Github} />}
                  {!r.linkedin_url && !r.github_url && r.author_url && (
                    <IconLink href={r.author_url} label="Profile" icon={ExternalLink} />
                  )}
                </span>
              </td>
              <td
                className={`${td} text-muted-foreground max-w-[240px] truncate`}
                title={r.why_match ?? undefined}
              >
                {r.why_match ?? null}
              </td>
              <td className={td} onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onGenerate?.(r, "email")}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors whitespace-nowrap"
                >
                  <Mail className="size-3" /> Email
                </button>
              </td>
              <td className={td} onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onGenerate?.(r, "message")}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors whitespace-nowrap"
                >
                  <MessageSquare className="size-3" /> Message
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PostsGrid({
  leads,
  savedByUrl,
  onOpen,
  onSave,
}: {
  leads: Lead[];
  savedByUrl: Map<string, any>;
  onOpen: (l: Lead) => void;
  onSave: (l: Lead) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-4">
      {leads.map((l, idx) => (
        <LeadCard
          key={l.full_post_url || `${l.title}-${idx}`}
          lead={l}
          saved={savedByUrl.has(l.full_post_url)}
          onOpen={() => onOpen(l)}
          onSave={() => onSave(l)}
        />
      ))}
    </div>
  );
}

export function LocalBusinessCard({
  row,
  onOpen,
  onGenerate,
  intent,
  relevance,
}: {
  row: LocalBusinessRow;
  onOpen?: (row: LocalBusinessRow) => void;
  onGenerate?: (row: LocalBusinessRow, kind: "email" | "message") => void;
  intent?: IntentBadgeInput;
  /** Phase A3: stated-criteria relevance chips (derived, never invented). */
  relevance?: string[];
}) {
  return (
    <div className="w-full p-4 rounded-xl border border-border bg-card hover:border-primary/30 transition-all space-y-2">
      <button type="button" onClick={() => onOpen?.(row)} className="text-left w-full">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{row.name}</div>
            {row.category && (
              <div className="text-xs text-muted-foreground truncate">{row.category}</div>
            )}
          </div>
          <span className="flex flex-col items-end gap-1 shrink-0">
            {intent ? <IntentBadge tier={intent.tier} confidence={intent.confidence} /> : null}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Local
            </span>
          </span>
        </div>
        {row.address && <p className="text-xs text-muted-foreground truncate">{row.address}</p>}
        {relevance && relevance.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {relevance.map((chip) => (
              <span
                key={chip}
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </button>
      {onGenerate && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onGenerate(row, "email")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Mail className="size-3" /> Email
          </button>
          <button
            type="button"
            onClick={() => onGenerate(row, "message")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <MessageSquare className="size-3" /> Message
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {ensureHttpUrl(row.website) && (
          <a
            href={ensureHttpUrl(row.website)!}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <Globe className="size-3" /> Website
          </a>
        )}
        {row.phone && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Phone className="size-3" /> {row.phone}
          </span>
        )}
        {!row.phone &&
          (row.phoneStatus === "mismatch-hidden" || row.phoneStatus === "invalid-hidden") && (
            <span className="inline-flex items-center gap-1 text-muted-foreground/70">
              <Phone className="size-3" /> number unverified
            </span>
          )}
        {row.email && (
          <a
            href={`mailto:${row.email}`}
            className="inline-flex items-center gap-1 text-emerald-500 hover:underline"
          >
            <Mail className="size-3" /> {row.email}
            {row.email_verified && <BadgeCheck className="size-3" />}
          </a>
        )}
      </div>
    </div>
  );
}

export function LocalBusinessesGrid({
  rows,
  onOpen,
  onGenerate,
  intentByKey,
  relevanceByKey,
}: {
  rows: LocalBusinessRow[];
  onOpen?: (row: LocalBusinessRow) => void;
  onGenerate?: (row: LocalBusinessRow, kind: "email" | "message") => void;
  intentByKey?: Record<string, IntentBadgeInput>;
  relevanceByKey?: Record<string, string[]>;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-4">
      {rows.map((r) => (
        <LocalBusinessCard
          key={r.key}
          row={r}
          onOpen={onOpen}
          onGenerate={onGenerate}
          intent={intentByKey?.[r.key] ?? null}
          relevance={relevanceByKey?.[r.key]}
        />
      ))}
    </div>
  );
}

/** Compact list variant: one row per post, no cards. */
export function PostsList({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {leads.map((l) => (
        <button
          key={l.full_post_url}
          type="button"
          onClick={() => onOpen(l)}
          className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-accent/40 transition-colors text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium truncate">{l.title}</span>
            <span className="block text-[11px] text-muted-foreground truncate">
              {l.platform ?? l.source ?? "Post"}
            </span>
          </span>
          <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
        </button>
      ))}
    </div>
  );
}
