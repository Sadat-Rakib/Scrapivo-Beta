import re,requests,json
vals={}
for fn in ['.env','.env.local']:
  try:
    for line in open(fn,encoding='utf-8'):
      m=re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$',line)
      if m: vals[m.group(1)]=m.group(2).strip().strip('"').strip("'")
  except FileNotFoundError: pass
url=(vals.get('MY_SUPABASE_URL') or vals.get('SUPABASE_URL') or '').rstrip('/'); key=vals.get('MY_SUPABASE_SERVICE_ROLE_KEY') or ''
out={'configured':bool(url and key),'tables':{}}
for t in ['idx_businesses','idx_companies','idx_people','idx_investors','idx_jobs']:
  try:
    r=requests.get(f'{url}/rest/v1/{t}',params={'select':'*','limit':'1'},headers={'apikey':key,'Authorization':f'Bearer {key}','Prefer':'count=exact','Range':'0-0'},timeout=30)
    cr=r.headers.get('content-range',''); total=int(cr.split('/')[-1]) if '/' in cr and cr.split('/')[-1].isdigit() else None
    out['tables'][t]={'http':r.status_code,'rows':total,'success':r.status_code in (200,206)}
  except Exception as e: out['tables'][t]={'success':False,'error':type(e).__name__}
print(json.dumps(out))
open('reports/gate2/_postgres-counts.json','w').write(json.dumps(out,indent=2))