import json, os, collections
import boto3, pyarrow.fs as pafs, pyarrow.parquet as pq
from pathlib import Path
root=Path('reports/gate2'); meta=json.loads((root/'_s3-metadata.json').read_text())
bucket='scrapivo-raw-data-2026-523220341033-us-east-2-an'
creds=boto3.Session(profile_name='scrapivo',region_name='us-east-2').get_credentials().get_frozen_credentials()
fs=pafs.S3FileSystem(access_key=creds.access_key,secret_key=creds.secret_key,session_token=creds.token,region='us-east-2')
def schema_names(key): return pq.ParquetFile(f'{bucket}/{key}',filesystem=fs).schema_arrow.names
def present(v): return v is not None and (not isinstance(v,str) or v.strip()!='')
def profile_files(files, wanted, max_rows_per_file=None):
    actual=schema_names(files[0]['key']); cols=[x for x in wanted if x in actual]
    total=0; nonblank=collections.Counter(); cat_fields=[c for c in ['title','role','country','industry','category','category_raw','location','location_city','location_country','kind','sectors','stages','stage','technologies','tools_used'] if c in cols]; uniques={c:set() for c in cat_fields}; top={c:collections.Counter() for c in cat_fields}
    dup_fields=[c for c in ['registry_id','id','domain','website','personal_linkedin','linkedin'] if c in cols]; dup_counts={c:collections.Counter() for c in dup_fields}
    for f in files:
      pf=pq.ParquetFile(f'{bucket}/{f["key"]}',filesystem=fs)
      seen=0
      for batch in pf.iter_batches(batch_size=10000,columns=cols):
        data=batch.to_pydict(); n=batch.num_rows
        if max_rows_per_file is not None and seen+n>max_rows_per_file:
          n=max_rows_per_file-seen; data={k:v[:n] for k,v in data.items()}
        if n<=0: break
        total+=n; seen+=n
        for c,vals in data.items():
          for v in vals:
            if present(v):
              nonblank[c]+=1
              if c in cat_fields:
                if isinstance(v,list):
                  for z in v:
                    if present(z): top[c][str(z)]+=1; uniques[c].add(str(z))
                else:
                  s=str(v); top[c][s]+=1; uniques[c].add(s)
              if c in dup_counts and not isinstance(v,list): dup_counts[c][str(v)]+=1
        if max_rows_per_file is not None and seen>=max_rows_per_file: break
    contacts=[c for c in ['email','phone','website','domain','personal_linkedin','company_linkedin','linkedin','facebook','twitter'] if c in cols]
    at_least=None
    # second bounded pass only for row-wise contact union
    contact_yes=0; contact_total=0
    if contacts:
      for f in files:
        pf=pq.ParquetFile(f'{bucket}/{f["key"]}',filesystem=fs); seen=0
        for batch in pf.iter_batches(batch_size=10000,columns=contacts):
          d=batch.to_pydict(); n=batch.num_rows
          if max_rows_per_file is not None and seen+n>max_rows_per_file: n=max_rows_per_file-seen; d={k:v[:n] for k,v in d.items()}
          if n<=0: break
          for i in range(n): contact_yes += int(any(present(d[c][i]) for c in contacts))
          contact_total+=n; seen+=n
          if max_rows_per_file is not None and seen>=max_rows_per_file: break
      at_least={'rows':contact_yes,'pct':round(100*contact_yes/contact_total,2),'missing_rows':contact_total-contact_yes,'missing_pct':round(100*(contact_total-contact_yes)/contact_total,2)}
    return {'rows_profiled':total,'columns':actual,'nonblank':{c:{'rows':nonblank[c],'pct':round(100*nonblank[c]/total,2)} for c in cols},'unique':{c:len(v) for c,v in uniques.items()},'top':{c:top[c].most_common(20) for c in cat_fields},'at_least_one_contact':at_least,'duplicate_values':{c:{'values_repeated':sum(1 for n in d.values() if n>1),'extra_rows':sum(n-1 for n in d.values() if n>1)} for c,d in dup_counts.items()}}
out={}
out['people']=profile_files(meta['processed/people_by_country/']['files'],['name','title','role','company_name','company','website','email','phone','personal_linkedin','company_linkedin','linkedin','facebook','twitter','country','industry','tools_used','domain'])
out['companies']=profile_files(meta['processed/companies_by_initial/']['files'],['company_name','name','website','domain','location','locality','city','country','category','industry','industries','email','phone','linkedin','facebook','twitter','description','employees','stage','technologies','tools_used'],2000)
out['investors']=profile_files(meta['processed/investors/']['files'],['id','name','kind','firm','role','location_raw','location_city','location_country','email','phone','linkedin','facebook','twitter','website','sectors','stages'])
out['businesses_sample']=profile_files(meta['processed/local-businesses/by_country/']['files'],['registry_id','name','category','category_raw','locality','region','country','phone','email','website','domain','linkedin','facebook','twitter','junk_flag'],2000)
(root/'_profiles.json').write_text(json.dumps(out,indent=2,default=str),encoding='utf-8')
print(json.dumps({k:{'rows_profiled':v['rows_profiled'],'columns':v['columns'],'nonblank':v['nonblank'],'unique':v['unique'],'at_least_one_contact':v['at_least_one_contact'],'duplicate_values':v['duplicate_values']} for k,v in out.items()}))