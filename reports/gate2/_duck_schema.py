import duckdb,boto3,json
cr=boto3.Session(profile_name='scrapivo').get_credentials().get_frozen_credentials(); c=duckdb.connect(); c.execute('LOAD httpfs'); c.execute("SET s3_region='us-east-2'"); c.execute("SET s3_access_key_id=?",[cr.access_key]); c.execute("SET s3_secret_access_key=?",[cr.secret_key]);
if cr.token: c.execute("SET s3_session_token=?",[cr.token])
base='s3://scrapivo-raw-data-2026-523220341033-us-east-2-an/'
paths={'businesses':'processed/local-businesses/by_country/*.parquet','companies':'processed/companies_by_initial/*/*.parquet','people':'processed/people_by_country/*/*.parquet','investors':'processed/investors/investor.parquet'}
out={}
for k,p in paths.items(): out[k]=c.execute(f"describe select * from read_parquet('{base+p}',union_by_name=true,hive_partitioning=true)").fetchall()
print(json.dumps(out,default=str))