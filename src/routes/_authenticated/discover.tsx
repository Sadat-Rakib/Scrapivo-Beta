import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { buildProjectQuery } from "@/lib/project-query";
import { displaySearchLabel, scrapyAckReply, toPlainSearchQuery } from "@/lib/display-query";
import { getRemainingSearches } from "@/lib/search.functions";
import { runSpecSearch, getSearchBrowserProgress } from "@/lib/spec-search.functions";
import { aiChat } from "@/lib/ai-chat.functions";
import { saveLead, listSavedLeads } from "@/lib/leads.functions";
import { saveTranscript, getTranscript } from "@/lib/transcript.functions";
import { getIntentStrategy, discoverCandidateIntent } from "@/lib/intent/intent.functions";
import type { IntentStrategy } from "@/lib/intent/strategy";
import type { EvidenceObject } from "@/lib/intent/evidence";
import type { IntentCandidate } from "@/lib/intent/discover.server";
import { rankEvidence } from "@/lib/intent/rank";
import { createSignalWatch } from "@/lib/campaigns.functions";
import { resolveLeadContact, verificationLabel } from "@/lib/contact.functions";
import {
  listProjects,
  createProject,
  setActiveProject,
  type Project,
} from "@/lib/projects.functions";
import { getMyProfile, updateMyProfile } from "@/lib/profile.functions";
import { OnboardingWizard, type OnboardingAnswers } from "@/components/discover/onboarding-wizard";
import { GuidedTour } from "@/components/discover/guided-tour";
import type { Lead } from "@/lib/scoring";
import type { CompanyRow, PersonRow, LocalBusinessRow } from "@/lib/search/lead-segments";
import { filterBarModel, relevanceChips, type TurnFilter } from "@/lib/search/relevance";
import { specRowsToCandidates } from "@/lib/intent/spec-candidates";
import { LeadDetailPanel } from "@/components/lead-detail-panel";
import { DiscoverWelcomeHero, GUIDED_SEARCH_TEXT } from "@/components/discover/discover-welcome-hero";
import { ActiveSearchSession, isSearchAbortError } from "@/lib/search/search-run-client";
import { cancelSearchRun } from "@/lib/search/search-run.functions";
import {
  projectSpecRowsToQualifiedViews,
  viewToLegacyLead,
  viewToLocalBusinessRow,
} from "@/lib/search/qualified-lead-view";
import { enrichZeroNarrative, outcomeUi, shouldSurfaceOutcome, zeroResultsNarrative } from "@/lib/search/outcome-ui";

import {
  UnifiedComposer,
  type ComposerHandle,
  type ComposerMode,
  type SearchTier,
} from "@/components/discover/unified-composer";
import { Route as AuthRoute } from "@/routes/_authenticated/route";
import {
  PostsGrid,
  PostsList,
  CompanyCard,
  PersonCard,
  CompanyTable,
  PersonTable,
  ViewToggle,
  LocalBusinessesGrid,
  BusinessTable,
  type ResolvedContactInfo,
  type IntentBadgeInput,
} from "@/components/discover/result-tabs";
import { EntityDetailPanel, type SelectedEntity } from "@/components/discover/entity-detail-panel";
import { ProjectChipsRow } from "@/components/discover/project-chips-row";
import { GenerateModal } from "@/components/discover/generate-modal";
import { Bell, Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { ThinkingSteps } from "@/components/discover/thinking-steps";
import { ScrapyBrowser } from "@/components/discover/scrapy-browser";
import { StreamedReconciliationNote } from "@/components/discover/streamed-reconciliation-note";
import { streamedFateLabel } from "@/lib/search/candidate-ledger";
import { ClarifyPanel } from "@/components/discover/clarify-panel";
import { UnderstandingInspector } from "@/components/discover/understanding-inspector";
import type { ClarifyQuestion, ClarifyAnswers } from "@/lib/search/clarifier";
import { resolveSearchVertical } from "@/lib/search/vertical";
import { friendlyErrorText } from "@/lib/friendly-error";
import { type ChatTurn } from "@/components/discover/scrapy-chat-panel";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { mySupabase } from "@/integrations/my-supabase/client";

export const Route = createFileRoute("/_authenticated/discover")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; fresh?: number; conversation?: string; inspect?: number } => ({
    q: typeof search.q === "string" ? search.q : undefined,
    // URL params arrive as strings (?fresh=1); accept numeric strings too.
    fresh:
      typeof search.fresh === "number"
        ? search.fresh
        : typeof search.fresh === "string" && /^\d+$/.test(search.fresh)
          ? Number(search.fresh)
          : undefined,
    conversation: typeof search.conversation === "string" ? search.conversation : undefined,
    // ?inspect=1 replaces the page with the Gate 1 Understanding Inspector.
    inspect:
      typeof search.inspect === "number"
        ? search.inspect
        : typeof search.inspect === "string" && /^\d+$/.test(search.inspect)
          ? Number(search.inspect)
          : undefined,
  }),
  head: () => ({
    meta: [{ title: "Scrapivo — Discover" }],
  }),
  component: DiscoverRoute,
});

/**
 * ?inspect=1 short-circuits the whole page. The inspector must not be a panel
 * inside Discover: mounted there it would sit beside search state, effects and
 * queries, and Gate 1's guarantee is that understanding runs with none of that
 * attached.
 */
function DiscoverRoute() {
  const { inspect, q } = Route.useSearch();
  if (inspect) return <UnderstandingInspector initialQuery={q ?? ""} />;
  return <DiscoverPage />;
}

function DiscoverPage() {
  const { userId } = AuthRoute.useRouteContext();
  const routeSearch = Route.useSearch();
  const qc = useQueryClient();
  const chat = useServerFn(aiChat);
  const save = useServerFn(saveLead);
  const getSaved = useServerFn(listSavedLeads);
  const createWatch = useServerFn(createSignalWatch);
  const resolveContact = useServerFn(resolveLeadContact);

  const getProjects = useServerFn(listProjects);
  const createProj = useServerFn(createProject);
  const setActiveProj = useServerFn(setActiveProject);
  const getProfile = useServerFn(getMyProfile);
  const patchProfile = useServerFn(updateMyProfile);
  const getUsage = useServerFn(getRemainingSearches);
  const runSpec = useServerFn(runSpecSearch);
  const cancelRun = useServerFn(cancelSearchRun);
  const getBrowserProgress = useServerFn(getSearchBrowserProgress);
  const getStrategy = useServerFn(getIntentStrategy);
  const discoverIntent = useServerFn(discoverCandidateIntent);
  // Step 4: verified intent per row-key + run progress. Entries are scoped
  // by offer: a new search with a different offer hides old badges instead
  // of showing stale evidence. Rows without evidence have no entry (hidden).
  type IntentEntry = { offer: string; evidence: EvidenceObject[] };
  const [intentByKey, setIntentByKey] = useState<Record<string, IntentEntry>>({});
  const [intentProgress, setIntentProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const intentRunRef = useRef(0);
  const intentAbortRef = useRef<AbortController | null>(null);
  const activeOfferRef = useRef("");
  // Badge/evidence lookups honor the active offer (T4 stale-state fix).
  const intentBadgeFor = (key: string) => {
    const e = intentByKey[key];
    return e && e.offer === activeOfferRef.current ? (e.evidence[0] ?? null) : null;
  };
  const intentEvidenceFor = (key: string | null): EvidenceObject[] => {
    if (!key) return [];
    const e = intentByKey[key];
    return e && e.offer === activeOfferRef.current ? e.evidence : [];
  };
  // Grid input derived with the same offer gate (single progress line and
  // badges stay consistent between cards, grids, and drawers).
  const badgeMapForGrid = (): Record<string, IntentBadgeInput> => {
    const out: Record<string, IntentBadgeInput> = {};
    for (const [k, e] of Object.entries(intentByKey)) {
      if (e.offer === activeOfferRef.current && e.evidence[0]) out[k] = e.evidence[0];
    }
    return out;
  };
  // Build stamp (freshness proof): console only. The footer tag was removed
  // per UX review; the stamp still logs once for debugging which code serves.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savedQuery = useQuery({ queryKey: ["saved-leads"], queryFn: () => getSaved() });
  const savedLeads = savedQuery.data ?? [];
  type SavedLeadRow = NonNullable<(typeof savedLeads)[number]>;
  const savedByUrl = new Map<string, SavedLeadRow>(
    savedLeads.map((l): [string, SavedLeadRow] => [l.full_post_url, l]),
  );

  const profileQuery = useQuery({ queryKey: ["my-profile"], queryFn: () => getProfile() });
  const usageQuery = useQuery({ queryKey: ["usage"], queryFn: () => getUsage() });

  // ── Projects ("the 75% info") ────────────────────────────────────────────
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => getProjects() });
  const skipKey = `scrapivo:onboarding-skipped:${userId}`;
  const returnChatKey = `scrapivo:return-chat-asked:${userId}`;
  const tourKey = `scrapivo:guided-tour-seen:${userId}`;
  const [localProject, setLocalProject] = useState<Project | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return JSON.parse(localStorage.getItem("scrapivo:local-project") || "null");
    } catch {
      return null;
    }
  });
  const [onboardingSkipped, setOnboardingSkipped] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      localStorage.getItem(skipKey) === "1" ||
      // Migrate legacy browser-wide skip once per user.
      localStorage.getItem("scrapivo:onboarding-skipped") === "1"
    );
  });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [tourSeen, setTourSeen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(tourKey) === "1";
    } catch {
      return true;
    }
  });
  const serverProjects = projectsQuery.data?.projects ?? [];
  const projects: Project[] = serverProjects.length
    ? serverProjects
    : localProject
      ? [localProject]
      : [];
  const activeProject = projects.find((p) => p.is_active) ?? projects[0] ?? null;
  const showOnboarding =
    wizardOpen || (projectsQuery.isSuccess && projects.length === 0 && !onboardingSkipped);
  const greetingName = (() => {
    const fromProfile = profileQuery.data?.full_name?.trim() || "";
    const fromProject = activeProject?.business_name?.trim() || "";
    // Prefer the longest real personal name — never truncate multi-part names
    // like "Mir Sadat Bin Rakib" down to the last two tokens.
    if (fromProfile) return fromProfile;
    return fromProject;
  })();
  // Zero-typing: fire ONE automatic search as soon as onboarding produced an
  // active project (server or local). Never re-fires for the same project.
  const [pendingAutoSearch, setPendingAutoSearch] = useState(false);
  const [autoRanForProject, setAutoRanForProject] = useState<string | null>(null);

  const searchContext = activeProject
    ? {
        audience: activeProject.audience,
        goal: activeProject.goal,
        niche: activeProject.niche ?? undefined,
        service: activeProject.service ?? undefined,
        location: activeProject.location ?? undefined,
        business: activeProject.business_name ?? undefined,
        experience_level: activeProject.experience_level ?? undefined,
        work_style: activeProject.work_style ?? undefined,
        website: activeProject.website ?? undefined,
        about_doc: activeProject.about_doc ?? undefined,
      }
    : undefined;

  const markReturnChatAsked = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(returnChatKey, "1");
    }
  };

  const completeOnboarding = async (a: OnboardingAnswers) => {
    // The projects table caps names at 80 chars; a long business name used to
    // blow past it and surface raw Zod JSON in a toast. Clamp + de-dash here.
    const suffix = a.goal === "jobs" ? "jobs" : a.goal === "clients" ? "clients" : "leads";
    const baseName = (a.business_name || "My project")
      .replace(/[—–]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    const projectName =
      `${baseName} ${suffix}`.length <= 80
        ? `${baseName} ${suffix}`
        : `${baseName.slice(0, 80 - suffix.length - 1).trim()} ${suffix}`;
    const payload = {
      name: projectName,
      kind: a.kind,
      business_name: a.business_name,
      website: a.website,
      about_doc: a.about_doc,
      niche: a.niche,
      service: a.service,
      location: a.location,
      audience: a.audience,
      goal: a.goal,
      experience_level: a.experience_level,
      work_style: a.work_style,
    };
    try {
      if (a.business_name?.trim() || a.service?.trim() || a.location?.trim()) {
        const yoe = a.experience_level === "5+" ? 6 : a.experience_level === "2-4" ? 3 : 1;
        void getProfile()
          .then((existing) => {
            const existingName = existing?.full_name?.trim() || "";
            const wizardName = a.business_name?.trim() || "";
            // Don't overwrite a longer saved full name with a shorter wizard answer.
            const nextName =
              wizardName && wizardName.length >= existingName.length
                ? wizardName
                : existingName || wizardName || undefined;
            return patchProfile({
              data: {
                full_name: nextName,
                job_title: a.service?.trim() || undefined,
                years_experience: yoe,
                location: a.location?.trim() || undefined,
                work_preference: a.work_style || undefined,
                skills: a.service?.trim() ? [a.service.trim()] : undefined,
              },
            });
          })
          .then(() => qc.invalidateQueries({ queryKey: ["my-profile"] }))
          .catch(() => {});
      }
      const r = await createProj({ data: payload });
      if (r.needs_migration || !r.project) {
        const local = {
          ...payload,
          id: "local",
          website: payload.website ?? null,
          about_doc: payload.about_doc ?? null,
          business_name: payload.business_name ?? null,
          niche: payload.niche ?? null,
          service: payload.service ?? null,
          location: payload.location ?? null,
          is_active: true,
          created_at: new Date().toISOString(),
        } as Project;
        localStorage.setItem("scrapivo:local-project", JSON.stringify(local));
        setLocalProject(local);
        toast.info("Saved on this device. Apply the projects migration to sync across devices.");
      } else {
        qc.invalidateQueries({ queryKey: ["projects"] });
        toast.success("Project saved. Searches now start from this context");
      }
      markReturnChatAsked();
    } catch (e: unknown) {
      toast.error(friendlyErrorText(e, "Could not save project"));
    } finally {
      setWizardOpen(false);
      setPendingAutoSearch(true);
    }
  };

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ComposerMode>("search");
  const [tier, setTier] = useState<SearchTier>("scrapy");
  const [thinker, setThinker] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [localRows, setLocalRows] = useState<LocalBusinessRow[]>([]);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [activeVertical, setActiveVertical] = useState<
    "investors" | "local" | "jobs" | "general" | undefined
  >(undefined);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Honest terminal-zero copy from the retrieval funnel (never invented fiction).
  const [zeroNarrative, setZeroNarrative] = useState<string | null>(null);
  // Streamed-vs-final reconciliation: leads shown live while researching that
  // the final list does not include, each with the reason (never a silent drop).
  const [streamedMissing, setStreamedMissing] = useState<Array<{ key: string; title: string; label: string }>>([]);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [queryType, setQueryType] = useState<string | null>(null);
  // Clarifying-question flow. Questions are computed BEFORE the search runs and
  // hold it until answered or skipped — see beginSearch. (They used to arrive
  // alongside results, which meant the first search was always the unrefined
  // one; the comment outlived the behaviour.)
  const [clarifyQs, setClarifyQs] = useState<ClarifyQuestion[]>([]);
  // Stage-1 CONFIRM: provenance-tagged understanding summary from derived
  // (website/document/image) facts. Null = no confirm gate this round.
  const [confirmSummary, setConfirmSummary] = useState<string | null>(null);
  // Phase B dropdown: questions collapse above the input; reopened
  // automatically for each new question round.
  const [questionsOpen, setQuestionsOpen] = useState(true);
  useEffect(() => {
    if (clarifyQs.length > 0) setQuestionsOpen(true);
  }, [clarifyQs]);
  const [refinement, setRefinement] = useState<string>("");
  const [clarifyAnswers, setClarifyAnswers] = useState<ClarifyAnswers | null>(null);
  // Query waiting on clarification. The search does NOT run until the user
  // answers or skips — asking after results means the first search is the
  // wrong one and they watch it happen.
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [defaultSummary, setDefaultSummary] = useState<string>("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [chatLog, setChatLog] = useState<ChatTurn[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const returnChatOpenedRef = useRef(false);
  // Conversation scroll container — new turns (echoed input, plan, questions)
  // scroll into view the frame they mount.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contactBusyKey, setContactBusyKey] = useState<string | null>(null);
  const [contactByKey, setContactByKey] = useState<Record<string, ResolvedContactInfo>>({});
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  type GenTarget = {
    kind: "email" | "message";
    vertical: "investor" | "company" | "local" | "job";
    name: string;
    firm?: string;
    role?: string;
    location?: string;
    email?: string;
    /** Matched-slot sentence — the personalization hook for the draft. */
    whyMatch?: string;
    /** Company/hiring: why-now signal + platform. */
    whyNow?: string;
    platform?: string;
    /** Local: category/address/opportunity for the pitch draft. */
    category?: string;
    address?: string;
    noWebsite?: boolean;
    seoPoor?: boolean;
    /** The raise facts the user stated — tailor investor drafts to them. */
    investorStage?: string;
    investorSector?: string;
  };
  const [genTarget, setGenTarget] = useState<GenTarget | null>(null);
  const openGenerateForEntity = (kind: "email" | "message") => {
    if (!selectedEntity) return;
    if (selectedEntity.type === "person") {
      const p = selectedEntity.person;
      setGenTarget({
        kind,
        vertical: "investor",
        name: p.name,
        firm: p.company_hint,
        role: p.title_hint ?? p.role_hint ?? undefined,
        location: p.location_hint ?? undefined,
        email: p.inline_contacts?.emails?.[0],
        whyMatch: p.why_match ?? undefined,
        investorStage: raiseStage,
        investorSector: raiseSector,
      });
    } else if (selectedEntity.type === "local") {
      const b = selectedEntity.local;
      setGenTarget({
        kind,
        vertical: "local",
        name: b.name,
        category: b.category,
        address: b.address,
        location: b.address?.split(",").slice(-2, -1)[0]?.trim(),
        email: b.email,
        noWebsite: !!b.opportunity_tags?.some(
          (t) => t === "no_website" || t === "verified_no_website",
        ),
        seoPoor: !!b.opportunity_tags?.includes("seo_poor"),
      });
    } else {
      const c = selectedEntity.company;
      setGenTarget({
        kind,
        vertical: "company",
        name: c.name,
        firm: c.name,
        whyNow: c.why_now,
        platform: c.platforms?.[0],
        email: contactByKey[`co:${c.key}`]?.email,
      });
    }
  };
  const openGenerateForLocal = (row: LocalBusinessRow, kind: "email" | "message") => {
    setGenTarget({
      kind,
      vertical: "local",
      name: row.name,
      category: row.category,
      address: row.address,
      location: row.address?.split(",").slice(-2, -1)[0]?.trim(),
      email: row.email,
      noWebsite: !!row.opportunity_tags?.some(
        (t) => t === "no_website" || t === "verified_no_website",
      ),
      seoPoor: !!row.opportunity_tags?.includes("seo_poor"),
    });
  };
  const openGenerateForCompany = (row: CompanyRow, kind: "email" | "message") => {
    setGenTarget({
      kind,
      vertical: "company",
      name: row.name,
      firm: row.name,
      whyNow: row.why_now,
      platform: row.platforms?.[0],
      email: contactByKey[`co:${row.key}`]?.email,
    });
  };
  // Grid-view person cards share the table's outreach target (single owner).
  const openGenerateForPerson = (row: PersonRow, kind: "email" | "message") =>
    setGenTarget({
      kind,
      vertical: "investor",
      name: row.name,
      firm: row.company_hint,
      role: row.title_hint ?? row.role_hint ?? undefined,
      location: row.location_hint ?? undefined,
      email: row.inline_contacts?.emails?.[0],
      whyMatch: row.why_match ?? undefined,
      investorStage: raiseStage,
      investorSector: raiseSector,
    });
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  // ChatGPT-style conversation: every submitted query persists as a user
  // bubble WITH its results frozen into the turn, so previous inputs keep
  // their outputs while new searches append below.
  type TurnResults = {
    leads: Lead[];
    companies: CompanyRow[];
    people: PersonRow[];
    local: LocalBusinessRow[];
  };
  type ConversationTurn = {
    id: string;
    text: string;
    results?: TurnResults;
    counts?: { posts: number; companies: number; people: number; local: number };
    // Phase A3: stated selling context frozen with the turn so relevance
    // chips + filter state survive refresh/history. Optional: old turns omit.
    filter?: TurnFilter;
  };
  // Step 3: transcripts persist whole turns (results included) — nothing is
  // ever collapsed into counts. Older turns render folded (header only, one
  // click to expand) so DOM stays cheap; the data stays in memory + server.
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  // Per-turn fold state. Default: only the latest turn is open.
  const [expandedTurns, setExpandedTurns] = useState<Record<string, boolean>>({});
  // Conversation identity: per-user namespaced (`userId:uuid`) so two users
  // can never collide on the globally-unique server column. Minted lazily
  // inside effects/handlers only (never during render), persisted to
  // localStorage, replaced only by New chat / Clear.
  const conversationIdRef = useRef<string | null>(null);
  const getConversationId = () => {
    if (!conversationIdRef.current) {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(`scrapivo:conversation-id:${userId}`);
      } catch {
        // Private mode: memory-only identity, server save still attempted.
      }
      conversationIdRef.current =
        stored ||
        `${userId}:${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      try {
        window.localStorage.setItem(
          `scrapivo:conversation-id:${userId}`,
          conversationIdRef.current,
        );
      } catch {
        // ignore
      }
    }
    return conversationIdRef.current;
  };
  const rotateConversationId = () => {
    const next = `${userId}:${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    conversationIdRef.current = next;
    try {
      window.localStorage.setItem(`scrapivo:conversation-id:${userId}`, next);
    } catch {
      // ignore
    }
    // M11: new chat aborts in-flight work and rotates conversation identity.
    searchSessionRef.current?.rotateConversation(next);
    searchSessionRef.current = new ActiveSearchSession(next);
  };
  // Owning turn for the in-flight hunt (ref: onSuccess closures go stale).
  const pendingTurnIdRef = useRef<string | null>(null);
  // Accumulated panel answers for the active turn: partial answers persist
  // across clarify rounds so answering Q1 then Search on Q2 never loses Q1.
  const pendingTurnAnswersRef = useRef<Record<string, string>>({});
  const pendingFrameRef = useRef<import("@/lib/understanding/frame").UnderstandingFrame | null>(null);
  // Stage 1 structured attachments: the composer stages uploaded+registered
  // ids here; beginSearch hands them to the turn, and they ride every round
  // of that turn so clarification rounds keep their input context.
  const pendingAttachmentsRef = useRef<Array<{ attachmentId: string }>>([]);
  const turnAttachmentsRef = useRef<Array<{ attachmentId: string }>>([]);
  // Thin-ask (refinement offer on a completed zero run) is offered at most once
  // per turn — re-offering it on every identical zero is the C3 dead loop.
  const thinAskedTurnsRef = useRef<Set<string>>(new Set());
  // Spec loading state: runSpec is a plain server-fn await (not a mutation),
  // so false never fires on this path. Without this the UI
  // looks dead during the S3 scan then pops results "out of blue".
  const [specPending, setSpecPending] = useState(false);
  // Current-run in-flight flag: set SYNCHRONOUSLY at submit (and when a
  // chat-initiated search is merely scheduled) so no async gap — 200 ms
  // deferred beginSearch included — can render the zero banner or fire a
  // zero toast while the current run is still understanding/searching.
  const [runInFlight, setRunInFlight] = useState(false);
  const [browserProgressRun, setBrowserProgressRun] = useState<string | null>(null);
  type StreamedLead = import("@/lib/search/search-browser-progress.server").StreamedLead;
  const [browserProgressEvents, setBrowserProgressEvents] = useState<Array<{ id: number; action: string; source?: string; detail?: string; count?: number | string; row?: StreamedLead }>>([]);
  // M11: only the active search_run_id may mutate results/loading/outcome UI.
  const searchSessionRef = useRef<ActiveSearchSession | null>(null);
  useEffect(() => {
    if (!browserProgressRun) return;
    let active = true;
    let cursor = 0;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await getBrowserProgress({ data: { search_run_id: browserProgressRun, after: cursor } });
        if (!active || !searchSessionRef.current?.accept({ search_run_id: browserProgressRun }).ok) return;
        if (result.events.length) {
          cursor = result.events[result.events.length - 1].id;
          setBrowserProgressEvents((events) => [...events, ...result.events].slice(-12));
        }
        if (!result.done) timer = window.setTimeout(poll, 450);
      } catch {
        if (active) timer = window.setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [browserProgressRun, getBrowserProgress]);
  const getSearchSession = () => {
    if (!searchSessionRef.current) {
      searchSessionRef.current = new ActiveSearchSession(getConversationId());
    }
    return searchSessionRef.current;
  };
  useEffect(() => {
    return () => {
      searchSessionRef.current?.dispose();
      searchSessionRef.current = null;
      intentAbortRef.current?.abort();
      intentRunRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 1.8 pagination: page size only (never a result ceiling) + per-turn
  // next-offset cursor + hasMore for the active turn's Show more button.
  const SPEC_PAGE_SIZE = 50;
  const specOffsetRef = useRef<Record<string, number>>({});
  const [specHasMore, setSpecHasMore] = useState(false);
  // Phase A3: active turn's stated selling context (drives filter bar +
  // relevance chips). Mirrored onto the frozen turn for persistence.
  const [specFilter, setSpecFilter] = useState<TurnFilter | null>(null);
  const filterFromAnswers = (m: Record<string, string>): TurnFilter | null => {
    const f: TurnFilter = {};
    if (typeof m.mode === "string" && m.mode.trim()) f.mode = m.mode.trim();
    if (typeof m.offer === "string" && m.offer.trim()) f.offer = m.offer.trim();
    if (typeof m.opportunity === "string" && m.opportunity.trim())
      f.opportunity = m.opportunity.trim();
    if (typeof m.site === "string" && m.site.trim()) f.site = m.site.trim();
    if (typeof m.channel === "string" && m.channel.trim()) f.channel = m.channel.trim();
    return f.mode ? f : null;
  };
  // One-tap site-filter toggle: flips opportunity and re-runs this turn
  // (force keeps stated answers; offset resets to the first page).
  const toggleSiteFilter = () => {
    const tid = pendingTurnIdRef.current;
    if (!tid || !activeQuery) return;
    const m = { ...pendingTurnAnswersRef.current };
    if (m.opportunity === "no_website") delete m.opportunity;
    else {
      m.opportunity = "no_website";
      delete m.site;
    }
    pendingTurnAnswersRef.current = m;
    void runSpecBranch(activeQuery, tid, {}, true, 0).catch((e: Error) =>
      toast.error(friendlyErrorText(e, "Could not reload")),
    );
  };
  const runSpecBranch = async (
    query: string,
    turnId: string,
    answers: Record<string, string>,
    force = false,
    offset = 0,
  ): Promise<void> => {
    if (pendingTurnIdRef.current !== turnId) return;
    // Merge with answers given in earlier rounds of this turn.
    const merged = { ...pendingTurnAnswersRef.current, ...answers };
    pendingTurnAnswersRef.current = merged;
    // M11: abort prior run + mint identity before any UI mutation.
    const session = getSearchSession();
    setRunInFlight(true);
    const { run, signal } = session.begin({
      conversation_id: getConversationId(),
      turn_id: turnId,
    });
    // Request disconnects are not propagated by every hosting adapter.
    // Notify the authenticated server registry as well as aborting fetch.
    const cancelOnServer = () => {
      void cancelRun({ data: { search_run_id: run.search_run_id } }).catch(() => {});
    };
    signal.addEventListener("abort", cancelOnServer, { once: true });
    intentAbortRef.current?.abort();
    intentRunRef.current += 1;
    setIntentProgress(null);
    setBrowserProgressRun(run.search_run_id);
    setBrowserProgressEvents([]);
    setZeroNarrative(null);
    setConfirmSummary(null);
    setStreamedMissing([]);
    setActivityExpanded(false);
    // Loading spinner only for the active run (stale cannot flip chrome).
    session.applyIfActive({ search_run_id: run.search_run_id }, () => {
      setSpecPending(true);
      setActiveQuery(query);
    });
    try {
      // Phase 1.8: limit is PAGE SIZE (default 50), never a result ceiling.
      // offset>0 appends the next verified page to this turn's results.
      const res = await runSpec({
        data: {
          query,
          limit: SPEC_PAGE_SIZE,
          offset,
          answers: merged,
          prior_frame: pendingFrameRef.current ?? undefined,
          attachments: turnAttachmentsRef.current,
          force,
          search_run_id: run.search_run_id,
          conversation_id: run.conversation_id,
          turn_id: run.turn_id,
          request_id: run.request_id,
        },
        signal,
      });
      // Discard late responses — zero state mutation (results/loading/empty/error).
      if (!session.accept(res).ok || pendingTurnIdRef.current !== turnId) return;

      setSpecEntity(res.spec.entity ?? null);
      // Two clarify shapes leave the server, and they must not behave the same:
      // a BLOCKING clarify carries no outcome AND spec.status
      // "needs_clarification" — no search ran, so no zero state may render.
      // Thin-ask rides on a COMPLETED zero-result run; offering it twice
      // is the dead loop (E2E-C3), so it is offered exactly once per turn and
      // never after Skip / Search-with-defaults — the zero then settles as an
      // honest empty state.
      const blockingClarify =
        !res.outcome || res.spec.status === "needs_clarification" || res.stage === "confirm";
      const thinAsk =
        res.clarify.length > 0 &&
        !!res.outcome &&
        !blockingClarify &&
        !force &&
        !thinAskedTurnsRef.current.has(turnId);
      if ((res.clarify.length > 0 || res.stage === "confirm") && (thinAsk || blockingClarify)) {
        if (thinAsk) thinAskedTurnsRef.current.add(turnId);
        pendingFrameRef.current = res.spec.understanding ?? null;
        setClarifyQs(res.clarify);
        setConfirmSummary(res.confirmSummary ?? null);
        setPendingQuery(query);
        setActiveQuery(query);
        if (res.outcome) {
          // R03 (Defect B): a COMPLETED zero run that carries a thin-ask must
          // still land the zero screen — never a bare bubble + questions limbo
          // that regresses toward the greeting. Attach the empty result set to
          // the turn (renders the "Results for · 0 results" header + narrative),
          // surface the streamed reconciliation, and keep pagination honest
          // (zero delivered → no Show more). The questions remain offered as a
          // refinement panel above the composer.
          setLeads([]);
          setCompanies([]);
          setPeople([]);
          setLocalRows([]);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? { ...t, results: { leads: [], companies: [], people: [], local: [] } }
                : t,
            ),
          );
          specOffsetRef.current[turnId] = offset + res.rows.length;
          setSpecHasMore(false);
          setStreamedMissing(
            (res.candidateLedger?.streamedNotReturned ?? []).map((item) => ({
              key: item.key,
              title: item.title,
              label: streamedFateLabel(item),
            })),
          );
          setZeroNarrative(
            res.outcome === "NO_QUALIFIED_RESULTS"
              ? enrichZeroNarrative(zeroResultsNarrative(res.retrievalTrace), res.candidateLedger)
              : null,
          );
          if (turnId === pendingTurnIdRef.current) {
            const zeroOutcome = outcomeUi(res.outcome, {
              superseded: session.wasSuperseded(res.search_run_id),
              detail: res.boundary_message ?? zeroResultsNarrative(res.retrievalTrace) ?? res.retrievalTrace?.sourceHealth?.summary ?? null,
            });
            if (shouldSurfaceOutcome(zeroOutcome)) toast.info(zeroOutcome.message!);
          }
        } else {
          setZeroNarrative(null);
        }
        session.settle(res);
        return;
      }

      // M11: render from QualifiedLead projection — unresolved never becomes a lead.
      const projected = projectSpecRowsToQualifiedViews({
        rows: res.rows,
        spec: res.spec,
        run,
      });
      if (import.meta.env.DEV) {
        // Server→UI loss visibility: qualification ran twice (server + here);
        // when the screen shows zero but the server returned rows, this says
        // whether UI projection killed them and under which reject codes.
        const codes: Record<string, number> = {};
        for (const r of projected.rejected) codes[r.reject_code] = (codes[r.reject_code] ?? 0) + 1;
        console.info(
          `[ui-projection] server=${res.rows.length} projected=${projected.views.length} ` +
            `rejected=${projected.rejected.length} codes=${JSON.stringify(codes)}`,
        );
      }
      const isBusiness =
        res.spec.entity === "business" ||
        (projected.views.length > 0 && projected.views[0].lead.entity_type === "business");
      const leads: Lead[] = isBusiness
        ? []
        : projected.views.map((v, i) => viewToLegacyLead(v, i) as Lead);
      const local: LocalBusinessRow[] = isBusiness
        ? projected.views.map((v, i) => viewToLocalBusinessRow(v, i) as unknown as LocalBusinessRow)
        : [];
      const qualifiedCount = projected.qualified_count;

      const turnFilter = filterFromAnswers(merged);
      const append = offset > 0;
      setSpecFilter(turnFilter);
      if (append) {
        setLeads((prev) => [...prev, ...leads]);
        setLocalRows((prev) => [...prev, ...local]);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  filter: turnFilter ?? undefined,
                  results: {
                    leads: [...(t.results?.leads ?? []), ...leads],
                    companies: [],
                    people: [],
                    local: [...(t.results?.local ?? []), ...local],
                  },
                }
              : t,
          ),
        );
      } else {
        setLeads(leads);
        setCompanies([]);
        setPeople([]);
        setLocalRows(local);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  filter: turnFilter ?? undefined,
                  results: { leads, companies: [], people: [], local },
                }
              : t,
          ),
        );
      }
      specOffsetRef.current[turnId] = offset + res.rows.length;
      setSpecHasMore(res.hasMore);
      setActiveQuery(query);
      setSuggestions([]);
      session.settle(res);

      if (
        typeof merged.offer === "string" &&
        merged.offer.trim() &&
        projected.views.length &&
        res.spec.entity !== "job"
      ) {
        void runIntentEnrichment(
          merged.offer,
          res.spec.entity,
          { people: [], companies: [], local: [] },
          specRowsToCandidates(res.rows.filter((r) => r.disposition === "qualified")),
        );
      }

      // Typed outcomes — never bare "No results found"; superseded cancel is silent.
      // No outcome = a Stage-1 round (clarify/confirm) ran instead of a search;
      // surfacing a zero toast here would be the premature-zero defect.
      const uiOutcome = res.outcome
        ? outcomeUi(res.outcome, {
            superseded: session.wasSuperseded(res.search_run_id),
            // Raw provider diagnostics name internal infrastructure; only the
            // user-safe source-health sentence may reach the toast.
            detail: res.boundary_message ?? zeroResultsNarrative(res.retrievalTrace) ?? res.retrievalTrace?.sourceHealth?.summary ?? null,
          })
        : null;
      setZeroNarrative(
        !append && qualifiedCount === 0 && res.outcome === "NO_QUALIFIED_RESULTS"
          ? enrichZeroNarrative(zeroResultsNarrative(res.retrievalTrace), res.candidateLedger)
          : null,
      );
      if (!append) {
        setStreamedMissing(
          (res.candidateLedger?.streamedNotReturned ?? []).map((item) => ({
            key: item.key,
            title: item.title,
            label: streamedFateLabel(item),
          })),
        );
      }
      if (
        !append &&
        turnId === pendingTurnIdRef.current &&
        uiOutcome &&
        shouldSurfaceOutcome(uiOutcome) &&
        qualifiedCount === 0
      ) {
        toast.info(uiOutcome.message!);
      } else if (
        !append &&
        res.moreAvailableMessage &&
        turnId === pendingTurnIdRef.current &&
        qualifiedCount > 0
      ) {
        toast.message(res.moreAvailableMessage);
      }
    } catch (e: unknown) {
      // Aborted because a newer search started — no failure chrome.
      if (isSearchAbortError(e) || session.wasSuperseded(run.search_run_id)) {
        return;
      }
      if (!session.accept({ search_run_id: run.search_run_id }).ok) return;
      throw e;
    } finally {
      signal.removeEventListener("abort", cancelOnServer);
      // Only the still-active run may clear loading — a superseded finally
      // must not hide the newer search's spinner.
      if (session.activeRunId === run.search_run_id) {
        setSpecPending(false);
        setRunInFlight(false);
      }
    }
  };

  // Step 4: offer-gated intent enrichment. Runs ONLY with a stated offer,
  // over structured rows (people/companies/local, top 20), sequentially so
  // progress ("Checking evidence 7/20") is real and the run is cancellable
  // by any new search. Evidence merges into intentByKey; rows without
  // evidence keep no entry and no badge.
  const runIntentEnrichment = async (
    offer: string,
    entity: string,
    rows: { people: PersonRow[]; companies: CompanyRow[]; local: LocalBusinessRow[] },
    prebuilt?: IntentCandidate[],
  ): Promise<void> => {
    const trimmedOffer = offer.trim().slice(0, 120);
    if (!trimmedOffer) return;
    // Round-robin across row types so 20 people can't starve every
    // company/local out of the top-20 budget (T4 fix). Prebuilt spec
    // candidates arrive already interleaved — same cap applies.
    const pools: IntentCandidate[][] = [
      rows.people.map((p) => ({
        key: p.key,
        name: p.name,
        company: p.company_hint ?? p.company_domain ?? null,
        city: p.location_hint ?? null,
        country: null as string | null,
      })),
      rows.companies.map((c) => ({
        key: c.key,
        name: c.name,
        // Domain anchors company queries (bare names return nothing);
        // matcher still requires a real token hit, so no false positives.
        company: c.domain ?? c.website ?? c.name,
        city: null as string | null,
        country: null as string | null,
      })),
      rows.local.map((b) => ({
        key: b.key,
        name: b.name,
        company: b.name,
        city: null as string | null,
        country: null as string | null,
      })),
    ];
    const candidates: IntentCandidate[] =
      prebuilt?.slice(0, 20) ??
      (() => {
        const out: IntentCandidate[] = [];
        for (let i = 0; out.length < 20; i++) {
          let added = false;
          for (const pool of pools) {
            if (pool[i]) {
              out.push(pool[i]);
              added = true;
              if (out.length >= 20) break;
            }
          }
          if (!added) break;
        }
        return out;
      })();
    if (!candidates.length) return;
    const runId = ++intentRunRef.current;
    intentAbortRef.current?.abort();
    const controller = new AbortController();
    intentAbortRef.current = controller;
    activeOfferRef.current = trimmedOffer;
    setIntentProgress({ done: 0, total: candidates.length });
    let strategy: IntentStrategy;
    try {
      strategy = await getStrategy({ data: { offer: trimmedOffer, entity }, signal: controller.signal });
    } catch {
      if (intentRunRef.current === runId) setIntentProgress(null);
      return; // Strategy failed: base results stand, no intent layer.
    }
    const rowByKey = new Map<string, PersonRow | CompanyRow | LocalBusinessRow>();
    for (const r of [...rows.people, ...rows.companies, ...rows.local]) rowByKey.set(r.key, r);
    let done = 0;
    for (const c of candidates) {
      if (intentRunRef.current !== runId) return; // superseded
      try {
        const res = await discoverIntent({ data: { candidate: c, strategy, offer: trimmedOffer }, signal: controller.signal });
        done += 1;
        if (intentRunRef.current !== runId) return;
        setIntentProgress({ done, total: candidates.length });
        if (res.evidence.length) {
          const row = rowByKey.get(c.key);
          const ranked = [...res.evidence].sort(
            (a, b) =>
              rankEvidence(row, b.leadKey, b).quality - rankEvidence(row, a.leadKey, a).quality,
          );
          setIntentByKey((m) => ({ ...m, [c.key]: { offer: trimmedOffer, evidence: ranked } }));
        }
      } catch {
        done += 1;
        if (intentRunRef.current !== runId) return;
        setIntentProgress({ done, total: candidates.length });
      }
    }
    if (intentRunRef.current === runId) setIntentProgress(null);
  };

  const specAnswersFromPanel = (a: ClarifyAnswers | null | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!a) return out;
    // Free-text "Something else…" answers land under `other`.
    const other = (a.other ?? {}) as Record<string, unknown>;
    const pick = (...keys: string[]): string => {
      for (const k of keys) {
        const v = (a as Record<string, unknown>)[k] ?? other[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    };
    const role = pick("entity_role", "craft");
    const entity = pick("entity");
    const category = pick("entity_category");
    const industry = pick("entity_industry");
    const location = pick("entity_location", "geography");
    const investorSector = pick("investor_sector");
    const mode = pick("entity_mode");
    const purpose = pick("entity_purpose");
    const salary = pick("entity_salary");
    const size = pick("entity_size");
    const revenue = pick("entity_revenue");
    const relation = pick("entity_relation");
    const scope = pick("entity_scope");
    const offer = pick("entity_offer");
    // Investor slots survive the panel (previously dropped: answers existed
    // but never reached retrieval). "any" means no filter — skip it.
    const invStage = pick("investor_stage");
    const invCheck = pick("investor_check");
    const invSector = pick("investor_sector");
    // Geography ids (global/us/na/eu/uk/local) map to the country names the
    // readers understand; unresolvable ones stay missing (re-asked).
    const GEO_ID_MAP: Record<string, string> = {
      us: "USA",
      na: "North America",
      eu: "Europe",
      uk: "UK",
    };
    const mappedLocation = GEO_ID_MAP[location] ?? location;
    if (role) out.role = role;
    if (entity) out.entity = entity;
    if (category) out.category = category;
    if (industry) out.industry = industry;
    if (mappedLocation && mappedLocation !== "global" && mappedLocation !== "local") {
      out.location = mappedLocation;
    }
    if (location === "global") out.geo_scope = "worldwide";
    if (invStage && invStage !== "any") out.investor_stage = invStage;
    if (invCheck && invCheck !== "any") out.investor_check = invCheck;
    if (invSector && invSector !== "any") out.investor_sector = invSector;
    if (investorSector && investorSector.toLowerCase() !== "any") out.investor_sector = investorSector;
    // Mode/offer ride along as stated criteria (ignored by retrieval and
    // validation; consumed by Intent in Batch 4). Phase 1.3: the server mode
    // gate blocks retrieval until mode is stated (one question), and asks the
    // offer question only after a selling answer — just-looking never sees it.
    // Explicit "Search" (force) bypasses the gate.
    if (mode) out.mode = mode;
    if (purpose) out.purpose = purpose;
    if (salary) out.salary_min = salary;
    if (size) out.employee_count = size;
    if (revenue) out.revenue = revenue;
    if (relation) out["relation.type"] = relation;
    if (scope) out["target.scope"] = scope;
    if (offer) out.offer = offer;
    // ICP follow-up answers (Phase 1.4): site preference drives the
    // no_website retrieval filter; channel tailors the pitch (no row filter).
    const site = pick("entity_site");
    if (site === "without" || site === "no_website") out.opportunity = "no_website";
    else if (site === "with" || site === "has_website") out.site = "with";
    const channel = pick("entity_channel");
    if (channel && channel !== "any") out.channel = channel;
    return out;
  };
  const [planTokens, setPlanTokens] = useState<
    import("@/lib/search/tokenize-input").InputTokens | null
  >(null);
  // Questions mount only after the plan has revealed (min 2 lines) — never beside it.
  const [planDone, setPlanDone] = useState(false);
  // Latest spec entity from runSpec responses: steers the plan narration
  // (business/company/person lines) once known; legacy vertical covers pre-spec.
  const [specEntity, setSpecEntity] = useState<string | null>(null);
  // Raise facts: clarifier answers win, tokenizer slots from the query fill gaps.
  const raiseStage =
    (clarifyAnswers?.investor_stage && clarifyAnswers.investor_stage !== "any"
      ? clarifyAnswers.investor_stage
      : undefined) ??
    planTokens?.stage ??
    undefined;
  const raiseSector =
    (clarifyAnswers?.investor_sector && clarifyAnswers.investor_sector !== "any"
      ? clarifyAnswers.investor_sector
      : undefined) ??
    planTokens?.sector ??
    undefined;
  const turnId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const resetConversation = () => {
    clearWorkspace();
    setBrowserProgressRun(null);
    setBrowserProgressEvents([]);
    setStreamedMissing([]);
    setTurns([]);
    setExpandedTurns({});
    setContactByKey({});
    setIntentByKey({});
    setIntentProgress(null);
    intentRunRef.current += 1;
    // New chat owns a new identity: the old server row stays intact under
    // its own id (history keeps working); only the view resets.
    rotateConversationId();
    pendingTurnIdRef.current = null;
    pendingTurnAnswersRef.current = {};
    pendingFrameRef.current = null;
    pendingAttachmentsRef.current = [];
    turnAttachmentsRef.current = [];
    setConfirmSummary(null);
    setPlanTokens(null);
    setActiveQuery(null);
    setClarifyAnswers(null);
    setClarifyQs([]);
    setPendingQuery(null);
    setDefaultSummary("");
    composerRef.current?.focus();
  };
  const saveTranscriptFn = useServerFn(saveTranscript);
  const getTranscriptFn = useServerFn(getTranscript);

  // Shared contact resolution (cards, tables, and the detail drawer all use it).
  const resolveContactFor = async (
    key: string,
    company: string,
    postText: string,
    personName?: string,
    freeOnly?: boolean,
    knownEmail?: string,
    profileUrls?: string[],
    deepEnrich?: boolean,
  ) => {
    setContactBusyKey(key);
    try {
      const r = await resolveContact({
        data: { company, postText, personName, freeOnly, knownEmail, profileUrls, deepEnrich },
      });
      const email = r.contacts?.[0]?.email;
      const phone = r.contacts?.[0]?.phone || r.harvested_phones?.[0];
      const note = r.contacts?.[0]?.corroborating_sources?.[0]?.note;
      const verifyNote = verificationLabel(r.verification?.tier, r.verification?.method);
      const domain = r.domain && r.domain.via !== "unverified_guess" ? r.domain.domain : undefined;
      const socials = r.socials && Object.values(r.socials).some(Boolean) ? r.socials : undefined;
      if (email || phone || domain || socials) {
        setContactByKey((m) => ({
          ...m,
          [key]: {
            email,
            phone,
            domain,
            note: note || undefined,
            verifyNote,
            socials,
            status: "ok",
          },
        }));
        // Write resolve socials/website back onto the in-memory row.
        if (key.startsWith("co:") && socials) {
          const coKey = key.slice(3);
          setCompanies((prev) =>
            prev.map((c) =>
              c.key !== coKey
                ? c
                : {
                    ...c,
                    website: c.website || (domain ? `https://${domain}` : undefined),
                    domain: c.domain || domain,
                    linkedin_url: c.linkedin_url || socials.linkedin,
                    twitter_url: c.twitter_url || socials.twitter,
                    facebook_url: c.facebook_url || socials.facebook,
                  },
            ),
          );
        } else if (!key.startsWith("co:") && socials) {
          setPeople((prev) =>
            prev.map((p) =>
              p.key !== key
                ? p
                : {
                    ...p,
                    linkedin_url: p.linkedin_url || socials.linkedin,
                    github_url: p.github_url || socials.github,
                    author_url: p.author_url || socials.linkedin || socials.twitter || p.author_url,
                    company_domain: p.company_domain || domain,
                  },
            ),
          );
        }
      } else {
        setContactByKey((m) => ({ ...m, [key]: { status: "none" } }));
      }
    } catch (e: unknown) {
      toast.error(friendlyErrorText(e, "Contact resolve failed"));
    } finally {
      setContactBusyKey(null);
    }
  };

  const companyProfileUrls = (row: CompanyRow) =>
    [row.website, row.linkedin_url, row.twitter_url, row.facebook_url].filter(
      (u): u is string => !!u,
    );
  const personProfileUrls = (row: PersonRow) =>
    [row.author_url, row.linkedin_url, row.github_url].filter((u): u is string => !!u);

  const resolveCompanyContact = (row: CompanyRow, freeOnly?: boolean, deepEnrich?: boolean) => {
    const best = row.leads[0];
    const knownEmail = row.inline_contacts?.emails?.[0];
    return resolveContactFor(
      `co:${row.key}`,
      row.domain || row.name,
      `${best.title}\n${best.snippet}`,
      undefined,
      freeOnly,
      knownEmail,
      companyProfileUrls(row),
      deepEnrich,
    );
  };
  const resolvePersonContact = (row: PersonRow, freeOnly?: boolean, deepEnrich?: boolean) =>
    resolveContactFor(
      row.key,
      row.company_hint || row.company_domain || row.name,
      `${row.lead.title}\n${row.lead.snippet}`,
      row.name,
      freeOnly,
      row.inline_contacts?.emails?.[0],
      personProfileUrls(row),
      deepEnrich,
    );

  const entityContactKey =
    selectedEntity && selectedEntity.type !== "local"
      ? selectedEntity.type === "company"
        ? `co:${selectedEntity.company.key}`
        : selectedEntity.person.key
      : null;
  // Raw row key for intent-evidence lookup (contact map uses co: prefix).
  const selectedEntityKey = !selectedEntity
    ? null
    : selectedEntity.type === "company"
      ? selectedEntity.company.key
      : selectedEntity.type === "person"
        ? selectedEntity.person.key
        : selectedEntity.local.key;
  const resolveSelectedEntityContact = () => {
    if (!selectedEntity) return;
    if (selectedEntity.type === "company") void resolveCompanyContact(selectedEntity.company);
    else if (selectedEntity.type === "person") void resolvePersonContact(selectedEntity.person);
  };

  // Auto free-only enrich when opening a company with a domain and no contacts yet.
  useEffect(() => {
    if (!selectedEntity || selectedEntity.type !== "company") return;
    const row = selectedEntity.company;
    const key = `co:${row.key}`;
    if (contactByKey[key]?.status === "ok") return;
    if (!row.domain && !row.website && !row.linkedin_url) return;
    void resolveCompanyContact(row, true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per selected company key
  }, [selectedEntity?.type === "company" ? selectedEntity.company.key : null]);
  const composerRef = useRef<ComposerHandle>(null);
  const isMobile = useIsMobile();

  // No freshness gating: every result shows, newest or not.
  const shownLeads = leads;
  const shownCompanies = companies;
  const shownPeople = people;


  const chatMut = useMutation({
    mutationFn: async (messages: ChatTurn[]) => chat({ data: { messages } }),
    onSuccess: (res) => {
      const cleaned = res.content.replace(/\s*SEARCH:.*$/m, "").trim();
      setChatLog((m) => [...m, { role: "assistant", content: scrapyAckReply(cleaned) }]);
      if (res.query) {
        const q = toPlainSearchQuery(res.query) || res.query;
        toast.success("On it, searching now");
        // Through beginSearch, so a search Scrapy starts from the chat gets the
        // same clarifier a typed one does. Calling the mutation directly here
        // was a second way to reach results with the questions skipped.
        setRunInFlight(true);
        setTimeout(() => void beginSearch(q), 200);
      }
    },
    onError: (e: Error) => toast.error(friendlyErrorText(e)),
  });

  const saveMut = useMutation({
    mutationFn: async (lead: Lead) => save({ data: lead }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-leads"] }),
    onError: (e: Error) => toast.error(friendlyErrorText(e)),
  });

  const watchMut = useMutation({
    mutationFn: async (q: string) => createWatch({ data: { query: q, schedule: "daily" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      toast.success("Signal watch saved — see Watches in the sidebar");
    },
    onError: (e: Error) => toast.error(friendlyErrorText(e)),
  });

  // Auto-search effect: runs once the (possibly just-created) active project
  // is available so the search carries its full structured context.
  useEffect(() => {
    if (!pendingAutoSearch || !activeProject) return;
    if (autoRanForProject === activeProject.id) return;
    const q = buildProjectQuery(activeProject);
    if (!q) {
      setPendingAutoSearch(false);
      return;
    }
    setPendingAutoSearch(false);
    setAutoRanForProject(activeProject.id);
    setInput(q);
    void beginSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSearch, activeProject?.id]);

  // Auto-enrich the top results after each search — FREE waterfall only
  // (own crawler + public registries), sequential so the server isn't hammered.
  const autoResolvedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeQuery || false || specPending) return;
    if (autoResolvedFor.current === activeQuery) return;
    if (!companies.length && !people.length) return;
    autoResolvedFor.current = activeQuery;
    let cancelled = false;
    (async () => {
      for (const c of companies.slice(0, 12)) {
        if (cancelled || contactByKey[`co:${c.key}`]) continue;
        await resolveCompanyContact(c, true).catch(() => {});
      }
      // Prefer people with a company hint (better domain resolve) first.
      const peopleOrdered = [
        ...people.filter((p) => !!p.company_hint || !!p.company_domain),
        ...people.filter((p) => !p.company_hint && !p.company_domain),
      ].slice(0, 8);
      for (const p of peopleOrdered) {
        if (cancelled || contactByKey[p.key]) continue;
        await resolvePersonContact(p, true).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, companies, people, false, specPending]);

  /**
   * Wipe the previous answer before starting a new one.
   *
   * Without this, the clarifier and SearchingSteps render ON TOP of the last
   * search's cards — header still says "Results for 'sales'" while hunting
   * "web development", and the old Freelancer grid sits underneath the
   * questions. The user asked for the clarifier (or the hunting steps) to be
   * the only thing on screen; previous results belong in History, not behind
   * the new research.
   */
  const stopSearch = () => {
    searchSessionRef.current?.cancel({ clearActive: true });
    intentAbortRef.current?.abort();
    intentRunRef.current += 1;
    setIntentProgress(null);
    setBrowserProgressRun(null);
    setBrowserProgressEvents([]);
    setStreamedMissing([]);
    setSpecPending(false);
    setRunInFlight(false);
  };
  const clearWorkspace = () => {
    stopSearch();
    setLeads([]);
    setCompanies([]);
    setPeople([]);
    setLocalRows([]);
    setSpecFilter(null);
    // contactByKey is GLOBAL: frozen turns still render their seeded
    // contacts, so it's only wiped on a full conversation reset.
    setSelected(null);
    setSelectedEntity(null);
    setSuggestions([]);
    setQueryType(null);
    setRefinement("");
    setSpecHasMore(false);
  };

  /**
   * Entry point for every user-initiated search. Classifies FIRST (cheap — no
   * source fan-out, no quota) and, when the query is vague, holds the search
   * until the clarifying questions are answered or skipped.
   *
   * Asking after results was the wrong order: the first search is then the
   * wrong one and the user watches it run before being asked to fix it.
   */
  // Deep-link + new-chat params: ?conversation= rehydrates an exact saved
  // transcript (history reopen), ?q= re-runs a history search, ?fresh=
  // resets to a clean conversation (fixes same-route navigate no-ops).
  const seenParamsRef = useRef("");
  useEffect(() => {
    const key = `${routeSearch.q ?? ""}|${routeSearch.fresh ?? ""}|${routeSearch.conversation ?? ""}`;
    if (!key || seenParamsRef.current === key) return;
    seenParamsRef.current = key;
    if (routeSearch.fresh) {
      resetConversation();
    } else if (routeSearch.conversation) {
      const cid = routeSearch.conversation;
      conversationIdRef.current = cid;
      searchSessionRef.current?.rotateConversation(cid);
      try {
        window.localStorage.setItem(`scrapivo:conversation-id:${userId}`, cid);
      } catch {
        // ignore
      }
      // Full hygiene: a reopened conversation must not inherit live
      // workspace rows, contacts, intent, or turn ownership.
      clearWorkspace();
      setContactByKey({});
      setIntentByKey({});
      setIntentProgress(null);
      intentRunRef.current += 1;
      pendingTurnIdRef.current = null;
      pendingTurnAnswersRef.current = {};
      pendingFrameRef.current = null;
      setPlanTokens(null);
      setClarifyQs([]);
      setPendingQuery(null);
      void getTranscriptFn({ data: { conversationId: cid } })
        .then((r) => {
          setTurns((r.turns as unknown as ConversationTurn[]) ?? []);
          setExpandedTurns({});
          setActiveQuery(null);
        })
        .catch((e: unknown) => {
          toast.error(friendlyErrorText(e, "Could not reopen conversation"));
        });
    } else if (routeSearch.q && routeSearch.q.trim() && routeSearch.q.trim() !== activeQuery) {
      // Legacy history entries re-run in an ISOLATED conversation so the
      // search never pollutes (or gets polluted by) the current transcript.
      resetConversation();
      // Drop the ?q param after consuming so refresh replays the saved
      // transcript instead of re-running the search.
      navigate({ to: "/discover", search: {}, replace: true });
      void beginSearch(routeSearch.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- param-driven entry only
  }, [routeSearch.q, routeSearch.fresh, routeSearch.conversation]);

  // Transcript persistence: debounced save of whole turns whenever they
  // settle (never mid-search). The conversation id is captured up front so
  // an id rotation mid-debounce can never misattribute the snapshot.
  // Unmount flush covers fast-close (<1500ms) loss. Failures stay silent:
  // transcript is best-effort; in-memory truth stays intact.
  useEffect(() => {
    if (!turns.length || false || specPending) return;
    const cid = getConversationId();
    const snapshot = turns;
    let flushed = false;
    const flush = () => {
      if (flushed) return;
      flushed = true;
      void saveTranscriptFn({
        data: { conversationId: cid, turns: snapshot as unknown as never },
      }).catch(() => {});
    };
    const t = setTimeout(flush, 1500);
    return () => {
      clearTimeout(t);
      // Unmount-only flush (fast-close protection): deps-change cleanups
      // must NOT save, or every keystroke-turn would write immediately.
      if (unmountedRef.current) flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, false, specPending]);

  const unmountedRef = useRef(false);
  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    [],
  );

  // Refresh replay: plain reload (no params) restores the stored
  // conversation's exact transcript instead of starting blank.
  const replayedRef = useRef(false);
  useEffect(() => {
    if (replayedRef.current) return;
    if (routeSearch.q || routeSearch.fresh || routeSearch.conversation) return;
    if (turns.length) return;
    replayedRef.current = true;
    const cid = getConversationId();
    void getTranscriptFn({ data: { conversationId: cid } })
      .then((r) => {
        const saved = (r.turns as unknown as ConversationTurn[]) ?? [];
        if (saved.length) {
          setTurns(saved);
          setExpandedTurns({});
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll: the echoed user bubble and new panels come into view the
  // frame they appear, matching ChatGPT-style conversation behavior.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [turns.length, clarifyQs.length, false, specPending]);

  const beginSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed && pendingAttachmentsRef.current.length === 0) return;
    const pendingId = pendingTurnIdRef.current;
    const pendingQuestion = clarifyQs[0];
    const startsNewRequest = /^(?:find|search|show|look for|looking for)\b/i.test(trimmed) ||
      (/^research\b/i.test(trimmed) && /\b(?:in|for|about|businesses|companies|people|jobs|investors)\b/i.test(trimmed));
      if (pendingQuery && pendingId && pendingQuestion && !startsNewRequest) {
        const field = ({
          entity_location: "location",
          entity_category: "category",
          entity_industry: "industry",
          entity_role: "role",
          entity_mode: "mode",
          entity_purpose: "purpose",
          entity_salary: "salary_min",
          entity_size: "employee_count",
          entity_revenue: "revenue",
          entity_relation: "relation.type",
          entity_scope: "target.scope",
        } as Record<string, string>)[pendingQuestion.id] ?? pendingQuestion.id;
        setTurns((prev) => prev.map((turn) => turn.id === pendingId
          ? { ...turn, text: `${turn.text}\n${trimmed}` }
          : turn));
        setClarifyQs([]);
        setPendingQuery(null);
        // Confirm gate: the combined card was shown — record acceptance so the
        // confirm gate never re-fires on this frame.
        setConfirmSummary(null);
        await runSpecBranch(pendingQuery, pendingId, {
          ...(confirmSummary ? { confirm: "confirmed" } : {}),
          [field]: trimmed,
        });
        return;
      }
    // User bubble first: the submitted text lives in the conversation from
    // this instant, independent of whatever happens downstream. Results are
    // attached to the owning turn by onSuccess (turn-owned transcript) — no
    // deferred snapshotting, so outputs can never vanish or duplicate.
    const newTurnId = turnId();
    pendingTurnIdRef.current = newTurnId;
    pendingTurnAnswersRef.current = {};
    pendingFrameRef.current = null;
    // Stage 1: staged attachment ids ride THIS turn (resent on clarify
    // rounds); the staging area clears so they cannot leak into later turns.
    turnAttachmentsRef.current = pendingAttachmentsRef.current;
    pendingAttachmentsRef.current = [];
    intentRunRef.current += 1; // cancel any in-flight intent enrichment
    setIntentProgress(null);
    setTurns((prev) => [...prev, { id: newTurnId, text: trimmed || "(attachments only)", ts: Date.now() }]);
    // Fold state derives at render (open = explicitly opened, else the
    // latest turn), so no sync needed here; manual toggles persist.
    // New research starts with a clean screen — never leave the previous
    // answer underneath the clarifier or the hunting steps.
    clearWorkspace();
    setClarifyQs([]);
    setPendingQuery(null);
    // Each new research asks again. Keeping answers across queries meant
    // "sales" → "web development" skipped the clarifier and ran straight into
    // hunting while the old sales cards were still on screen.
    setClarifyAnswers(null);
    setDefaultSummary("");
    // Stage 1: the canonical path is the ONLY user-input path (legacy
    // clarify stack removed at the P5 cutover).
    if (pendingTurnIdRef.current !== newTurnId) return;
    try {
      await runSpecBranch(trimmed, newTurnId, {});
    } catch (e) {
      toast.error(friendlyErrorText(e as Error, "Search failed"));
    }
  };

  const onSubmit = () => {
    const text = input.trim();
    // Stage 1: attachment-only submissions are legal — text OR ≥1 uploaded
    // attachment. The composer already enforces the same contract.
    if (!text && pendingAttachmentsRef.current.length === 0) return;
    if (mode === "search") {
      setInput("");
      // Hardened: a freak throw must toast, never swallow the query silently.
      void beginSearch(text).catch((e: unknown) => {
        console.error("[discover] beginSearch failed", e);
        toast.error(friendlyErrorText(e, "Search failed to start"));
        setInput(text);
      });
    } else {
      setChatOpen(true);
      const next: ChatTurn[] = [...chatLog, { role: "user", content: text }];
      setChatLog(next);
      setInput("");
      chatMut.mutate(next);
      setMode("search");
    }
  };

  const sendToScrapy = (text: string) => {
    const next: ChatTurn[] = [...chatLog, { role: "user", content: text }];
    setChatLog(next);
    chatMut.mutate(next);
  };

  const pending = false || chatMut.isPending || specPending;
  const hasResults = leads.length > 0 || localRows.length > 0 || activeQuery !== null;
  // A submitted turn starts the conversation instantly: the echoed user
  // bubble renders on the next frame, never held until the clarifier
  // round-trip finishes (ChatGPT-style echo).
  const idle = !hasResults && !false && !specPending && turns.length === 0;
  const showHero = idle;

  /** One full result feed (People → Companies → Posts → Local) — rendered for
   *  the active workspace AND for frozen transcript turns. */
  const renderResultSections = (
    rows: {
      leads: Lead[];
      companies: CompanyRow[];
      people: PersonRow[];
      local: LocalBusinessRow[];
    },
    filter?: TurnFilter | null,
  ) => (
    <>
      {rows.people.length > 0 && (
        <div className="space-y-3 pb-4">
          {viewMode === "table" ? (
            <PersonTable
              rows={rows.people}
              onOpen={(row) => {
                setSelected(null);
                setSelectedEntity({ type: "person", person: row });
              }}
              onGenerate={openGenerateForPerson}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rows.people.map((p) => (
                <PersonCard
                  key={p.key}
                  row={p}
                  onOpen={(row) => {
                    setSelected(null);
                    setSelectedEntity({ type: "person", person: row });
                  }}
                  contact={contactByKey[p.key]}
                  intent={intentBadgeFor(p.key)}
                  onGenerate={openGenerateForPerson}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {rows.companies.length > 0 && (
        <div className="space-y-3 pb-4">
          {viewMode === "table" ? (
            <CompanyTable
              rows={rows.companies}
              onOpen={(row) => {
                setSelected(null);
                setSelectedEntity({ type: "company", company: row });
              }}
              onGenerate={openGenerateForCompany}
              relevanceByKey={Object.fromEntries(
                rows.companies.map((c) => [
                  c.key,
                  relevanceChips({ website: c.website ?? null }, filter ?? null, false),
                ]),
              )}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rows.companies.map((c) => (
                <CompanyCard
                  key={c.key}
                  row={c}
                  onOpen={(row) => {
                    setSelected(null);
                    setSelectedEntity({ type: "company", company: row });
                  }}
                  contact={contactByKey[`co:${c.key}`]}
                  onGenerate={openGenerateForCompany}
                  intent={intentBadgeFor(c.key)}
                  relevance={relevanceChips({ website: c.website ?? null }, filter ?? null, false)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {rows.leads.length > 0 && (
        <div className="space-y-3 pb-4">
          {viewMode === "table" ? (
            <PostsList leads={rows.leads} onOpen={setSelected} />
          ) : (
            <PostsGrid
              leads={rows.leads}
              savedByUrl={savedByUrl}
              onOpen={setSelected}
              onSave={(l) => saveMut.mutate(l)}
            />
          )}
        </div>
      )}
      {rows.local.length > 0 && (
        <div className="space-y-3 pb-4">
          {viewMode === "table" ? (
            <BusinessTable
              rows={rows.local}
              onOpen={(row) => {
                setSelected(null);
                setSelectedEntity({ type: "local", local: row });
              }}
              onGenerate={openGenerateForLocal}
              relevanceByKey={Object.fromEntries(
                rows.local.map((r) => [r.key, relevanceChips(r, filter ?? null)]),
              )}
            />
          ) : (
            <LocalBusinessesGrid
              rows={rows.local}
              onOpen={(row) => {
                setSelected(null);
                setSelectedEntity({ type: "local", local: row });
              }}
              onGenerate={openGenerateForLocal}
              intentByKey={badgeMapForGrid()}
              relevanceByKey={Object.fromEntries(
                rows.local.map((r) => [r.key, relevanceChips(r, filter ?? null)]),
              )}
            />
          )}
        </div>
      )}
    </>
  );
  // First-visit guided tour: plays once, only on the home view, never on top
  // of the onboarding wizard, and only for genuinely new accounts (signed up
  // within NEW_USER_WINDOW_MS). Existing users never see it.
  const NEW_USER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  const profileCreatedAt = (profileQuery.data as { created_at?: string } | undefined)?.created_at;
  const profileAgeMs = profileCreatedAt ? Date.now() - new Date(profileCreatedAt).getTime() : NaN;
  const isNewUser = Number.isFinite(profileAgeMs) && profileAgeMs <= NEW_USER_WINDOW_MS;
  const showTour =
    !tourSeen &&
    isNewUser &&
    !showOnboarding &&
    !wizardOpen &&
    showHero &&
    profileQuery.isSuccess &&
    projectsQuery.isSuccess;

  // Every browser session: open Scrapy and ask what they want to find now.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (showOnboarding || wizardOpen) return;
    if (!projectsQuery.isSuccess || projects.length === 0) return;
    if (!idle) return;
    if (returnChatOpenedRef.current) return;
    if (sessionStorage.getItem(returnChatKey) === "1") return;

    returnChatOpenedRef.current = true;
    sessionStorage.setItem(returnChatKey, "1");
    const name = greetingName.trim() || "there";
    setMode("chat");
    setChatOpen(true);
    setChatLog((prev) =>
      prev.length > 0
        ? prev
        : [{ role: "assistant", content: `Hey ${name}! What do you want to find now?` }],
    );
  }, [
    showOnboarding,
    wizardOpen,
    projectsQuery.isSuccess,
    projects.length,
    idle,
    greetingName,
    returnChatKey,
  ]);

  const navigate = AuthRoute.useNavigate();

  return (
    <div className="h-full flex min-h-0 bg-[#0a0a0b] text-white">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6">
          {showOnboarding ? (
            // min-h-full (not h-full) + flex-col: when the content is taller
            // than the scroll container it grows and scrolls from the top
            // instead of being centered past the scroll origin (clipped).
            <div className="min-h-full flex flex-col items-center justify-center py-6 md:py-10">
              <OnboardingWizard
                onComplete={completeOnboarding}
                onSkip={() => {
                  setWizardOpen(false);
                  setOnboardingSkipped(true);
                  if (typeof window !== "undefined") {
                    localStorage.setItem(skipKey, "1");
                  }
                }}
              />
            </div>
          ) : showHero ? (
            <div className="min-h-full flex flex-col items-center justify-center py-6 md:py-10">
              <DiscoverWelcomeHero
                greetingName={greetingName || undefined}
                onGuidedStart={(kind) => {
                  void beginSearch(GUIDED_SEARCH_TEXT[kind]).catch((e: unknown) => {
                    toast.error(friendlyErrorText(e, "Could not start guided search"));
                  });
                }}
              />
            </div>
          ) : (
            <div className="max-w-4xl mx-auto py-4 md:py-6 space-y-5 md:space-y-6">
              {/* Conversation transcript: each turn = user bubble + its own
                  frozen results, folded except the latest (one click reopens).
                  Nothing is ever discarded — Step 3 keeps every turn's data
                  in memory and on the server. */}
              {turns.map((t, i) => {
                const isLast = i === turns.length - 1;
                const open = expandedTurns[t.id] ?? isLast;
                const totals = t.results
                  ? t.results.leads.length +
                    t.results.companies.length +
                    t.results.people.length +
                    t.results.local.length
                  : (t.counts?.posts ?? 0) +
                    (t.counts?.companies ?? 0) +
                    (t.counts?.people ?? 0) +
                    (t.counts?.local ?? 0);
                return (
                  <div key={t.id} className="space-y-4">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 border border-primary/25 px-3.5 py-2 text-sm text-foreground">
                        {t.text}
                      </div>
                    </div>
                    {t.results ? (
                      open ? (
                        <>
                          {/* Phase C: per-turn header at the TOP of its
                              results. Frozen turns: read-only label + counts.
                              Last turn: full control cluster. */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm min-w-0">
                              <span className="text-muted-foreground">Results for </span>
                              <span className="font-medium">"{t.text}"</span>
                              <span className="text-muted-foreground"> · {totals} results</span>
                            </div>
                            {isLast && (
                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                {specHasMore && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={specPending}
                                    onClick={() => {
                                      const tid = pendingTurnIdRef.current ?? "";
                                      const off = specOffsetRef.current[tid] ?? 0;
                                      void runSpecBranch(activeQuery ?? "", tid, {}, true, off).catch((e: Error) =>
                                        toast.error(friendlyErrorText(e, "Could not load more")),
                                      );
                                    }}
                                  >
                                    Show more
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={watchMut.isPending || !activeQuery}
                                  onClick={() => activeQuery && watchMut.mutate(activeQuery)}
                                >
                                  <Bell className="size-3 mr-1" /> Watch signal
                                </Button>
                                <ViewToggle view={viewMode} onChange={setViewMode} />
                                <button
                                  onClick={() => {
                                    // Clear resets the VIEW and rotates identity so the
                                    // cleared transcript can never overwrite history.
                                    // (Same as New chat minus the composer focus.)
                                    clearWorkspace();
                                    setTurns([]);
                                    setExpandedTurns({});
                                    setContactByKey({});
                                    setIntentByKey({});
                                    setIntentProgress(null);
                                    intentRunRef.current += 1;
                                    pendingTurnIdRef.current = null;
                                    pendingTurnAnswersRef.current = {};
                                    pendingFrameRef.current = null;
                                    setBrowserProgressRun(null);
                                    setBrowserProgressEvents([]);
                                    setStreamedMissing([]);
                                    rotateConversationId();
                                    setPlanTokens(null);
                                    setActiveQuery(null);
                                    setClarifyAnswers(null);
                                    setClarifyQs([]);
                                    setPendingQuery(null);
                                    setDefaultSummary("");
                                    setSpecHasMore(false);
                                  }}
                                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                                >
                                  <X className="size-3" /> Clear
                                </button>
                              </div>
                            )}
                          </div>
                          {isLast &&
                            (() => {
                              const bar = filterBarModel(specFilter);
                              if (!bar.visible) return null;
                              return (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {bar.modeLabel && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">
                                      {bar.modeLabel}
                                    </span>
                                  )}
                                  {bar.offerLabel && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">
                                      Offer: {bar.offerLabel}
                                    </span>
                                  )}
                                  {bar.filterState === "no-website-on" && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                                      No-website filter: ON
                                    </span>
                                  )}
                                  {bar.filterState === "stale-site-on" && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                                      Redesign targets: ON
                                    </span>
                                  )}
                                  {bar.filterState === "unset" && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
                                      Showing all — set site preference
                                    </span>
                                  )}
                                  {(bar.showSiteToggle || bar.filterState === "no-website-on") && (
                                    <button
                                      type="button"
                                      onClick={toggleSiteFilter}
                                      className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                    >
                                      {bar.filterState === "no-website-on"
                                        ? "Show all"
                                        : "No-website only"}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          <div>
                            <button
                              type="button"
                              onClick={() => setExpandedTurns((m) => ({ ...m, [t.id]: false }))}
                              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                            >
                              <ChevronUp className="size-3" /> Fold ({totals} results)
                            </button>
                          </div>
                          {renderResultSections(t.results, t.filter ?? null)}
                          {/* Turn-owned honest zero (Defect B): a settled turn
                              with an empty result set must say WHERE the search
                              stopped (enriched zero narrative), not just show a
                              bare "· 0 results" header. */}
                          {isLast &&
                            !runInFlight &&
                            clarifyQs.length === 0 &&
                            t.results.leads.length === 0 &&
                            t.results.companies.length === 0 &&
                            t.results.people.length === 0 &&
                            t.results.local.length === 0 && (
                              <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground space-y-3">
                                <div className="text-foreground font-medium">
                                  {zeroNarrative
                                    ? zeroNarrative
                                    : `No verified matches found for "${displaySearchLabel(t.text)}" yet.`}
                                </div>
                                <div>
                                  Try broadening the search — remove a constraint, add a location, or search without a filter.
                                </div>
                              </div>
                            )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setExpandedTurns((m) => ({ ...m, [t.id]: true }))}
                          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        >
                          <ChevronDown className="size-3" /> Expand ({totals} results)
                        </button>
                      )
                    ) : null}
                    {t.counts && !t.results && (
                      <div className="text-xs text-muted-foreground">
                        {[
                          t.counts.people ? `${t.counts.people} people` : "",
                          t.counts.companies ? `${t.counts.companies} companies` : "",
                          t.counts.posts ? `${t.counts.posts} posts` : "",
                          t.counts.local ? `${t.counts.local} local` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No results"}{" "}
                        — run the search again to reload.
                      </div>
                    )}
                    {/* Phase B: thinking lives at the composer (single
                        unified sequence). Nothing narrates inside turns. */}
                  </div>
                );
              })}

              {/* Phase C: header + controls live per-turn above (controls move
                  with each turn). No standalone bottom header. */}

              {/* Phase C: filter bar lives per-turn above (with each turn's
                  controls). No standalone bottom bar. */}

              {/* Previous results must not sit under the clarifier or the
                  hunting steps — that was the reported bug. */}
              {/* Single unified feed: every non-empty section stacks, no tabs.
                  Once the owning turn has its results, the turn render above
                  shows them — the live feed hides to avoid duplicate groups. */}
              {intentProgress && (
                <div className="text-xs text-muted-foreground pb-1">
                  Checking evidence {intentProgress.done}/{intentProgress.total}…
                </div>
              )}
              {clarifyQs.length === 0 &&
                !false &&
                !specPending &&
                !turns[turns.length - 1]?.results &&
                renderResultSections(
                  {
                    people: shownPeople,
                    companies: shownCompanies,
                    leads: shownLeads,
                    local: localRows,
                  },
                  specFilter,
                )}

              {/* `activeQuery` is set the moment the clarifier opens (so the
                  header reads correctly), which made this empty-state render
                  UNDER the questions — telling the user nothing was found before
                  the search had even run. No results box while clarifying. */}
              {!false &&
                !specPending &&
                !runInFlight &&
                clarifyQs.length === 0 &&
                !turns[turns.length - 1]?.results &&
                activeQuery &&
                leads.length === 0 &&
                companies.length === 0 &&
                people.length === 0 &&
                localRows.length === 0 && (
                  <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground space-y-3">
                    <div className="text-foreground font-medium">
                      {activeVertical === "local"
                        ? `No local businesses found for "${displaySearchLabel(activeQuery)}".`
                        : zeroNarrative
                          ? zeroNarrative
                          : `No verified matches found for "${displaySearchLabel(activeQuery)}" yet.`}
                    </div>
                    {activeVertical === "local" && (
                      <div>
                        We scanned the local business database and live directories for that place.
                        Try a nearby larger city, or check the spelling of the town.
                      </div>
                    )}
                    {activeVertical !== "local" && (
                      <div>Try broadening the search — remove a constraint, add a location, or search without a filter.</div>
                    )}
                    {suggestions.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-foreground text-xs font-medium">
                          Try these related searches:
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {suggestions.map((s, si) => (
                            <button
                              key={`${s}-${si}`}
                              type="button"
                              onClick={() => void beginSearch(s)}
                              className="inline-flex items-center px-3 py-1.5 rounded-full border border-border hover:bg-accent text-foreground text-xs"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => composerRef.current?.focus()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border hover:bg-accent text-foreground text-xs"
                    >
                      Try a broader search
                    </button>
                  </div>
                )}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col px-4 md:px-6 pb-4 md:pb-6 pt-2">
          <div className="max-w-3xl mx-auto w-full" data-tour="composer">
            {/* WS3: project chips above the composer — hidden when the user
                has no projects; clicking opens the project page. */}
            <ProjectChipsRow />
            {/* Phase B: unified thinking sequence (replaces SearchingPlan +
                SearchingSteps). One composer-attached narration derived from
                live query/tokens/entity — never fixed ladders. */}
            {(clarifyQs.length > 0 || false || specPending) && (
              <div className="mb-2 rounded-2xl border border-border bg-card p-4 space-y-1.5">
                <ThinkingSteps
                  inputKey={pendingQuery ?? activeQuery ?? "idle"}
                  input={{
                    query: pendingQuery ?? activeQuery ?? "",
                    tokens: planTokens,
                    // While a search runs, specEntity is the PREVIOUS turn's
                    // entity — narrating it mislabels the running query (a
                    // jobs hunt would say "businesses"). Pending narration
                    // uses the live tokenizer slots only; the confirmed
                    // entity label appears once the turn settles.
                    entityLabel:
                      false || specPending
                        ? null
                        : specEntity === "business"
                          ? "businesses"
                          : specEntity === "company"
                            ? "companies"
                            : specEntity === "person"
                              ? "people"
                              : activeVertical === "local"
                                ? "local businesses"
                                : (activeVertical ?? null),
                  }}
                  pending={false || specPending}
                  compact={planDone}
                  onDone={() => setPlanDone(true)}
                />
                {/* E2E-C14 stop control: the composer button is now the single
                    stop affordance (PRD V2 WS5) — it sits in the stable footer,
                    holds one position during browsing and is always clickable.
                    The old floating pill is removed; the accessible name
                    "Stop search" is preserved for the cancel harness. */}
                {browserProgressEvents.length > 0 && (
                  <div className={`mt-2 border-t border-border pt-2 space-y-1 ${activityExpanded ? "max-h-44 overflow-y-auto" : ""}`} aria-live="polite" aria-label="Live research activity">
                    {(activityExpanded
                      ? browserProgressEvents
                      : browserProgressEvents.slice(-3)
                    ).map((event) => (
                      <div key={event.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-primary shrink-0" />
                        <span>
                          {event.action}{event.source ? ` · ${event.source}` : ""}
                          {event.count != null ? ` · ${event.count}` : event.detail ? ` · ${event.detail}` : ""}
                        </span>
                      </div>
                    ))}
                    {browserProgressEvents.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setActivityExpanded((v) => !v)}
                        className="text-left text-[11px] text-primary/80 hover:text-primary"
                      >
                        {activityExpanded
                          ? "Show less"
                          : `Show all activity (${browserProgressEvents.length})`}
                      </button>
                    )}
                    {(() => {
                      // C10 honesty: the ✓ section shows only rows that passed
                      // the strict verification; provisional finds appear as
                      // plain activity lines above instead of claiming a check.
                      const verifiedEvents = browserProgressEvents.filter(
                        (event) => event.row && event.row.rowStatus !== "provisional",
                      );
                      if (verifiedEvents.length === 0) return null;
                      return (
                        <div className="space-y-0.5 pt-1" aria-live="polite" aria-label="Verified while researching">
                          {verifiedEvents.slice(-4).map((event) => (
                            <div key={`v${event.id}`} className="flex items-center gap-2 text-xs text-emerald-400/90">
                              <span>✓</span>
                              <span className="truncate">
                                {event.row?.title}
                                {event.row?.email || event.row?.phone
                                  ? ` · ${event.row.email ?? event.row.phone}`
                                  : ""}
                              </span>
                            </div>
                          ))}
                          <div className="text-[11px] text-muted-foreground">
                            {verifiedEvents.length} verified while researching…
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
            {/* One mini-browser instance for the run: it stays mounted after
                the search settles so a kept-open session remains viewable
                and controllable (it renders nothing when the run used no
                browser). */}
            <ScrapyBrowser runId={browserProgressRun} />
            {!specPending && !false && streamedMissing.length > 0 && (
              <StreamedReconciliationNote items={streamedMissing} />
            )}
            {/* Clarifying questions as an attached dropdown above the input —
                never inside the results flow. Collapsible; reopens per round.
                BUG-09 (PRD §30–31): the open body is self-bounded (max-h + its
                own scroll) so a long question set can never push the composer
                off a 1366×768-class footer. */}
            {(clarifyQs.length > 0 || confirmSummary) && planDone && !false && !specPending && (
              <div className="mb-2 flex flex-col overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-xl">
                <button
                  type="button"
                  onClick={() => setQuestionsOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 px-4 pt-3 pb-2 text-left"
                  aria-expanded={questionsOpen}
                >
                  <span className="text-xs font-medium text-primary">
                    {clarifyQs.length > 0 ? (
                      <>
                        Narrow this down
                        <span className="ml-1 text-muted-foreground">
                          {clarifyQs.length} question{clarifyQs.length === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : (
                      "Here is what I understood"
                    )}
                  </span>
                  {questionsOpen ? (
                    <ChevronUp className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  )}
                </button>
                {questionsOpen && (
                  <div className="max-h-[40vh] min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
                    <ClarifyPanel
                      questions={clarifyQs}
                      confirmSummary={confirmSummary}
                      refinement={defaultSummary || refinement}
                      disabled={false || specPending}
                      onDismiss={() => {
                        setClarifyQs([]);
                        const q = pendingQuery;
                        setPendingQuery(null);
                        // Stage-1 CONFIRM card "Edit": let the user restate the
                        // request — a new submit re-runs understanding. Never
                        // force-run a search they asked to edit.
                        if (confirmSummary && clarifyQs.length === 0) {
                          setConfirmSummary(null);
                          if (q) setInput(q);
                          composerRef.current?.focus();
                          return;
                        }
                        setConfirmSummary(null);
                        if (!q) return;
                        {
                          void runSpecBranch(q, pendingTurnIdRef.current ?? "", {}, true).catch(
                            (e: Error) =>
                              toast.error(friendlyErrorText(e, "Search failed to start")),
                          );
                          return;
                        }
                      }}
                      onApply={(answers, opts) => {
                        setClarifyAnswers(answers);
                        setClarifyQs([]);
                        const hadConfirm = !!confirmSummary;
                        setConfirmSummary(null);
                        const q = pendingQuery ?? activeQuery;
                        setPendingQuery(null);
                        if (!q) return;
                        {
                          // Spec path: answers merge as stated criteria.
                          // Search/Search-with-defaults buttons force the
                          // hunt with stated answers; option picks flow on.
                          // A shown CONFIRM card records acceptance so the
                          // gate never re-fires on this frame.
                          void runSpecBranch(
                            q,
                            pendingTurnIdRef.current ?? "",
                            {
                              ...(hadConfirm ? { confirm: "confirmed" } : {}),
                              ...specAnswersFromPanel(answers),
                            },
                            opts?.force ?? false,
                          ).catch((e: Error) =>
                            toast.error(friendlyErrorText(e, "Search failed to start")),
                          );
                          return;
                        }
                        // Pass clarify into mutate vars — do not rely on setState timing.
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            <UnifiedComposer
              ref={composerRef}
              value={input}
              onChange={setInput}
              mode={mode}
              onModeChange={(m) => {
                setMode(m);
                if (m === "chat") setChatOpen(true);
              }}
              onSubmit={onSubmit}
              onSubmitAttachments={(atts) => {
                pendingAttachmentsRef.current = atts;
              }}
              onStop={stopSearch}
              pending={pending}
              tier={tier}
              onTierChange={setTier}
              thinker={thinker}
              onThinkerChange={setThinker}
            />
            {/* Build footer tag removed (Phase B) — stamp logs to console. */}
          </div>
        </div>
      </div>

      {selected && (
        <div className="hidden md:block w-[420px] border-l border-border shrink-0 bg-card overflow-y-auto">
          <LeadDetailPanel
            lead={selected}
            saved={savedByUrl.get(selected.full_post_url)}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
      {selectedEntity && !selected && (
        <div className="hidden md:block w-[420px] border-l border-border shrink-0 bg-card overflow-y-auto">
          <EntityDetailPanel
            entity={selectedEntity}
            onClose={() => setSelectedEntity(null)}
            contact={entityContactKey ? contactByKey[entityContactKey] : undefined}
            contactBusy={!!entityContactKey && contactBusyKey === entityContactKey}
            onResolveContact={resolveSelectedEntityContact}
            onGenerate={(kind) => openGenerateForEntity(kind)}
            evidence={intentEvidenceFor(selectedEntityKey)}
          />
        </div>
      )}
      <Sheet
        open={(!!selected || !!selectedEntity) && isMobile}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            setSelectedEntity(null);
          }
        }}
      >
        <SheetContent side="right" className="p-0 w-full sm:max-w-md bg-card overflow-y-auto">
          <SheetTitle className="sr-only">Details</SheetTitle>
          {selected ? (
            <LeadDetailPanel
              lead={selected}
              saved={savedByUrl.get(selected.full_post_url)}
              onClose={() => setSelected(null)}
            />
          ) : selectedEntity ? (
            <EntityDetailPanel
              entity={selectedEntity}
              onClose={() => setSelectedEntity(null)}
              contact={entityContactKey ? contactByKey[entityContactKey] : undefined}
              contactBusy={!!entityContactKey && contactBusyKey === entityContactKey}
              onResolveContact={resolveSelectedEntityContact}
              onGenerate={(kind) => openGenerateForEntity(kind)}
              evidence={intentEvidenceFor(selectedEntityKey)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      {showTour && <GuidedTour userId={userId} onDone={() => setTourSeen(true)} />}
      {genTarget && (
        <GenerateModal
          lead={{
            vertical: genTarget.vertical,
            name: genTarget.name,
            firm: genTarget.firm,
            role: genTarget.role,
            location: genTarget.location,
            whyMatch: genTarget.whyMatch,
            whyNow: genTarget.whyNow,
            platform: genTarget.platform,
            category: genTarget.category,
            address: genTarget.address,
            noWebsite: genTarget.noWebsite,
            seoPoor: genTarget.seoPoor,
          }}
          kind={genTarget.kind}
          sender={{
            name: greetingName || undefined,
            service: activeProject?.service ?? undefined,
            stage: genTarget.investorStage,
            sector: genTarget.investorSector,
          }}
          toEmail={genTarget.email}
          onClose={() => setGenTarget(null)}
        />
      )}
    </div>
  );
}
