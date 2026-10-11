import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchSpec } from '../search-spec';
import type { SpecRow } from '../../spec-search.functions';
import type { AgentBrowser } from '../../research-agent/browser';
const search = vi.fn(async () => ({ results: [], sourceHealth: null }));
vi.mock('../provider-ladder', () => ({ discoverWebFreeFirst: (...args: unknown[]) => (search as (...args: unknown[]) => unknown)(...args) }));
const { discoverWithBrowser } = await import('../browser-live.server');
const { rowCouldSatisfySpec } = await import('../../spec-search.functions');
const spec: SearchSpec = { entity: 'investor', criteria: [{ field: 'investor_type', value: 'fund or angel', stated: true, confidence: 1 }], raw_query: 'actual funds or angels', missing: [], status: 'ready_to_search', signal_required: true, signal_types: ['investment'], signal_recency: null };
const staff: SpecRow = { kind: 'investor', title: 'Sam Staff', detail: '', company: 'Example Fund', role: 'Partner', entity_id: 'staff', entity_resolved: true, page_type: 'entity_page', website_url: 'https://staff.invalid', source_url: 'https://staff.invalid', evidence: [{ subject: 'staff', source_url: 'https://staff.invalid', source_type: 'db', evidence_type: 'identity', supports: 'identity', excerpt: 'Sam Staff — Partner @ Example Fund', observed_at: '2026-10-10T00:00:00Z', confidence: 1 }] };
const snapshot = { url: 'https://search.invalid', title: 'No results', pageType: 'search_results', headings: [], visibleRelevantText: 'No search results available in this offline fixture.', links: [], interactiveElements: [], selectedFilters: [], loadingState: 'complete', friction: [] };
const browser = {
  createSession: vi.fn(async () => ({ id: 'fixture', visible: false, screenshotDirectory: '', createdAt: '2026-10-10', counters: { actions: 0, pages: 0, scrolls: 0, screenshots: 0, reasoningCalls: 0 }, limits: { actions: 50, pages: 20, scrolls: 2, screenshots: 0, reasoningCalls: 0 }, lastSnapshot: null })),
  navigate: vi.fn(async (_session, url: string) => ({ snapshot: { ...snapshot, url }, action: 'navigate', verified: true })),
  search: vi.fn(async () => ({ snapshot, action: 'search', verified: true })),
  observe: vi.fn(async () => snapshot),
  extract: vi.fn(async () => ({ values: { body: snapshot.visibleRelevantText }, sourceUrl: snapshot.url, observedAt: '2026-10-10', errors: [] })),
  extractLinks: vi.fn(async () => []), close: vi.fn(async () => undefined),
} as unknown as AgentBrowser;
afterEach(() => { search.mockClear(); vi.unstubAllGlobals(); });

describe('scoped investor research budget priority', () => {
  it.each([true, false])('scope=%s defers unknown staff to discovery while preserving broad seed behavior', async scoped => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture'); }));
    const request = scoped ? spec : { ...spec, criteria: [] };
    const rows = await discoverWithBrowser(request, { browser, initialCandidates: [staff], discoveryQueries: ['AI venture capital funds'], desiredCount: 1, maxPages: 1, timeoutMs: 1000 });
    const first = (search.mock.calls as unknown as Array<[{ queries: string[] }]>)[0]?.[0].queries[0];
    if (scoped) expect(first).toBe('AI venture capital funds');
    else expect(first).toContain('Sam Staff');
    expect(rows.some(row => row.title === staff.title)).toBe(true);
    expect(rowCouldSatisfySpec(request, staff)).toBe(true);
  });
});
it('preserves broad seed research when discovery has no queries', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture'); }));
  let attempts = -1;
  await discoverWithBrowser({ ...spec, criteria: [] }, { browser, initialCandidates: [staff],
    discoveryQueries: [], desiredCount: 1, maxPages: 6, timeoutMs: 10000,
    onCandidateMemory: memory => { attempts = memory.find(item => item.row.title === staff.title)?.attempts ?? -1; } });
  const queries = (search.mock.calls as unknown as Array<[{ queries: string[] }]>).flatMap(call => call[0].queries);
  expect(queries[0]).toContain('Sam Staff');
  expect(attempts).toBe(2); // Existing research() permits two bounded attempts.
});

it('researches deferred AV8 fund seed after empty scoped discovery with remaining budget', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture'); }));
  const fund = { ...staff, title: 'AV8 Ventures', entity_id: 'av8', company: undefined, role: undefined,
    evidence: [{ ...staff.evidence![0], subject: 'av8', excerpt: 'AV8 Ventures', source_url: 'https://av8.invalid' }],
    website_url: 'https://av8.invalid', source_url: 'https://av8.invalid' };
  let attempts = -1;
  const rows = await discoverWithBrowser(spec, { browser, initialCandidates: [fund],
    discoveryQueries: ['AI venture capital funds'], desiredCount: 1, maxPages: 6, timeoutMs: 10000,
    onCandidateMemory: memory => { attempts = memory.find(item => item.row.title === fund.title)?.attempts ?? -1; } });
  const queries = (search.mock.calls as unknown as Array<[{ queries: string[] }]>).flatMap(call => call[0].queries);
  expect(queries[0]).toBe('AI venture capital funds');
  expect(rows.some(row => row.title === fund.title)).toBe(true);
  expect(rowCouldSatisfySpec(spec, fund)).toBe(true);
  expect(attempts, 'retained resolved fund remains entirely unresearched after discovery').toBeGreaterThan(0);
  expect(queries.some(query => query.includes('AV8 Ventures'))).toBe(true);
});

