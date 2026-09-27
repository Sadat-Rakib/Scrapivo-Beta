// WS3: "Add to list…" menu for the entity detail drawer. Lists existing
// lists across projects (create new happens on the project page — keeps this
// menu to one decision). Dedupe is server-side; re-adding is a safe no-op.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ListPlus } from "lucide-react";
import { addListItemsFn, listAllLists } from "@/lib/projects.functions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SelectedEntity } from "./entity-detail-panel";

type AllListRow = { id: string; project_id: string; name: string; projects: { name: string } | { name: string }[] };

function projectNameOf(l: AllListRow): string {
  const p = l.projects;
  if (Array.isArray(p)) return p[0]?.name ?? "";
  return p?.name ?? "";
}

/** Minimal display snapshot — canonical data stays in the graph/stores. */
export function entitySnapshot(entity: SelectedEntity): Record<string, unknown> {
  if (entity.type === "company") {
    const c = entity.company;
    return { name: c.name, domain: c.domain ?? c.website ?? null, kind: "company" };
  }
  if (entity.type === "local") {
    const b = entity.local;
    return {
      name: b.name,
      domain: b.domain ?? b.website ?? null,
      address: b.address ?? null,
      kind: "local",
    };
  }
  const p = entity.person;
  return {
    name: p.name,
    domain: p.company_domain ?? null,
    title: p.role_hint ?? p.title_hint ?? null,
    kind: "person",
  };
}

export function entityIdOf(entity: SelectedEntity): string {
  if (entity.type === "company") return `company:${entity.company.key}`;
  if (entity.type === "local") return `local:${entity.local.key}`;
  return `person:${entity.person.key}`;
}

export function AddToListMenu({ entity }: { entity: SelectedEntity }) {
  const qc = useQueryClient();
  const getLists = useServerFn(listAllLists);
  const addItems = useServerFn(addListItemsFn);
  const listsQ = useQuery({ queryKey: ["all-lists"], queryFn: () => getLists() });
  const lists = ((listsQ.data?.lists ?? []) as unknown) as AllListRow[];

  const addMut = useMutation({
    mutationFn: (list: AllListRow) =>
      addItems({
        data: {
          project_id: list.project_id,
          list_id: list.id,
          items: [{ entity_id: entityIdOf(entity), source_row: entitySnapshot(entity) }],
        },
      }),
    onSuccess: (out) => {
      toast.success(out.added > 0 ? "Added to list" : "Already in that list");
      void qc.invalidateQueries({ queryKey: ["list-items"] });
      void qc.invalidateQueries({ queryKey: ["project"] });
      void qc.invalidateQueries({ queryKey: ["projects-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Add to list"
          className="p-1 rounded hover:bg-accent text-muted-foreground"
        >
          <ListPlus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Add to list</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {lists.length === 0 ? (
          <DropdownMenuItem disabled>
            No lists yet — create one on a project page
          </DropdownMenuItem>
        ) : (
          lists.map((l) => (
            <DropdownMenuItem
              key={l.id}
              disabled={addMut.isPending}
              onClick={() => addMut.mutate(l)}
            >
              <span className="truncate">{l.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground truncate">
                {projectNameOf(l)}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
