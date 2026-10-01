/** Read-only, seeded forensic scorer. Run: npx tsx reports/understanding-forensic/stress.mts */
import { writeFileSync } from 'node:fs';
import { generateHoldout, generateChaos } from '../../src/lib/understanding/corpus';
import { extractFrameDeterministic } from '../../src/lib/understanding/fallback';
import { validateFrame } from '../../src/lib/understanding/validate';
import { syncClarification } from '../../src/lib/understanding/clarify-state';
import { frameToSearchSpec, isActionableFrame } from '../../src/lib/understanding/to-search-spec';
import { evaluateQueryReadiness } from '../../src/lib/search/query-readiness';
import { detectModeFromQuery, isDirectoryEntity } from '../../src/lib/search/mode-gate';

const seed = 27491;
const generated = [...generateHoldout(seed, 40), ...generateChaos(seed, 40)];
type Manual = { id: string; family: string; prompt: string; expect: Record<string, unknown> };
const manual: Manual[] = [
  {id:'M01',family:'brand',prompt:'looking for d2c skincare guys around dhaka n bangladesh who r active online need emails nums socials and wanna see if they posted recently',expect:{entity_type:'company',entity_subtype:'brand',location:'Dhaka',business_model:'d2c',industry:'skincare',required_fields:['email','phone','socials'],social_freshness:true}},
  {id:'M02',family:'local',prompt:'find plumbers in Austin',expect:{entity_type:'business',location:'Austin',category:'plumber',goal_clarify:true}},
  {id:'M03',family:'local',prompt:'find plumbers in Austin that need website services',expect:{entity_type:'business',location:'Austin',category:'plumber',goal_clarify:false,relation:'needs_service',no_website:false}},
  {id:'M04',family:'local',prompt:'Camrose Alberta businesses with no website but active facebook or insta. phone and email please',expect:{entity_type:'business',entity_subtype:'local',location:'Camrose',no_website:true,required_fields:['phone','email'],social_freshness:true}},
  {id:'M05',family:'investor',prompt:'need investors',expect:{entity_type:'investor',clarification:'required'}},
  {id:'M06',family:'jobs',prompt:'remote react jobs paying this much',expect:{entity_type:'job',remote:true,technology:'React',placeholder:true,clarification:'required',no_location:true}},
  {id:'M07',family:'founder',prompt:'startup founders around Tartu Estonia recently raised and hiring, at least this much revenue',expect:{entity_type:'person',location:'Tartu',role:'founder',placeholder:true,clarification:'required',signal:true}},
  {id:'M08',family:'investor',prompt:'pre seed AI angels across southeast asia actively writing checks of $100k to $250k',expect:{entity_type:'investor',entity_subtype:'angel',location:'Southeast Asia',industry:'AI',signal:true}},
  {id:'M09',family:'jobs',prompt:'Find remote startup jobs using React and TypeScript, hiring globally, paying at least $120,000 per year',expect:{entity_type:'job',remote:true,technology:'React',salary_min:120000}},
  {id:'M10',family:'brand',prompt:'D2C brands in Chattogram or Dhaka, not agencies, selling skincare',expect:{entity_type:'company',business_model:'d2c',industry:'skincare',negated:'agency',multi_location:true}},
  {id:'M11',family:'local',prompt:'umm find cafes in Bandar Seri Begawan wait no make that Muscat, with websites',expect:{entity_type:'business',location:'Muscat',has_website:true}},
  {id:'M12',family:'people',prompt:'heads of growth at fintechs in Cluj-Napoca or Tbilisi, founder emails if public',expect:{entity_type:'person',role:'growth',multi_location:true,required_fields:['email']}},
  {id:'M13',family:'opportunity',prompt:'small firms near Kigali hiring marketers AND recently funded, exclude staffing agencies',expect:{entity_type:'company',location:'Kigali',signal:true,negated:'agency'}},
  {id:'M14',family:'local',prompt:'gotta find physio clinics in Surabaya no site but posts this month need phone',expect:{entity_type:'business',location:'Surabaya',no_website:true,social_freshness:true,required_fields:['phone']}},
  {id:'M15',family:'jobs',prompt:'hybrid TypeScript roles in Porto paying at least €70,000',expect:{entity_type:'job',location:'Porto',technology:'TypeScript',salary_min:70000}},
  {id:'M16',family:'investor',prompt:'investors in Cebu or Chiang Mai that back climate startups, check actual recent deals',expect:{entity_type:'investor',multi_location:true,signal:true}},
  {id:'M17',family:'founder',prompt:'founders in Medellín raising seed, NOT already funded, get LinkedIn and work email',expect:{entity_type:'person',location:'Medellín',role:'founder',negated:'funded',required_fields:['email','socials']}},
  {id:'M18',family:'brand',prompt:'companies like these around Pune doing marketing, around this size, all contact details',expect:{entity_type:'company',location:'Pune',placeholder:true,clarification:'required',required_fields:['email','phone']}},
  {id:'M19',family:'local',prompt:'research only: restaurants in Lusaka with websites, no outreach',expect:{entity_type:'business',location:'Lusaka',category:'restaurant',goal_clarify:false,has_website:true}},
  {id:'M20',family:'opportunity',prompt:'I sell SEO. find active shops in Alberta that could use SEO help, verify last social post and emails',expect:{entity_type:'business',location:'Alberta',goal_clarify:false,required_fields:['email'],social_freshness:true}},
];

const all = [...generated.map(c => ({id:c.id,family:c.set,prompt:c.prompt,expect:c.expect})), ...manual];
writeFileSync(new URL('./CORPUS.json', import.meta.url), JSON.stringify({seed, generated:80, manual:20, cases:all}, null, 2));
const norm = (x: unknown) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const contains = (x: unknown, y: unknown) => norm(x).includes(norm(y));
const score: Record<string,{pass:number,total:number}> = {};
const add = (axis:string, pass:boolean) => { const s=score[axis]??={pass:0,total:0}; s.total++; if(pass)s.pass++; return pass; };
const rows = [];
for (const c of all) {
  let parsed: ReturnType<typeof extractFrameDeterministic>;
  try { parsed=extractFrameDeterministic(c.prompt); add('extraction_crash',true); }
  catch (error) {
    add('extraction_crash',false);
    rows.push({id:c.id,family:c.family,query:c.prompt,checks:{extraction_crash:false},failed:['extraction_crash'],frame:null,spec:null,repairs:[],error:String(error)});
    continue;
  }
  const {frame:validated,repairs} = validateFrame(parsed);
  const f=syncClarification(validated); const s=frameToSearchSpec(f); const e=c.expect as Record<string,any>;
  const crit=(field:string)=>s.criteria.find(x=>x.field===field)?.value;
  const target=[f.target.role?.value,f.target.job_title?.value,f.target.category?.value,f.target.industry?.value,f.target.business_type?.value,f.target.entity_subtype?.value].filter(Boolean).join(' ');
  const checks: Record<string,boolean>={};
  const check=(axis:string,ok:boolean)=>{checks[axis]=add(axis,ok)};
  if(e.task_type) check('task',Array.isArray(e.task_type)?e.task_type.includes(f.task_type.value):e.task_type===f.task_type.value);
  if(e.entity_type) check('entity',Array.isArray(e.entity_type)?e.entity_type.includes(f.target.entity_type.value):e.entity_type===f.target.entity_type.value);
  if(e.entity_subtype) check('subtype',contains(f.target.entity_subtype?.value??f.target.category?.value,e.entity_subtype));
  if(e.target) check('subtype',contains(target,e.target));
  if(e.role) check('role',contains(f.target.role?.value??f.target.job_title?.value,e.role));
  if(e.category) check('category',contains(f.target.category?.value,e.category));
  if(e.industry) check('industry',contains(f.target.industry?.value??f.target.category?.value,e.industry));
  if(e.location) check('location',contains(f.location?.value,e.location));
  if(e.no_location) check('location',!f.location);
  if(e.business_model) check('business_model',contains(f.target.business_type?.value??crit('business_model'),e.business_model));
  if(e.prospecting_mode) check('mode',Array.isArray(e.prospecting_mode)?e.prospecting_mode.includes(f.prospecting_mode.value):e.prospecting_mode===f.prospecting_mode.value);
  if(e.relation) check('relation',Array.isArray(e.relation)?e.relation.includes(f.relation.type.value):e.relation===f.relation.type.value);
  if(e.direction) check('direction',e.direction===f.relation.direction.value);
  if(e.intent_signal_required!==undefined) check('signal',f.evidence.intent_signal_required===e.intent_signal_required);
  if(e.signal) check('signal',f.evidence.intent_signal_required||s.signal_required);
  if(e.negated) {const words=Array.isArray(e.negated)?e.negated:[e.negated];check('negation',words.every((v:string)=>f.constraints.some(x=>x.negated&&contains(x.field+' '+x.value,v))));}
  if(e.min_constraints!==undefined) check('filters',f.constraints.length>=e.min_constraints);
  if(e.required_fields) check('contacts_outputs',e.required_fields.every((v:string)=>f.required_fields.some(x=>contains(x.value,v))));
  if(e.remote) check('remote',contains(crit('employment'),'remote')||contains(crit('geo_scope'),'worldwide'));
  if(e.technology) check('technology',contains(crit('technology')+' '+f.target.technologies.map(x=>x.value).join(' '),e.technology));
  if(e.salary_min) check('salary',Number(crit('salary_min')??0)>=e.salary_min);
  if(e.no_website!==undefined) check('no_website',(crit('opportunity')==='no_website')===e.no_website);
  if(e.has_website) check('has_website',f.relation.type.value==='has_asset'||s.criteria.some(x=>x.field==='website'&&x.value==='true'));
  if(e.multi_location) check('multi_location',f.compound.subgoals.length>=2||s.criteria.filter(x=>x.field==='location').length>=2);
  if(e.placeholder) check('placeholder',f.constraints.some(x=>contains(x.raw,'this much')||contains(x.raw,'around this size'))||s.missing.includes('salary_min'));
  if(e.social_freshness) check('social_freshness',f.verification.some(x=>contains(x.raw,'post')||contains(x.label,'post'))||f.enrichment_requirements.some(x=>contains(x.value,'post'))||crit('needs_live')==='true');
  const readiness=evaluateQueryReadiness({spec:s,query:c.prompt,force:false});
  const mode=detectModeFromQuery(c.prompt);
  const modeGate=!isActionableFrame(s)&&isDirectoryEntity(s.entity)&&s.status==='ready_to_search'&&!mode&&!crit('mode');
  // Main search route ignores frame-native clarification; it uses these three gates.
  const clarify=s.missing.length>0||!readiness.ready||modeGate;
  if(e.clarification) check('clarification',clarify===(e.clarification==='required'));
  if(e.goal_clarify!==undefined) check('goal_clarification',clarify===e.goal_clarify);
  if(e.entity_type) check('spec_entity',s.entity===e.entity_type);
  if(e.location) check('spec_location',contains(crit('location'),e.location));
  if(e.business_model) check('spec_business_model',contains(crit('business_model'),e.business_model));
  if(e.required_fields) check('spec_required_fields',e.required_fields.every((v:string)=>s.criteria.some(x=>contains(x.field+' '+x.value,v))));
  const specChecks=Object.entries(checks).filter(([axis])=>axis.startsWith('spec_'));
  if(specChecks.length) check('spec_preservation',specChecks.every(([,ok])=>ok));
  rows.push({id:c.id,family:c.family,query:c.prompt,checks,failed:Object.keys(checks).filter(k=>!checks[k]),frame:{entity:f.target.entity_type.value,location:f.location?.value,category:f.target.category?.value,industry:f.target.industry?.value,role:f.target.role?.value,mode:f.prospecting_mode.value,relation:f.relation.type.value,required_fields:f.required_fields.map(x=>x.value),clarification:f.clarification},spec:{entity:s.entity,criteria:s.criteria,missing:s.missing,status:s.status},repairs});
}
const first=frameToSearchSpec(syncClarification(validateFrame(extractFrameDeterministic('find businesses that need websites')).frame));
const second=frameToSearchSpec(syncClarification(validateFrame(extractFrameDeterministic('Alberta')).frame));
add('conversation_merge',first.criteria.some(x=>x.field==='requested_service')&&second.criteria.some(x=>x.field==='requested_service')&&second.criteria.some(x=>x.field==='location'&&contains(x.value,'Alberta')));
writeFileSync(new URL('./STRESS_RESULTS.json', import.meta.url), JSON.stringify({seed,total:all.length,score,rows},null,2));
console.log(JSON.stringify({total:all.length,fullyCorrect:rows.filter(r=>r.failed.length===0).length,score,failed:rows.filter(r=>r.failed.length).slice(0,25).map(r=>({id:r.id,failed:r.failed}))}));
console.log(JSON.stringify({manual:rows.filter(r=>r.id.startsWith('M')).map(r=>({id:r.id,failed:r.failed,frame:r.frame,spec:r.spec?{entity:r.spec.entity,criteria:r.spec.criteria.map(x=>`${x.field}=${x.value}`),missing:r.spec.missing}:null,error:r.error}))}));
