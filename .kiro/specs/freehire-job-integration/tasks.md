# Implementation Plan: FreeHire Job Integration

## Overview

This implementation plan converts the FreeHire job integration design into a series of actionable coding tasks. The plan follows a phased approach prioritizing FreeHire repository setup and verification (Phase 1) before proceeding to Scrapivo integration. Each task builds incrementally on previous work with checkpoints to validate progress.

## Tasks

- [x] 1. Phase 1: FreeHire Repository Setup and Verification
  - [x] 1.1 Clone FreeHire repository and create Docker Compose environment
    - Clone strelov1/freehire repository to separate directory outside Scrapivo codebase
    - Create docker-compose.yml file for PostgreSQL and Meilisearch containers
    - Configure PostgreSQL container with persistent volume, port 5432, and environment variables
    - Configure Meilisearch container with persistent volume, port 7700, and master key
    - Add health checks for both containers
    - Use Windows-compatible paths and PowerShell commands
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 13.1, 13.2, 13.3, 13.4, 13.6, 13.8, 13.9_

  - [x] 1.2 Initialize FreeHire database schema
    - Run PostgreSQL schema migrations to create jobs, companies, and ingestion_runs tables
    - Create indexes for dedupe_id, is_active, posted_at, and company_domain
    - Verify schema creation by querying table metadata
    - _Requirements: 1.5, 3.2_

  - [x] 1.3 Configure and verify FreeHire ingestion pipeline
    - Configure FreeHire ingestion settings (source endpoints, API keys if needed)
    - Run FreeHire ingestion pipeline for at least one configured source
    - Verify live jobs are fetched, normalized, and stored in PostgreSQL
    - Verify jobs are indexed in Meilisearch within 5 seconds
    - Query FreeHire API to confirm jobs are searchable
    - Run ingestion a second time and verify no duplicates are created
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8_

  - [ ]* 1.4 Write property test for ingestion metrics consistency
    - **Property 2: Ingestion Metrics Internal Consistency**
    - **Validates: Requirements 2.5, 8.1, 8.2**
    - Verify jobs_created + jobs_updated + jobs_failed = jobs_seen
    - Verify all timestamp and metric fields are populated
    - _Requirements: 2.6, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 1.5 Write property test for ingestion idempotence
    - **Property 3: Ingestion Idempotence**
    - **Validates: Requirements 2.7**
    - Verify running ingestion twice with same input produces no duplicates
    - Verify second run updates existing records (jobs_updated > 0)

- [~] 2. Checkpoint - Phase 1 Verification Complete
  - Verify Docker Compose starts without errors
  - Verify PostgreSQL and Meilisearch are healthy
  - Verify FreeHire ingestion completes successfully with live data
  - Verify API returns searchable jobs
  - Ensure all Phase 1 tests pass, ask the user if questions arise

- [ ] 3. Canonical Job Model and Schema Reconciliation
  - [~] 3.1 Audit FreeHire schema and define canonical model
    - Review FreeHire's existing PostgreSQL schema
    - Create TypeScript interface CanonicalJob in src/lib/jobs/canonical-model.ts
    - Include all required fields: id, source, sources, source_job_id, dedupe_id, company_id, company_name, company_domain, title, description, url, location, cities, countries, regions, work_mode, employment_type, seniority, role, category, skills, domains, company_type, relocation, english_level, salary_min, salary_max, salary_currency, posted_at, updated_at, expires_at, is_active, created_at
    - Create mapping function mapScrapivoToCanonical to convert existing JobPosting type
    - _Requirements: 3.1, 3.2, 3.3_

  - [~] 3.2 Extend PostgreSQL schema if necessary
    - Compare CanonicalJob fields with FreeHire schema
    - Create ALTER TABLE migrations for missing fields only if semantically different
    - Document field mappings between Scrapivo and FreeHire schemas
    - _Requirements: 3.4, 3.5_

  - [ ]* 3.3 Write property test for job normalization
    - **Property 1: Job Normalization Preserves Required Fields**
    - **Validates: Requirements 2.2, 2.3, 3.2**
    - Verify all required fields are populated after normalization
    - Test with various source formats (Greenhouse, Lever, Ashby, SmartRecruiters)

  - [ ]* 3.4 Write unit tests for canonical model mapping
    - Test mapScrapivoToCanonical with example JobPosting objects
    - Test salary parsing functions (parseSalaryMin, parseSalaryMax, parseSalaryCurrency)
    - Test edge cases (missing fields, null values, malformed data)
    - _Requirements: 3.1_

- [ ] 4. Deduplication Engine Implementation
  - [~] 4.1 Implement deterministic deduplication
    - Create src/lib/jobs/deduplication.ts
    - Implement computeDedupeId function using SHA256 hash
    - Implement normalization functions: normalizeDomain, normalizeTitle, normalizeLocation
    - Add city alias mappings for common abbreviations
    - _Requirements: 4.1_

  - [~] 4.2 Implement fuzzy deduplication
    - Install rapidfuzz library
    - Implement fuzzyMatchScore function using token_sort_ratio
    - Implement shouldMerge function with 0.85 similarity threshold
    - _Requirements: 4.3, 4.4_

  - [~] 4.3 Implement job record merge logic
    - Create merge strategy preferring ATS sources over aggregators
    - Implement source provenance preservation in sources array
    - Implement timestamp preservation (earliest posted_at, latest updated_at)
    - Implement field merging for skills, domains, description, salary ranges
    - _Requirements: 4.2, 4.7, 3.6_

  - [ ]* 4.4 Write property test for deterministic deduplication
    - **Property 5: Deterministic Deduplication ID**
    - **Validates: Requirements 4.1**
    - Verify identical dedupe_ids for jobs with same normalized fields
    - Test with various company domain formats, title variations, location aliases

  - [ ]* 4.5 Write property test for fuzzy matching threshold
    - **Property 6: Fuzzy Matching Threshold**
    - **Validates: Requirements 4.3, 4.4**
    - Verify jobs with similarity score >= 0.85 are merged
    - Verify jobs with similarity score < 0.85 are not merged

  - [ ]* 4.6 Write property test for merge timestamp preservation
    - **Property 9: Merge Timestamp Preservation**
    - **Validates: Requirements 4.7**
    - Verify merged record has earliest posted_at and latest updated_at

  - [ ]* 4.7 Write property test for source provenance preservation
    - **Property 4: Source Provenance Preservation on Merge**
    - **Validates: Requirements 3.6, 4.2**
    - Verify all contributing sources are preserved in sources array after merge

  - [ ]* 4.8 Write unit tests for deduplication logic
    - Test normalization functions with edge cases
    - Test fuzzyMatchScore with crafted similar/dissimilar examples
    - Test shouldMerge boundary conditions

- [ ] 5. Multi-Tier Source Integration
  - [~] 5.1 Implement Tier 2 ATS adapters
    - Create src/lib/jobs/tier2-adapters.ts
    - Implement Greenhouse adapter: https://boards-api.greenhouse.io/v1/boards/{company}/jobs
    - Implement Lever adapter: https://api.lever.co/v0/postings/{company}?mode=json
    - Implement Ashby adapter: https://api.ashbyhq.com/posting-api/job-board/{company}
    - Implement SmartRecruiters adapter with pagination: https://api.smartrecruiters.com/v1/companies/{company}/postings
    - Each adapter should parse source-specific JSON to CanonicalJob model
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_

  - [~] 5.2 Implement Tier 3 JobSpy worker
    - Create src/workers/jobspy-worker.ts
    - Integrate JobSpy Python library via child process or microservice
    - Implement scheduled fetch for LinkedIn, Indeed, Glassdoor
    - Configure worker to write normalized jobs to PostgreSQL
    - Implement isolation so JobSpy failures don't impact Tier 1/2 ingestion
    - _Requirements: 5.8, 5.9_

  - [~] 5.3 Implement ingestion error handling and metrics
    - Create src/lib/jobs/ingestion-error-handler.ts
    - Implement error classification (network, parse, validation, database)
    - Record errors in ingestion_runs table with job_url, error_type, message, stack_trace
    - Ensure failed source doesn't prevent other sources from processing
    - _Requirements: 5.10, 8.8, 8.9_

  - [ ]* 5.4 Write property test for error isolation
    - **Property 10: Error Isolation in Multi-Source Ingestion**
    - **Validates: Requirements 5.10**
    - Verify one source failure doesn't stop other sources
    - Verify errors are recorded in ingestion_runs metadata

  - [ ]* 5.5 Write property test for parser error descriptiveness
    - **Property 29: Parser Error Descriptiveness**
    - **Validates: Requirements 14.5**
    - Verify parsing errors include source identifier and descriptive message

  - [ ]* 5.6 Write unit tests for ATS adapters
    - Test each adapter with example API responses
    - Test error handling for malformed responses
    - Test pagination for SmartRecruiters adapter

- [~] 6. Checkpoint - Multi-Source Ingestion Working
  - Verify Tier 2 adapters can fetch and normalize jobs
  - Verify JobSpy worker runs without blocking main ingestion
  - Verify errors are logged and other sources continue processing
  - Ensure all tests pass, ask the user if questions arise

- [ ] 7. PostgreSQL Integration and Meilisearch Configuration
  - [~] 7.1 Configure database connection pooling
    - Set up PostgreSQL client with connection pool (min: 5, max: 20)
    - Implement connection health checks on startup
    - Implement error handling for connection limit exceeded
    - _Requirements: 6.5, 6.6, 6.7, 6.8_

  - [~] 7.2 Implement PostgreSQL-first write ordering
    - Ensure all job writes commit to PostgreSQL before Meilisearch indexing
    - Implement async Meilisearch indexing with 5-second timeout
    - Log warnings if indexing exceeds timeout
    - _Requirements: 6.1, 6.2, 2.4, 2.5_

  - [~] 7.3 Configure Meilisearch index settings
    - Reuse FreeHire's Meilisearch configuration
    - Set searchableAttributes: title, description, company_name, location, cities, countries, skills, domains, role, category
    - Set filterableAttributes: collections, regions, work_mode, role, category, ai_archetype, seniority, skills, domains, company_type, countries, cities, relocation, employment_type, english_level, salary_min, salary_max, salary_currency, is_active
    - Set sortableAttributes: posted_at, updated_at, salary_min, salary_max
    - Configure synonyms for common skill abbreviations
    - _Requirements: 7.1, 7.2, 7.3, 7.9_

  - [~] 7.4 Implement Meilisearch index rebuild function
    - Create function to rebuild entire Meilisearch index from PostgreSQL
    - Filter for active jobs only (is_active = true)
    - _Requirements: 6.3, 6.4_

  - [ ]* 7.5 Write property test for PostgreSQL-first write ordering
    - **Property 11: PostgreSQL-First Write Ordering**
    - **Validates: Requirements 6.1, 6.2**
    - Verify PostgreSQL commit completes before Meilisearch indexing starts

  - [ ]* 7.6 Write property test for Meilisearch index rebuild completeness
    - **Property 12: Meilisearch Index Rebuild Completeness**
    - **Validates: Requirements 6.3**
    - Verify rebuilt index contains all and only active jobs from PostgreSQL

- [ ] 8. Meilisearch Query Adapter Implementation
  - [~] 8.1 Create Meilisearch query adapter
    - Create src/lib/jobs/meilisearch-adapter.ts
    - Implement searchJobs function converting JobSearchFilters to Meilisearch query
    - Implement buildFilterString to translate Scrapivo filters
    - Support location, remoteOnly, seniority, region, sources filters
    - Return jobs, total, facets, page, pageSize
    - _Requirements: 7.4, 7.5, 7.6, 7.8_

  - [~] 8.2 Implement pagination and facet aggregation
    - Enforce page size limits (min: 10, max: 100)
    - Return facet counts for work_mode, seniority, employment_type, countries, regions, company_type
    - _Requirements: 7.6, 7.7, 7.8_

  - [~] 8.3 Implement search error handling with graceful degradation
    - Create src/lib/jobs/search-error-handler.ts
    - Fall back to PostgreSQL queries if Meilisearch unavailable
    - Return empty result set with error message for invalid queries
    - _Requirements: 6.6_

  - [ ]* 8.4 Write property test for search facet completeness
    - **Property 13: Search Facet Completeness**
    - **Validates: Requirements 7.5, 7.7**
    - Verify all configured facet fields are present in response with live counts

  - [ ]* 8.5 Write property test for pagination boundary handling
    - **Property 14: Pagination Boundary Handling**
    - **Validates: Requirements 7.6**
    - Verify page size constraints are enforced
    - Verify no duplicates or missing records across pages

  - [ ]* 8.6 Write unit tests for query adapter
    - Test filter translation with various JobSearchFilters combinations
    - Test error handling for Meilisearch unavailability
    - Test response time requirements (<200ms for queries under 50 chars)

- [ ] 9. Profile Matching Engine - Deterministic Scoring
  - [~] 9.1 Create user profile data model
    - Create src/lib/profile/types.ts
    - Define UserProfile interface with skills, experience_years, seniority, quotas, notification preferences
    - Define NotificationChannel interface
    - _Requirements: 9.1_

  - [~] 9.2 Implement deterministic match score computation
    - Create src/lib/matching/deterministic-matcher.ts
    - Implement computeMatch function returning MatchResult
    - Compute skills_have as exact intersection (case-insensitive)
    - Compute skills_close using synonym mappings
    - Compute skills_missing as required skills not in profile
    - Compute match_percentage using formula: ((h + 0.5 * c) / r) * 100
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [~] 9.3 Add skill synonym mappings
    - Define SKILL_SYNONYMS dictionary for common abbreviations
    - Support js/javascript, ts/typescript, py/python, k8s/kubernetes, etc.
    - _Requirements: 9.3_

  - [ ]* 9.4 Write property test for deterministic match score computation
    - **Property 17: Deterministic Match Score Computation**
    - **Validates: Requirements 9.1**
    - Verify same inputs produce same score on repeated invocations
    - Verify score is in range [0, 100]

  - [ ]* 9.5 Write property test for skills_have computation
    - **Property 18: Skills Have Computation**
    - **Validates: Requirements 9.2**
    - Verify skills_have equals intersection of profile and job skills

  - [ ]* 9.6 Write property test for skills_close computation
    - **Property 19: Skills Close Computation**
    - **Validates: Requirements 9.3**
    - Verify skills_close includes synonym matches not in skills_have

  - [ ]* 9.7 Write property test for skills_missing computation
    - **Property 20: Skills Missing Computation**
    - **Validates: Requirements 9.4**
    - Verify skills_missing = required - (skills_have ∪ skills_close)

  - [ ]* 9.8 Write property test for match percentage formula
    - **Property 21: Match Percentage Formula**
    - **Validates: Requirements 9.5**
    - Verify match_percentage = floor(((h + 0.5*c) / r) * 100) clamped to [0, 100]

  - [ ]* 9.9 Write unit tests for deterministic matcher
    - Test with known skill sets and expected scores
    - Test synonym matching with example skills
    - Test edge cases (empty profile, no required skills, 100% match)

- [ ] 10. Profile Matching Engine - Deep Analysis (Optional LLM)
  - [~] 10.1 Implement deep match analysis with LLM
    - Create src/lib/matching/deep-matcher.ts
    - Implement computeDeepMatch function returning DeepMatchResult
    - Construct LLM prompt with candidate profile and job description
    - Cache results by (profile_id, job_id) combination with 30-day TTL
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [~] 10.2 Implement deep match quota management
    - Check user quota before calling LLM
    - Reject requests if quota exhausted
    - Decrement quota after successful analysis
    - Return cached results without consuming quota
    - _Requirements: 10.5, 10.6, 10.7_

  - [~] 10.3 Implement LLM error handling
    - Create src/lib/matching/match-error-handler.ts
    - Handle quota exhaustion with friendly error message
    - Fall back to deterministic match if LLM unavailable
    - Handle missing profile error
    - _Requirements: 10.7_

  - [ ]* 10.4 Write property test for deep match cache hit
    - **Property 22: Deep Match Cache Hit**
    - **Validates: Requirements 10.3, 10.4**
    - Verify cached results are returned without LLM invocation

  - [ ]* 10.5 Write property test for deep match quota enforcement
    - **Property 23: Deep Match Quota Enforcement**
    - **Validates: Requirements 10.5**
    - Verify requests are rejected when quota exhausted
    - Verify quota resets at expected time

  - [ ]* 10.6 Write unit tests for deep matcher
    - Test prompt construction with example profiles
    - Test LLM response parsing
    - Test quota enforcement logic
    - Test error handling for LLM unavailability

- [~] 11. Checkpoint - Profile Matching Complete
  - Verify deterministic match scores are computed correctly
  - Verify deep match analysis works with LLM (if configured)
  - Verify quota enforcement prevents overuse
  - Ensure all matching tests pass, ask the user if questions arise

- [ ] 12. Email Generation Service
  - [~] 12.1 Implement personalized email generation
    - Create src/lib/email/email-generator.ts
    - Accept inputs: candidate profile, job description, company context
    - Ground all statements in supplied candidate data
    - Avoid generic phrases and invented achievements
    - Return editable text
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [ ]* 12.2 Write unit tests for email generation
    - Test grounding in candidate profile data
    - Test rejection of generic phrases
    - Test handling of missing profile fields

- [ ] 13. Notification System Implementation
  - [~] 13.1 Create notification service
    - Create src/lib/notifications/notification-service.ts
    - Support Telegram, Discord, Email, Slack, WhatsApp channels
    - Send notifications for new jobs matching saved search criteria
    - Include job title, company, location, match percentage, direct link
    - _Requirements: 15.1, 15.2, 15.3_

  - [~] 13.2 Implement notification rate limiting
    - Enforce max 10 notifications per user per hour
    - Track notification counts per user per time window
    - _Requirements: 15.4, 15.5_

  - [~] 13.3 Implement notification retry logic
    - Retry failed notifications up to 3 times with exponential backoff (1s, 2s, 4s)
    - Log all failures
    - _Requirements: 15.6, 15.8_

  - [~] 13.4 Implement notification preferences management
    - Create UI for managing notification channels
    - Allow users to enable/disable channels
    - Provide notification history view
    - _Requirements: 15.7, 15.9_

  - [ ]* 13.5 Write property test for notification content completeness
    - **Property 30: Notification Content Completeness**
    - **Validates: Requirements 15.2, 15.3**
    - Verify notifications include all required fields

  - [ ]* 13.6 Write property test for notification rate limiting
    - **Property 31: Notification Rate Limiting**
    - **Validates: Requirements 15.4**
    - Verify max 10 notifications per hour are enforced

  - [ ]* 13.7 Write property test for notification channel disable
    - **Property 32: Notification Channel Disable**
    - **Validates: Requirements 15.5**
    - Verify disabled channels receive no notifications

  - [ ]* 13.8 Write property test for notification retry with exponential backoff
    - **Property 33: Notification Retry with Exponential Backoff**
    - **Validates: Requirements 15.6**
    - Verify retry attempts with correct backoff delays

  - [ ]* 13.9 Write unit tests for notification service
    - Test each notification channel implementation
    - Test rate limiting logic
    - Test retry logic with simulated failures

- [ ] 14. Frontend Integration with Scrapivo UI
  - [~] 14.1 Migrate job search to Meilisearch queries
    - Update src/routes/_authenticated/jobs.tsx
    - Replace in-memory filtering with Meilisearch queries via TanStack server functions
    - Preserve existing UI components and layout
    - _Requirements: 12.1, 12.2, 19.2, 19.3_

  - [~] 14.2 Implement match sidebar component
    - Display match percentage, skills_have, skills_close, skills_missing
    - Add "Analyze Match" button for deep analysis
    - Show deep match results (compatibility_score, reasoning, strengths, gaps, recommendations)
    - _Requirements: 12.5, 9.7_

  - [~] 14.3 Implement job detail view
    - Display full job description with company, location, salary, requirements
    - Show source badge indicating data provenance
    - Integrate match sidebar
    - _Requirements: 12.4_

  - [~] 14.4 Implement bookmarking functionality
    - Allow users to save jobs for later review
    - Display bookmarked jobs in separate view
    - _Requirements: 12.6_

  - [~] 14.5 Update job card display
    - Show title, company, location, work_mode, seniority, salary, source badge
    - Display match percentage if user has profile
    - _Requirements: 12.3_

  - [ ]* 14.6 Write property test for bookmark persistence
    - **Property 24: Bookmark Persistence Round-Trip**
    - **Validates: Requirements 12.6**
    - Verify bookmarking and unbookmarking are persistent

  - [ ]* 14.7 Write unit tests for UI components
    - Test search filter translation
    - Test job card rendering
    - Test match sidebar display
    - Test responsive design on mobile and desktop

- [~] 15. Checkpoint - Frontend Integration Complete
  - Verify search UI works with Meilisearch queries
  - Verify job details display correctly
  - Verify match sidebar shows accurate scores
  - Verify bookmarking persists across sessions
  - Ensure all tests pass, ask the user if questions arise

- [ ] 16. Migration from In-Memory to Persistent Storage
  - [~] 16.1 Refactor job registry to use PostgreSQL
    - Remove in-memory job arrays from src/lib/jobs/registry.ts
    - Replace with PostgreSQL queries
    - Remove dedupeJobs function (rely on database-level deduplication)
    - _Requirements: 19.1, 19.4_

  - [~] 16.2 Update existing job source adapters
    - Refactor adapters to write to PostgreSQL instead of returning arrays
    - Ensure adapters call deduplication logic
    - Ensure adapters record ingestion run metadata
    - _Requirements: 19.6, 19.8_

  - [~] 16.3 Preserve backward compatibility
    - Maintain JobPosting TypeScript interface
    - Maintain JobSearchFilters interface
    - _Requirements: 19.5, 19.8_

  - [ ]* 16.4 Write unit tests for migration
    - Test PostgreSQL query performance
    - Test backward compatibility with existing interfaces
    - Test adapter refactoring

- [ ] 17. Parser Round-Trip Testing
  - [ ]* 17.1 Write property test for Greenhouse parser round-trip
    - **Property 25: ATS Parser Round-Trip (Greenhouse)**
    - **Validates: Requirements 14.1, 14.6, 14.7**
    - Verify parse(serialize(job)) == job for all valid canonical jobs from Greenhouse

  - [ ]* 17.2 Write property test for Lever parser round-trip
    - **Property 26: ATS Parser Round-Trip (Lever)**
    - **Validates: Requirements 14.2, 14.6, 14.7**
    - Verify parse(serialize(job)) == job for all valid canonical jobs from Lever

  - [ ]* 17.3 Write property test for Ashby parser round-trip
    - **Property 27: ATS Parser Round-Trip (Ashby)**
    - **Validates: Requirements 14.3, 14.6, 14.7**
    - Verify parse(serialize(job)) == job for all valid canonical jobs from Ashby

  - [ ]* 17.4 Write property test for SmartRecruiters parser round-trip
    - **Property 28: ATS Parser Round-Trip (SmartRecruiters)**
    - **Validates: Requirements 14.4, 14.6, 14.7**
    - Verify parse(serialize(job)) == job for all valid canonical jobs from SmartRecruiters

- [ ] 18. Data Retention and Privacy Implementation
  - [~] 18.1 Implement data retention policy
    - Create job archival process for records inactive > 90 days
    - Create separate archive table for historical data
    - _Requirements: 20.1, 20.2_

  - [~] 18.2 Implement encryption for sensitive fields
    - Encrypt user profile sensitive fields (email, contact details, API keys)
    - Use TLS for data transmission between services
    - _Requirements: 20.3, 20.4_

  - [~] 18.3 Implement data export API
    - Allow users to download all profile, search history, bookmarks, notifications
    - _Requirements: 20.5_

  - [~] 18.4 Implement account deletion
    - Remove all user data within 30 days of deletion request
    - Delete profile, search history, bookmarks, notification preferences, cached matches
    - _Requirements: 20.6_

  - [ ]* 18.5 Write property test for data retention policy
    - **Property 34: Data Retention Policy**
    - **Validates: Requirements 20.1, 20.2**
    - Verify jobs inactive > 90 days are archived

  - [ ]* 18.6 Write property test for profile encryption at rest
    - **Property 36: Profile Encryption at Rest**
    - **Validates: Requirements 20.4**
    - Verify sensitive fields are encrypted in database

  - [ ]* 18.7 Write property test for data export completeness
    - **Property 37: Data Export Completeness**
    - **Validates: Requirements 20.6**
    - Verify exported data includes all user-associated records

  - [ ]* 18.8 Write property test for account deletion completeness
    - **Property 38: Account Deletion Completeness**
    - **Validates: Requirements 20.7**
    - Verify all user data is removed after deletion

- [ ] 19. Ingestion Observability and Monitoring
  - [~] 19.1 Implement ingestion run metrics tracking
    - Record started_at, completed_at, duration for each run
    - Track jobs_seen, jobs_created, jobs_updated, jobs_deactivated, jobs_failed
    - Capture errors with stack traces in errors field
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [~] 19.2 Implement stale job auto-deactivation
    - Check job age against source-specific refresh interval
    - Automatically mark stale jobs inactive
    - _Requirements: 8.10_

  - [~] 19.3 Create ingestion status API endpoint
    - Return most recent ingestion run status for each source
    - Include metrics and error details
    - _Requirements: 8.9_

  - [ ]* 19.4 Write property test for error capture on ingestion failure
    - **Property 15: Error Capture on Ingestion Failure**
    - **Validates: Requirements 8.8**
    - Verify errors are captured with job URL, error type, message

  - [ ]* 19.5 Write property test for stale job auto-deactivation
    - **Property 16: Stale Job Auto-Deactivation**
    - **Validates: Requirements 8.10**
    - Verify jobs older than refresh interval are marked inactive

  - [ ]* 19.6 Write unit tests for observability features
    - Test metrics tracking accuracy
    - Test stale job detection logic
    - Test ingestion status API response format

- [ ] 20. Final Integration and End-to-End Testing
  - [~] 20.1 Integration testing for complete workflow
    - Test job ingestion from source to PostgreSQL to Meilisearch to UI
    - Test profile matching with deterministic and deep analysis
    - Test notification delivery for matched jobs
    - Test email generation for applications

  - [~] 20.2 Performance testing
    - Verify search response times <200ms for typical queries
    - Verify Meilisearch indexing completes within 5 seconds
    - Verify connection pool handles concurrent requests

  - [~] 20.3 Error recovery testing
    - Test graceful degradation when Meilisearch unavailable
    - Test ingestion continues when one source fails
    - Test notification retry logic with simulated failures

  - [~] 20.4 Documentation and deployment guide
    - Document Docker Compose setup for Windows
    - Document environment variable configuration
    - Document ingestion scheduling and monitoring
    - Document API endpoints and TypeScript interfaces

- [~] 21. Final Checkpoint - Project Complete
  - All Phase 1 verification criteria met
  - All ingestion tiers operational (FreeHire, Tier 2, Tier 3)
  - Profile matching and email generation working
  - Notification system delivering alerts
  - Frontend integrated with Meilisearch backend
  - All property tests and unit tests passing
  - Documentation complete

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests validate universal correctness properties from design document
- Unit tests validate specific examples and edge cases
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
- Phase 1 (tasks 1-2) is critical - must complete successfully before proceeding
- TypeScript is the implementation language for all Scrapivo integration code
- FreeHire repository code uses its existing language (assumed Python/Node.js)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4", "1.5"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 6, "tasks": ["4.1", "4.2"] },
    { "id": 7, "tasks": ["4.3"] },
    { "id": 8, "tasks": ["4.4", "4.5", "4.6", "4.7", "4.8"] },
    { "id": 9, "tasks": ["5.1", "5.2"] },
    { "id": 10, "tasks": ["5.3", "5.4", "5.5", "5.6"] },
    { "id": 11, "tasks": ["7.1", "7.2"] },
    { "id": 12, "tasks": ["7.3"] },
    { "id": 13, "tasks": ["7.4", "7.5", "7.6"] },
    { "id": 14, "tasks": ["8.1"] },
    { "id": 15, "tasks": ["8.2", "8.3"] },
    { "id": 16, "tasks": ["8.4", "8.5", "8.6"] },
    { "id": 17, "tasks": ["9.1"] },
    { "id": 18, "tasks": ["9.2", "9.3"] },
    { "id": 19, "tasks": ["9.4", "9.5", "9.6", "9.7", "9.8", "9.9"] },
    { "id": 20, "tasks": ["10.1", "10.2"] },
    { "id": 21, "tasks": ["10.3", "10.4", "10.5", "10.6"] },
    { "id": 22, "tasks": ["12.1", "12.2"] },
    { "id": 23, "tasks": ["13.1"] },
    { "id": 24, "tasks": ["13.2", "13.3"] },
    { "id": 25, "tasks": ["13.4", "13.5", "13.6", "13.7", "13.8", "13.9"] },
    { "id": 26, "tasks": ["14.1"] },
    { "id": 27, "tasks": ["14.2", "14.3", "14.4", "14.5"] },
    { "id": 28, "tasks": ["14.6", "14.7"] },
    { "id": 29, "tasks": ["16.1"] },
    { "id": 30, "tasks": ["16.2"] },
    { "id": 31, "tasks": ["16.3", "16.4"] },
    { "id": 32, "tasks": ["17.1", "17.2", "17.3", "17.4"] },
    { "id": 33, "tasks": ["18.1", "18.2"] },
    { "id": 34, "tasks": ["18.3", "18.4"] },
    { "id": 35, "tasks": ["18.5", "18.6", "18.7", "18.8"] },
    { "id": 36, "tasks": ["19.1"] },
    { "id": 37, "tasks": ["19.2", "19.3"] },
    { "id": 38, "tasks": ["19.4", "19.5", "19.6"] },
    { "id": 39, "tasks": ["20.1"] },
    { "id": 40, "tasks": ["20.2", "20.3"] },
    { "id": 41, "tasks": ["20.4"] }
  ]
}
```
