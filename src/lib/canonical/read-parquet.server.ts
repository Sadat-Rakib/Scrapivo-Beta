/**
 * Minimal Parquet-over-S3 reader for canonical datasets (Phase 1).
 * hyparquet + S3 range GETs, column projection, partition pruning by the
 * caller. No new index service — correctness first (locked).
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { parquetReadObjects } from "hyparquet";

const BUCKET = process.env.S3_BUCKET ?? "scrapivo-raw-data-2026-523220341033-us-east-2-an";
const REGION = process.env.AWS_REGION ?? "us-east-2";

let s3: S3Client | null = null;
const LIST_CACHE_MS = 5 * 60_000;
const listCache = new Map<string, { at: number; files: { key: string; size: number }[] }>();
function client(): S3Client {
  if (!s3) {
    const profile = process.env.AWS_PROFILE?.trim();
    s3 = new S3Client({ region: REGION, ...(profile ? { credentials: fromIni({ profile }) } : {}) });
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
}

/** Fetch byte range of an S3 object. */
async function fetchRange(key: string, start: number, end?: number): Promise<ArrayBuffer> {
  const range = end === undefined ? `bytes=${start}-` : `bytes=${start}-${end}`;
  const res = await client().send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range }),
  );
  const buf = await res.Body!.transformToByteArray();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function objectLength(key: string): Promise<number> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: "bytes=0-0" }),
  );
  const cr = res.ContentRange ?? "";
  const m = cr.match(/\/(\d+)$/);
  if (m) return Number(m[1]);
  const buf = await res.Body!.transformToByteArray();
  return buf.length;
}

export async function listPartitionFiles(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const page = await client().send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
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
): Promise<{ key: string; size: number }[]> {
  const cached = listCache.get(prefix);
  if (cached && Date.now() - cached.at < LIST_CACHE_MS) return cached.files.map((f) => ({ ...f }));
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await client().send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
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

export interface ReadOpts<T> {
  keys: string[];
  columns: string[];
  where?: (row: Record<string, unknown>) => boolean;
  limit: number;
  meta: Omit<DbHitMeta, "rowsScanned" | "rowsReturned">;
}

/** Read + filter rows across partition files (streaming per file, capped). */
export async function readFiltered<T>(opts: ReadOpts<T>): Promise<{ rows: T[]; meta: DbHitMeta }> {
  const rows: T[] = [];
  let scanned = 0;
  for (const key of opts.keys) {
    if (rows.length >= opts.limit) break;
    const len = await objectLength(key);
    const file = {
      byteLength: len,
      slice: (start: number, end?: number) => fetchRange(key, start, end),
    };
    // hyparquet asyncBuffer protocol: { byteLength, slice }
    const recs = (await parquetReadObjects({
      file,
      columns: opts.columns,
    } as never)) as Record<string, unknown>[];
    for (const r of recs) {
      scanned++;
      if (!opts.where || opts.where(r)) {
        rows.push(r as T);
        if (rows.length >= opts.limit) break;
      }
    }
  }
  return {
    rows,
    meta: {
      ...opts.meta,
      rowsScanned: scanned,
      rowsReturned: rows.length,
      dbHit: rows.length > 0,
    },
  };
}
