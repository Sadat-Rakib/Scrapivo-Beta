import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronLeft as PageLeft, ChevronRight as PageRight, Trash2 } from "lucide-react";
import { deleteList, listListItems, removeListItem } from "@/lib/projects.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/projects/$projectId/lists/$listId")({
  head: () => ({
    meta: [{ title: "Scrapivo — List" }],
  }),
  component: ListDetailPage,
});

type ListItemRow = {
  id: string;
  entity_id: string;
  source_row: Record<string, unknown> | null;
  note: string | null;
  added_at: string;
};

const PAGE_SIZE = 25;

function ListDetailPage() {
  const { projectId, listId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const getItems = useServerFn(listListItems);
  const remove = useServerFn(removeListItem);
  const removeList = useServerFn(deleteList);
  const [page, setPage] = useState(0);

  const q = useQuery({
    queryKey: ["list-items", listId, page],
    queryFn: () => getItems({ data: { list_id: listId, page, pageSize: PAGE_SIZE } }),
  });

  const removeMut = useMutation({
    mutationFn: (itemId: string) => remove({ data: { list_id: listId, id: itemId } }),
    onSuccess: () => {
      toast.success("Removed");
      void qc.invalidateQueries({ queryKey: ["list-items", listId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delListMut = useMutation({
    mutationFn: () => removeList({ data: { project_id: projectId, id: listId } }),
    onSuccess: () => {
      toast.success("List deleted");
      void qc.invalidateQueries({ queryKey: ["project-lists", projectId] });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      void navigate({ to: "/projects/$projectId", params: { projectId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = (q.data?.items ?? []) as ListItemRow[];
  const total = q.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="h-full overflow-y-auto no-scrollbar p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full space-y-5 text-white">
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white"
      >
        <ChevronLeft className="size-3.5" /> Back to project
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">List</h1>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-white/40">{total} item(s)</span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Delete this list and all its items?")) delListMut.mutate();
            }}
            disabled={delListMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/50 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
          >
            <Trash2 className="size-3.5" /> Delete list
          </button>
        </div>
      </div>

      {q.isLoading ? (
        <p className="text-xs text-white/40">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-white/40">
          Empty — add prospects from search results with “Add to list…”.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">
                  {String(it.source_row?.name ?? it.entity_id)}
                </div>
                {it.source_row?.domain ? (
                  <div className="text-[10px] text-white/40 truncate">
                    {String(it.source_row.domain)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => removeMut.mutate(it.id)}
                className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white"
                title="Remove from list"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="bg-white/[0.04] text-white border-white/15"
          >
            <PageLeft className="size-3.5" />
          </Button>
          <span className="text-[11px] text-white/50">
            Page {page + 1} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => p + 1)}
            className="bg-white/[0.04] text-white border-white/15"
          >
            <PageRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
