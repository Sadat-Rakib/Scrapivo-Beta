# Requirements Document

## Introduction

The Investor Search module contains critical bugs that produce incorrect search results and lacks semantic understanding for sector matching. This specification addresses four critical issues: (1) stage filter producing false positives due to substring matching, (2) overly simplistic sector matching that fails to recognize synonyms, (3) outdated investor dataset requiring additions and removals, and (4) lack of semantic understanding in all filter operations. The solution must use free AI models only and preserve all existing functionality.

## Glossary

- **Investor_Search_System**: The complete investor search and filtering module including search logic, data storage, and API interfaces
- **Stage_Filter**: The filtering mechanism that matches investor funding stages (Pre-seed, Seed, Series A, Series B, etc.)
- **Stage_Hierarchy**: The ordered sequence of funding stages from earliest to latest investment phases
- **Sector_Matcher**: The component responsible for matching user sector queries against investor focus areas
- **Semantic_Matching**: AI-powered matching that understands synonyms and related terms rather than exact text matching
- **Investor_Dataset**: The static JSON file containing all investor records
- **Free_AI_Model**: Zero-cost AI models such as Groq with Llama, Hugging Face inference API, or similar services
- **False_Positive**: A search result that incorrectly matches the filter criteria (e.g., "Seed" appearing when "Pre-seed" was filtered)

## Requirements

### Requirement 1: Fix Stage Filter Matching

**User Story:** As a founder searching for pre-seed investors, I want to see only pre-seed investors in results, so that I don't waste time contacting investors at wrong stages.

#### Acceptance Criteria

1. WHEN a user filters by "Pre-seed", THE Investor_Search_System SHALL return only investors whose stages array contains "Pre-seed" as an exact match
2. WHEN a user filters by "Pre-seed", THE Investor_Search_System SHALL exclude all investors whose stages contain "Seed", "Series A", "Series B", or any stage containing "seed" but not matching "Pre-seed"
3. WHEN a user filters by "Seed", THE Investor_Search_System SHALL return investors with "Seed" stage and SHALL exclude investors with only "Pre-seed"
4. WHEN a user filters by any stage value, THE Stage_Filter SHALL perform exact matching after normalization rather than substring matching
5. THE Stage_Filter normalization function SHALL convert stages to lowercase, replace whitespace with hyphens, and standardize "Series" prefix formatting

### Requirement 2: Implement Semantic Sector Matching

**User Story:** As a founder building an AI company, I want searches for "AI" to match investors focused on "machine learning", "artificial intelligence", "deep learning", and related terms, so that I find all relevant investors.

#### Acceptance Criteria

1. WHEN a user searches for a sector term, THE Sector_Matcher SHALL identify semantically similar terms using an AI model
2. THE Sector_Matcher SHALL use only Free_AI_Model services for semantic matching operations
3. WHEN a user searches for "AI", THE Investor_Search_System SHALL return investors with focus areas containing "artificial intelligence", "machine learning", "deep learning", "neural networks", "computer vision", or "natural language processing"
4. WHEN a user searches for "fintech", THE Investor_Search_System SHALL return investors with focus areas containing "financial technology", "payments", "banking", "digital banking", or "insurtech"
5. THE Semantic_Matching function SHALL cache synonym mappings to minimize API calls to Free_AI_Model services
6. IF semantic matching fails or times out, THEN THE Investor_Search_System SHALL fall back to exact text matching
7. THE Semantic_Matching function SHALL complete within 500ms for cached terms and within 2000ms for uncached terms

### Requirement 3: Update Investor Dataset

**User Story:** As a user of the investor directory, I want access to current investor data excluding specific regions, so that the directory reflects market reality and user requirements.

#### Acceptance Criteria

1. THE Investor_Dataset SHALL contain approximately 500 new investor records beyond the current dataset
2. THE Investor_Search_System SHALL exclude all investors whose locations array contains "Israel" or any Israeli cities
3. WHEN processing the Investor_Dataset, THE System SHALL remove all records where any location field matches Israel-based locations
4. THE new investor records SHALL follow the existing InvestorRecord schema format
5. THE new investor records SHALL include complete data for name, firm, title, check sizes, locations, focus_areas, and stages fields
6. THE Investor_Dataset update process SHALL preserve all existing non-Israel-based investor records

### Requirement 4: Preserve Existing Functionality

**User Story:** As a developer maintaining the system, I want all existing search features to continue working correctly, so that bug fixes don't introduce regressions.

#### Acceptance Criteria

1. WHEN the stage filter improvements are implemented, THE Investor_Search_System SHALL continue to support filtering by location
2. WHEN the stage filter improvements are implemented, THE Investor_Search_System SHALL continue to support filtering by check size bands (angel, seed, growth)
3. WHEN the stage filter improvements are implemented, THE Investor_Search_System SHALL continue to support filtering by investor type (vc, angel, scout)
4. WHEN the stage filter improvements are implemented, THE Investor_Search_System SHALL continue to support filtering by status (active, needs_review, inactive)
5. WHEN the stage filter improvements are implemented, THE Investor_Search_System SHALL continue to support free-text query search across investor names, firms, titles, and focus areas
6. THE Investor_Search_System SHALL maintain the existing sorting logic prioritizing active status and check size
7. THE Investor_Search_System SHALL maintain the existing result limit functionality

### Requirement 5: Semantic Matching Configuration

**User Story:** As a system administrator, I want semantic matching to use free AI services with proper error handling, so that the system remains cost-free and resilient.

#### Acceptance Criteria

1. THE Semantic_Matching function SHALL use Groq API with Llama models or equivalent Free_AI_Model services
2. THE System SHALL store Free_AI_Model API credentials in environment variables
3. WHEN Free_AI_Model API calls fail, THE System SHALL log errors and fall back to exact text matching
4. THE System SHALL implement request timeout limits for Free_AI_Model API calls
5. THE Semantic_Matching function SHALL implement exponential backoff retry logic for transient failures
6. THE System SHALL cache synonym expansion results in memory to reduce API calls

### Requirement 6: Data Quality and Validation

**User Story:** As a system maintainer, I want new investor data to be validated and complete, so that search results remain high quality.

#### Acceptance Criteria

1. WHEN adding new investor records, THE System SHALL validate that all required fields are present and non-empty
2. WHEN adding new investor records, THE System SHALL validate that check sizes are positive numbers or zero
3. WHEN adding new investor records, THE System SHALL validate that stages array contains at least one valid stage value
4. WHEN adding new investor records, THE System SHALL validate that focus_areas array contains at least one entry
5. THE System SHALL reject investor records with location fields containing "Israel", "Tel Aviv", "Jerusalem", "Haifa", or other Israeli cities
6. THE System SHALL assign status "active" to records with complete data and "needs_review" to records with missing or incomplete data
