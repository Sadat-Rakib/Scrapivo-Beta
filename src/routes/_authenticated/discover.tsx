import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { buildProjectQuery } from "@/lib/project-query";
import { displaySearchLabel, scrapyAckReply, toPlainSearchQuery } from "@/lib/display-query";
import { runSearch, getRemainingSearches } from "@/lib/search.functions";
import { aiChat } from "@/lib/ai-chat.functions";
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
import type { Lead } from "@/lib/scoring";
import type { CompanyRow, PersonRow, LocalBusinessRow } from "@/lib/search/lead-segments";
import { LeadDetailPanel } from "@/components/lead-detail-panel";
import { DiscoverWelcomeHero } from "@/components/discover/discover-welcome-hero";

import {
  UnifiedComposer,
  type ComposerHandle,
  type ComposerMode,
} from "@/components/discover/unified-composer";
import { Route as AuthRoute } from "@/routes/_authenticated/route";
import {
  ResultTabPills,
  PostsGrid,
  CompanyCard,
  PersonCard,
  CompanyTable,
  PersonTable,
  ViewToggle,
  LocalBusinessesGrid,
  type ResultTab,
  type ResolvedContactInfo,
} from "@/components/discover/result-tabs";
import { EntityDetailPanel, type SelectedEntity } from "@/components/discover/entity-detail-panel";
import { Bell, Plus, X } from "lucide-react";
import { SearchingSteps } from "@/components/discover/searching-steps";
import { ClarifyPanel } from "@/components/discover/clarify-panel";
import type { ClarifyQuestion, ClarifyAnswers } from "@/lib/search/clarifier";
import { type ChatTurn } from "@/components/discover/scrapy-chat-panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { mySupabase } from "@/integrations/my-supabase/client";

export const Route = createFileRoute("/_authenticated/discover")({
  head: () => ({
    meta: [{ title: "Scrapivo — Discover" }],
  }),
  component: DiscoverPage,
});

function DiscoverPage() {
  const { userId } = AuthRoute.useRouteContext();
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

  const savedQuery = useQuery({ queryKey: ["saved-leads"], queryFn: () => getSaved() });
  const savedLeads = savedQuery.data ?? [];
  const savedByUrl = new Map<string, any>(savedLeads.map((l: any) => [l.full_post_url, l]));

  const profileQuery = useQuery({ queryKey: ["my-profile"], queryFn: () => getProfile() });
  const usageQuery = useQuery({ queryKey: ["usage"], queryFn: () => getUsage() });

  // ── Projects ("the 75% info") ────────────────────────────────────────────
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => getProjects() });
  const skipKey = `scrapivo:onboarding-skipped:${userId}`;
  const returnChatKey = `scrapivo:return-chat-asked:${userId}`;
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
      }
    : undefined;

  const markReturnChatAsked = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(returnChatKey, "1");
    }
  };

  const completeOnboarding = async (a: OnboardingAnswers) => {
    const payload = {
      name: `${a.business_name} — ${a.goal === "jobs" ? "jobs" : a.goal === "clients" ? "clients" : "leads"}`,
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
        toast.info("Saved on this device — apply the projects migration to sync across devices.");
      } else {
        qc.invalidateQueries({ queryKey: ["projects"] });
        toast.success("Project saved — searches now start from this context");
      }
      markReturnChatAsked();
    } catch (e: any) {
      toast.error(e?.message || "Could not save project");
    } finally {
      setWizardOpen(false);
      setPendingAutoSearch(true);
    }
  };

  // 24h = real posted_at within 24 hours only.
  // All = no UI age cut.
  const [freshness, setFreshness] = useState<"all" | "24h">("all");
  const inWindow = (l: {
    posted_at?: string;
    freshness_window?: string;
    full_post_url?: string;
    source?: string;
  }) => {
    if (freshness === "all") return true;
    const maxMs = 86_400_000;
    if (l.posted_at) {
      const t = new Date(l.posted_at).getTime();
      return Number.isFinite(t) && Date.now() - t <= maxMs;
    }
    // 24h never trusts undated posts.
    return false;
  };

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ComposerMode>("search");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [localRows, setLocalRows] = useState<LocalBusinessRow[]>([]);
  const [resultTab, setResultTab] = useState<ResultTab>("posts");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
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
  const [contactBusyKey, setContactBusyKey] = useState<string | null>(null);
  const [contactByKey, setContactByKey] = useState<Record<string, ResolvedContactInfo>>({});
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

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
    } catch (e: any) {
      toast.error(e?.message || "Contact resolve failed");
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

  const entityContactKey = selectedEntity
    ? selectedEntity.type === "company"
      ? `co:${selectedEntity.company.key}`
      : selectedEntity.person.key
    : null;
  const resolveSelectedEntityContact = () => {
    if (!selectedEntity) return;
    if (selectedEntity.type === "company") void resolveCompanyContact(selectedEntity.company);
    else void resolvePersonContact(selectedEntity.person);
  };
  const deepEnrichSelectedEntity = () => {
    if (!selectedEntity) return;
    if (selectedEntity.type === "company") {
      void resolveCompanyContact(selectedEntity.company, false, true);
    } else {
      void resolvePersonContact(selectedEntity.person, false, true);
    }
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

  const shownLeads = freshness === "all" ? leads : leads.filter((l) => inWindow(l));

  // The chip scopes the POSTS feed, not the entity tabs.
  //
  // Companies and People answer "who is worth contacting", and that does not
  // expire on the same clock as a forum thread: a role opened four days ago is
  // still open. Applying the freshness chip here emptied both tabs (ATS caps at 7d).
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
      // Seed published in-post contacts so Resolve isn't required to see them.
      const seeded: Record<string, ResolvedContactInfo> = {};
      for (const c of cos) {
        const email = c.inline_contacts?.emails?.[0];
        const phone = c.inline_contacts?.phones?.[0];
        if (email || phone) {
          seeded[`co:${c.key}`] = {
            email,
            phone,
            note: "Published in post",
            verifyNote: "In-post (highest trust)",
            status: "ok",
          };
        }
      }
      for (const p of ppl) {
        const email = p.inline_contacts?.emails?.[0];
        const phone = p.inline_contacts?.phones?.[0];
        if (email || phone) {
          seeded[p.key] = {
            email,
            phone,
            note: "Published in post",
            verifyNote: "In-post (highest trust)",
            status: "ok",
          };
        }
      }
      setContactByKey(seeded);
      setSelected(null);
      setSelectedEntity(null);
      const aud = searchContext?.audience;
      setResultTab(
        aud === "people"
          ? "people"
          : aud === "companies" || aud === "agencies"
            ? "companies"
            : "posts",
      );
      setActiveQuery(q);
      setSuggestions(res.suggestions ?? []);
      setQueryType(res.queryType ?? null);
      setRefinement((res as { refinement?: string }).refinement ?? "");
      qc.invalidateQueries({ queryKey: ["usage"] });
      if (!posts.length && !cos.length && !ppl.length) {
        toast.info("No buyer-signal posts found. Try a different angle.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const chatMut = useMutation({
    mutationFn: async (messages: ChatTurn[]) => chat({ data: { messages } }),
    onSuccess: (res) => {
      const cleaned = res.content.replace(/\s*SEARCH:.*$/m, "").trim();
      setChatLog((m) => [...m, { role: "assistant", content: scrapyAckReply(cleaned) }]);
      if (res.query) {
        const q = toPlainSearchQuery(res.query) || res.query;
        toast.success("On it — searching now");
        // Through beginSearch, so a search Scrapy starts from the chat gets the
        // same clarifier a typed one does. Calling the mutation directly here
        // was a second way to reach results with the questions skipped.
        setTimeout(() => void beginSearch(q), 200);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMut = useMutation({
    mutationFn: async (lead: Lead) => save({ data: lead as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-leads"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const watchMut = useMutation({
    mutationFn: async (q: string) => createWatch({ data: { query: q, schedule: "daily" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-watches"] });
      toast.success("Signal watch saved — see Watches in the sidebar");
    },
    onError: (e: Error) => toast.error(e.message),
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
    setContactByKey({});
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
  const beginSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
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
      const [{ classifyQuery }, { shouldClarify, buildClarifyingQuestions, applyClarifyAnswers }] =
        await Promise.all([
          import("@/lib/search/query-classifier"),
          import("@/lib/search/clarifier"),
        ]);
      const classified = classifyQuery(plain);
      if (shouldClarify(classified)) {
        const questions = buildClarifyingQuestions(classified, {
          hasLocation: !!classified.location,
        });
        // Empty question list = nothing left to ask (all dims inferred).
        if (questions.length) {
          setPendingQuery(trimmed);
          setClarifyQs(questions as ClarifyQuestion[]);
          setDefaultSummary(applyClarifyAnswers(classified, {}).summary ?? "");
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
      void beginSearch(text);
      setInput("");
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
  const idle = !hasResults && !runSearchMut.isPending;
  const showHero = idle;

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
        : [{ role: "assistant", content: `Hey ${name} — what do you want to find now?` }],
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
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6">


          {showOnboarding ? (
            <div className="h-full flex items-center justify-center py-6 md:py-10">
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
            <div className="h-full flex items-center justify-center py-6 md:py-10">
              <DiscoverWelcomeHero
                greetingName={greetingName || undefined}
                onFocusComposer={() => {
                  setMode("search");
                  composerRef.current?.focus();
                }}
                onChooseChat={() => {
                  setChatOpen(true);
                  setMode("chat");
                }}
                projectQuery={
                  activeProject ? buildProjectQuery(activeProject) || undefined : undefined
                }
                onOpenWizard={() => setWizardOpen(true)}
                onFindLeads={
                  activeProject
                    ? () => {
                        const q = buildProjectQuery(activeProject);
                        if (!q) return;
                        setInput(q);
                        // "Find my leads" is a user-initiated search and must
                        // clarify like any other; it was going straight to the
                        // mutation and skipping the questions entirely.
                        void beginSearch(q);
                      }
                    : undefined
                }
              />
            </div>
          ) : (
            <div className="max-w-4xl mx-auto py-4 md:py-6 space-y-5 md:space-y-6">
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
                    <ResultTabPills
                      tab={resultTab}
                      onChange={setResultTab}
                      counts={{
                        posts: shownLeads.length,
                        companies: shownCompanies.length,
                        people: shownPeople.length,
                        local: localRows.length,
                      }}
                      visible={
                        searchContext?.audience === "people"
                          ? ["people"]
                          : searchContext?.audience === "companies" ||
                              searchContext?.audience === "agencies"
                            ? ["companies", "local"]
                            : undefined
                      }
                    />
                    {(resultTab === "companies" || resultTab === "people") && (
                      <ViewToggle view={viewMode} onChange={setViewMode} />
                    )}
                    <div className="inline-flex rounded-full border border-border p-0.5 bg-muted/40 ml-auto">
                      {(
                        [
                          ["24h", "24h"],
                          ["all", "All"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setFreshness(id)}
                          className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${
                            freshness === id
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {clarifyQs.length > 0 && !runSearchMut.isPending && (
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

              {runSearchMut.isPending && (
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
                />
              )}

              {/* Previous results must not sit under the clarifier or the
                  hunting steps — that was the reported bug. */}
              {clarifyQs.length === 0 && !runSearchMut.isPending && (
                <>
                  {resultTab === "posts" && (
                    <PostsGrid
                      leads={shownLeads}
                      savedByUrl={savedByUrl}
                      onOpen={setSelected}
                      onSave={(l) => saveMut.mutate(l)}
                    />
                  )}
                  {resultTab === "companies" &&
                    (viewMode === "table" && shownCompanies.length ? (
                      <div className="pb-4">
                        <CompanyTable
                          rows={shownCompanies}
                          onOpen={(row) => {
                            setSelected(null);
                            setSelectedEntity({ type: "company", company: row });
                          }}
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-4">
                        {shownCompanies.map((c) => (
                          <CompanyCard
                            key={c.key}
                            row={c}
                            onOpen={(row) => {
                              setSelected(null);
                              setSelectedEntity({ type: "company", company: row });
                            }}
                            contactBusy={contactBusyKey === `co:${c.key}`}
                            contact={contactByKey[`co:${c.key}`]}
                            onResolveContact={resolveCompanyContact}
                          />
                        ))}
                        {!companies.length && (
                          <p className="text-sm text-muted-foreground col-span-full">
                            No companies could be confidently identified from these signals yet.
                          </p>
                        )}
                      </div>
                    ))}
                  {resultTab === "people" &&
                    (viewMode === "table" && shownPeople.length ? (
                      <div className="pb-4">
                        <PersonTable
                          rows={shownPeople}
                          onOpen={(row) => {
                            setSelected(null);
                            setSelectedEntity({ type: "person", person: row });
                          }}
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-4">
                        {shownPeople.map((p) => (
                          <PersonCard
                            key={p.key}
                            row={p}
                            onOpen={(row) => {
                              setSelected(null);
                              setSelectedEntity({ type: "person", person: row });
                            }}
                            contactBusy={contactBusyKey === p.key}
                            contact={contactByKey[p.key]}
                            onAccessContact={resolvePersonContact}
                          />
                        ))}
                        {!people.length && (
                          <p className="text-sm text-muted-foreground col-span-full">
                            No people identified yet — job-board listings are company-authored, so
                            people show up when signals come from posts by real authors.
                          </p>
                        )}
                      </div>
                    ))}
                  {resultTab === "local" &&
                    (localRows.length ? (
                      <LocalBusinessesGrid rows={localRows} />
                    ) : (
                      <p className="text-sm text-muted-foreground pb-4">
                        No local businesses in this search. Try a place + category (e.g. plumbers in
                        Texas), or use the Local businesses page for a dedicated hunt.
                      </p>
                    ))}
                </>
              )}

              {/* `activeQuery` is set the moment the clarifier opens (so the
                  header reads correctly), which made this empty-state render
                  UNDER the questions — telling the user nothing was found before
                  the search had even run. No results box while clarifying. */}
              {!runSearchMut.isPending &&
                clarifyQs.length === 0 &&
                activeQuery &&
                leads.length === 0 &&
                companies.length === 0 &&
                people.length === 0 && (
                  <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground space-y-3">
                    <div className="text-foreground font-medium">
                      {queryType === "product"
                        ? `No fresh public asks for a tool like "${displaySearchLabel(activeQuery)}" in the last day or two.`
                        : `No fresh buyer-intent posts for "${displaySearchLabel(activeQuery)}" in the last day or two.`}
                    </div>
                    <div>
                      {queryType === "product"
                        ? "We look for posts where people recommend, compare, or ask for tools like yours."
                        : "This means:"}
                    </div>
                    {queryType !== "product" && (
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
          <div className="max-w-3xl mx-auto">
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
            onDeepEnrich={deepEnrichSelectedEntity}
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
              onDeepEnrich={deepEnrichSelectedEntity}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

