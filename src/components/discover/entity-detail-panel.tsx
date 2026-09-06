// Detail drawer for a Company or Person row — the "tap the card, see
// everything" view: identity, socials, contact resolution, generate pills.
import type { CompanyRow, LocalBusinessRow, PersonRow } from "@/lib/search/lead-segments";
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
  MessageSquare,
  MapPin,
  Phone,
  Twitter,
  User,
  X,
  BadgeCheck,
  Store,
} from "lucide-react";

export type SelectedEntity =
  | { type: "company"; company: CompanyRow }
  | { type: "person"; person: PersonRow }
  | { type: "local"; local: LocalBusinessRow };

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

export function EntityDetailPanel({
  entity,
  onClose,
  contact,
  onResolveContact,
  contactBusy,
  onGenerate,
}: {
  entity: SelectedEntity;
  onClose: () => void;
  contact?: ResolvedContactInfo;
  onResolveContact: () => void;
  contactBusy?: boolean;
  onGenerate?: (kind: "email" | "message") => void;
}) {
  const isCompany = entity.type === "company";
  const isLocal = entity.type === "local";
  const c = isCompany ? entity.company : null;
  const b = isLocal ? entity.local : null;
  const p = !isCompany && !isLocal ? entity.person : null;
  // Investor rows come from the verified directory, not posts: no post links,
  // LinkedIn-only socials, and no fake "signals" section.
  const isInvestorRow = !isCompany && !isLocal && p?.lead.source === "investors";
  const hasProfile = isCompany
    ? !!(c?.website || c?.linkedin_url || c?.twitter_url)
    : isLocal
      ? !!b?.website
      : !!(p?.author_url || p?.linkedin_url || p?.github_url);

  // Social row: every real profile/site link on the row, then anything the
  // contact resolution surfaced — deduped by URL.
  const socialLinks = (() => {
    const seen = new Set<string>();
    const out: Array<{ href: string; label: string; icon: typeof Globe }> = [];
    const add = (href?: string, label?: string, icon?: typeof Globe) => {
      if (!href) return;
      const key = href.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ href, label: label ?? "Profile", icon: icon ?? Globe });
    };
    if (isCompany && c) {
      add(c.website, "Website", Globe);
      add(c.linkedin_url, "LinkedIn", Linkedin);
      add(c.twitter_url, "X", Twitter);
      add(c.facebook_url, "Facebook", Facebook);
    } else if (isLocal && b) {
      add(b.website, "Website", Globe);
    } else if (p) {
      add(p.linkedin_url, "LinkedIn", Linkedin);
      if (!isInvestorRow) {
        add(p.author_url, "Profile", ExternalLink);
        add(p.github_url, "GitHub", Github);
      }
    }
    if (contact?.status === "ok") {
      if (contact.domain) add(`https://${contact.domain}`, "Website", Globe);
      add(contact.socials?.linkedin, "LinkedIn", Linkedin);
      add(contact.socials?.twitter, "X", Twitter);
      add(contact.socials?.facebook, "Facebook", Facebook);
      add(contact.socials?.instagram, "Instagram", Globe);
      add(contact.socials?.youtube, "YouTube", Globe);
      add(contact.socials?.tiktok, "TikTok", Globe);
      add(contact.socials?.github, "GitHub", Github);
    }
    return out;
  })();

  const posts = isCompany
    ? (c?.leads ?? [])
    : isInvestorRow || isLocal
      ? []
      : p
        ? [p.lead]
        : [];

  return (
    <div className="p-4 md:p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
            {isCompany ? <Building2 className="size-4.5" /> : isLocal ? <Store className="size-4.5" /> : <User className="size-4.5" />}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-base truncate">{c?.name ?? b?.name ?? p?.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {isCompany
                ? [c?.domain, `${c?.signal_count} signal${c?.signal_count === 1 ? "" : "s"}`]
                    .filter(Boolean)
                    .join(" · ")
                : isLocal
                  ? [b?.category, b?.address?.split(",").slice(-2, -1)[0]?.trim()].filter(Boolean).join(" · ")
                  : [p?.role_hint, p?.company_hint].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-2.5">
        {isLocal && b && (
          <>
            {b.category && (
              <Row label="Category">
                <span className="text-sm">{b.category.replace(/_/g, " ")}</span>
              </Row>
            )}
            {b.address && (
              <Row label="Location">
                <span className="inline-flex items-center gap-1 text-sm">
                  <MapPin className="size-3.5 text-muted-foreground" /> {b.address}
                </span>
              </Row>
            )}
            {b.description && (
              <Row label="About">
                <p className="text-sm text-foreground/85">{b.description}</p>
              </Row>
            )}
            {!!b.opportunity_tags?.length && (
              <Row label="Signals">
                <div className="flex flex-wrap gap-1">
                  {b.opportunity_tags.slice(0, 6).map((t) => (
                    <span
                      key={t}
                      className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground"
                    >
                      {t.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </Row>
            )}
          </>
        )}
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
            {c.description && (
              <Row label="About">
                <p className="text-sm text-foreground/85">{c.description}</p>
              </Row>
            )}
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
            {p.description && (
              <Row label="About">
                <p className="text-sm text-foreground/85">{p.description}</p>
              </Row>
            )}
          </>
        )}

        {socialLinks.length > 0 && (
          <Row label="Social">
            <div className="flex flex-wrap gap-y-1">
              {socialLinks.map((l) => (
                <LinkOut key={l.href} href={l.href} label={l.label} icon={l.icon} />
              ))}
            </div>
          </Row>
        )}

        {isLocal && b?.email && (
          <Row label="Email">
            <a
              href={`mailto:${b.email}`}
              className="text-sm text-emerald-400 hover:underline break-all"
            >
              {b.email}
            </a>
          </Row>
        )}
        {isLocal && b?.phone && (
          <Row label="Number">
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Phone className="size-3.5 text-emerald-400 shrink-0" /> {b.phone}
            </span>
          </Row>
        )}
        {contact?.status === "ok" && contact.email && (
          <Row label="Email">
            <a
              href={`mailto:${contact.email}`}
              className="text-sm text-emerald-400 hover:underline break-all"
            >
              {contact.email}
            </a>
          </Row>
        )}
        {contact?.status === "ok" && contact.phone && (
          <Row label="Number">
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Phone className="size-3.5 text-emerald-400 shrink-0" /> {contact.phone}
            </span>
          </Row>
        )}
        {contact?.status === "ok" && (contact.verifyNote || contact.note) && (
          <Row label="Verified">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <BadgeCheck className="size-3.5 text-emerald-400 shrink-0" />
              {[contact.verifyNote, contact.note].filter(Boolean).join(" · ")}
            </span>
          </Row>
        )}
        {!isLocal && (
          <Row label="Contact">
            <div className="space-y-1.5">
              {contact?.status === "none" && (
                <div className="text-xs text-muted-foreground">
                  {hasProfile
                    ? "Profile available — email/phone not verified yet."
                    : "No verified email/phone found yet."}
                </div>
              )}
              {!contact && hasProfile && (
                <div className="text-xs text-muted-foreground">Profile available</div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={contactBusy}
                onClick={onResolveContact}
              >
                <Mail className="size-3 mr-1" />
                <Phone className="size-3 mr-1" />
                {contactBusy ? "Checking…" : "Show contact"}
              </Button>
            </div>
          </Row>
        )}
        {onGenerate && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => onGenerate("email")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Mail className="size-3.5" /> Generate email
            </button>
            <button
              type="button"
              onClick={() => onGenerate("message")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <MessageSquare className="size-3.5" /> Generate message
            </button>
          </div>
        )}
      </div>

      {posts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {isCompany ? "Signals" : "Post"}
          </div>
          {posts.map((l) => (
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
                {l.posted_at_relative ? (
                  <span className="ml-auto shrink-0">{l.posted_at_relative}</span>
                ) : null}
              </div>
              <div className="text-sm line-clamp-2">{l.title}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
