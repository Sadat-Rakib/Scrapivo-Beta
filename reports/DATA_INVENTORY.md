# DATA_INVENTORY (generated, streaming, read-only)

Files: 107 | Total bytes: 14497806481 (13.50 GiB)

| file | MB | rows | entity | gitignored | app use |
|---|---|---|---|---|---|
| BasicCompanyDataAsOneFile.zip | 469.73 |  | companies-raw-infra | yes | NONE in src/ (pipeline input only) |
| city_country_map.json | 21.84 |  | other | no | src/lib/local/city-gazetteer.ts routing |
| companies_complete.jsonl | 239.16 | 315208 | companies | yes | src/lib/companies/local-file-source.ts; hiring-only blend |
| company_ats_tenants.json | 0.13 |  | other | no | NONE known |
| company_ats_tenants.json.prev | 0.00 |  | other | yes | NONE known |
| investors_complete.jsonl | 1.09 | 1252 | investors | no | src/lib/investors/local-file-source.ts:33; unified discover only |
| investors_complete.jsonl.pre-bio-backfill.bak | 1.07 |  | investors | yes | NONE known |
| investors_merged.json | 15.80 | 8098 | investors | no | src/lib/investors/search.ts:6 static import; Investors page live path |
| job_boards_catalog.json | 0.03 |  | other | no | NONE known |
| job_boards_catalog.json.prev | 0.01 |  | other | yes | NONE known |
| local_businesses_ae.jsonl | 67.18 | 86070 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_am.jsonl | 10.30 | 13468 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ar.jsonl | 306.61 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_at.jsonl | 100.83 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_au.jsonl | 311.38 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_austin.jsonl | 73.89 | 93734 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_az.jsonl | 12.87 | 17466 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_bd.jsonl | 102.18 | 124482 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_be.jsonl | 98.06 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_bg.jsonl | 35.39 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_bh.jsonl | 6.73 | 8773 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_bo.jsonl | 35.05 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_br.jsonl | 1603.06 | 2000000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ca.jsonl | 312.60 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ch.jsonl | 100.29 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_cl.jsonl | 97.63 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_co.jsonl | 97.95 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_cr.jsonl | 34.55 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_cy.jsonl | 29.14 | 37943 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_cz.jsonl | 98.85 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_de.jsonl | 318.07 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_dk.jsonl | 98.27 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_do.jsonl | 33.85 | 43591 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ec.jsonl | 34.71 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ee.jsonl | 23.18 | 31621 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_eg.jsonl | 108.88 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_es.jsonl | 312.85 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_fi.jsonl | 97.99 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_fr.jsonl | 314.57 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_gb.jsonl | 314.91 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ge.jsonl | 19.76 | 23967 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_gh.jsonl | 13.32 | 17434 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_gr.jsonl | 103.44 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_gt.jsonl | 34.99 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_hk.jsonl | 34.61 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_hr.jsonl | 33.26 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_hu.jsonl | 97.46 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_id.jsonl | 307.05 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ie.jsonl | 86.14 | 112677 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_il.jsonl | 68.39 | 86459 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_in.jsonl | 1662.03 | 2000000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_is.jsonl | 8.49 | 11395 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_it.jsonl | 311.95 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_jo.jsonl | 27.33 | 33862 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_jp.jsonl | 313.86 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ke.jsonl | 34.29 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_kr.jsonl | 105.76 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_kw.jsonl | 11.99 | 15736 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_kz.jsonl | 18.05 | 22810 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_lb.jsonl | 21.52 | 28686 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_lk.jsonl | 34.52 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_lt.jsonl | 32.14 | 43059 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_lu.jsonl | 14.50 | 18678 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_lv.jsonl | 29.04 | 39734 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ma.jsonl | 34.68 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_mt.jsonl | 10.04 | 13162 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_mx.jsonl | 308.81 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_my.jsonl | 99.02 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ng.jsonl | 54.76 | 69899 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_nl.jsonl | 100.41 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_no.jsonl | 96.54 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_np.jsonl | 34.09 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_nz.jsonl | 100.26 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_om.jsonl | 7.13 | 9491 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_pa.jsonl | 13.95 | 18159 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_pe.jsonl | 99.70 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ph.jsonl | 97.82 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_pk.jsonl | 100.73 | 126245 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_pl.jsonl | 100.48 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_pr.jsonl | 33.81 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_pt.jsonl | 101.01 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_py.jsonl | 33.96 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_qa.jsonl | 11.10 | 14382 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ro.jsonl | 98.60 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_rs.jsonl | 34.75 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_sa.jsonl | 59.48 | 77036 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_se.jsonl | 96.68 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_sg.jsonl | 54.54 | 69158 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_si.jsonl | 27.08 | 36453 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_sk.jsonl | 33.99 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_th.jsonl | 109.74 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_tn.jsonl | 28.08 | 36530 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_tr.jsonl | 300.70 | 400000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_tw.jsonl | 33.94 | 45000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_tz.jsonl | 9.82 | 12944 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_ua.jsonl | 108.04 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_us.jsonl | 1577.43 | 2000000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_uy.jsonl | 24.33 | 32251 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_uz.jsonl | 8.27 | 10831 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_vn.jsonl | 101.33 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| local_businesses_za.jsonl | 100.40 | 130000 | local-businesses | yes | src/lib/local/businesses-file-source.ts (DB-first); absent on Vercel (gitignored |
| people_complete.jsonl | 0.01 | 27 | people | no | NONE in src/ (pipeline scripts only) |
| pipeline.duckdb | 216.01 |  | companies-raw-infra | yes | NONE in src/ (scripts/pipeline/store.py only) |
| regions_manifest.json | 0.02 |  | other | no | src/lib/local/businesses-file-source.ts routing |
| workday_tenants.json | 0.12 |  | other | no | NONE known |
| workday_tenants.json.prev | 0.00 |  | other | yes | NONE known |
| yc_company_linkedin.json | 0.00 |  | other | no | NONE known |

Notes: row_estimate = streaming newline count for JSONL; schema_keys = keys of first record; samples truncated.
