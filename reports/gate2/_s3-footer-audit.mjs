import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { parquetMetadataAsync, parquetSchema } from "hyparquet";
import { writeFileSync } from "node:fs";
const bucket = "scrapivo-raw-data-2026-523220341033-us-east-2-an";
const s3 = new S3Client({ region: "us-east-2" });
async function list(prefix) { const out=[]; let token; do { const p=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken:token})); out.push(...(p.Contents??[]).filter(x=>x.Key?.endsWith(".parquet"))); token=p.NextContinuationToken; } while(token); return out; }
async function meta(o) { const size=Number(o.Size??0),key=o.Key; const file={byteLength:size,slice:async(start,end)=>{const z=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key,Range:`bytes=${start}-${(end??size)-1}`})); const b=await z.Body.transformToByteArray(); return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}}; const m=await parquetMetadataAsync(file,{initialFetchSize:65536,geoparquet:false}); return {key,size,rows:Number(m.num_rows),schema:Object.keys(parquetSchema(m).children??{})}; }
async function mapLimit(xs,n,fn){let i=0,out=Array(xs.length); await Promise.all(Array.from({length:Math.min(n,xs.length)},async()=>{for(;;){const j=i++; if(j>=xs.length)return; out[j]=await fn(xs[j]);}})); return out;}
const prefixes=["processed/local-businesses/by_country/","processed/companies_by_initial/","processed/people_by_country/","processed/investors/"]; const result={};
for(const p of prefixes){const os=await list(p),ms=await mapLimit(os,12,meta); result[p]={objects:ms.length,bytes:ms.reduce((a,x)=>a+x.size,0),rows:ms.reduce((a,x)=>a+x.rows,0),min_rows:Math.min(...ms.map(x=>x.rows)),max_rows:Math.max(...ms.map(x=>x.rows)),schema:ms[0]?.schema??[],files:ms.map(x=>({key:x.key,rows:x.rows,size:x.size}))};}
writeFileSync("reports/gate2/_s3-metadata.json",JSON.stringify(result,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,{objects:v.objects,bytes:v.bytes,rows:v.rows,min_rows:v.min_rows,max_rows:v.max_rows,schema:v.schema}]))));