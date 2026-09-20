import type { SearchIndexObjectStore } from "./object-store.server";
import type { PostingCandidate } from "./types";

const MAGIC = "SPI1";

interface PostingHeader {
  schemaVersion: 1;
  entity: string;
  dimension: string;
  entries: Array<[term: string, offset: number, bytes: number, count: number]>;
}

const decoder = new TextDecoder();

function uint32le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function readVarint(bytes: Uint8Array, state: { at: number }): number {
  let value = 0;
  let shift = 0;
  while (state.at < bytes.length) {
    const byte = bytes[state.at++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7;
    if (shift > 49) throw new Error("posting varint exceeds safe integer range");
  }
  throw new Error("truncated posting varint");
}

function zigzagDecode(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

const headerCache = new Map<string, { bodyStart: number; header: PostingHeader }>();

export async function readPosting(
  store: SearchIndexObjectStore,
  key: string,
  term: string,
): Promise<{ candidates: PostingCandidate[]; covered: boolean; bytesRead: number }> {
  let cached = headerCache.get(key);
  let bytesRead = 0;
  if (!cached) {
    const prefix = await store.getObject(key, { start: 0, end: 7 });
    bytesRead += prefix.byteLength;
    if (decoder.decode(prefix.subarray(0, 4)) !== MAGIC) throw new Error(`bad posting magic: ${key}`);
    const headerBytes = uint32le(prefix, 4);
    const rawHeader = await store.getObject(key, { start: 8, end: 7 + headerBytes });
    bytesRead += rawHeader.byteLength;
    const header = JSON.parse(decoder.decode(rawHeader)) as PostingHeader;
    cached = { bodyStart: 8 + headerBytes, header };
    headerCache.set(key, cached);
  }
  const entry = cached.header.entries.find((row) => row[0] === term);
  if (!entry) return { candidates: [], covered: false, bytesRead };
  const [, offset, length, count] = entry;
  if (count === 0 || length === 0) return { candidates: [], covered: true, bytesRead };
  const payload = await store.getObject(key, {
    start: cached.bodyStart + offset,
    end: cached.bodyStart + offset + length - 1,
  });
  bytesRead += payload.byteLength;
  const state = { at: 0 };
  const candidates: PostingCandidate[] = [];
  let previous = 0;
  while (state.at < payload.length) {
    const docId = previous + zigzagDecode(readVarint(payload, state));
    if (state.at + 2 > payload.length) throw new Error(`truncated posting tuple: ${key}`);
    candidates.push({ docId, quality: payload[state.at++], flags: payload[state.at++] });
    previous = docId;
  }
  if (candidates.length !== count) throw new Error(`posting count mismatch: ${key}:${term}`);
  return { candidates, covered: true, bytesRead };
}

export function clearPostingHeaderCache(): void {
  headerCache.clear();
}
