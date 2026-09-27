// Store tests (Workstream 3) — offline via a minimal thenable fake of the
// supabase-js query builder (same pattern as
// src/lib/jobs/__tests__/search-jobs-store.test.ts, trimmed to the calls
// the projects store + global-defaults loader make).
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateProjectContext, addListItems, setDefaultIcp } from "../projects-store";
import { loadGlobalDefaults, profileToDefaults } from "../global-defaults";

// ---------------------------------------------------------------------------
// Minimal supabase-js fake (thenable builder)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

type Op = {
  table: string;
  kind: "select" | "insert" | "upsert" | "update" | "delete" | null;
  values: Row[] | null;
  onConflict: string | null;
  ignoreDuplicates: boolean;
  filters: Array<[string, unknown]>;
  orderCol: string | null;
  orderAsc: boolean;
  range: [number, number] | null;
  want: "none" | "single" | "maybeSingle";
  wantCount: string | null;
  selectCols: string | null;
};

class Builder {
  op: Op;
  constructor(
    private fake: FakeSupabase,
    table: string,
  ) {
    this.op = {
      table,
      kind: "select",
      values: null,
      onConflict: null,
      ignoreDuplicates: false,
      filters: [],
      orderCol: null,
      orderAsc: true,
      range: null,
      want: "none",
      wantCount: null,
      selectCols: null,
    };
  }
  select(cols?: string, opts?: { count?: string }) {
    // supabase-js semantics: .select() after .insert()/.update()/.upsert()
    // keeps the mutation and just requests rows back.
    if (this.op.kind !== "select") {
      this.op.selectCols = cols ?? "*";
    } else {
      this.op.selectCols = cols ?? "*";
    }
    this.op.wantCount = opts?.count ?? null;
    return this;
  }
  insert(values: Row | Row[]) {
    this.op.kind = "insert";
    this.op.values = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op.kind = "upsert";
    this.op.values = Array.isArray(values) ? values : [values];
    this.op.onConflict = opts?.onConflict ?? null;
    this.op.ignoreDuplicates = !!opts?.ignoreDuplicates;
    return this;
  }
  update(values: Row) {
    this.op.kind = "update";
    this.op.values = [values];
    return this;
  }
  delete() {
    this.op.kind = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.op.filters.push([col, val]);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.op.filters.push([col, ["__in__", vals]]);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.op.orderCol = col;
    this.op.orderAsc = opts?.ascending ?? true;
    return this;
  }
  range(from: number, to: number) {
    this.op.range = [from, to];
    return this;
  }
  limit(_n: number) {
    return this;
  }
  single() {
    this.op.want = "single";
    return this.exec();
  }
  maybeSingle() {
    this.op.want = "maybeSingle";
    return this.exec();
  }
  then<T>(res: (v: { data: unknown; error: unknown; count?: number }) => T) {
    return this.exec().then(res);
  }

  private matches(row: Row): boolean {
    return this.op.filters.every(([col, val]) => {
      if (Array.isArray(val) && val[0] === "__in__") {
        return val[1].includes(row[col]);
      }
      // "projects.user_id" style filters join through a parent table; the
      // fake flattens by table name prefix.
      if (col.includes(".")) {
        const [tableName, parentCol] = col.split(".");
        const parent = this.fake.tables[tableName] ?? [];
        return parent.some((p) => p[parentCol] === val && p.id === row[`${tableName.slice(0, -1)}_id`]);
      }
      return row[col] === val;
    });
  }

  private shapeMutationResult(rows: Row[] | null): { data: unknown; error: unknown } {
    // .single()/.maybeSingle() after a mutation unwrap the one-row array —
    // mirroring supabase-js.
    if (this.op.want === "single") {
      return rows?.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "no rows / multiple rows" } };
    }
    if (this.op.want === "maybeSingle") {
      return { data: rows?.[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private async exec(): Promise<{ data: unknown; error: unknown; count?: number }> {
    const t = this.fake.tables[this.op.table];
    if (!t) return { data: null, error: { message: `relation ${this.op.table} missing` }, count: 0 };
    if (this.op.kind === "insert" || this.op.kind === "upsert") {
      const incoming = this.op.values ?? [];
      const conflictKeys = this.op.onConflict ? this.op.onConflict.split(",").map((s) => s.trim()) : [];
      const inserted: Row[] = [];
      for (const v of incoming) {
        const keyOf = (r: Row) => conflictKeys.map((k) => String(r[k])).join("|");
        const existingIdx = conflictKeys.length
          ? t.findIndex((r) => keyOf(r) === keyOf(v))
          : -1;
        if (existingIdx >= 0) {
          if (this.op.ignoreDuplicates) continue; // dedupe: skip, not an error
          t[existingIdx] = { ...t[existingIdx], ...v };
          inserted.push(t[existingIdx]);
        } else {
          t.push({ ...v });
          inserted.push(t[t.length - 1]);
        }
      }
      const back = this.op.selectCols ? inserted : null;
      return this.shapeMutationResult(back);
    }
    const filtered = t.filter((r) => this.matches(r));
    if (this.op.kind === "update") {
      for (const r of filtered) Object.assign(r, this.op.values?.[0] ?? {});
      return this.shapeMutationResult(this.op.selectCols ? filtered.map((r) => ({ ...r })) : null);
    }
    if (this.op.kind === "delete") {
      for (const r of filtered) t.splice(t.indexOf(r), 1);
      return { data: null, error: null };
    }
    let out = filtered.map((r) => ({ ...r }));
    if (this.op.orderCol) {
      const col = this.op.orderCol;
      // String sort suffices for the fake (timestamps/ids).
      out.sort((x, y) => {
        const a = String(x[col]);
        const b = String(y[col]);
        return a < b ? (this.op.orderAsc ? -1 : 1) : this.op.orderAsc ? 1 : -1;
      });
    }
    if (this.op.range) {
      out = out.slice(this.op.range[0], this.op.range[1] + 1);
    }
    if (this.op.want === "single") {
      return out.length === 1
        ? { data: out[0], error: null }
        : { data: null, error: { message: "no rows / multiple rows" } };
    }
    if (this.op.want === "maybeSingle") {
      return { data: out[0] ?? null, error: null };
    }
    return { data: out, error: null, count: this.op.wantCount ? out.length : undefined };
  }
}

class FakeSupabase {
  tables: Record<string, Row[]>;
  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
  }
  from(table: string) {
    return new Builder(this, table);
  }
}

const asClient = (fake: FakeSupabase) => fake as unknown as SupabaseClient;

// ---------------------------------------------------------------------------
// updateProjectContext — version bump on every update
// ---------------------------------------------------------------------------

describe("updateProjectContext", () => {
  it("bumps context_version on each update", async () => {
    const fake = new FakeSupabase({
      project_context: [
        {
          id: "ctx1",
          project_id: "p1",
          context_version: 1,
          exclusions: ["agencies"],
          offer_profile: {},
          updated_at: "t0",
        },
      ],
    });
    const first = await updateProjectContext(asClient(fake), "p1", { exclusions: ["agencies", "competitors"] });
    expect(first.context_version).toBe(2);
    expect(first.exclusions).toEqual(["agencies", "competitors"]);
    const second = await updateProjectContext(asClient(fake), "p1", { exclusions: [] });
    expect(second.context_version).toBe(3);
    const stored = fake.tables.project_context[0];
    expect(stored.context_version).toBe(3);
    expect(stored.exclusions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addListItems — dedupe on (list_id, entity_id)
// ---------------------------------------------------------------------------

describe("addListItems", () => {
  it("dedupes on (list_id, entity_id) and reports only newly added rows", async () => {
    const fake = new FakeSupabase({
      project_list_items: [
        { id: "i1", list_id: "L", entity_id: "company:a", source_row: { name: "A" } },
      ],
    });
    const out = await addListItems(asClient(fake), "L", [
      { entity_id: "company:a", source_row: { name: "A" } }, // duplicate
      { entity_id: "company:b", source_row: { name: "B" } },
      { entity_id: "company:c" },
    ]);
    expect(out.added).toBe(2);
    const entities = fake.tables.project_list_items.map((r) => r.entity_id).sort();
    expect(entities).toEqual(["company:a", "company:b", "company:c"]);
  });

  it("is a no-op for an empty batch", async () => {
    const fake = new FakeSupabase({ project_list_items: [] });
    const out = await addListItems(asClient(fake), "L", []);
    expect(out.added).toBe(0);
    expect(fake.tables.project_list_items).toHaveLength(0);
  });

  it("same entity in a DIFFERENT list is not deduped away", async () => {
    const fake = new FakeSupabase({
      project_list_items: [{ id: "i1", list_id: "L1", entity_id: "company:a" }],
    });
    const out = await addListItems(asClient(fake), "L2", [{ entity_id: "company:a" }]);
    expect(out.added).toBe(1);
    expect(fake.tables.project_list_items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// setDefaultIcp — is_default flips exclusively
// ---------------------------------------------------------------------------

describe("setDefaultIcp", () => {
  it("flips is_default exclusively within the project", async () => {
    const fake = new FakeSupabase({
      project_icps: [
        { id: "icp1", project_id: "p1", name: "Clinics", is_default: true },
        { id: "icp2", project_id: "p1", name: "Agencies", is_default: false },
        { id: "icp3", project_id: "p2", name: "Other project default", is_default: true },
      ],
    });
    await setDefaultIcp(asClient(fake), "p1", "icp2");
    expect(fake.tables.project_icps.find((r) => r.id === "icp1")?.is_default).toBe(false);
    expect(fake.tables.project_icps.find((r) => r.id === "icp2")?.is_default).toBe(true);
    // Other projects are untouched.
    expect(fake.tables.project_icps.find((r) => r.id === "icp3")?.is_default).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadGlobalDefaults — stored row wins, profile fallback otherwise
// ---------------------------------------------------------------------------

describe("loadGlobalDefaults", () => {
  it("prefers the stored project_global_defaults row", async () => {
    const fake = new FakeSupabase({
      project_global_defaults: [{ user_id: "u1", context: { geography: "EU" } }],
      profiles: [{ id: "u1", location: "Austin" }],
    });
    const out = await loadGlobalDefaults(asClient(fake), "u1");
    expect(out).toEqual({ geography: "EU" });
  });

  it("falls back to deriving the layer from the profiles row", async () => {
    const fake = new FakeSupabase({
      project_global_defaults: [],
      profiles: [
        {
          id: "u1",
          location: "Austin",
          job_title: "Web designer",
          full_name: "Mir",
          skills: ["figma"],
        },
      ],
    });
    const out = await loadGlobalDefaults(asClient(fake), "u1");
    expect(out.geography).toBe("Austin");
    expect(out.offer?.what_they_do).toBe("Web designer");
    expect(out.custom?.skills).toEqual(["figma"]);
  });

  it("profileToDefaults never invents keys for blank profiles", () => {
    const out = profileToDefaults({});
    expect(out.geography).toBeNull();
    expect(out.offer).toEqual({});
  });
});
