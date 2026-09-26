# STAGE_C_VERIFICATION (independent DuckDB pass)

Parquet rows: people=484325 companies=1602141 total=2086466
Expected (splits): people=484325 companies=1602141 total=2086466
COUNT CHECK: PASS

## Gate-field null rates (canonical output)
  people.name: null=0 (0.00%)
  people.company_name: null=0 (0.00%)
  people.title: null=0 (0.00%)
  people.email: null=0 (0.00%)
  people.phone: null=0 (0.00%)
  people.website: null=0 (0.00%)
  people.country: null=0 (0.00%)
  companies.company_name: null=0 (0.00%)
  companies.website: null=0 (0.00%)
  companies.location: null=0 (0.00%)
  companies.category: null=0 (0.00%)
  companies.email: null=0 (0.00%)
  companies.phone: null=0 (0.00%)

## Quality distributions
  people: 18:2, 26:6, 35:11, 43:33, 63:104, 75:6, 80:48852, 83:430, 100:434881
  companies: 43:1, 55:9, 60:22, 63:281, 66:1, 71:1, 75:41, 80:155299, 83:1923, 88:381, 100:1444182

## Dedupe REPORT (no merges performed)
  people dup-email: 65415 groups covering 173552 rows
  people dup-personal_linkedin: 54550 groups covering 139519 rows
  companies dup-email: 9416 groups covering 20244 rows
  companies dup-website: 478 groups covering 1029 rows

## Samples
  person: ('Gerald Adasavage', 'Head of Project Delivery', 'Green Automation', 'gerald.adasavage@greenautomation.com', '+48 57 444 84 92', 'United States', 100)
  person: ('Francesca Mangini', 'Legal Counsel (Regulatory Advice & Enforcement Mission) & Chapter Lead', 'Telstra', 'francesca.mangini@team.telstra.com', '+61 1300 368 387', 'Australia', 100)
  person: ('Firwansyah Silalahi', 'Head of Sales and Business Development', 'eFishery', 'firwansyah.silalahi@efishery.com', '+62 22 30500324', 'Republic of Indonesia', 100)
  company: ('37PropertyGroup', 'http://37propertygroup.com.au', 'info@37propertygroup.com.au', '0280016640', 'Consulting, Property Management, Real Estate', 80)
  company: ('Vitadeals', 'https://vitadeals.sg', 'info@vitadeals.sg', '65 6542 2348', 'Dietary Supplements, E-Commerce, Health Care, Wellness', 80)
  company: ("Vitality Women's Physical Therapy & Wellness", 'https://www.vitalitywomenspt.com', 'contact@vitalitywomenspt.com', '+1 331-215-4164', 'Fitness, Health Care, Medical, Therapeutics, Wellness', 100)
