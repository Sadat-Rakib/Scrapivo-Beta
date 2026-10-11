/**
 * Minimal Parquet-over-S3 reader for canonical datasets (Phase 1).
 * hyparquet + S3 range GETs, column projection, partition pruning by the
 * caller. No new index service — correctness first (locked).
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentity } from "@smithy/types";
import { parquetReadObjects } from "hyparquet";

const BUCKET = process.env.S3_BUCKET ?? "scrapivo-raw-data-2026-523220341033-us-east-2-an";
const REGION = process.env.AWS_REGION ?? "us-east-2";

let s3: S3Client | null = null;
const LIST_CACHE_MS = 5 * 60_000;
const NETWORK_TIMEOUT_MS = 15_000;
const listCache = new Map<string, { at: number; files: { key: string; size: number }[] }>();
/** Shared-config credentials, resolved on first use.
 *
 * `@aws-sdk/credential-provider-ini` reaches node:os / node:fs / node:child_process.
 * These readers stay transitively reachable from client routes (discover ->
 * spec-search.functions -> indexed/search-index.server), so importing it at module
 * scope drags those builtins into the browser bundle and fails the vite client
 * build. The S3 client accepts an async credentials provider, so the import
 * happens on the server at first use instead. */
export function iniCredentialProvider(profile: string) {
  return async (): Promise<AwsCredentialIdentity> => {
    const { fromIni } = await import("@aws-sdk/credential-provider-ini");
    return fromIni({ profile })();
  };
}

function client(): S3Client {
  if (!s3) {
    const profile = process.env.AWS_PROFILE?.trim();
    s3 = new S3Client({ region: REGION, ...(profile ? { credentials: iniCredentialProvider(profile) } : {}) });
  }
  return s3;
}

export interface DbHitMeta {
  dbHit: boolean;
  /** Retrieval engine that served (provider-* = live fleet tiers). */
  engine: string;
  partitionsRead: string[];
  rowsScanned: number;
  rowsReturned: number;
  /** Postgres-index hits only: wall time and the index/plan that served. */
  elapsedMs?: number;
  indexUsed?: string;
  /** Object-index accounting. Absent on legacy readers. */
  bytesRead?: number;
  canonicalRowsRead?: number;
  coverageIncomplete?: boolean;
  stopReason?: "deadline";
}

export interface ReadBudget {
  signal?: AbortSignal | null;
  deadline?: number;
}

export function isReadDeadline(error: unknown): boolean {
  return error instanceof Error && error.message === "S3_READ_DEADLINE";
}

function checkBudget(opts: ReadBudget): void {
  if (opts.signal?.aborted) throw new Error("SEARCH_CANCELLED");
  if (opts.deadline !== undefined && Date.now() >= opts.deadline) {
    throw new Error("S3_READ_DEADLINE");
  }
}

async function withRequestBudget<T>(
  opts: ReadBudget,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  checkBudget(opts);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const remaining = opts.deadline === undefined ? NETWORK_TIMEOUT_MS :
    Math.min(NETWORK_TIMEOUT_MS, Math.max(1, opts.deadline - Date.now()));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, remaining);
  try {
    const result = await request(controller.signal);
    checkBudget(opts);
    if (timedOut) throw new Error("S3_READ_DEADLINE");
    return result;
  } catch (error) {
    if (opts.signal?.aborted) throw new Error("SEARCH_CANCELLED");
    if (timedOut || (opts.deadline !== undefined && Date.now() >= opts.deadline)) {
      throw new Error("S3_READ_DEADLINE");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Fetch byte range of an S3 object. */
async function fetchRange(key: string, start: number, end?: number, budget: ReadBudget = {}): Promise<ArrayBuffer> {
  const range = end === undefined ? `bytes=${start}-` : `bytes=${start}-${end}`;
  return withRequestBudget(budget, async (signal) => {
    const res = await client().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range }),
      { abortSignal: signal },
    );
    const buf = await res.Body!.transformToByteArray();
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  });
}

export async function objectLength(key: string, budget: ReadBudget = {}): Promise<number> {
  return withRequestBudget(budget, async (signal) => {
    const res = await client().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: "bytes=0-0" }),
      { abortSignal: signal },
    );
    const cr = res.ContentRange ?? "";
    const m = cr.match(/\/(\d+)$/);
    // The SDK returns a streaming body even for a one-byte range. Consume it
    // before returning the header-derived length so its pooled socket is free.
    const buf = await res.Body!.transformToByteArray();
    if (m) return Number(m[1]);
    return buf.length;
  });
}

export async function listPartitionFiles(prefix: string, budget: ReadBudget = {}): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const page = await withRequestBudget(budget, (signal) => client().send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
      { abortSignal: signal },
    ),
    );
    for (const o of page.Contents ?? []) if (o.Key?.endsWith(".parquet")) out.push(o.Key);
    token = page.NextContinuationToken;
  } while (token);
  return out;
}

/**
 * Partition files with sizes, largest first. Bounded scans MUST consume in
 * this order — alphabetical order reads the emptiest shards first and
 * returns ~1 row from millions (the single-card bug). Size data is free
 * from the S3 listing; no extra calls.
 */
export async function listPartitionFilesBySize(
  prefix: string,
  budget: ReadBudget = {},
): Promise<{ key: string; size: number }[]> {
  checkBudget(budget);
  const cached = listCache.get(prefix);
  if (cached && Date.now() - cached.at < LIST_CACHE_MS) return cached.files.map((f) => ({ ...f }));
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await withRequestBudget(budget, (signal) => client().send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
      { abortSignal: signal },
    ),
    );
    for (const o of page.Contents ?? []) {
      if (o.Key?.endsWith(".parquet")) out.push({ key: o.Key, size: o.Size ?? 0 });
    }
    token = page.NextContinuationToken;
  } while (token);
  const sorted = out.sort((a, b) => b.size - a.size);
  listCache.set(prefix, { at: Date.now(), files: sorted });
  return sorted.map((f) => ({ ...f }));
}

export interface ReadOpts<T> extends ReadBudget {
  keys: string[];
  columns: string[];
  where?: (row: Record<string, unknown>) => boolean;
  limit: number;
  meta: Omit<DbHitMeta, "rowsScanned" | "rowsReturned">;
  readFile?: (key: string, columns: string[], budget: ReadBudget) => Promise<Record<string, unknown>[]>;
}

/** Read + filter rows across partition files (streaming per file, capped). */
export async function readFiltered<T>(opts: ReadOpts<T>): Promise<{ rows: T[]; meta: DbHitMeta }> {
  const rows: T[] = [];
  let scanned = 0;
  const partitionsRead: string[] = [];
  let coverageIncomplete = false;
  for (const key of opts.keys) {
    if (rows.length >= opts.limit) break;
    try {
      checkBudget(opts);
      const recs = opts.readFile
        ? await withRequestBudget(opts, (signal) =>
            opts.readFile!(key, opts.columns, { signal, deadline: opts.deadline }))
        : await (async () => {
            const len = await objectLength(key, opts);
            const file = {
              byteLength: len,
              slice: (start: number, end?: number) => fetchRange(key, start, end, opts),
            };
            return parquetReadObjects({ file, columns: opts.columns } as never) as Promise<Record<string, unknown>[]>;
          })();
      partitionsRead.push(key);
      for (const r of recs) {
        checkBudget(opts);
        scanned++;
        if (!opts.where || opts.where(r)) {
          rows.push(r as T);
          if (rows.length >= opts.limit) break;
        }
      }
    } catch (error) {
      if (!isReadDeadline(error)) throw error;
      coverageIncomplete = true;
      break;
    }
  }
  return {
    rows,
    meta: {
      ...opts.meta,
      partitionsRead,
      rowsScanned: scanned,
      rowsReturned: rows.length,
      dbHit: rows.length > 0,
      ...(coverageIncomplete ? { coverageIncomplete: true, stopReason: "deadline" as const } : {}),
    },
  };
}
