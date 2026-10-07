import { describe, expect, it } from 'vitest';
import { extractFrameDeterministic } from './fallback';
import { validateFrame } from './validate';
import { frameToSearchSpec } from './to-search-spec';
import { openValue } from './frame';
import { decideSpecClarification } from '../stage1/stage1-adapter';

const specOf = (raw: string) => frameToSearchSpec(validateFrame(extractFrameDeterministic(raw)).frame);

describe('chaos bucket and preference contracts', () => {
  it.each([
    'Find photographers in Ireland, need their website or instagram and some way to contact them',
    'Find dentists in Canada, need email or phone',
    'Find architects in Japan, include website or linkedin',
    'Find cafes in New Zealand with instagram or website',
    'can you find like wedding photographers videographers and maybe small creative studios in bali, phuket and santorini? mainly businesses that actually do weddings, need their site or insta and some way to contact them, but dont reject somebody just because you couldnt find an email yet',
  ])('retains requested channel alternatives: %s', raw => {
    const spec = specOf(raw);
    expect(spec.required_field_groups?.some(group => group.any_of.length >= 2)).toBe(true);
    expect((spec.requested_fields ?? []).some(field => ['website', 'instagram', 'socials', 'email', 'phone', 'linkedin'].includes(field))).toBe(false);
  });

  it.each([
    'Find cybersecurity companies in Canada, preferably under 100 employees',
    'Find dental clinics in Ireland, ideally fewer than 50 employees',
    'Find software companies in Japan, under 30 employees preferred',
    'need maybe 15 cybersecurity companies then another 15 ai infra/devtool startups, mostly usa/canada, preferably under like 100 employees but if headcount is unknown dont kill the result, founders or decision makers would be useful and pls dont mix cybersecurity consultants with actual product companies unless they genuinely fit',
  ])('keeps soft attributes out of hard criteria: %s', raw => {
    const spec = specOf(raw);
    expect(spec.criteria.some(c => c.field === 'employee_count')).toBe(false);
    expect(spec.criteria.some(c => c.field === 'prefer_employee_count')).toBe(true);
  });

  it.each([
    'Find 15 cybersecurity companies then another 15 AI startups in Canada',
    'Get about 5 dental clinics then another 8 orthodontists in Ireland',
    'Find roughly 10 software companies then another 12 hardware companies in Japan',
  ])('retains separately counted target buckets: %s', raw => {
    const frame = specOf(raw).understanding!;
    expect(frame.compound.is_compound).toBe(true);
    expect(frame.compound.subgoals).toHaveLength(2);
    expect(frame.compound.subgoals.every(goal => goal.quantity?.requested)).toBe(true);
  });

  it('keeps investment mandate evidence separate from funding received', () => {
    const spec = specOf('Find investors actively investing in healthtech in Australia');
    expect(spec.signal_types).toContain('investment');
    expect(spec.signal_types).not.toContain('funding');
  });

  it('keeps mandatory headcount beside an unrelated soft channel', () => {
    const spec = specOf('Find software companies in Canada, under 100 employees required and phone preferred');
    expect(spec.criteria.some(c => c.field === 'employee_count')).toBe(true);
    expect(spec.criteria.some(c => c.field === 'prefer_employee_count')).toBe(false);
  });

  it('retains shared geography and soft attributes through counted bucket compilation', () => {
    const raw = 'need maybe 15 cybersecurity companies then another 15 ai infra/devtool startups, mostly usa/canada, preferably under like 100 employees but if headcount is unknown dont kill the result';
    const spec = specOf(raw);
    const frame = spec.understanding!;
    expect(spec.locations).toHaveLength(2);
    expect(spec.locations).toContain('Canada');
    expect(frame.compound.subgoals.map(goal => goal.quantity?.requested)).toEqual([15, 15]);
    for (const goal of frame.compound.subgoals) {
      const branch = frameToSearchSpec({ ...frame, input: { raw: goal.raw!, normalized: goal.raw! },
        target: goal.target, relation: goal.relation, quantity: goal.quantity ?? null,
        compound: { is_compound: false, subgoals: [] } });
      expect(branch.criteria.some(c => c.field === 'employee_count')).toBe(false);
      expect(branch.criteria.some(c => c.field === 'prefer_employee_count')).toBe(true);
      expect(branch.locations).toHaveLength(2);
    }
  });

  it('repairs separately counted buckets dropped by a supplied provider frame', () => {
    const raw = 'Find about 8 battery companies then another 12 climate startups, in Germany and Netherlands';
    const frame = validateFrame(extractFrameDeterministic(raw)).frame;
    frame.meta.extractor = 'llm';
    frame.compound = { is_compound: false, subgoals: [] };
    const spec = frameToSearchSpec(frame);
    expect(spec.understanding?.compound.subgoals.map(goal => goal.quantity?.requested)).toEqual([8, 12]);
    expect(spec.understanding?.compound.subgoals[0]?.quantity?.approximate).toBe(true);
  });

  it('consumes canonicalized provider alternative groups without flattened gates', () => {
    const frame = validateFrame(extractFrameDeterministic('Find dentists in Canada with public contact details')).frame;
    frame.meta.extractor = 'llm';
    frame.constraints.push({ field: 'required_field', operator: 'one_of', value: ['site', 'insta'], raw: 'site or insta', unit: null, negated: false, confidence: .9 });
    const spec = frameToSearchSpec(frame);
    expect(spec.required_field_groups).toEqual([{ any_of: ['website', 'instagram'] }]);
    expect(spec.criteria.some(c => c.field === 'required_field' && /website|instagram/.test(c.value))).toBe(false);
  });

  it('does not invent a required alternative group from a negated contact ask', () => {
    expect(specOf("Find dentists in Canada, don't need email or phone").required_field_groups).toBeUndefined();
  });

  it.each([
    'Find dentists in Canada; email mandatory; website or email required',
    'Find dentists in Canada; email mandatory; website or email',
    'Find dentists in Canada; website or email required; email mandatory',
    'Find clinics in Ireland; email or phone required; website mandatory',
  ])('keeps independently mandatory fields beside overlapping alternatives: %s', raw => {
    for (const provider of [false, true]) {
      const frame = validateFrame(extractFrameDeterministic(raw)).frame;
      if (provider) {
        frame.meta.extractor = 'llm';
        frame.required_fields = [openValue('email', raw), openValue('phone', raw), openValue('website', raw)];
      }
      const spec = frameToSearchSpec(frame);
      const mandatory = /website mandatory/.test(raw) ? 'website' : 'email';
      expect(spec.requested_fields).toContain(mandatory);
      expect(spec.criteria).toContainEqual(expect.objectContaining({ field: `require_${mandatory}`, value: 'true' }));
      expect(spec.required_field_groups?.length).toBeGreaterThan(0);
    }
  });

  it('keeps optional alternatives optional', () => {
    const spec = specOf('Find dentists in Canada; email or phone if possible');
    expect(spec.required_field_groups).toBeUndefined();
    expect(spec.requested_fields ?? []).not.toContain('email');
    expect(spec.requested_fields ?? []).not.toContain('phone');
  });

  it('runs resolved counted buckets without asking which one to keep', () => {
    const raw = 'need maybe 15 cybersecurity companies then another 15 ai infra/devtool startups, mostly usa/canada, preferably under like 100 employees but if headcount is unknown dont kill the result';
    const spec = specOf(raw);
    expect(decideSpecClarification(spec, false)).toBeNull();
    expect(decideSpecClarification(spec, true)).toBeNull();
  });
});
