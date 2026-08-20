# Requirements Document

## Introduction

This document specifies the requirements for integrating the FreeHire job aggregation system (from strelov1/freehire GitHub repository) into the existing Scrapivo job finder system. The integration replaces the current in-memory, live-fetch architecture with a PostgreSQL-backed, Meilisearch-indexed job aggregation pipeline while preserving the existing Scrapivo codebase structure and user interface patterns.

The integration follows an "extend, do not rebuild" principle: reuse FreeHire's proven ingestion pipeline, source registry, ATS adapters, PostgreSQL schema, normalization, deduplication, and Meilisearch integration rather than building custom alternatives.

## Glossary

- **FreeHire**: The open-source job aggregation system from strelov1/freehire repository providing PostgreSQL-backed job storage and Meilisearch indexing
- **Scrapivo**: The existing job finder system located in `src/lib/jobs/` with in-memory, live-fetch architecture
- **Job_Aggregation_System**: The integrated system combining FreeHire's backend with Scrapivo's frontend
- **Ingestion_Pipeline**: FreeHire's job fetching, normalization, deduplication, and storage process
- **Meilisearch**: The search engine used by FreeHire for fast, faceted job search
- **PostgreSQL**: The database system used by FreeHire as the source of truth for all job data
- **Canonical_Job_Model**: The unified internal job representation that all sources converge into
- **Dedupe_ID**: A unique identifier for jobs computed from company domain, normalized title, and normalized location
- **Source_Provenance**: The tracking of which ingestion sources contributed a particular job record
- **ATS**: Applicant Tracking System (Greenhouse, Lever, Ashby, SmartRecruiters, etc.)
- **JobSpy**: A third-party library for scraping jobs from LinkedIn, Indeed, and Glassdoor
- **Profile_Matching**: The process of comparing candidate skills against job requirements to compute compatibility scores
- **Docker_Compose**: The orchestration tool used to run PostgreSQL and Meilisearch containers on Windows
- **Tier_1_Sources**: FreeHire's native ingestion pipeline (primary source, must be proven working first)
- **Tier_2_Sources**: Direct ATS API integrations (Greenhouse, Lever, Ashby, SmartRecruiters) added only if FreeHire doesn't cover them
- **Tier_3_Sources**: JobSpy integration for LinkedIn, Indeed, Glassdoor (scheduled worker, isolated from main ingestion)
- **Phase_1_Milestone**: The critical first deliverable proving FreeHire runs locally with live data flowing through PostgreSQL and Meilisearch

## Requirements

### Requirement 1: FreeHire Repository Setup and Local Deployment

**User Story:** As a developer, I want to clone and deploy the FreeHire repository locally, so that I can verify the ingestion pipeline works before integration.

#### Acceptance Criteria

1. WHEN the developer clones the strelov1/freehire repository, THE Job_Aggregation_System SHALL store the clone in a separate directory outside the Scrapivo codebase
2. THE Job_Aggregation_System SHALL NOT fork the strelov1/freehire repository to avoid upstream dependency complexities
3. WHEN Docker Compose is started, THE Job_Aggregation_System SHALL initialize PostgreSQL container regardless of whether it was started through Docker Compose or manually
4. WHEN Docker Compose is started, THE Job_Aggregation_System SHALL initialize Meilisearch container regardless of whether it was started through Docker Compose or manually
5. WHEN PostgreSQL container starts, THE Job_Aggregation_System SHALL create the FreeHire database schema including tables for jobs, companies, sources, and ingestion runs
6. WHEN Meilisearch container starts, THE Job_Aggregation_System SHALL expose the search API on the configured port
7. WHEN the developer runs Docker Compose on Windows, THE Job_Aggregation_System SHALL use PowerShell-compatible commands and Windows path conventions

### Requirement 2: FreeHire Ingestion Pipeline Verification

**User Story:** As a developer, I want to verify FreeHire's ingestion pipeline fetches and stores live jobs, so that I can confirm the system works before proceeding to integration.

#### Acceptance Criteria

1. WHEN the FreeHire ingestion pipeline runs, THE Ingestion_Pipeline SHALL fetch live jobs from at least one configured source
2. WHEN jobs are fetched, THE Ingestion_Pipeline SHALL normalize job data into the Canonical_Job_Model
3. WHEN jobs are normalized, THE Ingestion_Pipeline SHALL store job records in PostgreSQL even if some required fields are missing
4. WHEN jobs are stored in PostgreSQL, THE Ingestion_Pipeline SHALL attempt to index job records in Meilisearch within 5 seconds
5. IF indexing a job in Meilisearch exceeds 5 seconds, THEN THE Ingestion_Pipeline SHALL log a warning and continue processing
6. WHEN the ingestion completes, THE Ingestion_Pipeline SHALL expose metrics including: started_at, completed_at, duration, jobs_seen, jobs_created, jobs_updated, jobs_deactivated, jobs_failed, errors
7. WHEN the developer queries the FreeHire API, THE Job_Aggregation_System SHALL return live jobs even if some required fields are missing
8. WHEN the ingestion pipeline runs a second time, THE Ingestion_Pipeline SHALL update existing job records without creating duplicates
9. IF Phase 1 verification fails, THEN THE Job_Aggregation_System SHALL NOT proceed to Phase 2 or subsequent phases

### Requirement 3: Canonical Job Data Model Reconciliation

**User Story:** As a developer, I want to reconcile Scrapivo's job model with FreeHire's schema, so that I can create a unified canonical model without unnecessary duplication.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL define one Canonical_Job_Model that all sources converge into
2. THE Canonical_Job_Model SHALL include fields: id, source, sources (array), source_job_id, company_id, company_name, company_domain, title, description, url, location, cities (array), countries (array), regions (array), work_mode, employment_type, seniority, role, category, skills (array), domains (array), company_type, relocation, english_level, salary_min, salary_max, salary_currency, posted_at, updated_at, expires_at, is_active, created_at
3. WHEN reconciling with FreeHire's schema, THE Job_Aggregation_System SHALL reuse compatible existing fields from FreeHire
4. WHEN FreeHire fields are insufficient, THE Job_Aggregation_System SHALL extend the schema only where technically necessary
5. THE Job_Aggregation_System SHALL NOT create new database migrations without first auditing FreeHire's existing schema
6. WHEN multiple sources provide the same job, THE Canonical_Job_Model SHALL preserve all contributing sources in the sources array field regardless of deduplication status

### Requirement 4: Job Deduplication Strategy

**User Story:** As a developer, I want to deduplicate jobs from multiple sources using deterministic and fuzzy matching, so that users don't see duplicate job listings.

#### Acceptance Criteria

1. WHEN computing primary deduplication, THE Job_Aggregation_System SHALL generate Dedupe_ID from company_domain, normalized_title, and normalized_location
2. WHEN primary deduplication matches multiple records, THE Job_Aggregation_System SHALL merge records and preserve Source_Provenance in the sources array
3. WHEN primary deduplication fails to match similar jobs, THE Job_Aggregation_System SHALL apply secondary fuzzy matching using rapidfuzz library
4. WHEN fuzzy matching computes similarity scores, THE Job_Aggregation_System SHALL merge jobs with similarity score above 0.85
5. WHEN a job is being deactivated, THE Job_Aggregation_System SHALL prevent deletion of the historical job record
6. WHEN a job expires or is removed from source, THE Job_Aggregation_System SHALL set is_active to false and record the deactivation timestamp
7. WHEN merging duplicate records, THE Job_Aggregation_System SHALL preserve the earliest posted_at timestamp and latest updated_at timestamp

### Requirement 5: Multi-Tier Source Coverage Integration

**User Story:** As a system administrator, I want to ingest jobs from FreeHire native sources, direct ATS APIs, and JobSpy sources, so that I can maximize job coverage while maintaining system reliability.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL prioritize Tier_1_Sources (FreeHire native ingestion) as the primary job source
2. THE Job_Aggregation_System SHALL allow implementing Tier_2_Sources before Tier_1_Sources are proven and Tier_2_Sources are evaluated
3. WHERE a direct ATS API is already covered by FreeHire, THE Job_Aggregation_System SHALL NOT implement a duplicate Tier_2_Sources adapter
4. WHEN implementing Tier_2_Sources, THE Job_Aggregation_System SHALL support Greenhouse API at https://boards-api.greenhouse.io/v1/boards/{company}/jobs
5. WHEN implementing Tier_2_Sources, THE Job_Aggregation_System SHALL support Lever API at https://api.lever.co/v0/postings/{company}?mode=json
6. WHEN implementing Tier_2_Sources, THE Job_Aggregation_System SHALL support Ashby API at https://api.ashbyhq.com/posting-api/job-board/{company}
7. WHEN implementing Tier_2_Sources, THE Job_Aggregation_System SHALL support SmartRecruiters API at https://api.smartrecruiters.com/v1/companies/{company}/postings with pagination
8. THE Job_Aggregation_System SHALL implement Tier_3_Sources (JobSpy) as a scheduled worker process isolated from the main Ingestion_Pipeline
9. WHEN Tier_3_Sources are configured, THE Job_Aggregation_System SHALL allow workers to be scheduled but remain inactive until explicitly started
10. WHEN any source ingestion fails, THE Job_Aggregation_System SHALL log the error, continue processing other sources, and expose failure metrics

### Requirement 6: PostgreSQL as Source of Truth

**User Story:** As a developer, I want PostgreSQL to serve as the authoritative source of truth for all job data, so that search indexes can be rebuilt at any time without data loss.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL store all job records in PostgreSQL before indexing in Meilisearch
2. WHEN a job record is updated, THE Job_Aggregation_System SHALL write changes to PostgreSQL and then update Meilisearch index
3. WHEN Meilisearch index is corrupted or deleted, THE Job_Aggregation_System SHALL rebuild the entire index from PostgreSQL data
4. THE Job_Aggregation_System SHALL NOT use Meilisearch as a data store for fields not present in PostgreSQL
5. WHEN the system starts, THE Job_Aggregation_System SHALL verify PostgreSQL connection before accepting search requests
6. WHEN PostgreSQL is unavailable, THE Job_Aggregation_System SHALL return an error message indicating database unavailability
7. THE Job_Aggregation_System SHALL maintain database connection pooling with minimum 5 connections and maximum 20 connections
8. WHEN a database operation would exceed 20 connections, THE Job_Aggregation_System SHALL reject the operation with an error indicating connection limit reached

### Requirement 7: Meilisearch Configuration and Search Capabilities

**User Story:** As a user, I want to search jobs using full-text queries, facets, and filters with fast response times, so that I can find relevant opportunities quickly.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL configure Meilisearch with searchable attributes: title, description, company_name, location, cities, countries, skills, domains, role, category
2. THE Job_Aggregation_System SHALL configure Meilisearch with filterable attributes: collections, regions, work_mode, role, category, ai_archetype, seniority, skills, domains, company_type, countries, cities, relocation, employment_type, english_level, salary_min, salary_max, salary_currency, is_active
3. THE Job_Aggregation_System SHALL configure Meilisearch with sortable attributes: posted_at, updated_at, salary_min, salary_max
4. WHEN a user submits a search query, THE Job_Aggregation_System SHALL return results within 200 milliseconds for queries under 50 characters
5. WHEN a user applies facet filters, THE Job_Aggregation_System SHALL return live result counts for each facet value
6. THE Job_Aggregation_System SHALL support pagination with configurable page size between 10 and 100 results per page
7. WHEN a pagination request exceeds 100 results per page, THE Job_Aggregation_System SHALL reject the request with an error indicating the maximum page size
8. WHEN search results are returned, THE Job_Aggregation_System SHALL include facet aggregations for: work_mode, seniority, employment_type, countries, regions, company_type
9. THE Job_Aggregation_System SHALL reuse FreeHire's existing Meilisearch configuration without rebuilding custom search logic

### Requirement 8: Ingestion Reliability and Observability

**User Story:** As a system administrator, I want to monitor ingestion runs with detailed metrics and error tracking, so that I can diagnose and resolve pipeline failures quickly.

#### Acceptance Criteria

1. WHEN an ingestion run starts, THE Ingestion_Pipeline SHALL record started_at timestamp in the ingestion_runs table
2. WHEN an ingestion run completes, THE Ingestion_Pipeline SHALL record completed_at timestamp and compute duration
3. WHEN processing jobs during ingestion, THE Ingestion_Pipeline SHALL track jobs_seen (total fetched from source)
4. WHEN storing jobs during ingestion, THE Ingestion_Pipeline SHALL track jobs_created (new records inserted)
5. WHEN updating jobs during ingestion, THE Ingestion_Pipeline SHALL track jobs_updated (existing records modified)
6. WHEN deactivating stale jobs during ingestion, THE Ingestion_Pipeline SHALL track jobs_deactivated (records marked inactive)
7. WHEN job processing fails during ingestion, THE Ingestion_Pipeline SHALL track jobs_failed (records that encountered errors)
8. WHEN errors occur during ingestion, THE Ingestion_Pipeline SHALL capture error messages with stack traces in the errors field
9. THE Job_Aggregation_System SHALL expose an API endpoint returning the status of the most recent ingestion run for each source
10. WHEN jobs remain active beyond their expected refresh interval, THE Job_Aggregation_System SHALL automatically mark them inactive based on source-specific refresh policies

### Requirement 9: Profile Matching - Deterministic Scoring

**User Story:** As a user, I want to see how well my skills match a job's requirements, so that I can prioritize applications for roles where I'm most qualified.

#### Acceptance Criteria

1. WHEN a user views a job detail, THE Job_Aggregation_System SHALL compute a match percentage based on skill-set overlap
2. WHEN computing match percentage, THE Job_Aggregation_System SHALL calculate skills_have as skills present in both user profile and job requirements
3. WHEN computing match percentage, THE Job_Aggregation_System SHALL calculate skills_close as user skills related to job requirements through synonyms or taxonomies
4. WHEN computing match percentage, THE Job_Aggregation_System SHALL calculate skills_missing as job requirements not present in user profile
5. WHEN computing match percentage, THE Job_Aggregation_System SHALL use formula: match_percentage = (skills_have + 0.5 * skills_close) / total_required_skills * 100
6. THE Job_Aggregation_System SHALL NOT require LLM calls for deterministic skill matching
7. WHEN displaying match results, THE Job_Aggregation_System SHALL display all three categories (skills_have, skills_close, skills_missing) even when any category is empty

### Requirement 10: Profile Matching - Deep Analysis (Optional LLM-Powered)

**User Story:** As a user, I want to request a deep match analysis using AI, so that I can understand nuanced compatibility beyond simple skill matching.

#### Acceptance Criteria

1. WHERE a user triggers deep match analysis, THE Job_Aggregation_System SHALL compute detailed compatibility using LLM-powered analysis
2. WHEN computing deep match analysis, THE Job_Aggregation_System SHALL provide candidate profile, job description, and company context to the LLM
3. WHEN deep match analysis completes, THE Job_Aggregation_System SHALL cache results by job_id and profile_id combination
4. WHEN a cached deep match analysis exists, THE Job_Aggregation_System SHALL return cached results without calling the LLM
5. THE Job_Aggregation_System SHALL enforce monthly per-user credit limits for deep match analysis calls
6. WHEN deep match analysis completes successfully, THE Job_Aggregation_System SHALL consume credits from the user's monthly quota
7. WHEN a user exceeds their monthly deep match analysis quota, THE Job_Aggregation_System SHALL return only an error message indicating quota exhaustion without analysis results
8. WHEN presenting deep match analysis, THE Job_Aggregation_System SHALL include reasoning and specific examples from the candidate's profile

### Requirement 11: Personalized Email Generation

**User Story:** As a user, I want to generate personalized outreach emails for job applications, so that I can craft compelling messages grounded in my actual experience and the specific role.

#### Acceptance Criteria

1. WHEN a user requests email generation, THE Job_Aggregation_System SHALL accept inputs: candidate profile, job description, company context
2. WHEN generating email content, THE Job_Aggregation_System SHALL ground all statements in supplied candidate data
3. THE Job_Aggregation_System SHALL NOT generate generic template phrases like "I am excited to apply" or "I would be a great fit"
4. THE Job_Aggregation_System SHALL NOT invent achievements, skills, or experiences not present in the candidate profile
5. WHEN referencing candidate skills or experiences, THE Job_Aggregation_System SHALL cite specific examples from the provided profile
6. WHEN email generation completes, THE Job_Aggregation_System SHALL return text that the user can modify before sending
7. IF the generated text cannot be made editable, THE Job_Aggregation_System SHALL allow the email generation to complete and return the text in read-only format
8. THE Job_Aggregation_System SHALL NOT automatically send generated emails without explicit user confirmation

### Requirement 12: Frontend Integration with Existing Scrapivo UI

**User Story:** As a user, I want to search and view jobs through the existing Scrapivo interface with minimal disruption, so that I can maintain my current workflow.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL preserve the existing search interface at `src/routes/_authenticated/jobs.tsx`
2. WHEN a user submits a search query, THE Job_Aggregation_System SHALL query Meilisearch and never query live APIs
3. WHEN displaying search results, THE Job_Aggregation_System SHALL show job cards with title, company, location, work_mode, seniority, salary, and source badge
4. WHEN a user clicks a job card, THE Job_Aggregation_System SHALL display job detail in a modal or dedicated page
5. WHEN displaying the match sidebar, THE Job_Aggregation_System SHALL show match percentage, skills_have, skills_close, skills_missing, and "Analyze Match" button
6. THE Job_Aggregation_System SHALL support basic bookmarking functionality allowing users to save jobs for later review
7. THE Job_Aggregation_System SHALL NOT implement application tracking, recruiter CRM, Kanban boards, or interview management features
8. THE Job_Aggregation_System SHALL maintain responsive design supporting desktop and mobile viewports

### Requirement 13: Docker Compose Environment Configuration

**User Story:** As a developer, I want to configure PostgreSQL and Meilisearch using Docker Compose on Windows, so that I can run the complete stack locally without manual service installation.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL provide a docker-compose.yml file defining PostgreSQL and Meilisearch services
2. WHEN Docker Compose starts, THE Job_Aggregation_System SHALL configure PostgreSQL with persistent volume for data storage
3. WHEN Docker Compose starts, THE Job_Aggregation_System SHALL configure Meilisearch with persistent volume for index data
4. THE Job_Aggregation_System SHALL require PostgreSQL to be exposed on exactly port 5432
5. IF port 5432 is unavailable, THEN THE Job_Aggregation_System SHALL fail to start and return an error indicating port unavailability
6. THE Job_Aggregation_System SHALL expose Meilisearch on port 7700
7. WHEN services start, THE Job_Aggregation_System SHALL allow partial credential configuration where some environment variables can be set even if not all services start successfully
8. THE Job_Aggregation_System SHALL include health checks for PostgreSQL and Meilisearch containers
9. WHEN running on Windows, THE Job_Aggregation_System SHALL use Windows-compatible volume paths and line endings

### Requirement 14: Parser and Serializer Requirements with Round-Trip Testing

**User Story:** As a developer, I want to parse job data from various source formats and serialize canonical jobs back to JSON, so that I can ensure data integrity through round-trip validation.

#### Acceptance Criteria

1. WHEN fetching jobs from Greenhouse API, THE Job_Aggregation_System SHALL parse JSON responses according to Greenhouse API schema
2. WHEN fetching jobs from Lever API, THE Job_Aggregation_System SHALL parse JSON responses according to Lever API schema
3. WHEN fetching jobs from Ashby API, THE Job_Aggregation_System SHALL parse JSON responses according to Ashby API schema
4. WHEN fetching jobs from SmartRecruiters API, THE Job_Aggregation_System SHALL parse JSON responses according to SmartRecruiters API schema
5. WHEN parsing job data fails, THE Job_Aggregation_System SHALL log the error and continue processing other jobs
6. IF an API call fails during ingestion, THE Job_Aggregation_System SHALL allow the system to fail silently and continue processing other jobs from successful API calls
7. THE Job_Aggregation_System SHALL provide a JSON serializer that formats Canonical_Job_Model instances into valid JSON
8. FOR ALL valid Canonical_Job_Model instances, parsing the serialized JSON and then serializing again SHALL produce an equivalent object (round-trip property)

### Requirement 15: Notification System Integration

**User Story:** As a user, I want to receive job alerts through my preferred communication channels, so that I can stay informed of new opportunities matching my criteria.

#### Acceptance Criteria

1. WHERE a user configures notification preferences, THE Job_Aggregation_System SHALL support Telegram, Discord, Email, Slack, and WhatsApp channels
2. WHEN new jobs match a user's saved search criteria, THE Job_Aggregation_System SHALL send notifications to configured channels
3. WHEN sending notifications, THE Job_Aggregation_System SHALL include job title, company, location, match percentage, and direct link to job detail
4. THE Job_Aggregation_System SHALL enforce rate limits preventing more than 10 notifications per user per hour
5. IF rate limit enforcement fails, THE Job_Aggregation_System SHALL allow notifications to be sent anyway
6. WHEN a user disables notifications for a channel, THE Job_Aggregation_System SHALL immediately stop sending new notifications to that channel
7. WHEN a user disables notifications for a channel, THE Job_Aggregation_System SHALL allow queued notifications to complete delivery to the disabled channel
8. WHEN notification delivery fails, THE Job_Aggregation_System SHALL log the failure and retry up to 3 times with exponential backoff
9. THE Job_Aggregation_System SHALL provide a user interface for managing notification preferences and viewing notification history

### Requirement 16: Phase 1 Critical Success Verification

**User Story:** As a project manager, I want to verify that Phase 1 deliverables are complete and working, so that I can authorize proceeding to subsequent implementation phases.

#### Acceptance Criteria

1. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate Docker Compose starts successfully with no error logs
2. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate PostgreSQL health status is "healthy" and connection succeeds
3. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate Meilisearch health status is "healthy" and API responds
4. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate FreeHire Ingestion_Pipeline runs successfully and completes without errors
5. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate live jobs are fetched from at least one source with recent timestamps
6. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate jobs are normalized and stored in PostgreSQL with all required fields
7. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate jobs are indexed in Meilisearch and searchable via API
8. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate API returns live jobs with title, company, location, URL, active status, and recent timestamp
9. WHEN Phase 1 review begins, THE Job_Aggregation_System SHALL demonstrate rerunning ingestion updates existing records without creating duplicates
10. IF any Phase 1 verification criterion fails, THEN THE Job_Aggregation_System SHALL NOT proceed to Phase 2 implementation until all Phase 1 failures are resolved

### Requirement 17: Exclusion of Out-of-Scope Features

**User Story:** As a project manager, I want to ensure the team does not build out-of-scope features, so that we maintain focus on core integration objectives.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL NOT rebuild FreeHire's ingestion architecture from scratch
2. THE Job_Aggregation_System SHALL NOT build custom LinkedIn or Indeed scrapers (use JobSpy library only)
3. THE Job_Aggregation_System SHALL NOT manually onboard 300,000 companies without automated processes
4. THE Job_Aggregation_System SHALL NOT build a custom search engine (reuse Meilisearch)
5. THE Job_Aggregation_System SHALL NOT build a separate standalone job portal
6. THE Job_Aggregation_System SHALL NOT implement Applicant Tracking System (ATS) features
7. THE Job_Aggregation_System SHALL NOT implement Recruiter CRM features
8. THE Job_Aggregation_System SHALL NOT implement Application tracker features
9. THE Job_Aggregation_System SHALL NOT implement Interview management features
10. THE Job_Aggregation_System SHALL NOT implement Kanban board features for job applications

### Requirement 18: Technology Stack Compliance

**User Story:** As a developer, I want to use the existing Scrapivo technology stack for frontend integration, so that I maintain consistency with the existing codebase.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL implement frontend components using TypeScript
2. THE Job_Aggregation_System SHALL implement frontend UI using React 19.2.0 or later
3. THE Job_Aggregation_System SHALL use TanStack Start for routing and server functions
4. THE Job_Aggregation_System SHALL use Vite as the build tool
5. THE Job_Aggregation_System SHALL use Tailwind CSS for styling
6. THE Job_Aggregation_System SHALL use shadcn/ui components for UI elements
7. WHEN creating new UI components, THE Job_Aggregation_System SHALL follow existing Scrapivo component patterns and naming conventions

### Requirement 19: Migration Strategy from In-Memory to Persistent Storage

**User Story:** As a developer, I want to migrate from in-memory job storage to PostgreSQL-backed storage, so that job data persists across application restarts and search performance improves.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL replace the in-memory job registry in `src/lib/jobs/registry.ts` with PostgreSQL queries
2. WHEN the application starts, THE Job_Aggregation_System SHALL NOT load all jobs into memory
3. WHEN a user submits a search query, THE Job_Aggregation_System SHALL query Meilisearch index instead of filtering in-memory job arrays
4. THE Job_Aggregation_System SHALL remove the `dedupeJobs` function from `src/lib/jobs/registry.ts` and rely on database-level deduplication
5. THE Job_Aggregation_System SHALL preserve the `JobPosting` TypeScript type interface for backward compatibility
6. WHEN migrating existing job source adapters, THE Job_Aggregation_System SHALL refactor them to write to PostgreSQL instead of returning arrays
7. THE Job_Aggregation_System SHALL allow a hybrid state where adapters can write to PostgreSQL while main storage remains in-memory during migration
8. THE Job_Aggregation_System SHALL maintain the existing `JobSearchFilters` interface for UI compatibility

### Requirement 20: Data Retention and Privacy

**User Story:** As a compliance officer, I want to ensure job data is retained appropriately and user data is handled securely, so that we meet data protection regulations.

#### Acceptance Criteria

1. THE Job_Aggregation_System SHALL retain inactive job records in PostgreSQL for 90 days after is_active becomes false
2. WHEN a job record exceeds the 90-day retention period, THE Job_Aggregation_System SHALL archive the record to a separate archive table
3. THE Job_Aggregation_System SHALL encrypt sensitive fields at rest when storing user profiles for matching
4. WHEN transmitting job data between services, THE Job_Aggregation_System SHALL use TLS encryption
5. THE Job_Aggregation_System SHALL provide a data export API allowing users to download all their stored profile and search data
6. THE Job_Aggregation_System SHALL allow partial data removal without requiring formal data deletion requests
7. WHEN a user requests account deletion, THE Job_Aggregation_System SHALL remove all associated profile data, search history, and bookmarks within 30 days
