export interface Lead {
  id: string;
  platform: string;
  platform_label: string;
  post_url: string;
  post_title: string;
  post_body_snippet: string;
  ai_summary: string;
  why_shown: string;
  author_handle: string;
  author_url: string;
  author_name: string;
  author_bio?: string;
  author_followers?: number;
  posted_at: string;
  posted_at_relative: string;
  engagement: {
    likes?: number;
    comments?: number;
    reposts?: number;
    upvotes?: number;
    points?: number;
    applicants?: number;
    views?: number;
  };
  intent_score: number;
  intent_tier: "hot" | "warm" | "signal";
  is_decision_maker: boolean;
  has_budget: boolean;
  has_urgency: boolean;
  source_confidence: number;
  raw_data?: Record<string, unknown>;
}

export interface SearchQuery {
  raw: string;
  skill: string;
  role: string;
  keywords: string[];
  buyerPhrases: string[];
  negativePhrases: string[];
}
