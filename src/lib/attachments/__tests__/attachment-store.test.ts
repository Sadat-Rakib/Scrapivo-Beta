import { describe, expect, it, vi } from "vitest";
import {
  loadVerifiedAttachment,
  registerVerifiedAttachment,
  type AttachmentRegistryRow,
} from "../attachment-store.server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stage 1 P2 attachment-security contract: the client sends registry IDs
 * only; the server verifies ownership (RLS), bucket, path prefix, traversal,
 * MIME, size and status before reading a byte. No test may pass by supplying
 * a client-chosen path.
 */

const OWNER = "11111111-1111-1111-1111-111111111111";
const ROW_ID = "22222222-2222-2222-2222-222222222222";

function row(over: Partial<AttachmentRegistryRow> = {}): AttachmentRegistryRow {
  return {
    id: ROW_ID,
    user_id: OWNER,
    bucket: "attachments",
    object_path: `${OWNER}/${ROW_ID}-notes.txt`,
    mime: "text/plain",
    size: 32,
    name: "notes.txt",
    status: "uploaded",
    parent_attachment_id: null,
    ...over,
  };
}

type QueryResult = { row: AttachmentRegistryRow | null; download?: { data: Blob | null; error: unknown } };

/** Minimal chainable mock of the supabase surface the store touches. */
function mockSupabase(q: QueryResult, listResult?: { data: Array<{ name: string }> | null; error: unknown }) {
  const storage = {
    from: () => ({
      list: vi.fn().mockResolvedValue(listResult ?? { data: [], error: null }),
      download: vi.fn().mockResolvedValue(q.download ?? { data: new Blob(["hello attachment"]), error: null }),
      upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }),
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    insert: vi.fn().mockResolvedValue({ error: null }),
    returns: () => builder,
    maybeSingle: vi.fn().mockResolvedValue({ data: q.row, error: null }),
  };
  return {
    from: vi.fn(() => builder),
    storage,
  } as unknown as SupabaseClient;
}

describe("Stage 1 attachment security (id-only, 4-step verification)", () => {
  it("a registry id belonging to ANOTHER USER resolves to nothing (RLS)", async () => {
    // RLS makes other users' rows invisible: the lookup returns no row.
    const supabase = mockSupabase({ row: null });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID);
    expect(res).toEqual({ ok: false, reason: "attachment not found in registry for this user" });
  });

  it("a row pointing OUTSIDE the owner's prefix is rejected", async () => {
    const supabase = mockSupabase({ row: row({ object_path: `someone-else/${ROW_ID}-notes.txt` }) });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID);
    expect(res).toEqual({ ok: false, reason: "object path is outside the owner's prefix" });
  });

  it("a path-traversal object_path is rejected", async () => {
    const supabase = mockSupabase({ row: row({ object_path: `${OWNER}/../${ROW_ID}-x.txt` }) });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID);
    expect(res).toEqual({ ok: false, reason: "object path is outside the owner's prefix" });
  });

  it("an unexpected bucket is rejected", async () => {
    const supabase = mockSupabase({ row: row({ bucket: "other-bucket" }) });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID);
    expect(res).toEqual({ ok: false, reason: 'unexpected bucket "other-bucket"' });
  });

  it("unsupported MIME is rejected", async () => {
    const supabase = mockSupabase({ row: row({ mime: "application/x-msdownload", name: "evil.exe" }) });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unsupported content type/);
  });

  it("oversize attachments are rejected", async () => {
    const supabase = mockSupabase({ row: row({ size: 6 * 1024 * 1024 }) });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID);
    expect(res).toEqual({ ok: false, reason: "attachment exceeds the size cap" });
  });

  it("a non-uploaded status is rejected", async () => {
    const supabase = mockSupabase({ row: row({ status: "quarantined" }) });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID);
    expect(res.ok).toBe(false);
  });

  it("a valid owned attachment downloads through the user-scoped client", async () => {
    const supabase = mockSupabase({ row: row() });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.kind).toBe("text");
      expect(new TextDecoder().decode(res.bytes)).toContain("hello attachment");
    }
  });

  it("a DERIVATIVE whose parent linkage does not match is rejected", async () => {
    const parent = "33333333-3333-3333-3333-333333333333";
    const supabase = mockSupabase({ row: row({ parent_attachment_id: null }) });
    const res = await loadVerifiedAttachment(supabase, OWNER, ROW_ID, { parentAttachmentId: parent });
    expect(res.ok).toBe(false);
  });

  it("registration refuses an object that is not present in the owner's prefix", async () => {
    const supabase = mockSupabase({ row: null }, { data: [{ name: "different-object" }], error: null });
    const res = await registerVerifiedAttachment(supabase, OWNER, {
      attachmentId: ROW_ID,
      name: "notes.txt",
      mime: "text/plain",
      size: 10,
    });
    expect(res).toEqual({ ok: false, reason: "uploaded object not found in the owner's storage prefix" });
  });

  it("registration succeeds when the object exists under the owner's prefix", async () => {
    const supabase = mockSupabase({ row: null }, { data: [{ name: `${ROW_ID}-notes.txt` }], error: null });
    const res = await registerVerifiedAttachment(supabase, OWNER, {
      attachmentId: ROW_ID,
      name: "notes.txt",
      mime: "text/plain",
      size: 10,
    });
    expect(res).toEqual({ ok: true });
  });
});
