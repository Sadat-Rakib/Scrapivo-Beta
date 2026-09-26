-- Gate 1 seed: small representative dataset for the 5 proof queries.
-- Idempotent (INSERT ... ON CONFLICT DO NOTHING keyed by registry_key).
-- city_norm / role_norm are precomputed here exactly as the loader must write
-- them (lowercase + alias-resolved: Bombay->Mumbai etc.). Country is ISO2 upper.
--
-- Late-record case: Pune Late-File Dental Clinic stands in for the real record
-- sitting at S3 position ~35114 (past the old 200-row oversample window, which
-- is why Pune returned Jamnagar rows). The indexed query must return it
-- regardless of original file position.
-- Exclusion cases: Jamnagar/Mumbai dentists must NOT match "dentists in Pune";
-- Harrogate must NOT match "companies in London"; Delhi must NOT match
-- "founders in Mumbai".

-- ---------------------------------------------------------------- businesses
INSERT INTO public.idx_businesses
  (registry_key, source, name, name_normalized, category, category_raw,
   city, city_norm, region, country, postal_code, address,
   phone, email, website, domain, quality_score, confidence,
   junk_flag, content_hash, source_file)
VALUES
  ('overture:DEMO-PUNE-001', 'overture', 'Bright Smile Dental', 'bright smile dental',
   'dentist', 'dentist', 'Pune', 'pune', 'MH', 'IN', '411001',
   '123 MG Road, Pune, MH 411001', '+912025501001', NULL, 'https://brightsmilepune.example',
   'brightsmilepune.example', 80, 0.9, 0, 'hash-demo-pune-001', 'local_businesses_in.jsonl'),
  ('overture:DEMO-PUNE-002', 'overture', 'Pune Family Dental Care', 'pune family dental care',
   'dentist', 'general_dentistry', 'Pune', 'pune', 'MH', 'IN', '411005',
   '45 FC Road, Pune, MH 411005', '+912025501002', 'care@punefamily.example', NULL,
   NULL, 65, 0.8, 0, 'hash-demo-pune-002', 'local_businesses_in.jsonl'),
  ('overture:DEMO-PUNE-LATE', 'overture', 'Pune Late-File Dental Clinic', 'pune late file dental clinic',
   'dentist', 'dentist', 'Pune', 'pune', 'MH', 'IN', '411001',
   'Shop 9, MG Road, Pune, MH 411001', '+912025501009', NULL, 'https://punelatefile.example',
   'punelatefile.example', 90, 0.95, 0, 'hash-demo-pune-late', 'local_businesses_in.jsonl'),
  ('overture:DEMO-JAM-001', 'overture', 'Jamnagar Dental House', 'jamnagar dental house',
   'dentist', 'dentist', 'Jamnagar', 'jamnagar', 'GJ', 'IN', '361008',
   'Cross Rd Complex, Jamnagar, GJ 361008', '+91288110001', NULL, NULL,
   NULL, 70, 0.85, 0, 'hash-demo-jam-001', 'local_businesses_in.jsonl'),
  ('overture:DEMO-JAM-002', 'overture', 'Shree Dental Jamnagar', 'shree dental jamnagar',
   'dentist', 'dentist', 'Jamnagar', 'jamnagar', 'GJ', 'IN', '361006',
   'Gokul Nagar, Jamnagar, GJ 361006', '+91288110002', NULL, NULL,
   NULL, 60, 0.8, 0, 'hash-demo-jam-002', 'local_businesses_in.jsonl'),
  ('overture:DEMO-MUM-DENT-001', 'overture', 'Bandra Smile Studio', 'bandra smile studio',
   'dentist', 'dentist', 'Mumbai', 'mumbai', 'MH', 'IN', '400050',
   'Linking Rd, Bandra, Mumbai, MH 400050', '+912226400001', NULL, NULL,
   NULL, 75, 0.85, 0, 'hash-demo-mum-dent-001', 'local_businesses_in.jsonl'),
  ('overture:DEMO-AUS-001', 'overture', 'Austin Rooter Plumbing', 'austin rooter plumbing',
   'plumber', 'plumber', 'Austin', 'austin', 'TX', 'US', '78701',
   '600 Congress Ave, Austin, TX 78701', '+15125550101', 'hello@austinrooter.example',
   'https://austinrooter.example', 'austinrooter.example', 85, 0.9, 0,
   'hash-demo-aus-001', 'local_businesses_us.jsonl'),
  ('overture:DEMO-AUS-002', 'overture', 'Lone Star Plumbers', 'lone star plumbers',
   'plumber', 'plumbing_contractor', 'Austin', 'austin', 'TX', 'US', '78745',
   '4801 Burleson Rd, Austin, TX 78745', '+15125550102', NULL, NULL,
   NULL, 70, 0.82, 0, 'hash-demo-aus-002', 'local_businesses_us.jsonl')
ON CONFLICT (registry_key) DO NOTHING;

-- ----------------------------------------------------------------- companies
INSERT INTO public.idx_companies
  (registry_key, source, name, name_normalized, country, city, city_norm, region,
   category, website, domain, email, phone, linkedin, description,
   quality_score, content_hash)
VALUES
  ('companies_house:DEMO-LON-001', 'companies_house', 'Thames Analytics Ltd', 'thames analytics',
   'GB', 'London', 'london', 'ENG', 'SaaS', 'https://thamesanalytics.example',
   'thamesanalytics.example', 'hello@thamesanalytics.example', '+442070960001',
   'https://linkedin.example/company/thames', 'B2B analytics platform', 82, 'hash-demo-lon-001'),
  ('companies_house:DEMO-LON-002', 'companies_house', 'Borough Fintech Ltd', 'borough fintech',
   'GB', 'London', 'london', 'ENG', 'Fintech', 'https://boroughfin.example',
   'boroughfin.example', NULL, '+442070960002', NULL, 'Payments infrastructure', 74,
   'hash-demo-lon-002'),
  ('companies_house:DEMO-HAR-001', 'companies_house', 'Harrogate Tea Rooms Ltd', 'harrogate tea rooms',
   'GB', 'Harrogate', 'harrogate', 'ENG', 'Hospitality', NULL, NULL, NULL, NULL, NULL,
   'Tea rooms and catering', 55, 'hash-demo-har-001'),
  ('sec_edgar:DEMO-US-001', 'sec_edgar', 'Acme Robotics Inc', 'acme robotics',
   'US', 'Austin', 'austin', 'TX', 'Robotics', 'https://acmerobotics.example',
   'acmerobotics.example', 'ir@acmerobotics.example', '+15125550201', NULL,
   'Warehouse robotics', 88, 'hash-demo-us-001'),
  ('sec_edgar:DEMO-US-002', 'sec_edgar', 'Hudson SaaS Corp', 'hudson saas',
   'US', 'New York', 'new york', 'NY', 'SaaS', 'https://hudsonsaas.example',
   'hudsonsaas.example', NULL, '+12125550202', NULL, 'Revenue tooling', 79,
   'hash-demo-us-002')
ON CONFLICT (registry_key) DO NOTHING;

-- -------------------------------------------------------------------- people
INSERT INTO public.idx_people
  (registry_key, source, name, name_normalized, role, role_norm, company,
   company_domain, city, city_norm, country, industry, email, phone, linkedin,
   quality_score, content_hash)
VALUES
  ('yc_directory:DEMO-MUM-001', 'yc_directory', 'Aarav Shah', 'aarav shah',
   'Founder & CEO', 'founder', 'Dabbawala Tech', 'dabbawala.example',
   'Mumbai', 'mumbai', 'IN', 'Logistics', 'aarav@dabbawala.example', NULL,
   'https://linkedin.example/in/aaravshah', 86, 'hash-demo-mum-001'),
  ('yc_directory:DEMO-MUM-002', 'yc_directory', 'Priya Nair', 'priya nair',
   'Co-Founder', 'founder', 'Monsoon AI', 'monsoonai.example',
   'Mumbai', 'mumbai', 'IN', 'AI', NULL, NULL,
   'https://linkedin.example/in/priyanaair', 78, 'hash-demo-mum-002'),
  ('yc_directory:DEMO-MUM-003', 'yc_directory', 'Rohan Mehta', 'rohan mehta',
   'Software Engineer', 'engineer', 'Monsoon AI', 'monsoonai.example',
   'Mumbai', 'mumbai', 'IN', 'AI', NULL, NULL, NULL, 60, 'hash-demo-mum-003'),
  ('yc_directory:DEMO-DEL-001', 'yc_directory', 'Kabir Anand', 'kabir anand',
   'Founder', 'founder', 'Capital Kites', 'capitalkites.example',
   'Delhi', 'delhi', 'IN', 'Fintech', NULL, NULL, NULL, 72, 'hash-demo-del-001')
ON CONFLICT (registry_key) DO NOTHING;
