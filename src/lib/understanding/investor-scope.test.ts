import { describe, expect, it } from 'vitest';
import { extractFrameDeterministic } from './fallback';
import { validateFrame } from './validate';
import { frameToSearchSpec } from './to-search-spec';
import { rowCouldSatisfySpec, rowSatisfiesSpec, postResearchRejectReason, type SpecRow } from '../spec-search.functions';
import { investorScopeState, observedInvestorTypes } from '../search/entity-resolve';
import { computeResearchNeeds } from '../search/browser-research';
import { qualifyLead } from '../search/qualify';
import { browserEntitiesToRows } from '../search/browser-live.server';
import { buildCandidateResearchQueries, buildResearchPlan } from '../search/source-plan';

const original = 'looking for investors who actually invest in ai startups, ideally seed/preseed, canada or us is good, checks maybe 100k to 2m ish but thats not an absolute rule, bonus if theyve invested in devtools automation agents data infra kinda stuff recently, i want actual funds/angels not articles talking about venture capital';
const specOf = (raw: string) => frameToSearchSpec(validateFrame(extractFrameDeterministic(raw)).frame);
const scoped = specOf(original);
const row = (name: string, quote: string): SpecRow => ({ kind: 'investor', title: name, detail: '', entity_id: name, entity_resolved: true, page_type: 'entity_page', sector: 'AI', country: 'CA', location: 'Toronto', website_url: 'https://subject.example', evidence: [{ subject: name, source_url: 'https://subject.example', source_type: 'web', evidence_type: 'identity', supports: 'identity', excerpt: quote, observed_at: '2026-10-10T00:00:00Z', confidence: .9 }] });

describe('explicit fund-or-angel investor scope', () => {
  it.each([original, 'Find fintech investors in Germany, actual venture capital funds or individual angel investors, not articles', 'Find climate investors in Japan, I want real angels or investment funds'])('preserves required OR scope and acquires its actual classes: %s', raw => {
    const frame = extractFrameDeterministic(raw);
    expect(frame.target.entity_subtype?.normalized).toBe('fund or angel');
    frame.meta.extractor = 'llm'; frame.target.entity_subtype = null;
    const spec = frameToSearchSpec(validateFrame(frame).frame);
    expect(spec.criteria).toContainEqual(expect.objectContaining({ field: 'investor_type', value: 'fund or angel' }));
    const queries = buildResearchPlan(spec).discoveryQueries;
    expect(queries.some(query => /funds/.test(query))).toBe(true);
    expect(queries.some(query => /angel investors/.test(query))).toBe(true);
    expect(queries.some(query => /startup investors list|site:linkedin.com\/in investor/.test(query))).toBe(false);
  });
  it.each(['Find AI investors in Canada', 'Find AI investors in Canada, ideally funds or angels', 'Find AI investors in Canada, not funds or angels'])('does not narrow a broad, preferred, or negated class ask: %s', raw => {
    expect(specOf(raw).criteria.some(item => item.field === 'investor_type')).toBe(false);
  });
  it.each(['Acme is a venture capital fund', 'Acme — early-stage investment firm', 'Acme is an individual angel investor', 'Acme is a partner at Example Fund and an angel investor'])('accepts subject-own investor identity: %s', quote => {
    expect(rowSatisfiesSpec(scoped, row('Acme', quote))).toBe(true);
  });
  it.each(['Acme is a partner at Example Fund', 'Acme is not an angel investor', 'Acme consults for a venture capital fund', 'Acme works with OtherCo, a venture capital fund', 'Acme invests in Example Startup', 'Acme is a supplier to angel investors', 'Acme invested in a venture capital fund', 'Acme backed an angel investor', 'Acme interviewed an angel investor', 'Acme is not only an angel investor'])('retains unknown scope for research but denies strict delivery: %s', quote => {
    const candidate = row('Acme', quote);
    expect(rowCouldSatisfySpec(scoped, candidate)).toBe(true);
    expect(rowSatisfiesSpec(scoped, candidate)).toBe(false);
    expect(postResearchRejectReason(scoped, candidate)).toBe('UNPROVEN_CRITERION:investor_type=UNKNOWN');
    const needs = computeResearchNeeds(candidate, scoped, qualifyLead(candidate, scoped, candidate.evidence));
    expect(needs).toContain('identity');
    expect(buildCandidateResearchQueries(scoped, candidate, needs)).toContain('"Acme" fund OR "angel investor" official profile');
    expect(investorScopeState(specOf('Find AI investors in Canada'), candidate)).toBe('pass');
  });
  it('cannot prove investor type from unrelated subject or arbitrary metadata', () => {
    const candidate = row('Acme', 'OtherCo is a venture capital fund');
    expect(investorScopeState(scoped, candidate)).toBe('unknown');
    expect(investorScopeState(scoped, { ...row('Acme', 'Acme is a venture capital fund'), evidence: [{ ...candidate.evidence![0], subject: 'OtherCo' }] })).toBe('unknown');
    expect(observedInvestorTypes('Acme', 'Acme — Partner @ Example Fund')).toEqual([]);
    expect(observedInvestorTypes('Acme', 'Acme — invested in a venture capital fund')).toEqual([]);
    expect(observedInvestorTypes('Acme', 'Acme, backed an angel investor')).toEqual([]);
    expect(observedInvestorTypes('Acme', 'Acme is a PARTNER AT venture capital firm')).toEqual([]);
    expect(observedInvestorTypes('Acme', 'Acme is a venture capital fund partner')).toEqual([]);
    expect(observedInvestorTypes('Acme', 'Acme is a fund manager')).toEqual([]);
    expect(observedInvestorTypes('Acme', 'Acme — ACTIVE NOT AN angel investor')).toEqual([]);
    expect(observedInvestorTypes('Acme', 'Acme — INVESTED IN A venture capital fund')).toEqual([]);
    expect(observedInvestorTypes('Acme', 'Acme is an AI-focused venture capital fund')).toEqual(['fund']);
  });
  it('normalizes a proven angel person while retaining ordinary staff as people', () => {
    for (const [name, quote, expected] of [['Sam Angel', 'Sam Angel is an angel investor who invests in AI startups', 'investor'], ['Sam Staff', 'Sam Staff is a partner at Example Fund', 'person']] as const) {
      const page = { url: 'https://subject.example', title: name, text: quote };
      const rows = browserEntitiesToRows([{ page: 0, kind: 'person', name, identityQuote: quote, fields: {} }], [page], undefined, { ...scoped, criteria: scoped.criteria.filter(item => !item.field.startsWith('location')) });
      expect(rows[0]?.kind).toBe(expected);
    }
  });
});
