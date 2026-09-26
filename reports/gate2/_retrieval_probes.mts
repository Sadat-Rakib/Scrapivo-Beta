import "../../scripts/_env.mts";
import { writeFileSync } from "node:fs";
import { runSpecSearchCore } from "../../src/lib/spec-search.functions";
process.env.VITEST="1"; process.env.USE_INDEXED_SEARCH="false"; delete process.env.AWAIT_PERSIST_LIVE;
const queries=[
 ["business","HVAC companies in Calgary"],["business","restaurants in Austin"],["business","dentists in London"],["business","plumbers in Pune"],["business","marketing agencies in Berlin"],["business","sailmakers in Ubud Bali"],
 ["person","founders in Canada"],["person","copywriters in New York"],["person","software engineers in Bengaluru"],["person","designers in Manchester"],["person","sales managers in Singapore"],["person","marine biologists in Reykjavik"],
 ["company","SaaS companies in Toronto"],["company","construction companies in Dallas"],["company","healthcare companies in London"],["company","AI companies in San Francisco"],["company","ecommerce companies in Mumbai"],["company","aquaculture companies in Bergen"]
];
const out=[];
for(const [entity,query] of queries){const at=Date.now(); try{const r=await runSpecSearchCore(query,{enrichFn:null,liveGapfill:null},5,{}, {force:true}); out.push({entity,query,spec:r.spec,dbMeta:r.dbMeta,stored_candidates:r.dbMeta.filter(x=>x.engine==="s3-parquet").reduce((n,x)=>n+x.rowsReturned,0),rows_after_filters:r.dbMeta.filter(x=>x.engine==="s3-parquet").reduce((n,x)=>n+x.rowsReturned,0),complete_usable:r.rows.length,pending_enrichment:r.pendingEnrichment,live_gapfill_triggered:r.liveDiscovery!=="not_required",live_status:r.liveDiscovery,qualified_rows:r.qualified_count,final_returned:r.rows.length,timing_ms:Date.now()-at,source:r.dbMeta.map(x=>x.engine)});}catch(e){out.push({entity,query,error:e instanceof Error?e.message:String(e),timing_ms:Date.now()-at});}}
writeFileSync("reports/gate2/_retrieval-probes.json",JSON.stringify(out,null,2)); console.log(JSON.stringify(out.map(x=>({query:x.query,stored:x.stored_candidates,complete:x.complete_usable,pending:x.pending_enrichment,final:x.final_returned,ms:x.timing_ms,source:x.source,error:x.error}))));