import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentBrowser } from '../research-agent/browser';
import type { SearchSpec } from './search-spec';
import type { SpecRow } from '../spec-search.functions';
vi.mock('./provider-ladder', () => ({ discoverWebFreeFirst: vi.fn(async () => ({ results: [], provider_used: 'searxng' })) }));
const { discoverWithBrowser } = await import('./browser-live.server');
const spec: SearchSpec = { entity: 'company', criteria: [], raw_query: 'companies hiring', missing: [], status: 'ready_to_search', signal_required: true, signal_types: ['hiring'], signal_recency: null };
const row: SpecRow = { kind: 'company', title: 'Offline Example', detail: '', entity_id: 'offline', entity_resolved: true, page_type: 'entity_page', website_url: 'https://offline.invalid', source_url: 'https://offline.invalid', evidence: [] };
const snapshot = { url: 'https://search.invalid', title: 'No results', pageType: 'search_results', headings: [], visibleRelevantText: 'No search results in offline fixture.', links: [], interactiveElements: [], selectedFilters: [], loadingState: 'complete', friction: [] };
function browser(navigate: unknown): AgentBrowser {
  return { createSession: async () => ({ id: 'offline', counters: {}, limits: {}, lastSnapshot: null }), navigate,
    search: async () => ({ snapshot, action: 'search', verified: true }),
    observe: async () => snapshot, extract: async () => ({ values: { body: snapshot.visibleRelevantText }, errors: [] }),
    extractLinks: async () => [], close: async () => undefined } as unknown as AgentBrowser;
}
const options = { initialCandidates: [row], discoveryQueries: [], timeoutMs: 10000 };
afterEach(() => vi.unstubAllGlobals());

describe('browser cancellation owns eager work rejection', () => {
  it.each([false, true])('user abort rejects even when eagerly created worker work resolves=%s', async resolves => {
    const controller = new AbortController();
    const adapter = browser(() => { controller.abort(); return resolves
      ? Promise.resolve({ snapshot, action: 'navigate', verified: true })
      : Promise.reject(new Error('SEARCH_CANCELLED')); });
    await expect(discoverWithBrowser(spec, { ...options, browser: adapter, signal: controller.signal })).rejects.toThrow('SEARCH_CANCELLED');
    await new Promise(resolve => setImmediate(resolve)); // Vitest fails on any detached rejection.
  });

  it('owns a late worker rejection after midflight user cancellation', async () => {
    const controller = new AbortController();
    const adapter = browser(() => new Promise((_resolve, reject) => {
      setTimeout(() => controller.abort(), 0);
      setTimeout(() => reject(new Error('SEARCH_CANCELLED')), 15);
    }));
    await expect(discoverWithBrowser(spec, { ...options, browser: adapter, signal: controller.signal })).rejects.toThrow('SEARCH_CANCELLED');
    await new Promise(resolve => setTimeout(resolve, 30));
  });

  it('keeps existing partial settlement on local timeout and owns late worker rejection', async () => {
    const adapter = browser(() => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('SEARCH_CANCELLED')), 1100)));
    const rows = await discoverWithBrowser(spec, { ...options, timeoutMs: 1000, browser: adapter });
    expect(rows.map(item => item.title)).toContain(row.title);
    await new Promise(resolve => setTimeout(resolve, 150));
  });

  it('preserves normal worker error in page diagnostics instead of converting it to cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture'); }));
    const trace: Array<{ kind: string; reason?: string }> = [];
    const rows = await discoverWithBrowser(spec, { ...options, browser: browser(() => Promise.reject(new Error('OFFLINE_PROVIDER_ERROR'))), onTrace: event => trace.push(event) });
    expect(rows.map(item => item.title)).toContain(row.title);
    expect(trace.some(event => event.kind === 'page' && event.reason === 'OFFLINE_PROVIDER_ERROR')).toBe(true);
  });
});
