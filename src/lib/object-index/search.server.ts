import { parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import type { DbHitMeta } from "@/lib/canonical/read-parquet.server";
import { checkPhone } from "@/lib/search/phone-safety";
import { COUNTRY_ISO } from "@/lib/search/search-spec-extract";
import { queryRequiredFields } from "@/lib/search/canonical-contract";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { SpecRow } from "@/lib/spec-search.functions";
import { categoryTerms, cityTerm, normalizeIndexText, postingBucket, roleTerm } from "./normalization";
import { getSearchIndexObjectStore, type SearchIndexObjectStore } from "./object-store.server";
import { readPosting } from "./postings";
import { documentSatisfiesRetrievalPlan, retrievalPlanFromSpec } from "./retrieval-plan";
import {
  CONTACT_FLAG_EMAIL,
  CONTACT_FLAG_PHONE,
  CONTACT_FLAG_WEBSITE,
  type ActiveSearchIndex,
  type CompactSearchDocument,
  type IndexedEntity,
  type PostingCandidate,
  type SearchDocumentRange,
  type SearchIndexManifest,
  SEARCH_INDEX_SCHEMA_VERSION,
} from "./types";

export interface ObjectIndexQueryResult {
  rows: SpecRow[];
  meta: DbHitMeta;
  coverage: "SEARCHABLE" | "NO_DATA" | "NO_COVERAGE";
}

interface DimensionQuery { dimension: string; terms: string[] }

const PREFIX = process.env.SEARCH_INDEX_PREFIX?.trim() || "derived/search-index";
const ACTIVE_KEY = `${PREFIX}/active.json`;
const textDecoder = new TextDecoder();
const manifestCache = new Map<string, SearchIndexManifest>();

function field(spec: SearchSpec, name: string): string | null {
  return spec.criteria.find((criterion) => criterion.field === name)?.value?.trim() || null;
}

function countryTerm(value: string): string {
  const normalized = value.trim().toLowerCase();
  return (COUNTRY_ISO[normalized]?.[0] || (/^[a-z]{2}$/.test(normalized) ? normalized : "")).toUpperCase();
}

function dimensionsForSpec(spec: SearchSpec): DimensionQuery[] {
  const location = field(spec, "location");
  const name = field(spec, "name");
  const domain = field(spec, "domain");
  const isCountry = location ? !!COUNTRY_ISO[location.toLowerCase()] || /^[a-z]{2}$/i.test(location) : false;
  const place = location ? (isCountry ? countryTerm(location) : cityTerm(location)) : null;
  if (spec.entity === "business") {
    const category = field(spec, "category");
    const categories = category ? categoryTerms("business", category) : [];
    return [
      ...(place ? [{ dimension: isCountry ? "country" : "city", terms: [place] }] : []),
      ...(categories.length ? [{ dimension: "category", terms: categories }] : []),
      ...(name ? [{ dimension: "name", terms: [normalizeIndexText(name)] }] : []),
      ...(domain ? [{ dimension: "domain", terms: [normalizeIndexText(domain)] }] : []),
    ];
  }
  if (spec.entity === "person") {
    const role = field(spec, "role");
    const normalizedRole = role ? roleTerm(role) : null;
    return [
      ...(normalizedRole ? [{ dimension: "role", terms: [normalizedRole] }] : []),
      ...(place ? [{ dimension: isCountry ? "country" : "city", terms: [place] }] : []),
      ...(field(spec, "industry") ? [{ dimension: "industry", terms: [normalizeIndexText(field(spec, "industry")!)] }] : []),
      ...(field(spec, "company") ? [{ dimension: "employer", terms: [normalizeIndexText(field(spec, "company")!)] }] : []),
      ...(name ? [{ dimension: "name", terms: [normalizeIndexText(name)] }] : []),
    ];
  }
  if (spec.entity === "company") {
    const category = field(spec, "category") || field(spec, "industry");
    const categories = category ? categoryTerms("company", category) : [];
    return [
      ...(categories.length ? [{ dimension: "category", terms: categories }] : []),
      ...(place ? [{ dimension: isCountry ? "country" : "coarse_location", terms: [place] }] : []),
      ...(name ? [{ dimension: "name", terms: [normalizeIndexText(name)] }] : []),
      ...(domain ? [{ dimension: "domain", terms: [normalizeIndexText(domain)] }] : []),
    ];
  }
  if (spec.entity === "investor") {
    return [
      ...(field(spec, "investor_sector") ? [{ dimension: "sector", terms: [normalizeIndexText(field(spec, "investor_sector")!)] }] : []),
      ...(field(spec, "investor_stage") ? [{ dimension: "stage", terms: [normalizeIndexText(field(spec, "investor_stage")!)] }] : []),
      ...(place ? [{ dimension: isCountry ? "country" : "location", terms: [place] }] : []),
      ...(name ? [{ dimension: "name", terms: [normalizeIndexText(name)] }] : []),
      ...(field(spec, "investor_kind") ? [{ dimension: "kind", terms: [normalizeIndexText(field(spec, "investor_kind")!)] }] : []),
    ];
  }
  return [];
}

async function loadManifest(store: SearchIndexObjectStore): Promise<SearchIndexManifest> {
  const explicitManifestKey = process.env.SEARCH_INDEX_MANIFEST_KEY?.trim();
  const manifestKey = explicitManifestKey || (JSON.parse(
    textDecoder.decode(await store.getObject(ACTIVE_KEY)),
  ) as ActiveSearchIndex).manifestKey;
  const cached = manifestCache.get(manifestKey);
  if (cached) return cached;
  const manifest = JSON.parse(textDecoder.decode(await store.getObject(manifestKey))) as SearchIndexManifest;
  if (manifest.status !== "complete") throw new Error(`search index version is not complete: ${manifest.version}`);
  if (manifest.schemaVersion !== SEARCH_INDEX_SCHEMA_VERSION) {
    throw new Error(`unsupported search index schema ${manifest.schemaVersion}`);
  }
  manifestCache.set(manifestKey, manifest);
  return manifest;
}

function union(rows: PostingCandidate[][]): PostingCandidate[] {
  const found = new Map<number, PostingCandidate>();
  for (const list of rows) for (const row of list) {
    const old = found.get(row.docId);
    if (!old || row.quality > old.quality) found.set(row.docId, row);
  }
  return [...found.values()];
}

function intersect(groups: PostingCandidate[][]): PostingCandidate[] {
  if (!groups.length) return [];
  let current = new Map(groups[0].map((candidate) => [candidate.docId, candidate]));
  for (const group of groups.slice(1)) {
    const next = new Map(group.map((candidate) => [candidate.docId, candidate]));
    current = new Map([...current].filter(([id]) => next.has(id)));
  }
  return [...current.values()];
}

function rangeForDoc(ranges: SearchDocumentRange[], entity: IndexedEntity, docId: number): SearchDocumentRange | null {
  return ranges.find((range) => range.entity === entity && docId >= range.startId && docId < range.endId) ?? null;
}

async function readDocuments(
  store: SearchIndexObjectStore,
  manifest: SearchIndexManifest,
  entity: IndexedEntity,
  ids: number[],
): Promise<{ rows: CompactSearchDocument[]; bytesRead: number; objects: string[] }> {
  const grouped = new Map<string, { range: SearchDocumentRange; ids: number[] }>();
  for (const id of ids) {
    const range = rangeForDoc(manifest.documentObjects, entity, id);
    if (!range) throw new Error(`document locator missing: ${entity}:${id}`);
    const group = grouped.get(range.key) ?? { range, ids: [] };
    group.ids.push(id);
    grouped.set(range.key, group);
  }
  const output: CompactSearchDocument[] = [];
  let bytesRead = 0;
  for (const [key, group] of grouped) {
    const wanted = new Set(group.ids);
    const positions = group.ids.map((id) => id - group.range.startId).sort((a, b) => a - b);
    const file = {
      byteLength: group.range.bytes,
      slice: async (start: number, end?: number) => {
        const data = await store.getObject(key, { start, end: end === undefined ? undefined : end - 1 });
        bytesRead += data.byteLength;
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      },
    };
    const metadata = await parquetMetadataAsync(file);
    let start = positions[0];
    let end = start + 1;
    const flush = async () => {
      const rows = await parquetReadObjects({ file, metadata, rowStart: start, rowEnd: end } as never) as CompactSearchDocument[];
      output.push(...rows.filter((row) => wanted.has(Number(row.doc_id))));
    };
    for (const position of positions.slice(1)) {
      if (position <= end + 8) end = position + 1;
      else { await flush(); start = position; end = position + 1; }
    }
    await flush();
  }
  return { rows: output, bytesRead, objects: [...grouped.keys()] };
}

function toSpecRow(document: CompactSearchDocument): SpecRow {
  const phone = checkPhone(document.phone, document.country ?? "");
  const location = document.city || document.coarse_location || document.country || null;
  const common = {
    key: document.registry_key,
    entity_id: document.registry_key,
    entity_resolved: true,
    identity_confidence: 0.9,
    email: document.email ?? null,
    phone: phone.phone,
    phoneStatus: phone.status,
    url: document.website || document.linkedin || null,
    location,
    country: document.country ?? null,
  };
  if (document.entity === "person") return {
    ...common,
    kind: "person",
    page_type: "person_page",
    title: `${document.name} — ${document.title ?? "?"} @ ${document.employer ?? "?"}`,
    detail: [document.employer, document.city, document.country, document.industry].filter(Boolean).join(" · "),
    industry: document.industry ?? null,
  };
  if (document.entity === "company") return {
    ...common,
    kind: "company",
    page_type: "company_page",
    title: `${document.name} — ${document.category ?? ""}`,
    detail: [location, document.website].filter(Boolean).join(" · "),
    category: document.category ?? null,
  };
  if (document.entity === "investor") return {
    ...common,
    kind: "investor",
    page_type: "person_page",
    title: `${document.name} — ${document.kind ?? "investor"}`,
    detail: [document.sector, document.stage, location].filter(Boolean).join(" · "),
    sector: document.sector ?? null,
    stage: document.stage ?? null,
  };
  return {
    ...common,
    kind: "business",
    page_type: "entity_page",
    title: document.name,
    detail: [document.city, document.coarse_location, document.country].filter(Boolean).join(", "),
    category: document.category ?? null,
  };
}

export async function queryObjectIndexForSpec(
  spec: SearchSpec,
  limit: number,
  offset = 0,
  store: SearchIndexObjectStore = getSearchIndexObjectStore(),
): Promise<ObjectIndexQueryResult | null> {
  if (!(["business", "company", "person", "investor"] as string[]).includes(spec.entity)) return null;
  const dimensions = dimensionsForSpec(spec);
  if (!dimensions.length) return null;
  const manifest = await loadManifest(store);
  const entity = spec.entity as IndexedEntity;
  const available = new Set(manifest.postingObjects.map((object) => object.key));
  const touched: string[] = [];
  const dimensionGroups: PostingCandidate[][] = [];
  let bytesRead = 0;
  let catalogChecked = false;
  for (const dimension of dimensions) {
    const termGroups: PostingCandidate[][] = [];
    let dimensionHadObject = false;
    for (const term of dimension.terms) {
      const bucket = await postingBucket(term, manifest.postingBucketHexChars);
      const key = `${PREFIX}/versions/${manifest.version}/postings/${entity}/${dimension.dimension}/${bucket}.pidx`;
      if (!available.has(key)) continue;
      dimensionHadObject = true;
      const posting = await readPosting(store, key, term);
      bytesRead += posting.bytesRead;
      touched.push(key);
      catalogChecked = true;
      termGroups.push(posting.candidates);
    }
    if (!dimensionHadObject) {
      return {
        rows: [],
        coverage: "NO_COVERAGE",
        meta: {
          dbHit: false,
          engine: "s3-object-index",
          partitionsRead: touched,
          rowsScanned: 0,
          rowsReturned: 0,
          bytesRead,
          canonicalRowsRead: 0,
          indexUsed: dimensions.map((item) => item.dimension).join("&"),
        },
      };
    }
    dimensionGroups.push(union(termGroups));
  }
  const candidates = intersect(dimensionGroups);
  const required = new Set(queryRequiredFields(spec));
  const filtered = candidates
    .filter((candidate) => !required.has("email") || (candidate.flags & CONTACT_FLAG_EMAIL) !== 0)
    .filter((candidate) => !required.has("phone") || (candidate.flags & CONTACT_FLAG_PHONE) !== 0)
    .filter((candidate) => field(spec, "opportunity") !== "no_website" ||
      (candidate.flags & CONTACT_FLAG_WEBSITE) === 0)
    .sort((a, b) => b.quality - a.quality || a.docId - b.docId);
  const plan = retrievalPlanFromSpec(spec);
  const accepted: CompactSearchDocument[] = [];
  const hydratedObjects: string[] = [];
  const chunkSize = Math.max(100, limit * 2);
  for (let at = 0; at < filtered.length && accepted.length < offset + limit; at += chunkSize) {
    const hydrated = await readDocuments(
      store,
      manifest,
      entity,
      filtered.slice(at, at + chunkSize).map((candidate) => candidate.docId),
    );
    bytesRead += hydrated.bytesRead;
    hydratedObjects.push(...hydrated.objects);
    const byId = new Map(hydrated.rows.map((document) => [Number(document.doc_id), document]));
    for (const candidate of filtered.slice(at, at + chunkSize)) {
      const document = byId.get(candidate.docId);
      if (document && documentSatisfiesRetrievalPlan(document, plan)) accepted.push(document);
    }
  }
  const rows = accepted.slice(offset, offset + limit).map(toSpecRow);
  const meta: DbHitMeta = {
    dbHit: rows.length > 0,
    engine: "s3-object-index",
    partitionsRead: [...new Set([...touched, ...hydratedObjects])],
    rowsScanned: candidates.length,
    rowsReturned: rows.length,
    bytesRead,
    canonicalRowsRead: 0,
    indexUsed: dimensions.map((dimension) => dimension.dimension).join("&"),
  };
  return { rows, meta, coverage: rows.length ? "SEARCHABLE" : catalogChecked ? "NO_DATA" : "NO_COVERAGE" };
}

export function clearObjectIndexCaches(): void {
  manifestCache.clear();
}
