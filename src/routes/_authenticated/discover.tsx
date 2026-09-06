import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { buildProjectQuery } from "@/lib/project-query";
import { displaySearchLabel, scrapyAckReply, toPlainSearchQuery } from "@/lib/display-query";
import { runSearch, getRemainingSearches } from "@/lib/search.functions";
import { aiChat } from "@/lib/ai-chat.functions";
import { prepareDynamicQuestions } from "@/lib/search/clarify-ai.functions";
import { saveLead, listSavedLeads } from "@/lib/leads.functions";
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
import { LeadDetailPanel } from "@/components/lead-detail-panel";
import { DiscoverWelcomeHero } from "@/components/discover/discover-welcome-hero";

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
  LocalListRows,
  type ResolvedContactInfo,
} from "@/components/discover/result-tabs";
import { EntityDetailPanel, type SelectedEntity } from "@/components/discover/entity-detail-panel";
import { GenerateModal } from "@/components/discover/generate-modal";
import { Bell, Plus, X } from "lucide-react";
import { SearchingSteps } from "@/components/discover/searching-steps";
import { SearchingPlan } from "@/components/discover/searching-plan";
import { ClarifyPanel } from "@/components/discover/clarify-panel";
import type { ClarifyQuestion, ClarifyAnswers } from "@/lib/search/clarifier";
import { resolveSearchVertical } from "@/lib/search/vertical";
import { friendlyErrorText } from "@/lib/friendly-error";
import { type ChatTurn } from "@/components/discover/scrapy-chat-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { mySupabase } from "@/integrations/my-supabase/client";

export const Route = createFileRoute("/_authenticated/discover")({
  validateSearch: (search: Record<string, unknown>): { q?: string; fresh?: number } => ({
    q: typeof search.q === "string" ? search.q : undefined,
    fresh: typeof search.fresh === "number" ? search.fresh : undefined,
  }),
  head: () => ({
    meta: [{ title: "Scrapivo — Discover" }],
  }),
  component: DiscoverPage,
});

function DiscoverPage() {
  const { userId } = AuthRoute.useRouteContext();
  const routeSearch = Route.useSearch();
  const qc = useQueryClient();
  const search = useServerFn(runSearch);
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
  const askDynamicQuestions = useServerFn(prepareDynamicQuestions);

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
  const [queryType, setQueryType] = useState<string | null>(null);
  // Clarifying-question flow. Questions are computed BEFORE the search runs and
  // hold it until answered or skipped — see beginSearch. (They used to arrive
  // alongside results, which meant the first search was always the unrefined
  // one; the comment outlived the behaviour.)
  const [clarifyQs, setClarifyQs] = useState<ClarifyQuestion[]>([]);
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
  };
  /** Turns older than this collapse to bubble + counts (memory/DOM cost). */
  const KEEP_FULL_TURNS = 4;
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [planTokens, setPlanTokens] = useState<
    import("@/lib/search/tokenize-input").InputTokens | null
  >(null);
  // Questions mount only after the plan has revealed (min 2 lines) — never beside it.
  const [planDone, setPlanDone] = useState(false);
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
    setTurns([]);
    setPlanTokens(null);
    setActiveQuery(null);
    setClarifyAnswers(null);
    setClarifyQs([]);
    setPendingQuery(null);
    setDefaultSummary("");
    composerRef.current?.focus();
  };

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

  const runSearchMut = useMutation({
    mutationFn: async (vars: string | { query: string; clarify?: ClarifyAnswers | null }) => {
      const q = typeof vars === "string" ? vars : vars.query;
      const clarify = typeof vars === "string" ? clarifyAnswers : (vars.clarify ?? clarifyAnswers);
      const plain = toPlainSearchQuery(q) || q.trim();
      return search({
        data: {
          query: plain,
          context: searchContext,
          ...(clarify ? { clarify } : {}),
          tier,
          thinker,
        },
      });
    },
    onSuccess: (res, vars) => {
      if (res.error === "limit") {
        toast.error(res.message ?? "Search limit reached");
        return;
      }
      const q = typeof vars === "string" ? vars : vars.query;
      // Empty [] is truthy for ?? — fall back to ranked leads when posts is empty
      // so Discover never paints a blank wall while Companies/People have rows.
      const rawPosts = (res.posts as Lead[] | undefined) ?? [];
      const rawLeads = (res.leads as Lead[] | undefined) ?? [];
      const posts = rawPosts.length > 0 ? rawPosts : rawLeads;
      const cos = (res.companies as CompanyRow[]) ?? [];
      const ppl = (res.people as PersonRow[]) ?? [];
      const locs = (res.local as LocalBusinessRow[] | undefined) ?? [];
      setLeads(posts);
      setCompanies(cos);
      setPeople(ppl);
      setLocalRows(locs);
      // Seed known contacts so Show contact isn't needed to see them. Honest
      // provenance only — no "in database" framing, just the state of the
      // email/phone we already hold.
      const seeded: Record<string, ResolvedContactInfo> = {};
      for (const c of cos) {
        const email = c.inline_contacts?.emails?.[0];
        const phone = c.inline_contacts?.phones?.[0];
        if (email || phone) {
          const fromDb = (c.platforms ?? []).includes("Investors");
          seeded[`co:${c.key}`] = {
            email,
            phone,
            note: fromDb ? "Verified contact" : "Published in post",
            status: "ok",
          };
        }
      }
      for (const p of ppl) {
        const email = p.inline_contacts?.emails?.[0];
        const phone = p.inline_contacts?.phones?.[0];
        if (email || phone) {
          const fromDb = p.lead.source === "investors";
          seeded[p.key] = {
            email,
            phone,
            note: fromDb ? "Verified contact" : "Published in post",
            status: "ok",
          };
        }
      }
      // MERGE (not replace): frozen turns keep rendering their seeded
      // contacts; the map is global and keyed by row key.
      setContactByKey((m) => ({ ...m, ...seeded }));
      setSelected(null);
      setSelectedEntity(null);
      setActiveQuery(q);
      setSuggestions(res.suggestions ?? []);
      setQueryType(res.queryType ?? null);
      setRefinement((res as { refinement?: string }).refinement ?? "");
      qc.invalidateQueries({ queryKey: ["usage"] });
      qc.invalidateQueries({ queryKey: ["history"] });
      const serverMessage = (res as { message?: string | null }).message;
      if (serverMessage) {
        toast.info(serverMessage);
      } else if (!posts.length && !cos.length && !ppl.length) {
        toast.info("No buyer-signal posts found. Try a different angle.");
      }
    },
    onError: (e: Error) => toast.error(friendlyErrorText(e)),
  });

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
    runSearchMut.mutate(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSearch, activeProject?.id]);

  // Auto-enrich the top results after each search — FREE waterfall only
  // (own crawler + public registries), sequential so the server isn't hammered.
  const autoResolvedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeQuery || runSearchMut.isPending) return;
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
  }, [activeQuery, companies, people, runSearchMut.isPending]);

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
  const clearWorkspace = () => {
    setLeads([]);
    setCompanies([]);
    setPeople([]);
    setLocalRows([]);
    // contactByKey is GLOBAL: frozen turns still render their seeded
    // contacts, so it's only wiped on a full conversation reset.
    setSelected(null);
    setSelectedEntity(null);
    setSuggestions([]);
    setQueryType(null);
    setRefinement("");
  };

  /**
   * Entry point for every user-initiated search. Classifies FIRST (cheap — no
   * source fan-out, no quota) and, when the query is vague, holds the search
   * until the clarifying questions are answered or skipped.
   *
   * Asking after results was the wrong order: the first search is then the
   * wrong one and the user watches it run before being asked to fix it.
   */
  // Deep-link + new-chat params: ?q= re-runs a history search, ?fresh=
  // resets to a clean conversation (fixes same-route navigate no-ops).
  const seenParamsRef = useRef("");
  useEffect(() => {
    const key = `${routeSearch.q ?? ""}|${routeSearch.fresh ?? ""}`;
    if (!key || seenParamsRef.current === key) return;
    seenParamsRef.current = key;
    if (routeSearch.fresh) {
      resetConversation();
    } else if (routeSearch.q && routeSearch.q.trim() && routeSearch.q.trim() !== activeQuery) {
      void beginSearch(routeSearch.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- param-driven entry only
  }, [routeSearch.q, routeSearch.fresh]);

  // Auto-scroll: the echoed user bubble and new panels come into view the
  // frame they appear, matching ChatGPT-style conversation behavior.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [turns.length, clarifyQs.length, runSearchMut.isPending]);

  const beginSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    // User bubble first: the submitted text lives in the conversation from
    // this instant, independent of whatever happens downstream. The PREVIOUS
    // turn's workspace is frozen into its own record first — that's what
    // keeps earlier inputs showing their outputs (ChatGPT-style transcript).
    setTurns((prev) => {
      const withSnapshot = prev.map((t, i) => {
        if (i !== prev.length - 1 || t.results) return t;
        const hasRows = leads.length > 0 || companies.length > 0 || people.length > 0 || localRows.length > 0;
        if (!hasRows) return t;
        return {
          ...t,
          results: {
            leads: [...leads],
            companies: [...companies],
            people: [...people],
            local: [...localRows],
          },
        };
      });
      // Collapse: keep the last KEEP_FULL_TURNS turns' results in memory.
      const appended = [...withSnapshot, { id: turnId(), text: trimmed }];
      const keepFrom = appended.length - KEEP_FULL_TURNS;
      return appended.map((t, i) => {
        if (i >= keepFrom || !t.results) return t;
        return {
          ...t,
          results: undefined,
          counts: {
            posts: t.results.leads.length,
            companies: t.results.companies.length,
            people: t.results.people.length,
            local: t.results.local.length,
          },
        };
      });
    });
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
    try {
      const plain = toPlainSearchQuery(trimmed) || trimmed;
      const [{ classifyQuery }, clarifier, { tokenizeInput }, { resolveSearchVertical }] =
        await Promise.all([
          import("@/lib/search/query-classifier"),
          import("@/lib/search/clarifier"),
          import("@/lib/search/tokenize-input"),
          import("@/lib/search/vertical"),
        ]);
      // Canonical vertical from the SAME resolver the server routes with —
      // narration and pipeline can never disagree ("investor" category must
      // win even when the hunt regex misses filler like "find ME investors").
      setActiveVertical(resolveSearchVertical(trimmed));
      const tokens = tokenizeInput(plain);
      setPlanTokens(tokens);
      const classified = classifyQuery(plain);
      if (clarifier.shouldClarify(classified)) {
        // Dynamic AI questions first (per-input, memory-aware), hardcoded as fallback.
        // Server-fn call — never import `.server` modules from this client
        // component (their node builtins break the browser bundle / Vercel build).
        // Deterministic tokens travel along as un-overridable facts.
        let questions: ClarifyQuestion[] = [];
        try {
          const res = await askDynamicQuestions({
            data: {
              query: plain,
              tokens,
              thinker,
              memory: {
                service: searchContext?.service ?? null,
                niche: searchContext?.niche ?? null,
                location: searchContext?.location ?? null,
                audience: searchContext?.audience ?? null,
                goal: searchContext?.goal ?? null,
                experience_level: searchContext?.experience_level ?? null,
                work_style: searchContext?.work_style ?? null,
                website: searchContext?.website ?? null,
                about_doc: searchContext?.about_doc?.slice(0, 1200) ?? null,
              },
            },
          });
          questions = (res.questions ?? []) as ClarifyQuestion[];
        } catch (e) {
          console.warn("[discover] dynamic questions failed, using fallback", e);
        }
        if (!questions.length) {
          questions = clarifier.buildClarifyingQuestions(classified, {
            hasLocation: !!classified.location || !!searchContext?.location,
            known: {
              stage: tokens.stage,
              sector: tokens.sector,
              geo: tokens.geo ?? searchContext?.location ?? null,
            },
            niche: searchContext?.niche ?? null,
          }) as ClarifyQuestion[];
        }
        // Empty question list = nothing left to ask (all dims inferred).
        if (questions.length) {
          setPendingQuery(trimmed);
          setPlanDone(false);
          setClarifyQs(questions as ClarifyQuestion[]);
          setDefaultSummary(clarifier.applyClarifyAnswers(classified, {}).summary ?? "");
          setActiveQuery(trimmed);
          return;
        }
      }
    } catch (err) {
      // Still never block the search — but say so, rather than vanishing.
      console.error("[discover] clarifier failed; searching without it", err);
    }
    setActiveQuery(trimmed);
    runSearchMut.mutate(trimmed);
  };

  const onSubmit = () => {
    const text = input.trim();
    if (!text) return;
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

  const pending = runSearchMut.isPending || chatMut.isPending;
  const hasResults = leads.length > 0 || activeQuery !== null;
  // A submitted turn starts the conversation instantly: the echoed user
  // bubble renders on the next frame, never held until the clarifier
  // round-trip finishes (ChatGPT-style echo).
  const idle = !hasResults && !runSearchMut.isPending && turns.length === 0;
  const showHero = idle;

  /** One full result feed (People → Companies → Posts → Local) — rendered for
   *  the active workspace AND for frozen transcript turns. */
  const renderResultSections = (rows: {
    leads: Lead[];
    companies: CompanyRow[];
    people: PersonRow[];
    local: LocalBusinessRow[];
  }) => (
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
              onGenerate={(row, kind) =>
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
                })
              }
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
            <LocalListRows
              rows={rows.local}
              onOpen={(row) => {
                setSelected(null);
                setSelectedEntity({ type: "local", local: row });
              }}
              onGenerate={openGenerateForLocal}
            />
          ) : (
            <LocalBusinessesGrid
              rows={rows.local}
              onOpen={(row) => {
                setSelected(null);
                setSelectedEntity({ type: "local", local: row });
              }}
              onGenerate={openGenerateForLocal}
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
              <DiscoverWelcomeHero greetingName={greetingName || undefined} />
            </div>
          ) : (
            <div className="max-w-4xl mx-auto py-4 md:py-6 space-y-5 md:space-y-6">
              {/* Conversation transcript: each turn = user bubble + its own
                  frozen results (or a collapsed count line for old turns).
                  The ACTIVE turn's live workspace renders below the map. */}
              {turns.map((t, i) => {
                const isLast = i === turns.length - 1;
                return (
                  <div key={t.id} className="space-y-4">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 border border-primary/25 px-3.5 py-2 text-sm text-foreground">
                        {t.text}
                      </div>
                    </div>
                    {t.results && renderResultSections(t.results)}
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
                    {isLast && clarifyQs.length > 0 && !runSearchMut.isPending && (
                      <SearchingPlan
                        key={`plan-${pendingQuery ?? activeQuery ?? "idle"}`}
                        tokens={planTokens}
                        vertical={activeVertical ?? "general"}
                        onDone={() => setPlanDone(true)}
                      />
                    )}
                    {isLast &&
                      clarifyQs.length > 0 &&
                      planDone &&
                      !runSearchMut.isPending && (
                        <ClarifyPanel
                          questions={clarifyQs}
                          refinement={defaultSummary || refinement}
                          disabled={runSearchMut.isPending}
                          onDismiss={() => {
                            setClarifyQs([]);
                            const q = pendingQuery;
                            setPendingQuery(null);
                            if (q) runSearchMut.mutate({ query: q, clarify: null });
                          }}
                          onApply={(answers) => {
                            setClarifyAnswers(answers);
                            setClarifyQs([]);
                            const q = pendingQuery ?? activeQuery;
                            setPendingQuery(null);
                            // Pass clarify into mutate vars — do not rely on setState timing.
                            if (q) runSearchMut.mutate({ query: q, clarify: answers });
                          }}
                        />
                      )}
                    {isLast && runSearchMut.isPending && (
                      <SearchingSteps
                        query={displaySearchLabel(
                          (typeof runSearchMut.variables === "string"
                            ? runSearchMut.variables
                            : runSearchMut.variables?.query) ??
                            activeQuery ??
                            "",
                        )}
                        goal={searchContext?.goal}
                        audience={searchContext?.audience}
                        vertical={activeVertical}
                      />
                    )}
                  </div>
                );
              })}

              {/* Active-turn header: watch/clear + Cards|Lists for the live
                  workspace (frozen turns render read-only above). */}
              {activeQuery &&
                clarifyQs.length === 0 &&
                !runSearchMut.isPending &&
                (leads.length > 0 || companies.length > 0 || people.length > 0) && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm min-w-0">
                      <span className="text-muted-foreground">Results for </span>
                      <span className="font-medium">"{displaySearchLabel(activeQuery)}"</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={watchMut.isPending}
                        onClick={() => watchMut.mutate(activeQuery)}
                      >
                        <Bell className="size-3 mr-1" /> Watch signal
                      </Button>
                      <button
                        onClick={() => {
                          clearWorkspace();
                          setTurns([]);
                          setPlanTokens(null);
                          setActiveQuery(null);
                          setClarifyAnswers(null);
                          setClarifyQs([]);
                          setPendingQuery(null);
                          setDefaultSummary("");
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        <X className="size-3" /> Clear
                      </button>
                    </div>
                  </div>
                )}

              {activeQuery &&
                clarifyQs.length === 0 &&
                !runSearchMut.isPending &&
                (leads.length > 0 ||
                  companies.length > 0 ||
                  people.length > 0 ||
                  localRows.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="ml-auto">
                      <ViewToggle view={viewMode} onChange={setViewMode} />
                    </div>
                  </div>
                )}

              {/* Previous results must not sit under the clarifier or the
                  hunting steps — that was the reported bug. */}
              {/* Single unified feed: every non-empty section stacks, no tabs. */}
              {clarifyQs.length === 0 && !runSearchMut.isPending &&
                renderResultSections({
                  people: shownPeople,
                  companies: shownCompanies,
                  leads: shownLeads,
                  local: localRows,
                })}

                          {/* `activeQuery` is set the moment the clarifier opens (so the
                  header reads correctly), which made this empty-state render
                  UNDER the questions — telling the user nothing was found before
                  the search had even run. No results box while clarifying. */}
              {!runSearchMut.isPending &&
                clarifyQs.length === 0 &&
                activeQuery &&
                leads.length === 0 &&
                companies.length === 0 &&
                people.length === 0 &&
                localRows.length === 0 && (
                  <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground space-y-3">
                    <div className="text-foreground font-medium">
                      {activeVertical === "local"
                        ? `No local businesses found for "${displaySearchLabel(activeQuery)}".`
                        : queryType === "product"
                          ? `No fresh public asks for a tool like "${displaySearchLabel(activeQuery)}" in the last day or two.`
                          : `No fresh buyer-intent posts for "${displaySearchLabel(activeQuery)}" in the last day or two.`}
                    </div>
                    {activeVertical === "local" && (
                      <div>
                        We scanned the local business database and live directories for that
                        place. Try a nearby larger city, or check the spelling of the town.
                      </div>
                    )}
                    {activeVertical !== "local" && (
                      <div>
                        {queryType === "product"
                          ? "We look for posts where people recommend, compare, or ask for tools like yours."
                          : "This means:"}
                      </div>
                    )}
                    {activeVertical !== "local" && queryType !== "product" && (
                      <ul className="list-disc pl-5 space-y-1">
                        <li>
                          No one posted publicly asking for this in the last few hours to two days.
                        </li>
                        <li>Try again shortly — new posts appear constantly.</li>
                        <li>Try broader terms (e.g. "developer" instead of "React developer").</li>
                      </ul>
                    )}
                    {suggestions.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-foreground text-xs font-medium">
                          Try these related searches:
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {suggestions.map((s) => (
                            <button
                              key={s}
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

        <div className="px-4 md:px-6 pb-4 md:pb-6 pt-2">
          <div className="max-w-3xl mx-auto" data-tour="composer">
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
              pending={pending}
              tier={tier}
              onTierChange={setTier}
              thinker={thinker}
              onThinkerChange={setThinker}
            />
          </div>
        </div>
      </div>

      {selected && (
        <div className="hidden lg:block w-[420px] border-l border-border shrink-0 bg-card overflow-y-auto">
          <LeadDetailPanel
            lead={selected}
            saved={savedByUrl.get(selected.full_post_url)}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
      {selectedEntity && !selected && (
        <div className="hidden lg:block w-[420px] border-l border-border shrink-0 bg-card overflow-y-auto">
          <EntityDetailPanel
            entity={selectedEntity}
            onClose={() => setSelectedEntity(null)}
            contact={entityContactKey ? contactByKey[entityContactKey] : undefined}
            contactBusy={!!entityContactKey && contactBusyKey === entityContactKey}
            onResolveContact={resolveSelectedEntityContact}
            onGenerate={(kind) => openGenerateForEntity(kind)}
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
