import re,requests,json
vals={}
for fn in ['.env','.env.local']:
  try:
    for line in open(fn,encoding='utf-8'):
      m=re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$',line)
      if m: vals[m.group(1)]=m.group(2).strip().strip('"').strip("'")
  except: pass
url=(vals.get('MY_SUPABASE_URL') or vals.get('SUPABASE_URL')).rstrip('/'); key=vals['MY_SUPABASE_SERVICE_ROLE_KEY']; h={'apikey':key,'Authorization':f'Bearer {key}','Prefer':'count=exact','Range':'0-0'}
def count(t,params):
 r=requests.get(f'{url}/rest/v1/{t}',params={'select':'registry_key','limit':'1',**params},headers=h,timeout=30); cr=r.headers.get('content-range',''); return int(cr.split('/')[-1]) if r.status_code in (200,206) and cr.split('/')[-1].isdigit() else None
cols={'idx_businesses':['country','city_norm','category','website','email','phone','domain'],'idx_companies':['country','city_norm','category','website','email','phone','domain'],'idx_people':['country','city_norm','role_norm','website','email','phone','domain','linkedin']}
out={}
for t,cs in cols.items():
 out[t]={}
 for c in cs: out[t][c+'_non_null']=count(t,{c:'not.is.null'})
 r=requests.get(f'{url}/rest/v1/{t}',params={'select':'country,count()'},headers={'apikey':key,'Authorization':f'Bearer {key}'},timeout=30)
 out[t]['country_aggregate_http']=r.status_code
 out[t]['countries']=r.json() if r.status_code==200 else None
open('reports/gate2/_postgres-profile.json','w').write(json.dumps(out,indent=2)); print(json.dumps(out))