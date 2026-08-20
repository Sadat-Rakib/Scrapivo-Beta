import type { Lead } from "@/lib/scoring";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  X,
  ExternalLink,
  Sparkles,
  Copy,
  Target,
  Brain,
  ShieldCheck,
  Radar,
  Mail,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { generateOutreach } from "@/lib/outreach.functions";
import { researchLead, type LeadResearch } from "@/lib/research.functions";
import {
  resolveLeadContact,
  verificationLabel,
  type ContactResolutionResult,
} from "@/lib/contact.functions";
import {
  saveLead,
  updateSavedLead,
  saveLeadContact,
  setPipelineStage,
  listLeadActivity,
  logLeadActivity,
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
} from "@/lib/leads.functions";
import { checkEmailGate, sendLeadEmail, startEmailSequence } from "@/lib/outreach/email.functions";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SavedRow = any;

export function LeadDetailPanel({
  lead,
  saved,
  onClose,
  onSavedChange,
}: {
  lead: Lead;
  saved?: SavedRow | null;
  onClose: () => void;
  onSavedChange?: (patch: Record<string, unknown>) => void;
}) {
  const qc = useQueryClient();
  const gen = useServerFn(generateOutreach);
  const research = useServerFn(researchLead);
  const resolveContact = useServerFn(resolveLeadContact);
  const save = useServerFn(saveLead);
  const update = useServerFn(updateSavedLead);
  const saveContactFn = useServerFn(saveLeadContact);
  const setStage = useServerFn(setPipelineStage);
  const listActivity = useServerFn(listLeadActivity);
  const logActivity = useServerFn(logLeadActivity);
  const checkGate = useServerFn(checkEmailGate);
  const sendEmail = useServerFn(sendLeadEmail);
  const startSeq = useServerFn(startEmailSequence);

  const [notes, setNotes] = useState<string>(saved?.notes ?? "");
  const [gateReasons, setGateReasons] = useState<string[]>([]);
  const [gateOk, setGateOk] = useState<boolean | null>(null);
  const [outreach, setOutreach] = useState<{
    dm: string;
    email_subject: string;
    email_body: string;
    call: string;
  } | null>(
    saved && saved.outreach_dm
      ? {
          dm: saved.outreach_dm,
          email_subject: saved.outreach_email_subject ?? "",
          email_body: saved.outreach_email_body ?? "",
          call: saved.outreach_call ?? "",
        }
      : null,
  );
  const [brief, setBrief] = useState<LeadResearch | null>(null);
  const [contact, setContact] = useState<ContactResolutionResult | null>(null);
  const [usedHook, setUsedHook] = useState<string | null>(null);
  const [stage, setStageLocal] = useState<string>(saved?.status ?? "saved");

  const activityQ = useQuery({
    queryKey: ["lead-activity", saved?.id],
    queryFn: () => listActivity({ data: { saved_lead_id: saved!.id, limit: 20 } }),
    enabled: !!saved?.id,
  });

  useEffect(() => {
    setNotes(saved?.notes ?? "");
    setStageLocal(saved?.status ?? "saved");
    setOutreach(
      saved && saved.outreach_dm
        ? {
            dm: saved.outreach_dm,
            email_subject: saved.outreach_email_subject ?? "",
            email_body: saved.outreach_email_body ?? "",
            call: saved.outreach_call ?? "",
          }
        : null,
    );
    setBrief(null);
    setContact(null);
    setUsedHook(null);
    setGateOk(null);
    setGateReasons([]);
  }, [saved?.id, lead.full_post_url]);

  useEffect(() => {
    if (!saved?.id || !outreach?.email_body || !saved?.contact_email) {
      setGateOk(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const g = await checkGate({ data: { savedLeadId: saved.id } });
        if (!cancelled) {
          setGateOk(g.ok);
          setGateReasons(g.reasons);
        }
      } catch {
        if (!cancelled) {
          setGateOk(false);
          setGateReasons(["Could not evaluate compliance gate"]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [saved?.id, saved?.contact_email, outreach?.email_subject, outreach?.email_body, checkGate]);

  const ensureSaved = async (): Promise<string> => {
    if (saved?.id) return saved.id;
    const row = await save({ data: lead as any });
    await qc.invalidateQueries({ queryKey: ["saved-leads"] });
    return row.id;
  };

  const researchPayload = {
    leadUrl: lead.full_post_url,
    leadTitle: lead.title,
    leadSnippet: lead.snippet,
    leadPlatform: lead.platform,
    leadAuthor: lead.author,
  };

  const genMut = useMutation({
    mutationFn: async () => {
      const id = await ensureSaved();
      const out = await gen({
        data: { ...researchPayload, autoResearch: true },
      });
      if (out.needs_research) {
        throw new Error(out.message || "Research required before outreach");
      }
      await update({
        data: {
          id,
          outreach_dm: out.dm,
          outreach_email_subject: out.email_subject,
          outreach_email_body: out.email_body,
          outreach_call: out.call,
        },
      });
      await logActivity({
        data: {
          saved_lead_id: id,
          lead_url: lead.full_post_url,
          kind: "outreach_draft",
          detail: "Outreach drafts generated",
        },
      });
      await qc.invalidateQueries({ queryKey: ["saved-leads"] });
      await qc.invalidateQueries({ queryKey: ["lead-activity", id] });
      return out;
    },
    onSuccess: (out) => {
      setOutreach({
        dm: out.dm,
        email_subject: out.email_subject,
        email_body: out.email_body,
        call: out.call,
      });
      if (out.used_hook?.claim) setUsedHook(out.used_hook.claim);
      toast.success("Outreach drafted from verified research");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const briefMut = useMutation({
    mutationFn: () => research({ data: researchPayload }),
    onSuccess: (b) => {
      setBrief(b);
      toast.success(
        b.verified_hooks?.length
          ? `Research ready · ${b.verified_hooks.length} verified hook(s)`
          : "Research ready",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leadProfileUrls = () => {
    const fromText = `${lead.title}\n${lead.snippet}`.match(
      /https?:\/\/(?:[\w.]*\.)?linkedin\.com\/(?:company|in)\/[^\s)"']+/gi,
    );
    return [
      ...new Set(
        [lead.author_url, lead.full_post_url, ...(fromText || [])].filter((u): u is string => !!u),
      ),
    ];
  };

  const contactMut = useMutation({
    mutationFn: (deepEnrich?: boolean) => {
      const company = (lead.author || lead.title.split(/[@—-]/)[0] || lead.title)
        .trim()
        .slice(0, 80);
      return resolveContact({
        data: {
          company,
          postText: `${lead.title}\n${lead.snippet}`,
          personName: lead.author || undefined,
          knownEmail: lead.inline_contacts?.emails?.[0],
          profileUrls: leadProfileUrls(),
          deepEnrich: !!deepEnrich,
        },
      });
    },
    onSuccess: async (c) => {
      setContact(c);
      const best = c.discovery?.emails?.[0]?.email || c.contacts?.[0]?.email || null;
      const phone = c.discovery?.phones?.[0]?.phone || c.harvested_phones?.[0] || null;
      const company =
        c.domain?.domain ||
        (lead.author || lead.title.split(/[@—-]/)[0] || "").trim().slice(0, 80) ||
        null;
      try {
        const id = await ensureSaved();
        const bestRec =
          (best && c.discovery?.emails?.find((e) => e.email === best)) ||
          c.discovery?.emails?.[0] ||
          null;
        await saveContactFn({
          data: {
            id,
            contact_name: lead.author || undefined,
            contact_email: best || undefined,
            contact_phone: phone || undefined,
            contact_company: company || undefined,
            contact_meta: {
              registry_verified: c.registry_verified,
              verification: c.verification,
              domain: c.domain,
              role_title: bestRec?.role_title || bestRec?.name || undefined,
              provenance: bestRec?.provenance ?? [],
              discovery_emails: (c.discovery?.emails ?? []).slice(0, 5).map((e) => ({
                email: e.email,
                role_title: e.role_title,
                origin: e.origin,
                provenance: e.provenance,
                consent: e.consent,
              })),
              compliance_rows: c.compliance_rows ?? [],
              outreach_ready: bestRec?.consent?.outreach_ready === true,
            },
          },
        });
        onSavedChange?.({
          contact_name: lead.author || null,
          contact_email: best,
          contact_phone: phone,
          contact_company: company,
        });
        await qc.invalidateQueries({ queryKey: ["saved-leads"] });
        await qc.invalidateQueries({ queryKey: ["lead-activity", id] });
        toast.success(best ? `Contact saved · ${best}` : "Contact lookup finished");
      } catch (e: any) {
        toast.message("Contact found — save failed (apply CRM migration if columns missing)");
        console.warn("[crm] persist contact", e);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stageMut = useMutation({
    mutationFn: async (status: (typeof PIPELINE_STAGES)[number]) => {
      const id = await ensureSaved();
      await setStage({
        data: {
          id,
          status,
          lead_url: lead.full_post_url,
          lead_title: lead.title,
        },
      });
      return { id, status };
    },
    onSuccess: ({ id, status }) => {
      setStageLocal(status);
      onSavedChange?.({ status });
      qc.invalidateQueries({ queryKey: ["saved-leads"] });
      qc.invalidateQueries({ queryKey: ["lead-activity", id] });
      toast.success(`Stage: ${PIPELINE_STAGE_LABELS[status]}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      const id = await ensureSaved();
      const result = await sendEmail({ data: { savedLeadId: id } });
      try {
        await startSeq({ data: { savedLeadId: id, followUpDelayDays: 3 } });
      } catch {
        /* sequence optional */
      }
      return { id, result };
    },
    onSuccess: ({ id }) => {
      setStageLocal("contacted");
      onSavedChange?.({ status: "contacted" });
      qc.invalidateQueries({ queryKey: ["saved-leads"] });
      qc.invalidateQueries({ queryKey: ["lead-activity", id] });
      toast.success("Email sent (CASL footer + unsubscribe included)");
      setGateOk(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveNotes = async () => {
    if (!notes && !saved?.id) return;
    const id = await ensureSaved();
    await update({ data: { id, notes } });
    await logActivity({
      data: {
        saved_lead_id: id,
        lead_url: lead.full_post_url,
        kind: "note",
        detail: notes.trim() ? "Notes updated" : "Notes cleared",
      },
    });
    await qc.invalidateQueries({ queryKey: ["saved-leads"] });
    await qc.invalidateQueries({ queryKey: ["lead-activity", id] });
    toast.success("Notes saved");
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success("Copied");
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline">{lead.platform_label ?? lead.platform}</Badge>
          {lead.tier && <Badge className="uppercase text-[10px]">{lead.tier}</Badge>}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="p-4 overflow-y-auto flex-1 space-y-5">
        <div>
          <h2 className="text-lg font-semibold leading-snug">{lead.title}</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            {lead.author ?? "anon"} · {lead.engagement ?? 0} engagement
            {lead.posted_at && ` · ${new Date(lead.posted_at).toLocaleDateString()}`}
          </div>
          <a
            href={lead.full_post_url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open original <ExternalLink className="size-3" />
          </a>
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
          <div className="text-xs font-medium">Pipeline stage</div>
          <div className="flex flex-wrap gap-1.5">
            {PIPELINE_STAGES.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={stage === s ? "default" : "outline"}
                className="h-7 text-[11px]"
                disabled={stageMut.isPending}
                onClick={() => stageMut.mutate(s)}
              >
                {PIPELINE_STAGE_LABELS[s]}
              </Button>
            ))}
          </div>
          {(saved?.contact_email || saved?.contact_name) && (
            <p className="text-[11px] text-muted-foreground">
              Saved contact:{" "}
              <span className="text-foreground">
                {[saved.contact_name, saved.contact_email, saved.contact_phone]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
          )}
        </div>

        <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {lead.snippet}
        </p>

        {lead.match_reasons?.length || lead.why_match ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Target className="size-3.5" /> Why this matches
            </div>
            {lead.why_match && (
              <p className="text-sm text-foreground/90 leading-relaxed">{lead.why_match}</p>
            )}
            {lead.match_reasons && lead.match_reasons.length > 0 && (
              <ul className="space-y-1">
                {lead.match_reasons.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {/* Contacts the author published IN the post. Highest trust available —
            no inference, no third-party provider — and it needs no enrichment
            call, so it renders immediately instead of behind a button. */}
        {lead.inline_contacts &&
        (lead.inline_contacts.emails.length ||
          lead.inline_contacts.phones.length ||
          lead.inline_contacts.links.length) ? (
          <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
              <ShieldCheck className="size-3.5" /> Contact published in this post
            </div>
            <div className="space-y-1 text-sm">
              {lead.inline_contacts.emails.map((e) => (
                <div key={e} className="flex items-center gap-2">
                  <a href={`mailto:${e}`} className="break-all text-foreground hover:underline">
                    {e}
                  </a>
                  <button
                    onClick={() => copy(e)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Copy"
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
              ))}
              {lead.inline_contacts.phones.map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <a href={`tel:${p}`} className="text-foreground hover:underline">
                    {p}
                  </a>
                  <button
                    onClick={() => copy(p)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Copy"
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
              ))}
              {lead.inline_contacts.links.map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block break-all text-xs text-primary hover:underline"
                >
                  {u}
                </a>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Published by the author in the post itself — no enrichment needed.
            </p>
          </div>
        ) : null}

        <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck className="size-3.5 text-primary" /> Verify contact
            </div>
            <div className="flex flex-wrap gap-1.5 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => contactMut.mutate(false)}
                disabled={contactMut.isPending}
              >
                {contactMut.isPending ? "Verifying…" : contact ? "Refresh" : "Resolve contact"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => contactMut.mutate(true)}
                disabled={contactMut.isPending}
                title="Browser fetch via scrape/stealth worker. Needs STEALTH_WORKER_URL or SCRAPE_WORKER_URL."
              >
                <Radar className="size-3 mr-1" />
                Deep enrich
              </Button>
            </div>
          </div>
          {contact && (
            <div className="space-y-2 text-sm">
              {contact.registry_verified && (
                <Badge variant="secondary" className="text-[10px]">
                  Registry verified
                </Badge>
              )}
              {contact.verification && (
                <p className="text-xs text-muted-foreground">
                  {/* Prefer the verifier's own sentence — it says what was actually
                      checked, instead of implying a probe that may never have run. */}
                  {contact.verification.label ||
                    verificationLabel(contact.verification.tier, contact.verification.method) ||
                    contact.verification.tier}
                </p>
              )}
              {contact.catch_all === true && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  This domain accepts mail for addresses that don&apos;t exist, so no address here
                  can be confirmed by checking — treat every one as inferred.
                </p>
              )}
              {contact.domain && (
                <p className="text-xs text-muted-foreground">
                  Domain: <span className="text-foreground">{contact.domain.domain}</span>
                  {contact.domain.verified ? " (homepage verified)" : ` (${contact.domain.via})`}
                </p>
              )}

              {/* Per-address evidence: where it was published, whether it verifies,
                  and whether it carries a lawful basis for outreach. This bundle is
                  the thing customers can't produce for themselves. */}
              {contact.discovery?.emails.slice(0, 4).map((rec) => (
                <div
                  key={rec.email}
                  className="rounded-md border border-border/60 bg-background/40 p-2 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground/90 break-all">{rec.email}</span>
                    <Badge
                      variant={rec.origin === "derived" ? "outline" : "secondary"}
                      className="text-[10px] shrink-0"
                    >
                      {rec.origin === "derived" ? "Inferred" : "Published"}
                    </Badge>
                  </div>
                  {rec.name && (
                    <div className="text-foreground/80">
                      {rec.name}
                      {rec.role_title ? ` · ${rec.role_title}` : ""}
                    </div>
                  )}
                  <div className="text-muted-foreground">{rec.verification.label}</div>
                  {rec.provenance[0]?.source_url && (
                    <div className="text-muted-foreground break-all">
                      Source:{" "}
                      {rec.provenance[0].source_url.startsWith("http") ? (
                        <a
                          href={rec.provenance[0].source_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline hover:text-foreground"
                        >
                          {rec.provenance[0].source_url}
                        </a>
                      ) : (
                        rec.provenance[0].source_url
                      )}
                      {rec.provenance[0].captured_at
                        ? ` · seen ${rec.provenance[0].captured_at.slice(0, 10)}`
                        : ""}
                    </div>
                  )}
                  <div
                    className={
                      rec.consent.outreach_ready
                        ? "text-emerald-600 dark:text-emerald-500"
                        : "text-muted-foreground"
                    }
                  >
                    {rec.consent.outreach_ready
                      ? "CASL: implied consent documented (conspicuous publication)"
                      : `CASL: no documented basis — ${rec.consent.reasons[0] ?? ""}`}
                  </div>
                </div>
              ))}

              {contact.discovery?.phones.slice(0, 3).map((rec) => (
                <div key={rec.e164 ?? rec.phone} className="text-xs text-muted-foreground">
                  <span className="text-foreground/90">{rec.e164 ?? rec.phone}</span> —{" "}
                  {rec.verification.label}
                  {rec.attribution ? ` · ${rec.attribution}` : ""}
                </div>
              ))}

              {!contact.discovery?.emails.length &&
                contact.contacts.slice(0, 3).map((c, i) => (
                  <div key={i} className="text-xs text-muted-foreground space-y-0.5">
                    {c.name && <div className="text-foreground/90">{c.name}</div>}
                    {c.email && <div>{c.email}</div>}
                    <div>
                      Confidence {Math.round(c.confidence * 100)}% ·{" "}
                      {c.corroborating_sources.length} source(s)
                    </div>
                  </div>
                ))}

              {contact.discovery_notes.length > 0 && (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    How we found this
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                    {contact.discovery_notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
              {!contact.contacts.length && !contact.domain && (
                <p className="text-xs text-muted-foreground">
                  No contact found yet — try Deep enrich if workers are running.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Brain className="size-3.5 text-primary" /> AI research brief
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => briefMut.mutate()}
                disabled={briefMut.isPending}
              >
                {briefMut.isPending ? "Researching…" : brief ? "Refresh" : "Run research"}
              </Button>
            </div>
          </div>
          {brief && (
            <div className="space-y-2 text-sm">
              {(brief.company || brief.domain) && (
                <p className="text-[11px] text-muted-foreground">
                  {brief.company}
                  {brief.domain ? ` · ${brief.domain}` : ""}
                </p>
              )}
              {brief.overview && <p className="text-foreground/90">{brief.overview}</p>}
              {brief.pain_points?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Pain points</div>
                  <ul className="space-y-0.5">
                    {brief.pain_points.map((p, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                        <span className="text-primary mt-0.5">•</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {brief.status_quo && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Status quo</div>
                  <p className="text-xs text-foreground/80">{brief.status_quo}</p>
                </div>
              )}
              {brief.why_now && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Why now</div>
                  <p className="text-xs text-foreground/80">{brief.why_now}</p>
                </div>
              )}
              {brief.urgency && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Urgency</div>
                  <p className="text-xs text-foreground/80">{brief.urgency}</p>
                </div>
              )}
              {brief.recommended_angle && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Recommended angle</div>
                  <p className="text-xs text-foreground/80">{brief.recommended_angle}</p>
                </div>
              )}
              {brief.verified_hooks?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Verified hooks
                  </div>
                  <ul className="space-y-1.5">
                    {brief.verified_hooks.map((h, i) => (
                      <li
                        key={i}
                        className="text-xs rounded-md border border-border/80 bg-background/50 p-2 space-y-0.5"
                      >
                        <div className="text-foreground/90">{h.claim}</div>
                        <a
                          href={h.citation_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {h.source_type} <ExternalLink className="size-2.5" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Activity</label>
          {!saved?.id ? (
            <p className="text-[11px] text-muted-foreground">
              Save this lead to start an activity log.
            </p>
          ) : activityQ.isLoading ? (
            <p className="text-[11px] text-muted-foreground">Loading…</p>
          ) : !activityQ.data?.length ? (
            <p className="text-[11px] text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="space-y-1.5 max-h-36 overflow-y-auto">
              {activityQ.data.map((a: any) => (
                <li key={a.id} className="text-[11px] text-muted-foreground flex gap-2">
                  <span className="shrink-0 tabular-nums opacity-70">
                    {a.created_at ? new Date(a.created_at).toLocaleString() : ""}
                  </span>
                  <span className="text-foreground/90">{a.detail || a.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Private notes for this lead…"
            className="min-h-20"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-muted-foreground">AI outreach</label>
            <Button
              size="sm"
              onClick={() => genMut.mutate()}
              disabled={genMut.isPending || briefMut.isPending}
            >
              <Sparkles className="size-3.5 mr-1.5" />
              {genMut.isPending
                ? "Researching & drafting…"
                : outreach
                  ? "Regenerate"
                  : "Research & draft"}
            </Button>
          </div>
          {usedHook && (
            <p className="text-[11px] text-muted-foreground">
              Opens with: <span className="text-foreground/80">{usedHook}</span>
            </p>
          )}
          {outreach && (
            <Tabs defaultValue="dm" className="w-full">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="dm">DM</TabsTrigger>
                <TabsTrigger value="email">Email</TabsTrigger>
                <TabsTrigger value="call">Call</TabsTrigger>
              </TabsList>
              <TabsContent value="dm">
                <OutreachBlock text={outreach.dm} onCopy={() => copy(outreach.dm)} />
              </TabsContent>
              <TabsContent value="email">
                <div className="text-xs text-muted-foreground mb-1">Subject</div>
                <div className="p-2 rounded-md border border-border bg-muted/30 text-sm mb-2">
                  {outreach.email_subject}
                </div>
                <OutreachBlock
                  text={outreach.email_body}
                  onCopy={() => copy(`${outreach.email_subject}\n\n${outreach.email_body}`)}
                />
                <div className="mt-3 space-y-2">
                  <Button
                    size="sm"
                    disabled={
                      sendMut.isPending ||
                      !saved?.contact_email ||
                      gateOk === false ||
                      !outreach.email_body
                    }
                    onClick={() => sendMut.mutate()}
                    title={
                      gateOk === false
                        ? gateReasons.join(" · ")
                        : !saved?.contact_email
                          ? "Resolve & save a contact email first"
                          : "Send via Resend with CASL footer"
                    }
                  >
                    <Mail className="size-3.5 mr-1.5" />
                    {sendMut.isPending ? "Sending…" : "Send email"}
                  </Button>
                  {gateOk === false && gateReasons.length > 0 && (
                    <ul className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
                      {gateReasons.slice(0, 5).map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  )}
                  {gateOk === true && (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-500">
                      CASL gate ready — send will re-verify immediately before Resend.
                    </p>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="call">
                <OutreachBlock text={outreach.call} onCopy={() => copy(outreach.call)} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

function OutreachBlock({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <div className="relative">
      <pre className="whitespace-pre-wrap text-sm p-3 rounded-md border border-border bg-muted/30 font-sans">
        {text}
      </pre>
      <Button size="sm" variant="ghost" className="absolute top-2 right-2" onClick={onCopy}>
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}
