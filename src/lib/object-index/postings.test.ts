import { describe, expect, it } from "vitest";
import { readPosting } from "./postings";
import type { SearchIndexObjectStore } from "./object-store.server";

function varint(value: number): number[] {
  const bytes: number[] = [];
  while (value >= 0x80) { bytes.push((value & 0x7f) | 0x80); value = Math.floor(value / 128); }
  bytes.push(value);
  return bytes;
}

function encode(term: string, rows: Array<[number, number, number]>): Uint8Array {
  let previous = 0;
  const body: number[] = [];
  for (const [docId, quality, flags] of rows) {
    const delta = docId - previous;
    const zigzag = delta >= 0 ? delta * 2 : -delta * 2 - 1;
    body.push(...varint(zigzag), quality, flags);
    previous = docId;
  }
  const header = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    entity: "business",
    dimension: "city_category",
    entries: [[term, 0, body.length, rows.length]],
  }));
  const output = new Uint8Array(8 + header.length + body.length);
  output.set(new TextEncoder().encode("SPI1"), 0);
  new DataView(output.buffer).setUint32(4, header.length, true);
  output.set(header, 8);
  output.set(body, 8 + header.length);
  return output;
}

describe("compact posting format", () => {
  it("range-reads header and exact delta-coded posting", async () => {
    const object = encode("toronto\0hvac", [[4, 90, 5], [19, 75, 1], [7, 60, 0]]);
    let bytesRead = 0;
    const store: SearchIndexObjectStore = {
      async getObject(_key, range) {
        const out = object.slice(range?.start ?? 0, range?.end === undefined ? undefined : range.end + 1);
        bytesRead += out.length;
        return out;
      },
      async headObject() { return { bytes: object.length }; },
      async listVersionPrefix() { return []; },
    };
    const result = await readPosting(store, "fixture.pidx", "toronto\0hvac");
    expect(result.covered).toBe(true);
    expect(result.candidates).toEqual([
      { docId: 4, quality: 90, flags: 5 },
      { docId: 19, quality: 75, flags: 1 },
      { docId: 7, quality: 60, flags: 0 },
    ]);
    expect(bytesRead).toBeLessThanOrEqual(object.length);
  });
});

