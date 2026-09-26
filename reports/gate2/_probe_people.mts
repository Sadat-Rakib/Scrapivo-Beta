await import("../../scripts/_env.mts");
const { searchPeopleDB } = await import("../../src/lib/canonical/people.server");
const probes=[['founder','Canada'],['copywriter','United States'],['software engineer','India'],['designer','United Kingdom'],['sales','Singapore'],['marine biologist','Iceland']]; const out=[];
for(const [role,country] of probes){const at=Date.now();try{const r=await searchPeopleDB({role,country,limit:6});out.push({query:`${role} in ${country}`,stored_candidates:r.meta.rowsReturned,rows_after_filter:r.rows.length,complete_rows:null,pending_enrichment:null,live_gapfill_triggered:null,qualified_rows:null,final_returned:r.rows.length,timing_ms:Date.now()-at,source:r.meta.engine,partitions:r.meta.partitionsRead,rows_scanned:r.meta.rowsScanned});}catch(e){out.push({query:`${role} in ${country}`,error:e instanceof Error?e.message:String(e),timing_ms:Date.now()-at});}}
console.log(JSON.stringify(out));
