import type { Lead } from "@/lib/scoring";
import type { CompanyRow, PersonRow, InlineContacts } from "@/lib/search/lead-segments";
import { LeadCard } from "@/components/lead-card";
import { Button } from "@/components/ui/button";
import {
  Building2,
  FileText,
  Users,
  Mail,
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
} from "lucide-react";

export type ResultTab = "posts" | "companies" | "people";

export type ResolvedContactInfo = {
  email?: string;
  phone?: string;
  domain?: string;
  note?: string;
  /** MX / ZeroBounce / pattern verification label */
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
  counts: { posts: number; companies: number; people: number };
  /** When set, only these tabs are shown (audience-scoped Discover). */
  visible?: ResultTab[];
}) {
  const items: Array<{ id: ResultTab; label: string; icon: typeof FileText; n: number }> = (
    [
      { id: "posts" as const, label: "Posts", icon: FileText, n: counts.posts },
      { id: "companies" as const, label: "Companies", icon: Building2, n: counts.companies },
      { id: "people" as const, label: "People", icon: Users, n: counts.people },
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
          <a href={`mailto:${e}`} className="hover:underline truncate" onClick={(ev) => ev.stopPropagation()}>
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
          <a href={l} target="_blank" rel="noreferrer" className="hover:underline truncate" onClick={(ev) => ev.stopPropagation()}>
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
  return (
    <a
      href={href}
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
  onResolveContact,
  contactBusy,
  contact,
}: {
  row: CompanyRow;
  onOpen: (row: CompanyRow) => void;
  onResolveContact?: (row: CompanyRow) => void;
  contactBusy?: boolean;
  contact?: ResolvedContactInfo;
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
      </button>
      <InPostContacts ic={row.inline_contacts} />
      {contact?.status === "ok" && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 space-y-1">
          {contact.email && (
            <div className="flex items-center gap-1.5 text-xs">
              <Mail className="size-3 text-emerald-400 shrink-0" />
              <a href={`mailto:${contact.email}`} className="hover:underline truncate">{contact.email}</a>
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
      {contact?.status === "none" && !row.inline_contacts && !(row.website || row.linkedin_url || row.twitter_url) && (
        <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          No verified contact found yet — try Research on the lead.
        </div>
      )}
      {contact?.status === "none" && !row.inline_contacts && (row.website || row.linkedin_url || row.twitter_url) && (
        <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          Profile available — email/phone not verified yet.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 pt-1 border-t border-border/60">
        {row.website && <IconLink href={row.website} label="Website" icon={Globe} />}
        {row.linkedin_url && <IconLink href={row.linkedin_url} label="LinkedIn" icon={Linkedin} />}
        {row.twitter_url && <IconLink href={row.twitter_url} label="X" icon={Twitter} />}
        {row.facebook_url && <IconLink href={row.facebook_url} label="Facebook" icon={Facebook} />}
        <IconLink href={row.sample_url} label="Signal" icon={ExternalLink} />
        {onResolveContact && (!contact || contact.status === "none") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] ml-auto"
            disabled={contactBusy}
            onClick={() => onResolveContact(row)}
          >
            <Mail className="size-3 mr-1" />
            {contactBusy ? "Resolving…" : contact?.status === "none" ? "Deep resolve" : "Resolve contact"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PersonCard({
  row,
  onOpen,
  onAccessContact,
  contactBusy,
  contact,
}: {
  row: PersonRow;
  onOpen: (row: PersonRow) => void;
  onAccessContact: (row: PersonRow) => void;
  contactBusy?: boolean;
  contact?: ResolvedContactInfo;
}) {
  return (
    <div className="w-full p-4 rounded-xl border border-border bg-card space-y-2">
      <button type="button" onClick={() => onOpen(row)} className="text-left w-full">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{row.name}</div>
            {row.role_hint && (
              <div className="text-[11px] text-primary/90">{row.role_hint}</div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {row.posted_at_relative ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="size-3" /> {row.posted_at_relative}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Clock className="size-3" /> Recently (undated)
              </span>
            )}
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

      <InPostContacts ic={row.inline_contacts} />
      {contact?.status === "ok" && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 space-y-1">
          {contact.email && (
            <div className="flex items-center gap-1.5 text-xs">
              <Mail className="size-3 text-emerald-400 shrink-0" />
              <a href={`mailto:${contact.email}`} className="hover:underline truncate">{contact.email}</a>
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
      {!contact && !!(row.author_url || row.linkedin_url || row.github_url) && !row.inline_contacts && (
        <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
          Profile available
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        {row.author_url && <IconLink href={row.author_url} label="Profile" icon={ExternalLink} />}
        {row.linkedin_url && <IconLink href={row.linkedin_url} label="LinkedIn" icon={Linkedin} />}
        {row.github_url && <IconLink href={row.github_url} label="GitHub" icon={Github} />}
        <IconLink href={row.sample_url} label="Post" icon={FileText} />
        {(!contact || contact.status === "none") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] ml-auto"
            disabled={contactBusy}
            onClick={() => onAccessContact(row)}
          >
            <Mail className="size-3 mr-1" />
            <Phone className="size-3 mr-1" />
            {contactBusy ? "Resolving…" : contact?.status === "none" ? "Deep resolve" : "Access contact"}
          </Button>
        )}
      </div>
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
  return (
    <div className="inline-flex rounded-full border border-border p-0.5 bg-muted/40">
      {(["cards", "table"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-full text-[11px] capitalize transition-colors ${
            view === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

const th = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2 text-xs align-middle";

export function CompanyTable({
  rows,
  onOpen,
}: {
  rows: CompanyRow[];
  onOpen: (row: CompanyRow) => void;
}) {
  return (
    <div className="rounded-xl border border-border overflow-x-auto pb-1">
      <table className="w-full min-w-[640px] border-collapse">
        <thead className="bg-muted/40">
          <tr>
            <th className={th}>Company</th>
            <th className={th}>Domain</th>
            <th className={th}>Signals</th>
            <th className={th}>Latest</th>
            <th className={th}>Links</th>
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
              <td className={td} onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex items-center gap-2.5">
                  {r.website && <IconLink href={r.website} label="Site" icon={Globe} />}
                  {r.linkedin_url && <IconLink href={r.linkedin_url} label="LI" icon={Linkedin} />}
                  {r.twitter_url && <IconLink href={r.twitter_url} label="X" icon={Twitter} />}
                  <IconLink href={r.sample_url} label="Signal" icon={ExternalLink} />
                </span>
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
}: {
  rows: PersonRow[];
  onOpen: (row: PersonRow) => void;
}) {
  return (
    <div className="rounded-xl border border-border overflow-x-auto pb-1">
      <table className="w-full min-w-[720px] border-collapse">
        <thead className="bg-muted/40">
          <tr>
            <th className={th}>Name</th>
            <th className={th}>Role</th>
            <th className={th}>Company</th>
            <th className={th}>Posted</th>
            <th className={th}>Links</th>
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
              <td className={`${td} text-muted-foreground`}>{r.role_hint ?? "—"}</td>
              <td className={`${td} text-muted-foreground`}>
                {r.company_hint ?? r.company_domain ?? "—"}
              </td>
              <td className={`${td} text-muted-foreground`}>{r.posted_at_relative ?? "—"}</td>
              <td className={td} onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex items-center gap-2.5">
                  {r.author_url && <IconLink href={r.author_url} label="Profile" icon={ExternalLink} />}
                  {r.linkedin_url && <IconLink href={r.linkedin_url} label="LI" icon={Linkedin} />}
                  {r.github_url && <IconLink href={r.github_url} label="GH" icon={Github} />}
                  <IconLink href={r.sample_url} label="Post" icon={FileText} />
                </span>
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
      {leads.map((l) => (
        <LeadCard
          key={l.full_post_url}
          lead={l}
          saved={savedByUrl.has(l.full_post_url)}
          onOpen={() => onOpen(l)}
          onSave={() => onSave(l)}
        />
      ))}
    </div>
  );
}
