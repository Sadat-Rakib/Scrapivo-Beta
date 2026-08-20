# Requirements Document

## Introduction

This document defines the requirements for redesigning the Scrapivo "Discover" dashboard layout and visual language to match a clean 3-column AI-tool dashboard pattern (reference: SETO AI style), while preserving all existing functionality, state management, and data-fetching logic. The redesign implements a new light theme variant alongside the existing dark/glassmorphism theme, restructures navigation from right to left sidebar, and introduces a dedicated chat history panel on the right.

## Glossary

- **App_Shell**: The top-level authenticated layout component that wraps all authenticated pages
- **Discover_Page**: The main landing page of Scrapivo after authentication, where users perform searches and interact with results
- **Left_Sidebar**: A fixed-width vertical panel (~220-260px) on the left side containing brand, primary navigation, and profile card
- **Center_Panel**: The main content area displaying welcome content, action cards, search interface, and results
- **Right_Sidebar**: A fixed-width vertical panel (~280-320px) on the right side displaying chat history
- **Profile_Popover**: A UI element that appears above the profile card showing search quota and account actions
- **Action_Card**: A clickable card in the center panel that initiates a specific workflow (find investors, customers, or jobs)
- **Unified_Composer**: The existing search/chat input component with mode toggle and voice input
- **Chat_History_Panel**: The new right sidebar component showing past chat/search conversations
- **Light_Theme**: The new visual style variant with generous whitespace, soft shadows, and rounded corners
- **Active_State**: Visual indicator showing which navigation item corresponds to the current page
- **Autotyping_Placeholder**: Animated placeholder text that cycles through example search queries
- **Search_Context**: The project-based context that informs search queries (audience, goal, niche, etc.)

## Requirements

### Requirement 1: Three-Column Layout Structure

**User Story:** As a user, I want a clean 3-column dashboard layout, so that I can easily navigate, search, and access my history in dedicated spaces.

#### Acceptance Criteria

1. THE App_Shell SHALL render three distinct vertical columns: Left_Sidebar, Center_Panel, and Right_Sidebar
2. WHEN the viewport width is desktop size (≥768px), THE App_Shell SHALL display all three columns simultaneously
3. THE Left_Sidebar SHALL have a fixed width between 220px and 260px
4. THE Right_Sidebar SHALL have a fixed width between 280px and 320px
5. THE Center_Panel SHALL occupy the remaining horizontal space between the two sidebars
6. WHEN the viewport width is mobile/tablet size (<768px), THE App_Shell SHALL hide the Left_Sidebar and Right_Sidebar and show only the Center_Panel
7. WHEN the viewport width is mobile/tablet size, THE App_Shell SHALL provide a mobile menu to access navigation

### Requirement 2: Left Sidebar - Brand and Navigation

**User Story:** As a user, I want primary navigation in a left sidebar, so that I can quickly access different sections of the application.

#### Acceptance Criteria

1. THE Left_Sidebar SHALL display the Scrapivo logo and wordmark at the top
2. THE Left_Sidebar SHALL display the following primary navigation items in vertical order: Home (Discover), Jobs, Businesses (Local businesses), Investors, Notifications (Watches), Saved
3. WHEN a navigation item is active (matches current route), THE Left_Sidebar SHALL display it with a filled/rounded pill background
4. THE Left_Sidebar SHALL display a visual divider after the primary navigation items
5. THE Left_Sidebar SHALL display Settings and Help navigation items after the divider
6. WHEN a user clicks a navigation item, THE App_Shell SHALL navigate to the corresponding route
7. THE Left_Sidebar SHALL display each navigation item with an icon and label with 8-10px gap between them

### Requirement 3: Left Sidebar - Profile Card and Popover

**User Story:** As a user, I want to see my profile and search quota at the bottom of the sidebar, so that I can monitor my usage and access account actions.

#### Acceptance Criteria

1. THE Left_Sidebar SHALL display a profile card pinned to the bottom
2. THE Profile_Card SHALL display the user's avatar (or initial from email), name/email, and an "Upgrade Now" button
3. WHEN a user clicks the profile card, THE App_Shell SHALL display a Profile_Popover above the card
4. THE Profile_Popover SHALL display "Searches today" with an X/5 progress bar showing current usage
5. THE Profile_Popover SHALL display a "Profile" link and a "Sign out" button
6. WHEN a user clicks "Sign out" in the Profile_Popover, THE App_Shell SHALL sign out the user and redirect to the auth page
7. THE Profile_Card SHALL extract the user's first name from the profile or email for display

### Requirement 4: Center Panel - Welcome Section

**User Story:** As a user, I want to see a personalized welcome message and clear action options, so that I understand what I can do and feel welcomed.

#### Acceptance Criteria

1. WHEN no search results are displayed, THE Center_Panel SHALL display a welcome section with icon, greeting, and subheading
2. THE Center_Panel SHALL display a small decorative icon/logo mark above the greeting
3. THE Center_Panel SHALL display "Welcome, {first name}!" as the greeting where {first name} is extracted from user profile or project data
4. THE Center_Panel SHALL display "What are you looking for now, a buying signal, niche, or role?" as the subheading
5. THE Center_Panel SHALL be vertically centered when displaying the welcome section
6. WHEN the user has no profile name, THE Center_Panel SHALL display "Welcome to Scrapivo!" instead of a personalized greeting

### Requirement 5: Center Panel - Action Cards

**User Story:** As a user, I want to see three clear action cards, so that I can quickly choose what type of search to perform.

#### Acceptance Criteria

1. THE Center_Panel SHALL display three action cards side by side below the subheading: "Find Investors", "Find Customers & Buyers", and "Find Jobs & Businesses"
2. THE Action_Card "Find Investors" SHALL display the description "Match with active investors for your stage and sector."
3. THE Action_Card "Find Customers & Buyers" SHALL display the description "Surface buyer-intent signals from real-time posts and hiring data."
4. THE Action_Card "Find Jobs & Businesses" SHALL display the description "Discover open roles and companies matching your criteria."
5. WHEN a user clicks an Action_Card, THE Center_Panel SHALL focus the search composer and optionally pre-fill search context
6. THE Action_Card SHALL display an icon, title, and description
7. WHEN a user hovers over an Action_Card, THE Action_Card SHALL display subtle elevation (shadow increase)

### Requirement 6: Center Panel - Search Bar with Autotyping Placeholder

**User Story:** As a user, I want to see example searches cycling in the search bar, so that I understand what kinds of queries I can make.

#### Acceptance Criteria

1. THE Unified_Composer SHALL display below the action cards in a command-bar pill style (full width, rounded)
2. THE Unified_Composer SHALL display an autotyping placeholder that cycles through example search queries
3. THE Autotyping_Placeholder SHALL display one example at a time with a typewriter-in animation
4. THE Autotyping_Placeholder SHALL dwell on each complete phrase for 2.5 to 3 seconds before transitioning
5. THE Autotyping_Placeholder SHALL include examples such as "businesses looking for web development services…", "companies searching for marketing agencies…", and other relevant patterns
6. THE Unified_Composer SHALL preserve the existing left-side mode toggle (Search / Chat)
7. THE Unified_Composer SHALL preserve the existing microphone icon for voice input
8. THE Center_Panel SHALL NOT display the helper text "Scrapivo searches social media platforms..." below the search bar

### Requirement 7: Center Panel - Category Pills and Utility Cards

**User Story:** As a user, I want to see category filters and quick actions below the search bar, so that I can refine my search or start new workflows.

#### Acceptance Criteria

1. THE Center_Panel SHALL display existing category pill row (Jobs, People, Companies, Posts, Sites, News, Updates, Platforms) below the search bar
2. THE Center_Panel SHALL display existing utility cards (New search, AI chat) below the category pills
3. THE Center_Panel SHALL apply the Light_Theme styling to utility cards (matching new design system)
4. THE Center_Panel SHALL preserve all existing functionality of category pills and utility cards

### Requirement 8: Right Sidebar - Chat History Panel

**User Story:** As a user, I want to see my past chats and searches in the right sidebar, so that I can quickly return to previous conversations.

#### Acceptance Criteria

1. THE Right_Sidebar SHALL display a "Chat History" header at the top
2. THE Right_Sidebar SHALL display a search input to filter past chats
3. THE Right_Sidebar SHALL display a scrollable list of chat items below the search input
4. THE Chat_History_Item SHALL display a thumbnail/icon, chat title (auto-generated from first query), one-line snippet of last message, and relative timestamp ("2h ago", "3d ago")
5. WHEN a user clicks a Chat_History_Item, THE Discover_Page SHALL re-open that chat/search thread
6. THE Right_Sidebar SHALL maintain scroll position when new chat items are added
7. THE Right_Sidebar SHALL display the most recent chat items at the top of the list

### Requirement 9: Light Theme Visual Style

**User Story:** As a user, I want a clean, modern light theme option, so that I can use the application in well-lit environments with reduced eye strain.

#### Acceptance Criteria

1. THE App_Shell SHALL implement the Light_Theme as a separate theme variant
2. THE Light_Theme SHALL use generous whitespace and rounded corners (12-16px) on cards and search bar
3. THE Light_Theme SHALL use soft drop shadows instead of hard borders for depth
4. THE Light_Theme SHALL apply a filled pill background to active navigation items
5. THE Light_Theme SHALL use muted/secondary color for card descriptions
6. THE Light_Theme SHALL apply consistent padding to all card components
7. THE App_Shell SHALL NOT break or modify the existing dark/glassmorphism theme

### Requirement 10: Navigation Changes and Route Mapping

**User Story:** As a user, I want navigation items renamed and reorganized, so that they better reflect their purpose.

#### Acceptance Criteria

1. THE Left_Sidebar SHALL rename "Discover" navigation item to "Home"
2. THE Left_Sidebar SHALL rename "Watches" navigation item to "Notifications"
3. THE Left_Sidebar SHALL rename "Local businesses" navigation item to "Businesses"
4. THE Left_Sidebar SHALL NOT display "Guides", "Pipeline", or "History" in the primary navigation
5. THE Right_Sidebar Chat_History_Panel SHALL replace the functionality of the removed "History" navigation item
6. THE App_Shell SHALL preserve all existing route handlers and page components

### Requirement 11: Responsive Behavior

**User Story:** As a user, I want the redesigned interface to work on mobile and tablet devices, so that I can access Scrapivo from any device.

#### Acceptance Criteria

1. WHEN the viewport width is less than 768px, THE App_Shell SHALL display a mobile header with hamburger menu
2. WHEN the viewport width is less than 768px, THE App_Shell SHALL hide the Left_Sidebar and Right_Sidebar by default
3. WHEN a user opens the mobile menu, THE App_Shell SHALL display the Left_Sidebar content in a sheet/drawer overlay
4. WHEN the viewport changes from mobile to desktop, THE App_Shell SHALL automatically display both sidebars
5. THE Center_Panel SHALL remain scrollable and functional at all viewport sizes
6. THE Action_Cards SHALL stack vertically on mobile viewports

### Requirement 12: Preserve Existing Functionality

**User Story:** As a developer, I want all existing functionality preserved, so that users experience no loss of features during the redesign.

#### Acceptance Criteria

1. THE Discover_Page SHALL preserve all existing data-fetching hooks (useQuery, useMutation)
2. THE Discover_Page SHALL preserve all existing state management (leads, companies, people, chatLog, etc.)
3. THE Unified_Composer SHALL preserve all existing search and chat submission logic
4. THE App_Shell SHALL preserve all existing authentication checks and redirects
5. THE Discover_Page SHALL preserve all existing result tabs, filters, and view modes
6. THE LeadDetailPanel and EntityDetailPanel SHALL continue to function without modification
7. THE App_Shell SHALL preserve all existing contact resolution and enrichment logic

### Requirement 13: Search Context Integration

**User Story:** As a user, I want my project context to inform my searches, so that results are relevant to my business needs.

#### Acceptance Criteria

1. WHEN a user has an active project, THE Discover_Page SHALL use the Search_Context (audience, goal, niche, service, location) in all searches
2. THE Profile_Card SHALL display the user's first name extracted from profile or active project
3. THE Center_Panel welcome greeting SHALL use the first name from profile or active project
4. THE Discover_Page SHALL preserve the existing project selection dropdown and "New project" button
5. WHEN a user switches projects, THE Discover_Page SHALL update the Search_Context for subsequent searches

### Requirement 14: Chat History Data Structure

**User Story:** As a developer, I want to define the chat history data structure, so that the Chat_History_Panel can be implemented correctly.

#### Acceptance Criteria

1. THE Chat_History_Item SHALL include the following fields: id (unique identifier), title (string), snippet (string), timestamp (ISO date string), thumbnail_url (optional string)
2. THE Discover_Page SHALL store chat history in local state or query from a backend endpoint
3. THE Chat_History_Panel SHALL sort chat items by timestamp in descending order (most recent first)
4. WHEN a chat title is not explicitly set, THE Chat_History_Panel SHALL auto-generate a title from the first user message (truncated to 50 characters)
5. THE Chat_History_Panel SHALL display relative timestamps calculated from the current time ("2h ago", "3d ago", "1w ago")

### Requirement 15: Sidebar Collapse Behavior (Optional)

**User Story:** As a user, I want to optionally collapse the left sidebar to icons-only, so that I can maximize screen space for results.

#### Acceptance Criteria

1. THE Left_Sidebar MAY include a collapse toggle button that switches between full and icons-only mode
2. WHEN the Left_Sidebar is in icons-only mode, THE Left_Sidebar SHALL display only navigation icons without labels
3. WHEN the Left_Sidebar is in icons-only mode, THE Left_Sidebar SHALL reduce its width to approximately 60-70px
4. WHEN the Left_Sidebar is in icons-only mode and a user hovers over a navigation icon, THE Left_Sidebar SHALL display a tooltip with the label
5. WHEN the Left_Sidebar is in icons-only mode, THE Profile_Card SHALL display only the user avatar/initial
6. THE App_Shell SHALL persist the collapse state in localStorage across sessions

