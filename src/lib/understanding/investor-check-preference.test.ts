import { describe, expect, it } from 'vitest';
import { detectConstraints, extractFrameDeterministic } from './fallback';
import { validateFrame } from './validate';
import { frameToSearchSpec } from './to-search-spec';
import { applyClarificationToFrame } from './to-search-spec';
import { rowSatisfiesSpec, type SpecRow } from '../spec-search.functions';

const original = 'looking for investors who actually invest in ai startups, ideally seed/preseed, canada or us is good, checks maybe 100k to 2m ish but thats not an absolute rule, bonus if theyve invested in devtools automation agents data infra kinda stuff recently, i want actual funds/angels not articles talking about venture capital';
const specOf = (raw: string) => frameToSearchSpec(validateFrame(extractFrameDeterministic(raw)).frame);

describe('optional investor monetary check range', () => {
  it.each([
    [original, '100000|2000000'],
    ['Find AI investors in Canada, preferably checks of $100,000 to $2 million, not companies', '100000|2000000'],
    ['Find investors in Canada with cheques between 250k and 1.5m, not a strict requirement', '250000|1500000'],
    ['Find investors in Canada, ticket sizes ideally USD 100k–USD 2m', '100000|2000000'],
    ['Find investors in Canada, checks 100k to 2m but that is not mandatory', '100000|2000000'],
  ])('preserves endpoints and optional strength: %s', (raw, value) => {
    const spec = specOf(raw);
    expect(spec.criteria).toContainEqual(expect.objectContaining({ field: 'prefer_investor_check', value }));
    expect(spec.criteria.some(c => c.field === 'investor_check')).toBe(false);
    expect(spec.criteria.some(c => c.field === 'exclude_category' && /rule|requirement|mandatory/.test(c.value))).toBe(false);
  });

  it('repairs an otherwise valid provider frame that omitted the check preference', () => {
    const frame = extractFrameDeterministic(original);
    frame.meta.extractor = 'llm';
    frame.constraints = frame.constraints.filter(c => c.field !== 'prefer_investor_check');
    const repaired = validateFrame(frame);
    expect(repaired.repairs.some(r => r.code === 'CONSTRAINT_RECOVERED_FROM_INPUT')).toBe(true);
    expect(frameToSearchSpec(repaired.frame).criteria).toContainEqual(expect.objectContaining({ field: 'prefer_investor_check', value: '100000|2000000' }));
    expect(validateFrame(repaired.frame).frame.constraints.filter(c => c.field === 'prefer_investor_check')).toHaveLength(1);
  });

  it('preserves explicit currency without guessing bare dollar currency', () => {
    expect(detectConstraints('Find investors, checks ideally CAD 100k to CAD 2m')).toContainEqual(expect.objectContaining({ field: 'prefer_investor_check', unit: 'CAD' }));
    expect(detectConstraints('Find investors, cheques ideally €100k to €2m')).toContainEqual(expect.objectContaining({ field: 'prefer_investor_check', unit: 'EUR' }));
    expect(detectConstraints('Find investors, checks maybe $100k to $2m')).toContainEqual(expect.objectContaining({ field: 'prefer_investor_check', unit: null }));
  });

  it('keeps adjacent hard attributes and genuine exclusions', () => {
    const spec = specOf('Find investors in Canada, at least 20 employees, checks maybe 100k to 2m but not an absolute rule, not companies');
    expect(spec.criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'employee_count', value: '20' }),
      expect.objectContaining({ field: 'prefer_investor_check', value: '100000|2000000' }),
      expect.objectContaining({ field: 'exclude_category', value: 'company' }),
    ]));
  });

  it('retains the genuine article exclusion in the original investor request', () => {
    expect(specOf(original).criteria).toContainEqual(expect.objectContaining({ field: 'exclude_category', value: expect.stringContaining('article') }));
  });

  it('does not inherit an unrelated later preference', () => {
    expect(detectConstraints('Find investors with checks 100k to 2m and emails preferred').some(c => c.field === 'prefer_investor_check')).toBe(false);
  });

  it.each([
    'Find events in Canada with ticket sizes maybe $50 to $200',
    'Find payment processors with checks maybe $100 to $200',
  ])('does not assign investor check preferences outside investor context: %s', raw => {
    expect(detectConstraints(raw).some(c => c.field === 'prefer_investor_check')).toBe(false);
    expect(specOf(raw).criteria.some(c => c.field === 'prefer_investor_check')).toBe(false);
  });

  it.each(['singularized', 'endpoints only', 'missing span'])('repairs a provider monetary check with %s provenance that missed optional strength', provenance => {
    const frame = extractFrameDeterministic(original);
    frame.meta.extractor = 'llm';
    const held = frame.constraints.find(c => c.field === 'prefer_investor_check')!;
    held.field = 'investor_check';
    if (provenance === 'endpoints only') held.raw = '100k to 2m';
    if (provenance === 'missing span') held.raw = null;
    const repaired = validateFrame(frame);
    const spec = frameToSearchSpec(repaired.frame);
    expect(spec.criteria).toContainEqual(expect.objectContaining({ field: 'prefer_investor_check', value: '100000|2000000' }));
    expect(spec.criteria.some(c => c.field === 'investor_check')).toBe(false);
    expect(repaired.frame.constraints.filter(c => c.field === 'prefer_investor_check')).toHaveLength(1);
    expect(validateFrame(repaired.frame).frame.constraints).toEqual(repaired.frame.constraints);
  });

  it('repairs hard monetary duplication even when the optional range is already present, preserving a categorical clarification', () => {
    const frame = extractFrameDeterministic(original);
    const preference = frame.constraints.find(c => c.field === 'prefer_investor_check')!;
    frame.constraints.push({ ...preference, field: 'investor_check' });
    frame.constraints.push({ ...preference, field: 'investor_check', operator: 'eq', value: 'seed', raw: 'seed' });
    const repaired = validateFrame(frame).frame;
    expect(repaired.constraints.filter(c => c.field === 'prefer_investor_check')).toHaveLength(1);
    expect(repaired.constraints.filter(c => c.field === 'investor_check')).toEqual([
      expect.objectContaining({ operator: 'eq', value: 'seed' }),
    ]);
  });

  it.each(['different range', 'different currency', 'negated'])('preserves a separate hard monetary constraint with %s', variation => {
    const frame = extractFrameDeterministic(original);
    const preference = frame.constraints.find(c => c.field === 'prefer_investor_check')!;
    const hard = { ...preference, field: 'investor_check' };
    if (variation === 'different range') hard.value = ['250000', '500000'];
    if (variation === 'different currency') hard.unit = 'CAD';
    if (variation === 'negated') hard.negated = true;
    frame.constraints.push(hard);
    expect(validateFrame(frame).frame.constraints).toContainEqual(hard);
  });

  it('does not reinterpret unhedged monetary ranges as optional or invent hard bands', () => {
    expect(detectConstraints('Find investors with checks between 100k and 2m required').some(c => /investor_check/.test(c.field))).toBe(false);
  });

  it.each(['angel', 'seed', 'growth'])('preserves the existing hard categorical answer %s', check => {
    const frame = applyClarificationToFrame(extractFrameDeterministic('Find investors in Canada'), { investor_check: check });
    expect(frameToSearchSpec(frame).criteria).toContainEqual(expect.objectContaining({ field: 'investor_check', value: check }));
  });

  it('does not reject an investor for missing or out-of-range optional check evidence', () => {
    const spec = specOf('Find investors in Canada, checks maybe 100k to 2m but not an absolute rule');
    const row = { kind: 'investor', title: 'North Fund', location: 'Canada', country: 'CA', check: null } as SpecRow;
    expect(rowSatisfiesSpec(spec, row)).toBe(true);
    expect(rowSatisfiesSpec(spec, { ...row, check: '5000000-10000000' })).toBe(true);
  });
});
