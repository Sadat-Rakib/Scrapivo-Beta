import { describe, expect, it } from 'vitest';
import { extractFrameDeterministic } from './fallback';
import { validateFrame } from './validate';
import { frameToSearchSpec } from './to-search-spec';
import { openValue, QuantitySchema } from './frame';
import { decideSpecClarification } from '../stage1/stage1-adapter';
import { deriveTemporalConstraint, evaluateTemporalValidity } from '../search/verification';
import { makeEvidence } from '../search/evidence';

const specOf = (raw: string) => frameToSearchSpec(validateFrame(extractFrameDeterministic(raw)).frame);

const providerCompanyBucketsWithOptionalPeople = (raw: string, first: string, second: string) => {
  const frame = validateFrame(extractFrameDeterministic(raw)).frame;
  frame.meta.extractor = 'llm';
  frame.target.entity_type = { value: 'person', raw: 'companies', confidence: .85 };
  frame.target.category = openValue(first, first);
  frame.target.role = openValue('founder or decision maker', 'founders or decision makers');
  frame.constraints = frame.constraints.filter(c => c.field !== 'employee_count');
  frame.compound = {
    is_compound: true,
    subgoals: [first, second].map((category, index) => ({
      raw: index === 0 ? `15 ${category}` : `another 15 ${category}`,
      target: {
        ...frame.target,
        entity_type: { value: 'person' as const, raw: category, confidence: .85 },
        category: openValue(category, category),
        role: openValue('founder or decision maker', 'founders or decision makers'),
      },
      relation: frame.relation,
      location: frame.location,
      temporal: null,
      constraints: [],
      quantity: QuantitySchema.parse({ requested: 15 }),
    })),
  };
  return frameToSearchSpec(validateFrame(frame).frame);
};

describe('chaos bucket and preference contracts', () => {
  it.each([
    ['looking for investors who actually invest in ai startups, ideally seed/preseed, canada or us is good, checks maybe 100k to 2m ish but thats not an absolute rule, bonus if theyve invested in devtools automation agents data infra kinda stuff recently, i want actual funds/angels not articles talking about venture capital', ['Canada', 'USA']],
    ['Find investors investing in healthtech, preferably seed or pre-seed, Ireland or UK is fine', ['Ireland', 'UK']],
    ['Find investors in climate startups, ideally early stage, in Germany and Netherlands', ['Germany', 'Netherlands']],
    ['Find investors investing in robotics, seed stage preferred, Australia or New Zealand is good', ['Australia', 'New Zealand']],
  ])('retains stage and target geography after a preference clause: %s', (raw, places) => {
    const spec = specOf(raw);
    expect(spec.locations).toEqual(places);
    expect(spec.criteria.some(c => c.field === 'prefer_investor_stage')).toBe(true);
    expect(spec.criteria.some(c => c.field === 'investor_stage')).toBe(false);
  });

  it.each([
    'Find investors in Toronto, ideally seed stage, email contacts in Canada and UK',
    'Find investors in Toronto, ideally seed stage, use registry sources in Canada and UK',
    'Find investors in Toronto, ideally seed stage, not Canada just mentioning Canada because thats where im contacting them from',
  ])('keeps post-preference contact, source and sender places out of targets: %s', raw => {
    expect(specOf(raw).locations).toEqual(['Toronto']);
  });

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
        location: goal.location ?? frame.location,
        locations: goal.location ? [goal.location] : frame.locations,
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

  it.each([
    [
      'need maybe 15 cybersecurity companies then another 15 ai infra/devtool startups, mostly usa/canada, preferably under like 100 employees but if headcount is unknown dont kill the result, founders or decision makers would be useful and pls dont mix cybersecurity consultants with actual product companies unless they genuinely fit',
      'cybersecurity company',
      'ai infra/devtool startup',
    ],
    [
      'find 15 fintech companies and another 15 climate startups in Germany or Netherlands, ideally under 80 employees, founders would be helpful',
      'fintech company',
      'climate startup',
    ],
    [
      'need 15 biotech companies then 15 robotics startups around Australia and New Zealand, preferably fewer than 120 employees, decision makers would be useful',
      'biotech company',
      'robotics startup',
    ],
  ])('keeps organization buckets primary when founders are optional: %s', (raw, first, second) => {
    const spec = providerCompanyBucketsWithOptionalPeople(raw, first, second);
    expect(spec.entity).toBe('company');
    expect(spec.criteria.some(c => c.field === 'role')).toBe(false);
    expect(spec.criteria.some(c => c.field === 'employee_count')).toBe(false);
    expect(spec.criteria.some(c => c.field === 'prefer_employee_count')).toBe(true);
    expect(spec.understanding?.compound.subgoals.map(goal => goal.target.entity_type.value)).toEqual(['company', 'company']);
  });

  it.each([
    'Find founders of AI startups in Toronto',
    'Find decision makers at cybersecurity companies in USA',
    'Find founders of AI startups in Toronto, ideally under 100 employees',
    'Find decision makers at cybersecurity companies in USA, preferably under 100 employees',
    'Find founders of startups in Toronto, email would be useful',
  ])('keeps primary person searches as people: %s', raw => {
    const frame = validateFrame(extractFrameDeterministic(raw)).frame;
    frame.meta.extractor = 'llm';
    frame.target.entity_type = { value: 'person', raw: /decision/i.test(raw) ? 'decision makers' : 'founders', confidence: .9 };
    frame.target.role = openValue(/decision/i.test(raw) ? 'decision maker' : 'founder', /decision/i.test(raw) ? 'decision makers' : 'founders');
    frame.target.category = openValue(/cybersecurity/i.test(raw) ? 'cybersecurity company' : 'AI startup', /cybersecurity/i.test(raw) ? 'cybersecurity companies' : 'AI startups');
    expect(frameToSearchSpec(validateFrame(frame).frame).entity).toBe('person');
  });

  it.each([
    ['Find investors in AI in Australia, ideally seed or pre-seed', 'seed or pre-seed', 'investor_stage'],
    ['Find investors in healthtech in Ireland, seed stage preferred', 'seed stage', 'investor_stage'],
    ['Find software founders in Japan, preferably early stage', 'early stage', 'company_stage'],
  ])('keeps supplied stage descriptors soft in their own clause: %s', (raw, stage, field) => {
    const frame = validateFrame(extractFrameDeterministic(raw)).frame;
    frame.meta.extractor = 'llm';
    frame.target.entity_type = { value: field === 'investor_stage' ? 'investor' : 'person', raw: field === 'investor_stage' ? 'investors' : 'founders', confidence: .95 };
    const trade = /healthtech/.test(raw) ? 'healthtech' : /software/.test(raw) ? 'software' : 'AI';
    frame.target.industry = openValue(trade, trade);
    frame.target.company_stage = openValue(stage, stage);
    const spec = frameToSearchSpec(frame);
    expect(spec.criteria.some(c => c.field === field)).toBe(false);
    expect(spec.criteria.some(c => c.field === `prefer_${field}`)).toBe(true);
    expect(spec.criteria.some(c => c.field === (field === 'investor_stage' ? 'investor_sector' : 'industry'))).toBe(true);
  });

  it.each([
    'Find investors in AI in Australia, must be seed stage; phone if possible',
    'Find investors in healthtech in Ireland, seed stage required and phone preferred',
  ])('keeps mandatory stage despite an unrelated hedge: %s', raw => {
    const frame = validateFrame(extractFrameDeterministic(raw)).frame;
    frame.meta.extractor = 'llm';
    frame.target.company_stage = openValue('seed', 'seed stage');
    const spec = frameToSearchSpec(frame);
    expect(spec.criteria.some(c => c.field === 'investor_stage')).toBe(true);
    expect(spec.criteria.some(c => c.field === 'prefer_investor_stage')).toBe(false);
  });

  it.each([false, true])('keeps bonus temporal evidence optional, whole raw=%s', whole => {
    const raw = 'Find investors investing in AI in Australia, bonus if they invested recently';
    const frame = validateFrame(extractFrameDeterministic(raw)).frame;
    frame.meta.extractor = 'llm';
    frame.temporal = { relation: 'recent', window: '90d', year: null, raw: whole ? raw : 'recently', confidence: .9 };
    const spec = frameToSearchSpec(frame);
    expect(spec.signal_recency).toBeNull();
    expect(deriveTemporalConstraint(spec).required).toBe(false);
    expect(spec.criteria.some(c => c.field === 'prefer_temporal_relation')).toBe(true);
  });

  it.each([false, true])('keeps mandatory event recency despite optional contact, whole raw=%s', whole => {
    const raw = 'Find investors in Australia who invested within 90 days; phone if possible';
    const frame = validateFrame(extractFrameDeterministic(raw)).frame;
    frame.meta.extractor = 'llm';
    frame.temporal = { relation: 'within_last', window: '90d', year: null, raw: whole ? raw : 'within 90 days', confidence: .9 };
    expect(deriveTemporalConstraint(frameToSearchSpec(frame)).required).toBe(true);
  });

  it('keeps an independent hard stale-age bound beside an ideal date', () => {
    const raw = 'Find React jobs in Canada, ideally last week but dont give 6 month old openings';
    const frame = validateFrame(extractFrameDeterministic(raw)).frame;
    frame.meta.extractor = 'llm';
    frame.temporal = { relation: 'within_last', window: '1w', year: null, raw: 'last week', confidence: .9 };
    const spec = frameToSearchSpec(frame);
    expect(spec.signal_recency).toBe('6m');
    expect(spec.criteria).toContainEqual(expect.objectContaining({ field: 'prefer_temporal_window', value: '1w' }));
    expect(deriveTemporalConstraint(spec).required).toBe(true);
    const now = Date.parse('2026-10-07T00:00:00Z');
    const evidence = (daysAgo: number) => makeEvidence({ source_url: 'https://employer.example/jobs/react', source_type: 'web',
      excerpt: 'React developer opening', evidence_type: 'hiring', supports: 'intent', subject: 'employer:react',
      observed_at: new Date(now).toISOString(), event_at: new Date(now - daysAgo * 86_400_000).toISOString() });
    expect(evaluateTemporalValidity(evidence(30), spec, now).ok).toBe(true);
    expect(evaluateTemporalValidity(evidence(200), spec, now).ok).toBe(false);
    expect(evaluateTemporalValidity({ ...evidence(0), event_at: null }, spec, now).ok).toBe(false);
  });

  it.each([
    'Find investors in AI, not articles talking about venture capital',
    'Find dentists in Canada, exclude news discussing dental care',
    'Find software companies in Ireland, skip blogs writing about software',
  ])('does not turn excluded source discussions into lead requirements: %s', raw => {
    expect(specOf(raw).criteria.some(c => c.field === 'content_topic')).toBe(false);
  });

  it('preserves requested social discussion after a separate exclusion clause', () => {
    expect(specOf('Find founders, not recruiters, who talk about fundraising').criteria.some(c => c.field === 'content_topic')).toBe(true);
  });
});
