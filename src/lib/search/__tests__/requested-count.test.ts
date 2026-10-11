import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSpecSearchCore } from '../../spec-search.functions';
import type { SearchSpec } from '../../search/search-spec';
import * as liveGapfill from '../../search/live-gapfill';
import { buildSourcePlan } from '../../search/source-plan';
afterEach(() => vi.restoreAllMocks());
const base: SearchSpec = { entity: 'company', criteria: [{ field: 'industry', value: 'software', stated: true, confidence: 1 }, { field: 'location', value: 'USA', stated: true, confidence: 1 }], raw_query: 'software companies in USA', missing: [], status: 'ready_to_search', signal_required: false, signal_types: [], signal_recency: null };
const counted = (count?: number): SearchSpec => ({ ...base, criteria: [...base.criteria, ...(count === undefined ? [] : [{ field: 'requested_count', value: String(count), stated: true, confidence: 1 }])] });
const records = Array.from({ length: 150 }, (_, index) => ({ registry_id: `count-${index}`, company_name: `Count Company ${index}`, category: 'Software', location: 'New York', country: 'USA', website: `https://count-${index}.example` }));
const companies = (empty = false) => vi.fn(async () => ({ rows: empty ? [] : records, meta: { dbHit: true, engine: 's3-parquet', partitionsRead: ['fixture'], rowsScanned: records.length, rowsReturned: empty ? 0 : records.length } }));

describe('requested count stays separate from API page size and oversampling', () => {
  it('delivers only requested ten from fifty qualified rows with API page size fifty', async () => {
    const result = await runSpecSearchCore(base.raw_query, { companies: companies() as never, liveGapfill: null }, 50, {}, { spec: counted(10), force: true });
    expect(result.rows).toHaveLength(10);
    expect(result.limit).toBe(50);
    expect(result.executionPlan?.researchPlan.desiredCount).toBe(10);
    expect(result.hasMore).toBe(false);
  });

  it.each([10, 50, 100])('passes exact numeric target%s to interactive live acquisition', async count => {
    const live = vi.spyOn(liveGapfill, 'runLiveGapfill').mockImplementation(async (spec, options) => ({ rows: [], source: null, plan: buildSourcePlan(spec, undefined, { desiredCount: options?.desiredCount }), diagnostics: [{ provider: 'browser-live', attempted: true, succeeded: true, artifactsFound: 0, qualified: 0 }] } as never));
    const result = await runSpecSearchCore(base.raw_query, { companies: companies(true) as never, liveGapfill: {} }, 50, {}, { spec: counted(count), force: true });
    expect(live.mock.calls.length).toBeGreaterThan(0);
    expect(live.mock.calls.every(([, options]) => options?.desiredCount === count)).toBe(true);
    expect(result.executionPlan?.researchPlan.desiredCount).toBe(count);
  });

  it('preserves second page of hundred and stops exhausted ten intent', async () => {
    const smallPage = await runSpecSearchCore(base.raw_query, { companies: companies() as never, liveGapfill: null }, 2, {}, { spec: counted(5), force: true });
    expect(smallPage.rows).toHaveLength(2);
    expect(smallPage.executionPlan?.researchPlan.desiredCount).toBe(5);
    expect(smallPage.hasMore).toBe(true);
    const next = await runSpecSearchCore(base.raw_query, { companies: companies() as never, liveGapfill: null }, 50, {}, { spec: counted(100), offset: 50, force: true });
    expect(next.rows).toHaveLength(50);
    expect(next.hasMore).toBe(false);
    const exhausted = await runSpecSearchCore(base.raw_query, { companies: companies() as never, liveGapfill: null }, 50, {}, { spec: counted(10), offset: 50, force: true });
    expect(exhausted.rows).toHaveLength(0);
    expect(exhausted.hasMore).toBe(false);
  });

  it('retains unnumbered page fifty behavior', async () => {
    const result = await runSpecSearchCore(base.raw_query, { companies: companies() as never, liveGapfill: null }, 50, {}, { spec: counted(), force: true });
    expect(result.rows).toHaveLength(50);
    expect(result.executionPlan?.researchPlan.desiredCount).toBe(50);
    expect(result.hasMore).toBe(true);
  });

  it('falls back to page size for a count that floors below one', async () => {
    const result = await runSpecSearchCore(base.raw_query, { companies: companies() as never, liveGapfill: null }, 50, {}, { spec: counted(0.5), force: true });
    expect(result.rows).toHaveLength(50);
    expect(result.executionPlan?.researchPlan.desiredCount).toBe(50);
  });

  it('preserves job pool override and bounded acquisition batch widening', async () => {
    const live = vi.spyOn(liveGapfill, 'runLiveGapfill').mockImplementation(async (spec, options) => ({ rows: [], source: null, plan: buildSourcePlan(spec, undefined, { desiredCount: options?.desiredCount }), diagnostics: [] } as never));
    await runSpecSearchCore(base.raw_query, { companies: companies(true) as never, liveGapfill: {} }, 50, {}, { spec: counted(10), force: true, jobContext: { poolTargetOverride: 200 } });
    expect(live.mock.calls[0]?.[1]?.desiredCount).toBe(30);
    expect(live.mock.calls).toHaveLength(1); // Job engine owns its widening.
  });

  it('preserves unnumbered initial batch and widening acquisition targets', async () => {
    const live = vi.spyOn(liveGapfill, 'runLiveGapfill').mockImplementation(async (spec, options) => ({ rows: [], source: null, plan: buildSourcePlan(spec, undefined, { desiredCount: options?.desiredCount }), diagnostics: [] } as never));
    await runSpecSearchCore(base.raw_query, { companies: companies(true) as never, liveGapfill: {} }, 50, {}, { spec: counted(), force: true });
    expect(live.mock.calls.map(([, options]) => options?.desiredCount)).toEqual([30, 30, 60]);
  });

  it('keeps direct gapfill explicit desiredCount override above parsed count', async () => {
    const browser = vi.fn(async (_spec: SearchSpec, _options: { desiredCount?: number }) => []);
    const result = await liveGapfill.runLiveGapfill(counted(10), { desiredCount: 100, web: null, jobs: null, osm: null, browser });
    expect(result.plan?.researchPlan.desiredCount).toBe(100);
    expect(browser.mock.calls[0]?.[1]?.desiredCount).toBe(100);
  });
});

