import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity as ActivityIcon,
  Bookmark,
  ChevronLeft,
  ListPlus,
  Radar,
  Search,
  Target,
} from "lucide-react";
import {
  getProject,
  updateProjectContextFn,
  upsertIcp,
  setDefaultIcpFn,
  saveSearch,
  listSavedSearches,
  createList,
  listLists,
  listProjectActivity,
} from "@/lib/projects.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [{ title: "Scrapivo — Project" }],
  }),
  component: ProjectDetailPage,
});

type ContextRow = {
  context_version: number;
  default_icp_id: string | null;
  offer_profile: Record<string, unknown>;
  preferred_geographies: string[];
  exclusions: string[];
  preferred_signals: string[];
  messaging_preferences: Record<string, unknown>;
  custom_context: Record<string, unknown>;
} | null;

type IcpRow = { id: string; name: string; definition: Record<string, unknown>; is_default: boolean };
type ProjectRow = { id: string; name: string; description: string | null; purpose: string | null };
type ListRow = { id: string; name: string; description: string | null; created_at: string };
type SavedSearchRow = { id: string; name: string; created_at: string };

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getProject);
  const saveCtx = useServerFn(updateProjectContextFn);
  const q = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => get({ data: { id: projectId } }),
  });

  const project = (q.data?.project ?? null) as ProjectRow | null;
  const context = (q.data?.context ?? null) as ContextRow;
  const icps = (q.data?.icps ?? []) as IcpRow[];
  const lists = (q.data?.lists ?? []) as ListRow[];

  // Local form state seeded from the context row.
  const [offerWhat, setOfferWhat] = useState("");
  const [offerValue, setOfferValue] = useState("");
  const [geographies, setGeographies] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [signals, setSignals] = useState("");

  useEffect(() => {
    if (!context) return;
    setOfferWhat(String(context.offer_profile?.what_they_do ?? ""));
    setOfferValue(String(context.offer_profile?.value_prop ?? ""));
    setGeographies((context.preferred_geographies ?? []).join(", "));
    setExclusions((context.exclusions ?? []).join(", "));
    setSignals((context.preferred_signals ?? []).join(", "));
  }, [context]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveCtx({
        data: {
          project_id: projectId,
          offer_profile: {
            ...(context?.offer_profile ?? {}),
            ...(offerWhat.trim() ? { what_they_do: offerWhat.trim() } : {}),
            ...(offerValue.trim() ? { value_prop: offerValue.trim() } : {}),
          },
          preferred_geographies: geographies
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          exclusions: exclusions
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          preferred_signals: signals
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Context saved (version bumped)");
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return <div className="p-8 text-sm text-white/50">Loading project…</div>;
  }
  if (!project) {
    return <div className="p-8 text-sm text-white/50">Project not found.</div>;
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full space-y-5 text-white">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white"
      >
        <ChevronLeft className="size-3.5" /> All projects
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        {project.description ? (
          <p className="text-xs text-white/60 mt-1">{project.description}</p>
        ) : null}
      </div>

      {/* Quick actions — flows without backing routes yet are disabled with a
          title, never a dead error. Parent wires search/watch launch. */}
      <div className="flex flex-wrap gap-2">
        <Button
          asChild
          size="sm"
          className="bg-white/15 hover:bg-white/25 text-white border-white/20"
        >
          <Link to="/discover">
            <Search className="size-3.5 mr-1" /> Find more leads
          </Link>
        </Button>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="bg-white/[0.04] text-white border-white/15 hover:bg-white/10"
        >
          <Link to="/watches">
            <Radar className="size-3.5 mr-1" /> Create Watch
          </Link>
        </Button>
        <Button
          asChild
          size="sm"
          variant="outline"
          disabled={lists.length === 0}
          title={lists.length === 0 ? "No lists yet — create one in the Lists tab" : "Open your first list"}
          className="bg-white/[0.04] text-white border-white/15 hover:bg-white/10 disabled:opacity-40"
        >
          <Link
            to="/projects/$projectId/lists/$listId"
            params={{ projectId, listId: lists[0]?.id ?? "" }}
          >
            <ListPlus className="size-3.5 mr-1" /> View list
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled
          title="Coming soon — signal check runs inside Watches"
          className="bg-white/[0.04] text-white border-white/15 disabled:opacity-40"
        >
          Check new signals
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-white/[0.05]">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="icps">ICPs</TabsTrigger>
          <TabsTrigger value="searches">Saved searches</TabsTrigger>
          <TabsTrigger value="lists">Lists</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-3">
          <p className="text-[11px] text-white/40">
            Research context v{context?.context_version ?? 1} — explicit query &gt; project
            context &gt; global defaults. Every save bumps the version; running searches keep
            their frozen snapshot.
          </p>
          <Field label="What you offer / what they do">
            <Textarea
              value={offerWhat}
              onChange={(e) => setOfferWhat(e.target.value)}
              placeholder="e.g. B2B web design studio selling site revamps"
              className="bg-white/[0.04] border-white/10 min-h-[60px]"
            />
          </Field>
          <Field label="Value proposition">
            <Textarea
              value={offerValue}
              onChange={(e) => setOfferValue(e.target.value)}
              placeholder="Why a prospect should care — one or two sentences"
              className="bg-white/[0.04] border-white/10 min-h-[60px]"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Preferred geographies (comma-separated)">
              <Input
                value={geographies}
                onChange={(e) => setGeographies(e.target.value)}
                placeholder="e.g. Austin, Texas, US"
                className="bg-white/[0.04] border-white/10"
              />
            </Field>
            <Field label="Preferred signals (comma-separated)">
              <Input
                value={signals}
                onChange={(e) => setSignals(e.target.value)}
                placeholder="e.g. hiring, funding, website revamp"
                className="bg-white/[0.04] border-white/10"
              />
            </Field>
          </div>
          <Field label="Exclusions (comma-separated)">
            <Input
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              placeholder="e.g. agencies, competitors, Acme Corp"
              className="bg-white/[0.04] border-white/10"
            />
          </Field>
          <Button
            type="button"
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className="bg-white/15 hover:bg-white/25 text-white border-white/20"
          >
            {saveMut.isPending ? "Saving…" : "Save context"}
          </Button>
        </TabsContent>

        <TabsContent value="icps" className="pt-3">
          <IcpsTab projectId={projectId} icps={icps} />
        </TabsContent>

        <TabsContent value="searches" className="pt-3">
          <SavedSearchesTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="lists" className="pt-3">
          <ListsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="activity" className="pt-3">
          <ActivityTab projectId={projectId} />
        </TabsContent>
      </Tabs>

      {/* Research Jobs: search-jobs.functions.ts has no by-project reader yet
          (parent wires it — WS3 must not edit that file). */}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-white/70">{label}</label>
      {children}
    </div>
  );
}

function IcpsTab({ projectId, icps }: { projectId: string; icps: IcpRow[] }) {
  const qc = useQueryClient();
  const add = useServerFn(upsertIcp);
  const setDefault = useServerFn(setDefaultIcpFn);
  const [name, setName] = useState("");

  const addMut = useMutation({
    mutationFn: () => add({ data: { project_id: projectId, name: name.trim(), definition: {} } }),
    onSuccess: () => {
      setName("");
      toast.success("ICP added");
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const defMut = useMutation({
    mutationFn: (icpId: string) =>
      setDefault({ data: { project_id: projectId, icp_id: icpId } }),
    onSuccess: () => {
      toast.success("Default ICP set");
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ICP name (e.g. Clinics without websites)"
          className="bg-white/[0.04] border-white/10"
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) addMut.mutate();
          }}
        />
        <Button
          type="button"
          disabled={!name.trim() || addMut.isPending}
          onClick={() => addMut.mutate()}
          className="bg-white/15 hover:bg-white/25 text-white border-white/20"
        >
          <Target className="size-3.5 mr-1" /> Add
        </Button>
      </div>
      {icps.length === 0 ? (
        <p className="text-xs text-white/40">No ICPs yet — add a reusable target definition.</p>
      ) : (
        <ul className="space-y-2">
          {icps.map((icp) => (
            <li
              key={icp.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5"
            >
              <span className="text-xs font-medium">
                {icp.name}
                {icp.is_default ? (
                  <span className="ml-2 text-[10px] rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-2 py-0.5">
                    default
                  </span>
                ) : null}
              </span>
              {!icp.is_default && (
                <button
                  type="button"
                  onClick={() => defMut.mutate(icp.id)}
                  className="text-[10px] text-white/50 hover:text-white"
                >
                  Set default
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SavedSearchesTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const add = useServerFn(saveSearch);
  const list = useServerFn(listSavedSearches);
  const [name, setName] = useState("");
  const q = useQuery({
    queryKey: ["project-saved-searches", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const savedSearches = (q.data?.savedSearches ?? []) as SavedSearchRow[];

  const addMut = useMutation({
    mutationFn: () =>
      add({
        data: {
          project_id: projectId,
          name: name.trim(),
          spec: { raw_query: name.trim(), entity: "unknown", criteria: [], missing: [], signal_required: false, signal_types: [], signal_recency: null, status: "unknown" },
        },
      }),
    onSuccess: () => {
      setName("");
      toast.success("Search saved");
      void qc.invalidateQueries({ queryKey: ["project-saved-searches", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this search — the full spec is captured when launched from a search"
          className="bg-white/[0.04] border-white/10"
        />
        <Button
          type="button"
          disabled={!name.trim() || addMut.isPending}
          onClick={() => addMut.mutate()}
          className="bg-white/15 hover:bg-white/25 text-white border-white/20"
        >
          <Bookmark className="size-3.5 mr-1" /> Save
        </Button>
      </div>
      {savedSearches.length === 0 ? (
        <p className="text-xs text-white/40">No saved searches yet.</p>
      ) : (
        <ul className="space-y-2">
          {savedSearches.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs"
            >
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const create = useServerFn(createList);
  const list = useServerFn(listLists);
  const [name, setName] = useState("");
  const q = useQuery({
    queryKey: ["project-lists", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const rows = (q.data?.lists ?? []) as ListRow[];

  const createMut = useMutation({
    mutationFn: () => create({ data: { project_id: projectId, name: name.trim() } }),
    onSuccess: () => {
      setName("");
      toast.success("List created");
      void qc.invalidateQueries({ queryKey: ["project-lists", projectId] });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New list name (e.g. Q3 outreach)"
          className="bg-white/[0.04] border-white/10"
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) createMut.mutate();
          }}
        />
        <Button
          type="button"
          disabled={!name.trim() || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="bg-white/15 hover:bg-white/25 text-white border-white/20"
        >
          <ListPlus className="size-3.5 mr-1" /> Create
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-white/40">No lists yet — create one, then add leads from search results.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((l) => (
            <li key={l.id}>
              <Link
                to="/projects/$projectId/lists/$listId"
                params={{ projectId, listId: l.id }}
                className="block rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs hover:border-white/25"
              >
                {l.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ActivityRow = { id: string; kind: string; created_at: string; detail: Record<string, unknown> };

function ActivityTab({ projectId }: { projectId: string }) {
  const get = useServerFn(listProjectActivity);
  const q = useQuery({
    queryKey: ["project-activity", projectId],
    queryFn: () => listProjectActivity({ data: { project_id: projectId, limit: 20 } }),
  });
  const rows = (q.data?.activity ?? []) as ActivityRow[];

  if (!rows.length) return <p className="text-xs text-white/40">No activity yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5"
        >
          <ActivityIcon className="size-3.5 text-white/40 shrink-0" />
          <span className="text-xs flex-1">{r.kind.replace(/_/g, " ")}</span>
          <span className="text-[10px] text-white/40">
            {new Date(r.created_at).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
