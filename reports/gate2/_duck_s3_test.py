import duckdb,boto3
cr=boto3.Session(profile_name='scrapivo').get_credentials().get_frozen_credentials(); c=duckdb.connect(); c.execute('LOAD httpfs'); c.execute("SET s3_region='us-east-2'"); c.execute("SET s3_access_key_id=?",[cr.access_key]); c.execute("SET s3_secret_access_key=?",[cr.secret_key]);
if cr.token: c.execute("SET s3_session_token=?",[cr.token])
print(c.execute("select count(*) from read_parquet('s3://scrapivo-raw-data-2026-523220341033-us-east-2-an/processed/investors/investor.parquet')").fetchone()[0])