// Detail drawer for a Company or Person row — the "tap the card, see
// everything" view: identity, socials, signals timeline, contact resolution.
import type { CompanyRow, PersonRow } from "@/lib/search/lead-segments";
import type { ResolvedContactInfo } from "@/components/discover/result-tabs";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Clock,
  ExternalLink,
  Facebook,
  FileText,
  Github,
  Globe,
  Linkedin,
  Mail,
  MapPin,
  Phone,
  Radar,
  Twitter,
  User,
  X,
  BadgeCheck,
} from "lucide-react";

export type SelectedEntity =
  | { type: "company"; company: CompanyRow }
  | { type: "person"; person: PersonRow };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="w-24 shrink-0 text-xs text-muted-foreground pt-0.5">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function LinkOut({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Globe }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mr-3"
    >
      <Icon className="size-3" /> {label}
    </a>
  );
}

function ContactBlock({
  contact,
  onResolve,
  onDeepEnrich,
  busy,
  hasProfile,
}: {
  contact?: ResolvedContactInfo;
  onResolve: () => void;
  onDeepEnrich?: () => void;
  busy?: boolean;
  hasProfile?: boolean;
}) {
  const actions = (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={onResolve}>
        <Mail className="size-3 mr-1" />
        <Phone className="size-3 mr-1" />
        {busy ? "Resolving…" : "Resolve contact"}
      </Button>
      {onDeepEnrich && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={busy}
          onClick={onDeepEnrich}
          title="Browser + paid enrich (CoreClaw LinkedIn/domain email, Hunter/PDL if keyed). Needs STEALTH_WORKER_URL or SCRAPE_WORKER_URL for browser fetch."
        >
          <Radar className="size-3 mr-1" />
          {busy ? "Enriching…" : "Deep enrich"}
        </Button>
      )}
    </div>
  );

  if (!contact) {
    return (
      <div className="space-y-1.5">
        {hasProfile && (
          <div className="text-xs text-muted-foreground">Profile available</div>
        )}
        {actions}
      </div>
    );
  }
  if (contact.status === "none") {
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">
          {hasProfile
            ? "Profile available — email/phone not verified yet. Try Deep enrich for a browser fetch."
            : "No verified email/phone found yet — try Deep enrich or Research on the lead."}
        </div>
        {actions}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 space-y-1.5">
        {contact.email && (
          <div className="flex items-center gap-1.5 text-sm">
            <Mail className="size-3.5 text-emerald-400 shrink-0" />
            <a href={`mailto:${contact.email}`} className="hover:underline truncate">{contact.email}</a>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-1.5 text-sm">
            <Phone className="size-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{contact.phone}</span>
          </div>
        )}
        {contact.domain && (
          <div className="flex items-center gap-1.5 text-sm">
            <Globe className="size-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{contact.domain}</span>
          </div>
        )}
        {(contact.verifyNote || contact.note) && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <BadgeCheck className="size-3 shrink-0" />
            {[contact.verifyNote, contact.note].filter(Boolean).join(" · ")}
          </div>
        )}
        {contact.socials && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {contact.socials.linkedin && <LinkOut href={contact.socials.linkedin} label="LinkedIn" icon={Linkedin} />}
            {contact.socials.twitter && <LinkOut href={contact.socials.twitter} label="X" icon={Twitter} />}
            {contact.socials.facebook && <LinkOut href={contact.socials.facebook} label="Facebook" icon={Facebook} />}
            {contact.socials.instagram && <LinkOut href={contact.socials.instagram} label="Instagram" icon={Globe} />}
            {contact.socials.youtube && <LinkOut href={contact.socials.youtube} label="YouTube" icon={Globe} />}
            {contact.socials.tiktok && <LinkOut href={contact.socials.tiktok} label="TikTok" icon={Globe} />}
            {contact.socials.github && <LinkOut href={contact.socials.github} label="GitHub" icon={Github} />}
          </div>
        )}
      </div>
      {onDeepEnrich && actions}
    </div>
  );
}

export function EntityDetailPanel({
  entity,
  onClose,
  contact,
  onResolveContact,
  onDeepEnrich,
  contactBusy,
}: {
  entity: SelectedEntity;
  onClose: () => void;
  contact?: ResolvedContactInfo;
  onResolveContact: () => void;
  onDeepEnrich?: () => void;
  contactBusy?: boolean;
}) {
  const isCompany = entity.type === "company";
  const c = isCompany ? entity.company : null;
  const p = !isCompany ? entity.person : null;

  return (
    <div className="p-4 md:p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
            {isCompany ? <Building2 className="size-4.5" /> : <User className="size-4.5" />}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-base truncate">{c?.name ?? p?.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {isCompany
                ? [c?.domain, `${c?.signal_count} signal${c?.signal_count === 1 ? "" : "s"}`]
                    .filter(Boolean)
                    .join(" · ")
                : [p?.role_hint, p?.platform].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-2.5">
        {isCompany && c && (
          <>
            {c.latest_signal && (
              <Row label="Latest">
                <span className="inline-flex items-center gap-1 text-sm">
                  <Clock className="size-3.5 text-muted-foreground" /> {c.latest_signal}
                </span>
              </Row>
            )}
            <Row label="Why now">
              <p className="text-sm text-foreground/85">{c.why_now}</p>
            </Row>
            <Row label="Links">
              <div className="flex flex-wrap gap-y-1">
                {c.website && <LinkOut href={c.website} label="Website" icon={Globe} />}
                {c.linkedin_url && <LinkOut href={c.linkedin_url} label="LinkedIn" icon={Linkedin} />}
                {c.twitter_url && <LinkOut href={c.twitter_url} label="X" icon={Twitter} />}
                {c.facebook_url && <LinkOut href={c.facebook_url} label="Facebook" icon={Facebook} />}
              </div>
            </Row>
          </>
        )}

        {!isCompany && p && (
          <>
            {(p.company_hint || p.company_domain) && (
              <Row label="Company">
                <span className="text-sm">
                  {[p.company_hint, p.company_domain].filter(Boolean).join(" · ")}
                </span>
              </Row>
            )}
            {p.location_hint && (
              <Row label="Location">
                <span className="inline-flex items-center gap-1 text-sm">
                  <MapPin className="size-3.5 text-muted-foreground" /> {p.location_hint}
                </span>
              </Row>
            )}
            {p.why_match && (
              <Row label="Why match">
                <p className="text-sm text-foreground/85">{p.why_match}</p>
              </Row>
            )}
            <Row label="Links">
              <div className="flex flex-wrap gap-y-1">
                {p.author_url && <LinkOut href={p.author_url} label="Profile" icon={ExternalLink} />}
                {p.linkedin_url && <LinkOut href={p.linkedin_url} label="LinkedIn" icon={Linkedin} />}
                {p.github_url && <LinkOut href={p.github_url} label="GitHub" icon={Github} />}
              </div>
            </Row>
          </>
        )}

        <Row label="Contact">
          <ContactBlock
            contact={contact}
            onResolve={onResolveContact}
            onDeepEnrich={onDeepEnrich}
            busy={contactBusy}
            hasProfile={
              isCompany
                ? !!(c?.website || c?.linkedin_url || c?.twitter_url)
                : !!(p?.author_url || p?.linkedin_url || p?.github_url)
            }
          />
        </Row>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {isCompany ? "Signals" : "Post"}
        </div>
        {(isCompany ? c!.leads : [p!.lead]).map((l) => (
          <a
            key={l.full_post_url}
            href={l.full_post_url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-border bg-card hover:border-primary/30 px-3 py-2 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
              <FileText className="size-3" />
              <span className="truncate">{l.platform_label ?? l.platform ?? "Signal"}</span>
              <span className="ml-auto shrink-0">
                {l.posted_at_relative || "Recently (undated)"}
              </span>
            </div>
            <div className="text-sm line-clamp-2">{l.title}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
