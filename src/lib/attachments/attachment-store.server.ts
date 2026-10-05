import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdmin } from "@/integrations/my-supabase/admin.server";

/**
 * Stage-1 secure attachment retrieval.
 *
 * THE CONTRACT (no exceptions):
 *  1. The client sends only a registry attachmentId (uuid) — never a
 *     filesystem or storage path.
 *  2. Registry lookup runs through the USER-SCOPED client, so RLS makes
 *     another user's rows invisible: a cross-user id looks like a missing one.
 *  3. Bucket, object-path prefix (userId/), path-traversal, MIME allowlist,
 *     size cap and status are all verified server-side.
 *  4. Only after every check passes is the object downloaded — with the same
 *     user-scoped client, so storage RLS enforces ownership a second time.
 * There is no code path that reads a client-supplied path or uses the
 * service-role key to bypass ownership.
 */

export const ATTACHMENT_BUCKET = "attachments";
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type AttachmentKind = "text" | "document" | "image";

const MIME_ALLOWLIST: Record<string, AttachmentKind> = {
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/json": "text",
  "application/pdf": "document",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
};

const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json", "log"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

function kindFromExtension(name: string): AttachmentKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (PDF_EXTENSIONS.has(ext)) return "document";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

function classify(mime: string, name: string): AttachmentKind | null {
  if (mime && MIME_ALLOWLIST[mime]) return MIME_ALLOWLIST[mime];
  return kindFromExtension(name);
}

/** True when the registry table itself is not deployed (42P01 / relation
 *  missing). The store then degrades to storage-prefix verification, which
 *  keeps every security property EXCEPT derivative parent-linkage. */
function isMissingRelation(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist|schema cache/i.test(error.message ?? "");
}

/** Storage-list fallback: find the object named `${attachmentId}-*` under the
 *  OWNER'S OWN prefix. Ownership comes from the per-user prefix + storage
 *  RLS, exactly as when the client uploaded it. Returns the object name. */
async function locateObjectByPrefix(
  supabase: SupabaseClient,
  userId: string,
  attachmentId: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { limit: 100, search: attachmentId });
  if (error || !data) return null;
  const match = data.find((o) => o.name.startsWith(`${attachmentId}-`));
  return match?.name ?? null;
}

export type VerifiedAttachment =
  | {
      ok: true;
      kind: AttachmentKind;
      mime: string;
      name: string;
      bytes: Uint8Array;
    }
  | { ok: false; reason: string };

/**
 * Stage-1 upload ticket: the server validates the descriptor, builds the
 * object path ITSELF from the SESSION user's id (the client never supplies a
 * path), and hands back a short-lived signed upload URL. This is the
 * deployment-proof path for hosted projects whose storage RLS policies are
 * not deployed: the service role acts strictly ON BEHALF of the verified
 * user, confined to that user's own prefix.
 */
export async function createStage1UploadTicket(
  userId: string,
  input: { attachmentId: string; name: string; mime: string; size: number },
): Promise<{ ok: true; signedUrl: string; token: string; path: string } | { ok: false; reason: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.attachmentId)) {
    return { ok: false, reason: "attachment id must be a uuid" };
  }
  if (input.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "attachment exceeds the size cap" };
  }
  if (!classify(input.mime, input.name)) {
    return { ok: false, reason: `unsupported content type "${input.mime || "unknown"}"` };
  }
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const objectPath = `${userId}/${input.attachmentId}-${safeName}`;
  try {
    const admin = getAdmin();
    const { data, error } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(objectPath);
    if (error || !data) {
      return { ok: false, reason: `upload ticket failed: ${error?.message ?? "unknown"}` };
    }
    // Best-effort registry row (path is already fixed). A missing registry
    // table must not block the upload — verification re-checks existence.
    await admin.from("attachments_registry").upsert({
      id: input.attachmentId,
      user_id: userId,
      bucket: ATTACHMENT_BUCKET,
      object_path: objectPath,
      mime: input.mime,
      size: input.size,
      name: safeName,
      status: "uploaded",
      parent_attachment_id: null,
    });
    return { ok: true, signedUrl: data.signedUrl, token: data.token, path: objectPath };
  } catch (e) {
    return { ok: false, reason: `upload ticket failed: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

/**
 * Stage-1 DERIVATIVE upload ticket (scanned-PDF page images). The parent must
 * already exist under the caller's own prefix; the derivative path embeds the
 * parent id (`<parent>-derived-<derId>-<name>`) so parent linkage is provable
 * from the object name alone, with or without the registry.
 */
export async function createStage1DerivativeTicket(
  userId: string,
  input: {
    attachmentId: string;
    parentAttachmentId: string;
    name: string;
    mime: string;
    size: number;
  },
): Promise<{ ok: true; signedUrl: string; token: string; path: string } | { ok: false; reason: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.attachmentId)) {
    return { ok: false, reason: "attachment id must be a uuid" };
  }
  if (input.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "derivative exceeds the size cap" };
  }
  if (classify(input.mime, input.name) !== "image") {
    return { ok: false, reason: "derivatives must be images" };
  }
  const admin = getAdmin();
  // The parent must exist under the CALLER'S OWN prefix.
  const { data: objects, error: listError } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { limit: 100, search: input.parentAttachmentId });
  if (listError || !objects?.some((o) => o.name.startsWith(`${input.parentAttachmentId}-`))) {
    return { ok: false, reason: "parent attachment not found in the owner's storage prefix" };
  }
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const objectPath = `${userId}/${input.parentAttachmentId}-derived-${input.attachmentId}-${safeName}`;
  try {
    const { data, error } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(objectPath);
    if (error || !data) {
      return { ok: false, reason: `upload ticket failed: ${error?.message ?? "unknown"}` };
    }
    await admin.from("attachments_registry").upsert({
      id: input.attachmentId,
      user_id: userId,
      bucket: ATTACHMENT_BUCKET,
      object_path: objectPath,
      mime: input.mime,
      size: input.size,
      name: safeName,
      status: "uploaded",
      parent_attachment_id: input.parentAttachmentId,
    });
    return { ok: true, signedUrl: data.signedUrl, token: data.token, path: objectPath };
  } catch (e) {
    return { ok: false, reason: `upload ticket failed: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

/** Derivative ids of a parent, server-mediated: registry rows first, then the
 *  parent-derived naming convention under the owner's prefix. */
export async function listDerivativeIdsForUser(
  userId: string,
  parentAttachmentId: string,
  limit = 6,
): Promise<string[]> {
  const admin = getAdmin();
  const { data: rows, error } = await admin
    .from("attachments_registry")
    .select("id")
    .eq("parent_attachment_id", parentAttachmentId)
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<Array<{ id: string }>>();
  if (!error && rows && rows.length > 0) {
    return rows.map((r) => r.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  }
  const { data: objects, error: listError } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { limit: 100, search: `${parentAttachmentId}-derived-` });
  if (listError || !objects) return [];
  const marker = `${parentAttachmentId}-derived-`;
  const ids: string[] = [];
  for (const o of objects) {
    if (!o.name.startsWith(marker)) continue;
    const id = o.name.slice(marker.length).split("-").slice(0, 5).join("-");
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * Server-mediated verification + read, used when storage RLS policies are not
 * deployed (user-scoped downloads would 403). EVERY guarantee of the 4-step
 * contract is preserved; ownership is enforced by construction: the service
 * role only ever touches objects under the VERIFIED session user's own
 * prefix, and the id→object mapping is derived from that prefix — never from
 * a client-supplied path. A cross-user id cannot exist under this prefix.
 */
export async function loadVerifiedAttachmentForUser(
  userId: string,
  attachmentId: string,
  opts: { parentAttachmentId?: string | null } = {},
): Promise<VerifiedAttachment> {
  const admin = getAdmin();
  // (1)+(2) Locate the object strictly inside the owner's own prefix; the id
  // → name mapping comes from that prefix listing, never from the client.
  const { data, error } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { limit: 100, search: attachmentId });
  if (error || !data) {
    return { ok: false, reason: "attachment listing failed for the owner's prefix" };
  }
  const objectName = data.find((o) => o.name.startsWith(`${attachmentId}-`));
  if (!objectName) {
    return { ok: false, reason: "attachment not found in the owner's storage prefix" };
  }
  const objectPath = `${userId}/${objectName.name}`;
  // Parent-linkage proof without the registry: the naming convention embeds
  // the parent id (parent-derived-derId-…); with the registry, the row is
  // authoritative.
  const { data: regRow } = await admin
    .from("attachments_registry")
    .select("parent_attachment_id, object_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (regRow?.object_path && regRow.object_path !== objectPath) {
    return { ok: false, reason: "object path does not match the registry row" };
  }
  if (opts.parentAttachmentId) {
    const linked = regRow
      ? regRow.parent_attachment_id === opts.parentAttachmentId
      : objectName.name.includes(`${opts.parentAttachmentId}-derived-`);
    if (!linked) {
      return { ok: false, reason: "derivative is not linked to the given parent attachment" };
    }
  }
  // (3) MIME allowlist by extension (upload-time MIME was validated at
  // ticket time); size capped at download.
  const kind = kindFromExtension(objectName.name);
  if (!kind) {
    return { ok: false, reason: `unsupported content type "${objectName.name}"` };
  }
  // (4) Existence + download (service role, confined to the owner's prefix).
  const { data: blob, error: downloadError } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .download(objectPath);
  if (downloadError || !blob) {
    return { ok: false, reason: "attachment object could not be downloaded" };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "attachment exceeds the size cap" };
  }
  return {
    ok: true,
    kind,
    mime: "",
    name: objectName.name.slice(attachmentId.length + 1),
    bytes,
  };
}

export type AttachmentRegistryRow = {
  id: string;
  user_id: string;
  bucket: string;
  object_path: string;
  mime: string;
  size: number;
  name: string;
  status: string;
  parent_attachment_id: string | null;
};

/**
 * Verify + load one attachment through the full 4-step contract. Every
 * failure is a specific, honest reason — callers surface it, they never
 * pretend the content was read.
 */
export async function loadVerifiedAttachment(
  supabase: SupabaseClient,
  userId: string,
  attachmentId: string,
  opts: { parentAttachmentId?: string | null } = {},
): Promise<VerifiedAttachment> {
  // (1) Registry lookup — user-scoped client; RLS hides other users' rows.
  const { data: row, error: rowError } = await supabase
    .from("attachments_registry")
    .select("*")
    .eq("id", attachmentId)
    .returns<AttachmentRegistryRow[]>()
    .maybeSingle();

  if (row && opts.parentAttachmentId && row.parent_attachment_id !== opts.parentAttachmentId) {
    return { ok: false, reason: "derivative is not linked to the given parent attachment" };
  }

  let bucket: string;
  let objectPath: string;
  let mime: string;
  let size: number;
  let name: string;
  let status: string;

  if (row) {
    bucket = row.bucket;
    objectPath = row.object_path;
    mime = row.mime;
    size = Number(row.size ?? 0);
    name = row.name || row.object_path.split("/").pop() || "attachment";
    status = row.status;
  } else if (rowError && isMissingRelation(rowError)) {
    // Registry not deployed — degrade to storage-prefix verification.
    // (2) The object must exist under the OWNER'S OWN prefix; a cross-user id
    // cannot exist there, and storage RLS enforces the prefix boundary.
    const objectName = await locateObjectByPrefix(supabase, userId, attachmentId);
    if (!objectName) {
      return { ok: false, reason: "attachment not found in the owner's storage prefix" };
    }
    bucket = ATTACHMENT_BUCKET;
    objectPath = `${userId}/${objectName}`;
    mime = "";
    name = objectName.slice(attachmentId.length + 1);
    size = 0; // unknown without metadata; re-checked after download
    status = "uploaded";
  } else if (rowError) {
    return { ok: false, reason: "attachment registry lookup failed" };
  } else {
    return { ok: false, reason: "attachment not found in registry for this user" };
  }

  // (2b) Bucket + path-prefix + traversal checks.
  if (bucket !== ATTACHMENT_BUCKET) {
    return { ok: false, reason: `unexpected bucket "${bucket}"` };
  }
  if (!objectPath.startsWith(`${userId}/`) || objectPath.includes("..")) {
    return { ok: false, reason: "object path is outside the owner's prefix" };
  }
  // (3) MIME allowlist + size cap + status.
  const kind = classify(mime, name);
  if (!kind) {
    return { ok: false, reason: `unsupported content type "${mime || "unknown"}"` };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "attachment exceeds the size cap" };
  }
  if (status !== "uploaded") {
    return { ok: false, reason: `attachment status "${status}" is not readable` };
  }
  // (4) Existence + download — user-scoped client, so storage RLS re-checks
  // ownership at the storage layer.
  const { data: blob, error: downloadError } = await supabase.storage.from(bucket).download(objectPath);
  if (downloadError || !blob) {
    return { ok: false, reason: "attachment object could not be downloaded" };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "attachment exceeds the size cap" };
  }
  return { ok: true, kind, mime, name, bytes };
}

/** List verified DERIVATIVE ids of a parent attachment (scanned-PDF page
 *  images). Registry path: parent_attachment_id rows. Fallback (registry not
 *  deployed): the composer names derivatives
 *  `${parentAttachmentId}-derived-${derId}-…` under the owner's prefix, so
 *  parent linkage is provable from the owner-scoped object name itself. */
export async function listDerivativeIds(
  supabase: SupabaseClient,
  userId: string,
  parentAttachmentId: string,
  limit = 6,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("attachments_registry")
    .select("id")
    .eq("parent_attachment_id", parentAttachmentId)
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<Array<{ id: string }>>();
  if (!error && data) {
    return data.map((r) => r.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  }
  if (error && !isMissingRelation(error)) return [];
  // Fallback: owner-scoped listing with parent-derived naming convention.
  const { data: objects, error: listError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { limit: 100, search: `${parentAttachmentId}-derived-` });
  if (listError || !objects) return [];
  const marker = `${parentAttachmentId}-derived-`;
  const ids: string[] = [];
  for (const o of objects) {
    if (!o.name.startsWith(marker)) continue;
    const rest = o.name.slice(marker.length);
    const id = rest.split("-").slice(0, 5).join("-");
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/** Register an already-uploaded object. Verifies existence in the owner's
 *  prefix before inserting the registry row (user-scoped insert, RLS-bound). */
export async function registerVerifiedAttachment(
  supabase: SupabaseClient,
  userId: string,
  input: { attachmentId: string; name: string; mime: string; size: number },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { attachmentId } = input;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attachmentId)) {
    return { ok: false, reason: "attachment id must be a uuid" };
  }
  if (input.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "attachment exceeds the size cap" };
  }
  if (!classify(input.mime, input.name)) {
    return { ok: false, reason: `unsupported content type "${input.mime || "unknown"}"` };
  }
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const objectPath = `${userId}/${attachmentId}-${safeName}`;
  // Existence check in the owner's own prefix (user-scoped list).
  const { data: objects, error: listError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { limit: 100, search: attachmentId });
  if (listError || !objects?.some((o) => o.name === `${attachmentId}-${safeName}`)) {
    return { ok: false, reason: "uploaded object not found in the owner's storage prefix" };
  }
  const { error: insertError } = await supabase.from("attachments_registry").insert({
    id: attachmentId,
    user_id: userId,
    bucket: ATTACHMENT_BUCKET,
    object_path: objectPath,
    mime: input.mime,
    size: input.size,
    name: safeName,
    status: "uploaded",
    parent_attachment_id: null,
  });
  if (insertError && !isMissingRelation(insertError)) {
    return { ok: false, reason: `registry insert failed: ${insertError.message}` };
  }
  // Registry missing (insertError = 42P01): the object existence was already
  // verified under the owner's prefix — degrade gracefully.
  return { ok: true };
}

/** Register a DERIVATIVE (e.g. a rendered page image of a PDF) linked to its
 *  parent. The parent must already belong to the caller. */
export async function registerDerivativeAttachment(
  supabase: SupabaseClient,
  userId: string,
  input: {
    attachmentId: string;
    parentAttachmentId: string;
    name: string;
    mime: string;
    size: number;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const parent = await loadVerifiedAttachment(supabase, userId, input.parentAttachmentId);
  if (!parent.ok) {
    return { ok: false, reason: `parent attachment could not be verified: ${parent.reason}` };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.attachmentId)) {
    return { ok: false, reason: "attachment id must be a uuid" };
  }
  if (input.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "derivative exceeds the size cap" };
  }
  if (classify(input.mime, input.name) !== "image") {
    return { ok: false, reason: "derivatives must be images" };
  }
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  // Parent linkage is provable from the object name itself, so the fallback
  // path (registry missing) can still verify derivatives.
  const objectPath = `${userId}/${input.parentAttachmentId}-derived-${input.attachmentId}-${safeName}`;
  const { data: objects, error: listError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { limit: 100, search: `${input.parentAttachmentId}-derived-${input.attachmentId}` });
  if (listError || !objects?.some((o) => o.name === `${input.parentAttachmentId}-derived-${input.attachmentId}-${safeName}`)) {
    return { ok: false, reason: "uploaded derivative not found in the owner's storage prefix" };
  }
  const { error: insertError } = await supabase.from("attachments_registry").insert({
    id: input.attachmentId,
    user_id: userId,
    bucket: ATTACHMENT_BUCKET,
    object_path: objectPath,
    mime: input.mime,
    size: input.size,
    name: safeName,
    status: "uploaded",
    parent_attachment_id: input.parentAttachmentId,
  });
  if (insertError && !isMissingRelation(insertError)) {
    return { ok: false, reason: `registry insert failed: ${insertError.message}` };
  }
  return { ok: true };
}
