export type QueryType = "role" | "skill" | "department" | "product" | "industry" | "generic";

export type IntentMode = "directory_smb" | "buyer_intent";

/** skill_role = classic "React developer"; buying_signal = Coldreach-style plain-English intent */
export type SignalMode = "skill_role" | "buying_signal";

export type SignalFamily =
  | "job_opening"
  | "job_description"
  | "news"
  | "website"
  | "employees"
  | "sec_10k"
  | "linkedin_company"
  | "custom"
  | null;

export interface RoleEntry {
  roleTitle: string;
  relatedSkills: string[];
  targetCustomerDesc: string;
  subredditBoosts: string[];
}

/** Who the user wants surfaced (from their active project / composer). */
export type Audience = "companies" | "agencies" | "people" | "all";
/** jobs = companies hiring; clients = people/businesses asking for the service. */
export type Goal = "jobs" | "clients" | "both";

export interface ClassifiedQuery {
  raw: string;
  type: QueryType;
  coreSkill: string;
  roleTitle: string;
  relatedSkills: string[];
  targetCustomerDesc: string;
  /** Parsed place (country/city), e.g. "India". Null when not specified. */
  location: string | null;
  /** directory_smb = find agencies/companies; buyer_intent = hiring/looking-for posts */
  intentMode: IntentMode;
  /** e.g. "marketing agency" when user asked for agencies/companies */
  icpNoun: string | null;
  signalMode: SignalMode;
  signalFamily: SignalFamily;
  /** Structured context from the active project (set post-classification). */
  audience?: Audience | null;
  goal?: Goal;
}

export const CLASSIFIER_ROLE_MAP: Record<string, RoleEntry> = {
  ai: {
    roleTitle: "AI/ML Engineer",
    relatedSkills: [
      "machine learning",
      "LLM",
      "GPT",
      "artificial intelligence",
      "deep learning",
      "MLOps",
      "RAG",
      "chatbot",
      "NLP",
    ],
    targetCustomerDesc: "startups and companies building AI products",
    subredditBoosts: ["MachineLearningJobs", "AIJobs", "artificial", "LocalLLaMA", "singularity"],
  },
  "ai engineer": {
    roleTitle: "AI/ML Engineer",
    relatedSkills: [
      "machine learning",
      "LLM",
      "OpenAI API",
      "fine-tuning",
      "RAG",
      "vector database",
      "embeddings",
    ],
    targetCustomerDesc: "founders and startups building AI-powered products",
    subredditBoosts: ["MachineLearningJobs", "AIJobs", "SideProject", "startups", "LocalLLaMA"],
  },
  "machine learning": {
    roleTitle: "Machine Learning Engineer",
    relatedSkills: [
      "ML",
      "deep learning",
      "neural network",
      "PyTorch",
      "TensorFlow",
      "data science",
      "AI",
    ],
    targetCustomerDesc: "companies that need ML models built or integrated",
    subredditBoosts: ["MachineLearningJobs", "AIJobs", "datascience"],
  },
  ml: {
    roleTitle: "Machine Learning Engineer",
    relatedSkills: ["machine learning", "AI", "deep learning", "Python", "PyTorch"],
    targetCustomerDesc: "companies building AI/ML products",
    subredditBoosts: ["MachineLearningJobs", "AIJobs", "datascience"],
  },
  react: {
    roleTitle: "React Developer",
    relatedSkills: ["React.js", "Next.js", "TypeScript", "frontend", "JavaScript", "UI"],
    targetCustomerDesc: "startups and agencies needing web app development",
    subredditBoosts: ["reactjs", "webdev", "nextjs", "javascript"],
  },
  "web development": {
    roleTitle: "Web Developer",
    relatedSkills: [
      "website",
      "web developer",
      "web app",
      "frontend",
      "backend",
      "full stack",
      "React",
      "WordPress",
      "Next.js",
    ],
    targetCustomerDesc: "startups and small businesses needing websites or web apps",
    subredditBoosts: ["webdev", "forhire", "startups", "Entrepreneur", "smallbusiness", "canada"],
  },
  "web developer": {
    roleTitle: "Web Developer",
    relatedSkills: [
      "web development",
      "website",
      "frontend",
      "backend",
      "React",
      "WordPress",
      "Next.js",
    ],
    targetCustomerDesc: "founders needing websites or web apps built",
    subredditBoosts: ["webdev", "forhire", "startups", "Entrepreneur", "smallbusiness"],
  },
  website: {
    roleTitle: "Web Developer",
    relatedSkills: [
      "web development",
      "web developer",
      "WordPress",
      "Webflow",
      "landing page",
      "site redesign",
    ],
    targetCustomerDesc: "businesses that need a new or redesigned website",
    subredditBoosts: ["webdev", "forhire", "smallbusiness", "Entrepreneur", "startups"],
  },
  web: {
    roleTitle: "Web Developer",
    relatedSkills: ["web development", "website", "frontend", "React", "WordPress"],
    targetCustomerDesc: "businesses needing web development help",
    subredditBoosts: ["webdev", "forhire", "startups", "Entrepreneur"],
  },
  fullstack: {
    roleTitle: "Full Stack Developer",
    relatedSkills: ["full-stack", "frontend", "backend", "React", "Node.js", "web development"],
    targetCustomerDesc: "founders needing complete web app development",
    subredditBoosts: ["webdev", "reactjs", "node", "SideProject"],
  },
  "full stack": {
    roleTitle: "Full Stack Developer",
    relatedSkills: ["fullstack", "frontend", "backend", "React", "Node.js"],
    targetCustomerDesc: "founders needing complete web app development",
    subredditBoosts: ["webdev", "reactjs", "startups"],
  },
  python: {
    roleTitle: "Python Developer",
    relatedSkills: ["Django", "FastAPI", "Flask", "scripting", "automation", "data"],
    targetCustomerDesc: "companies needing automation, APIs, or data pipelines",
    subredditBoosts: ["Python", "django", "learnpython"],
  },
  node: {
    roleTitle: "Node.js Developer",
    relatedSkills: ["Node.js", "Express", "JavaScript", "backend", "API"],
    targetCustomerDesc: "startups needing backend API development",
    subredditBoosts: ["node", "javascript", "webdev"],
  },
  mobile: {
    roleTitle: "Mobile App Developer",
    relatedSkills: ["iOS", "Android", "React Native", "Flutter", "Swift", "Kotlin"],
    targetCustomerDesc: "founders needing mobile apps built from scratch",
    subredditBoosts: ["androiddev", "iOSProgramming", "FlutterDev", "reactnative"],
  },
  ios: {
    roleTitle: "iOS Developer",
    relatedSkills: ["Swift", "SwiftUI", "Xcode", "Apple", "iPhone app"],
    targetCustomerDesc: "founders needing iPhone apps built",
    subredditBoosts: ["iOSProgramming", "swift"],
  },
  android: {
    roleTitle: "Android Developer",
    relatedSkills: ["Kotlin", "Java", "Android Studio", "Google Play"],
    targetCustomerDesc: "founders needing Android apps built",
    subredditBoosts: ["androiddev", "kotlin"],
  },
  flutter: {
    roleTitle: "Flutter Developer",
    relatedSkills: ["Dart", "mobile", "cross-platform", "iOS", "Android"],
    targetCustomerDesc: "startups needing cross-platform mobile apps",
    subredditBoosts: ["FlutterDev", "reactnative"],
  },
  devops: {
    roleTitle: "DevOps Engineer",
    relatedSkills: ["AWS", "Docker", "Kubernetes", "CI/CD", "infrastructure", "cloud"],
    targetCustomerDesc: "companies needing cloud infrastructure or deployment pipelines",
    subredditBoosts: ["devops", "aws", "kubernetes", "docker"],
  },
  blockchain: {
    roleTitle: "Blockchain Developer",
    relatedSkills: ["Solidity", "Web3", "Ethereum", "smart contracts", "DeFi", "NFT"],
    targetCustomerDesc: "crypto projects and Web3 startups",
    subredditBoosts: ["ethdev", "solidity", "CryptoJobsList", "Jobs4Bitcoins"],
  },
  wordpress: {
    roleTitle: "WordPress Developer",
    relatedSkills: ["WooCommerce", "PHP", "Elementor", "themes", "plugins", "website"],
    targetCustomerDesc: "small businesses needing WordPress sites",
    subredditBoosts: ["Wordpress", "webdev", "smallbusiness"],
  },
  shopify: {
    roleTitle: "Shopify Developer",
    relatedSkills: ["Liquid", "ecommerce", "WooCommerce", "online store"],
    targetCustomerDesc: "e-commerce brands needing Shopify development",
    subredditBoosts: ["shopify", "ecommerce"],
  },
  "ui ux": {
    roleTitle: "UI/UX Designer",
    relatedSkills: ["user interface", "user experience", "Figma", "product design", "wireframes"],
    targetCustomerDesc: "startups needing design work",
    subredditBoosts: ["web_design", "UI_Design", "userexperience", "DesignJobs"],
  },
  ux: {
    roleTitle: "UX Designer",
    relatedSkills: ["user experience", "UI", "Figma", "research", "wireframes"],
    targetCustomerDesc: "product companies needing UX research and design",
    subredditBoosts: ["userexperience", "UI_Design", "web_design"],
  },
  // Bare "design" / "need a design" — expand to real design crafts (not interior/3D).
  design: {
    roleTitle: "Designer",
    relatedSkills: [
      "web design",
      "UI/UX",
      "graphic design",
      "branding",
      "Figma",
      "logo",
      "website design",
      "landing page",
      "product design",
    ],
    targetCustomerDesc: "businesses needing web, brand, or product design",
    subredditBoosts: [
      "forhire",
      "DesignJobs",
      "web_design",
      "graphic_design",
      "UI_Design",
      "slavelabour",
      "hireadesigner",
    ],
  },
  "web design": {
    roleTitle: "Web Designer",
    relatedSkills: ["UI/UX", "Figma", "Webflow", "WordPress", "landing page", "website"],
    targetCustomerDesc: "businesses needing website or landing page design",
    subredditBoosts: ["web_design", "forhire", "DesignJobs", "Web_Design"],
  },
  "graphic design": {
    roleTitle: "Graphic Designer",
    relatedSkills: ["branding", "logo", "visual design", "Illustrator", "Photoshop"],
    targetCustomerDesc: "businesses needing brand identity and visual design",
    subredditBoosts: ["graphic_design", "DesignJobs", "branding"],
  },
  logo: {
    roleTitle: "Logo Designer",
    relatedSkills: ["branding", "graphic design", "brand identity", "Illustrator"],
    targetCustomerDesc: "new businesses needing logo and branding",
    subredditBoosts: ["graphic_design", "HungryArtists", "DesignJobs"],
  },
  marketing: {
    roleTitle: "Marketing Consultant",
    relatedSkills: [
      "digital marketing",
      "SEO",
      "social media",
      "content marketing",
      "PPC",
      "email marketing",
      "growth",
    ],
    targetCustomerDesc: "businesses needing marketing strategy and execution",
    subredditBoosts: ["marketing", "digital_marketing", "GrowthHacking", "SEO", "Entrepreneur"],
  },
  growth: {
    roleTitle: "Growth Marketer",
    relatedSkills: [
      "growth hacking",
      "user acquisition",
      "retention",
      "A/B testing",
      "funnel optimization",
      "marketing",
    ],
    targetCustomerDesc: "startups needing user growth and retention strategy",
    subredditBoosts: ["GrowthHacking", "startups", "SaaS", "Entrepreneur", "marketing"],
  },
  seo: {
    roleTitle: "SEO Specialist",
    relatedSkills: [
      "search engine optimization",
      "keywords",
      "backlinks",
      "content",
      "Google ranking",
      "organic traffic",
    ],
    targetCustomerDesc: "businesses wanting to rank higher on Google",
    subredditBoosts: ["SEO", "bigseo", "digital_marketing", "content_marketing"],
  },
  "social media": {
    roleTitle: "Social Media Manager",
    relatedSkills: ["Instagram", "TikTok", "LinkedIn", "content creation", "community management"],
    targetCustomerDesc: "brands needing social media management",
    subredditBoosts: ["SocialMediaMarketing", "digital_marketing", "marketing"],
  },
  content: {
    roleTitle: "Content Marketer",
    relatedSkills: [
      "content writing",
      "blog posts",
      "content strategy",
      "SEO writing",
      "copywriting",
    ],
    targetCustomerDesc: "companies needing content creation and strategy",
    subredditBoosts: ["content_marketing", "Blogging", "HireaWriter", "SEO"],
  },
  "email marketing": {
    roleTitle: "Email Marketing Specialist",
    relatedSkills: ["Klaviyo", "Mailchimp", "newsletters", "drip campaigns", "automation"],
    targetCustomerDesc: "e-commerce and SaaS companies needing email campaigns",
    subredditBoosts: ["EmailMarketing", "digital_marketing", "ecommerce"],
  },
  ads: {
    roleTitle: "Paid Ads Specialist",
    relatedSkills: ["Facebook Ads", "Google Ads", "PPC", "Meta Ads", "TikTok Ads", "ROAS"],
    targetCustomerDesc: "businesses needing paid advertising management",
    subredditBoosts: ["PPC", "FacebookAds", "digital_marketing", "GrowthHacking"],
  },
  copywriter: {
    roleTitle: "Copywriter",
    relatedSkills: ["copywriting", "sales copy", "landing pages", "email copy", "ad copy", "writer"],
    targetCustomerDesc: "businesses needing persuasive copy for sales and marketing",
    subredditBoosts: ["HireaWriter", "copywriting", "Entrepreneur", "marketing"],
  },
  writer: {
    roleTitle: "Writer",
    relatedSkills: [
      "copywriter",
      "copywriting",
      "content writer",
      "content writing",
      "ghostwriter",
      "technical writer",
      "blog",
      "article",
      "writing",
      "SEO writing",
    ],
    targetCustomerDesc: "companies and founders needing writing or content help",
    subredditBoosts: ["HireaWriter", "Blogging", "copywriting", "content_marketing", "forhire", "freelanceWriters"],
  },
  teacher: {
    roleTitle: "Teacher / Tutor",
    relatedSkills: [
      "tutor",
      "tutoring",
      "teacher",
      "lessons",
      "coaching",
      "instructor",
      "homework help",
      "online tutor",
    ],
    targetCustomerDesc: "students and parents looking for tutoring or lessons",
    subredditBoosts: ["tutors", "Teachers", "learnprogramming", "HomeworkHelp", "forhire", "slavelabour"],
  },
  tutor: {
    roleTitle: "Tutor",
    relatedSkills: [
      "tutoring",
      "teacher",
      "lessons",
      "homework help",
      "online tutor",
      "coaching",
      "instructor",
    ],
    targetCustomerDesc: "students seeking tutors or private lessons",
    subredditBoosts: ["tutors", "HomeworkHelp", "learnprogramming", "forhire", "slavelabour"],
  },
  investor: {
    roleTitle: "Investor",
    relatedSkills: [
      "raising",
      "fundraising",
      "seed round",
      "series a",
      "looking for investors",
      "raising capital",
      "pre-seed",
      "angel",
      "venture",
      "startup raising",
      "newly founded",
      "startup",
    ],
    targetCustomerDesc: "startups that are raising or seeking investment",
    subredditBoosts: ["startups", "startup_funding", "VentureCapital", "AngelInvesting", "Entrepreneur", "SaaS"],
  },
  sales: {
    roleTitle: "Sales Specialist",
    relatedSkills: [
      "sales",
      "sales rep",
      "salesperson",
      "SDR",
      "BDR",
      "account executive",
      "closer",
      "outbound",
      "inbound",
      "pipeline",
      "CRM",
    ],
    targetCustomerDesc: "companies hiring or needing sales talent",
    subredditBoosts: [
      "forhire",
      "sales",
      "salesjobs",
      "Entrepreneur",
      "startups",
      "smallbusiness",
      "SaaS",
    ],
  },
  sdr: {
    roleTitle: "SDR",
    relatedSkills: ["sales", "BDR", "outbound", "lead gen", "account executive"],
    targetCustomerDesc: "SaaS and B2B companies hiring outbound sales",
    subredditBoosts: ["sales", "salesjobs", "SaaS", "forhire"],
  },
  "lead generation": {
    roleTitle: "Lead Generation Specialist",
    relatedSkills: [
      "lead gen",
      "outbound",
      "appointment setting",
      "SDR",
      "BDR",
      "cold calling",
      "client acquisition",
      "pipeline",
      "prospecting",
      "sales",
      "sales rep",
      "account executive",
    ],
    targetCustomerDesc: "businesses buying lead generation or outbound services",
    subredditBoosts: ["sales", "salesjobs", "Entrepreneur", "smallbusiness", "SaaS", "forhire"],
  },
  "lead gen": {
    roleTitle: "Lead Generation Specialist",
    relatedSkills: [
      "lead generation",
      "outbound",
      "appointment setting",
      "SDR",
      "BDR",
      "cold calling",
      "client acquisition",
      "sales",
      "sales rep",
    ],
    targetCustomerDesc: "businesses buying lead generation or outbound services",
    subredditBoosts: ["sales", "salesjobs", "Entrepreneur", "smallbusiness", "SaaS", "forhire"],
  },
  "lead generation services": {
    roleTitle: "Lead Generation Specialist",
    relatedSkills: [
      "lead generation",
      "lead gen",
      "outbound",
      "appointment setting",
      "SDR",
      "BDR",
      "client acquisition",
      "prospecting",
      "sales",
      "sales rep",
      "account executive",
    ],
    targetCustomerDesc: "businesses buying lead generation services",
    subredditBoosts: ["sales", "salesjobs", "Entrepreneur", "smallbusiness", "SaaS", "forhire"],
  },
  "content writer": {
    roleTitle: "Content Writer",
    relatedSkills: ["blog posts", "articles", "SEO writing", "ghostwriting", "technical writing"],
    targetCustomerDesc: "companies needing regular content production",
    subredditBoosts: ["HireaWriter", "Blogging", "content_marketing"],
  },
  ghostwriter: {
    roleTitle: "Ghostwriter",
    relatedSkills: ["writing", "LinkedIn ghostwriting", "book writing", "thought leadership"],
    targetCustomerDesc: "executives and founders needing ghostwritten content",
    subredditBoosts: ["HireaWriter", "Journalism"],
  },
  "video editor": {
    roleTitle: "Video Editor",
    relatedSkills: [
      "Premiere Pro",
      "After Effects",
      "DaVinci Resolve",
      "YouTube editing",
      "short-form",
      "reels",
    ],
    targetCustomerDesc: "content creators and brands needing video editing",
    subredditBoosts: [
      "VideoEditingJobs",
      "VideoEditors",
      "YouTubeEditorsForHire",
      "CreatorServices",
    ],
  },
  photographer: {
    roleTitle: "Photographer",
    relatedSkills: ["photography", "product photography", "headshots", "Lightroom"],
    targetCustomerDesc: "businesses needing professional photography",
    subredditBoosts: ["PhotographyJobs", "photography"],
  },
  "data scientist": {
    roleTitle: "Data Scientist",
    relatedSkills: [
      "Python",
      "statistics",
      "machine learning",
      "SQL",
      "analytics",
      "visualization",
    ],
    targetCustomerDesc: "companies needing data analysis and modeling",
    subredditBoosts: ["datascience", "DataScienceJobs", "MachineLearningJobs"],
  },
  "data analyst": {
    roleTitle: "Data Analyst",
    relatedSkills: ["SQL", "Excel", "Python", "Tableau", "Power BI", "dashboards", "reporting", "analytics", "data"],
    targetCustomerDesc: "businesses needing data analysis and reporting",
    subredditBoosts: ["dataanalysis", "BusinessIntelligence", "SQL", "datascience"],
  },
  data: {
    roleTitle: "Data Analyst",
    relatedSkills: [
      "data analyst",
      "SQL",
      "Excel",
      "Python",
      "Tableau",
      "Power BI",
      "analytics",
      "dashboards",
      "reporting",
    ],
    targetCustomerDesc: "businesses needing data analysis and reporting",
    subredditBoosts: ["dataanalysis", "BusinessIntelligence", "SQL", "datascience"],
  },
  "virtual assistant": {
    roleTitle: "Virtual Assistant",
    relatedSkills: [
      "admin",
      "scheduling",
      "email management",
      "data entry",
      "research",
      "operations",
    ],
    targetCustomerDesc: "busy founders needing administrative support",
    subredditBoosts: ["VirtualAssistant", "WorkOnline", "slavelabour", "Entrepreneur"],
  },
  va: {
    roleTitle: "Virtual Assistant",
    relatedSkills: ["virtual assistant", "admin", "scheduling", "email", "operations"],
    targetCustomerDesc: "founders needing remote support",
    subredditBoosts: ["VirtualAssistant", "WorkOnline", "slavelabour"],
  },
  "project manager": {
    roleTitle: "Project Manager",
    relatedSkills: ["project management", "Agile", "Scrum", "coordination", "delivery"],
    targetCustomerDesc: "companies needing project coordination",
    subredditBoosts: ["projectmanagement", "agile"],
  },
  "product manager": {
    roleTitle: "Product Manager",
    relatedSkills: ["product management", "roadmap", "user stories", "PRD", "Agile", "B2B SaaS"],
    targetCustomerDesc: "startups needing product leadership",
    subredditBoosts: ["ProductManagement", "startups", "SaaS"],
  },
  accountant: {
    roleTitle: "Accountant / Bookkeeper",
    relatedSkills: ["bookkeeping", "accounting", "QuickBooks", "tax", "financial reporting"],
    targetCustomerDesc: "small businesses needing accounting services",
    subredditBoosts: ["Accounting", "smallbusiness", "Entrepreneur"],
  },
};

const PRODUCT_KEYWORDS = [
  "app",
  "tool",
  "software",
  "platform",
  "saas",
  "service",
  "extension",
  "plugin",
  "bot",
  "agent",
  "dashboard",
  "api",
  "sdk",
  "integration",
  "notetaker",
  "tracker",
  "scheduler",
  "generator",
  "analyzer",
  "monitor",
  "crm",
  "erp",
  "cms",
  "lms",
  "pos",
  "system",
  "solution",
];

const DEPARTMENT_KEYWORDS = [
  "marketing",
  "sales",
  "hr",
  "human resources",
  "finance",
  "operations",
  "legal",
  "customer success",
  "support",
  "engineering",
  "design",
  "product",
];

const PRODUCT_SYNONYMS: Record<string, string[]> = {
  notetaker: ["notetaker", "note-taking", "meeting notes", "transcription", "meeting recorder"],
  note: ["note-taking", "meeting notes", "transcription"],
  crm: ["CRM", "customer relationship", "sales pipeline", "contact management"],
  invoicing: ["invoicing", "billing", "invoice software", "accounting"],
  scheduler: ["scheduling", "calendar", "appointment booking"],
};

const FILLERS = [
  "developer",
  "dev",
  "engineer",
  "designer",
  "consultant",
  "specialist",
  "expert",
  "professional",
  "looking",
  "for",
  "i",
  "im",
  "i'm",
  "a",
  "an",
  "the",
  "need",
  "want",
  "hire",
  "freelancer",
  "freelance",
  // Conversational noise. Users type whole sentences — "I am a writer I am
  // actively looking for people, companies, posts etc who want writer" was
  // reducing to skill="writer acitvely posts etc", which matched nothing
  // anywhere. Every word below is grammar, not craft.
  "am",
  "are",
  "is",
  "was",
  "be",
  "me",
  "my",
  "we",
  "our",
  "us",
  "you",
  "your",
  "who",
  "whom",
  "that",
  "which",
  "and",
  "or",
  "etc",
  "actively",
  "currently",
  "really",
  "urgently",
  "please",
  "find",
  "finding",
  "search",
  "searching",
  "seek",
  "seeking",
  "get",
  "give",
  "show",
  "help",
  "someone",
  "somebody",
  "anyone",
  "people",
  "person",
  "posts",
  "post",
  "companies",
  "company",
  "business",
  "businesses",
  "client",
  "clients",
  "customer",
  "customers",
  // Do NOT strip bare "lead"/"leads" — that destroys "lead generation".
  "job",
  "jobs",
  "work",
  "gig",
  "gigs",
  "project",
  "projects",
  "opportunity",
  "opportunities",
  // Org-unit wrappers — "sales teams" / "marketing department" must reduce to
  // the craft ("sales" / "marketing"), not "sales team". Measured: "sales teams"
  // → coreSkill "sales team" → personNoun "sales team specialist" → every social
  // dork and craft gate missed real "sales rep" posts → Posts = ATS only.
  "team",
  "teams",
  "department",
  "departments",
  "dept",
  "group",
  "groups",
  "squad",
  "squads",
  "unit",
  "units",
  "function",
  "functions",
  "org",
  "organization",
  "organisation",
  "to",
  "of",
  "in",
  "on",
  "with",
  "from",
  "as",
  "such",
  "stuff",
  "things",
];

/**
 * Singularise the head noun of a skill phrase.
 *
 * Fixes a zero-result class: "companies looking for writers" produced
 * coreSkill="writers", and because every relevance gate downstream matches on
 * word boundaries, it never matched the word "writer" that actual posts use.
 * The query returned nothing from every source at once.
 *
 * Normalising HERE rather than in each matcher means the relevance gate, the
 * search dorks, and the job-board terms all get the fix together.
 *
 * Only the last word is touched — "graphic designers" → "graphic designer" —
 * and known-plural crafts that aren't plurals ("devops", "sales", "cms") are
 * left alone.
 */
const NOT_REALLY_PLURAL = new Set([
  "devops",
  "sales",
  "ops",
  "analytics",
  "cms",
  "saas",
  "aws",
  "css",
  "js",
  "news",
  "business",
  "graphics",
  "logistics",
  "mathematics",
  "physics",
]);

/**
 * Pull the craft out of a first-person self-description.
 *
 * People describe themselves before describing what they want: "I am a writer,
 * I'm actively looking for people who need writers". Filler-subtraction handles
 * that badly — it has to guess which of twenty words is the craft, and it got
 * "writer acitvely posts etc". But the sentence states the craft outright, and
 * the noun right after "I am a" / "I'm a" / "as a" IS it.
 *
 * Matching this pattern FIRST turns the hardest query shape into the easiest
 * one, and it's robust to typos elsewhere in the sentence because we stop at
 * the first clause boundary.
 */
export function extractSelfDescribedCraft(raw: string): string | null {
  const t = (raw || "").toLowerCase();
  // "i am a/an X", "i'm a X", "im an X", "as a X", "we are a X"
  const m =
    /\b(?:i\s*(?:'|’)?\s*a?m|im|i\s+am|as|we\s*(?:'|’)?\s*re|we\s+are)\s+(?:an?\s+)?([a-z][a-z0-9 .+#/-]{1,40}?)(?=\s*(?:,|\.|;|:|!|\?|\band\b|\bwho\b|\bthat\b|\blooking\b|\bactively\b|\bacitvely\b|\bseeking\b|\bsearching\b|\btrying\b|\bwanting\b|\bi\b|\bwe\b|$))/i.exec(
      t,
    );
  if (!m) return null;
  let craft = m[1].trim();
  // Drop a trailing seniority/quality adjective run that isn't the craft.
  craft = craft.replace(
    /^(?:freelance|senior|junior|experienced|professional|full[- ]time|part[- ]time)\s+/g,
    "",
  );
  if (craft.length < 3 || craft.split(/\s+/).length > 4) return null;
  // "I am looking for X" is NOT a self-description — that's the ask, and the
  // craft there is the thing being sought, handled by the normal path.
  if (/^(?:looking|searching|seeking|trying|going|able|happy|new|here)\b/.test(craft)) return null;
  return singularizeSkill(craft);
}

export function singularizeSkill(input: string): string {
  const s = (input || "").trim();
  if (!s) return s;
  const parts = s.split(/\s+/);
  const last = parts[parts.length - 1].toLowerCase();
  if (last.length < 4 || NOT_REALLY_PLURAL.has(last) || last.endsWith("ss")) return s;
  let singular: string | null = null;
  if (last.endsWith("ies") && last.length > 4) singular = `${last.slice(0, -3)}y`;
  else if (/(?:ches|shes|xes|ses)$/.test(last)) singular = last.slice(0, -2);
  else if (last.endsWith("s")) singular = last.slice(0, -1);
  if (!singular) return s;
  parts[parts.length - 1] = singular;
  return parts.join(" ");
}

function extractCoreSkill(input: string): string {
  let s = input.toLowerCase();
  for (const f of FILLERS) {
    s = s.replace(new RegExp(`\\b${f}\\b`, "gi"), " ");
  }
  s = s.replace(/\s+/g, " ").trim();
  return singularizeSkill(s) || singularizeSkill(input.toLowerCase().trim());
}

function findRoleMatch(lower: string): { key: string; entry: RoleEntry } | null {
  if (CLASSIFIER_ROLE_MAP[lower]) {
    return { key: lower, entry: CLASSIFIER_ROLE_MAP[lower] };
  }
  let best: { key: string; entry: RoleEntry } | null = null;
  let bestLen = 0;
  for (const [key, entry] of Object.entries(CLASSIFIER_ROLE_MAP)) {
    if (lower.includes(key) && key.length > bestLen) {
      best = { key, entry };
      bestLen = key.length;
    }
  }
  return best;
}

function extractProductKeywords(productDesc: string): string[] {
  const lower = productDesc.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => !PRODUCT_KEYWORDS.includes(w) && w.length > 2);
  const out = new Set<string>(words);
  for (const [key, syns] of Object.entries(PRODUCT_SYNONYMS)) {
    if (lower.includes(key)) syns.forEach((s) => out.add(s));
  }
  return [...out];
}

// ── Location + directory ICP parsing ─────────────────────────────────────────
const DIRECTORY_ENTITY_RE =
  /\b(agenc(?:y|ies)|companies|company|businesses|business|firms|firm|studios|studio|shops|shop)\b/i;

const LOCATION_ALIASES: Record<string, string> = {
  india: "India",
  indian: "India",
  bharat: "India",
  usa: "United States",
  "united states": "United States",
  "united states of america": "United States",
  us: "United States",
  uk: "United Kingdom",
  "united kingdom": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  uae: "United Arab Emirates",
  dubai: "Dubai",
  canada: "Canada",
  australia: "Australia",
  germany: "Germany",
  france: "France",
  singapore: "Singapore",
  israel: "Israel",
};

/** Country-level locations get Geoapify place: boundary filters. */
export const COUNTRY_LOCATIONS = new Set([
  "india",
  "united states",
  "united kingdom",
  "canada",
  "australia",
  "germany",
  "france",
  "singapore",
  "israel",
  "united arab emirates",
  "brazil",
  "mexico",
  "japan",
  "china",
  "spain",
  "italy",
  "netherlands",
  "sweden",
  "ireland",
  "new zealand",
  "south africa",
  "nigeria",
  "indonesia",
  "philippines",
  "pakistan",
  "bangladesh",
  "sri lanka",
  "nepal",
  "thailand",
  "vietnam",
  "malaysia",
  "south korea",
  "poland",
  "portugal",
  "switzerland",
  "austria",
  "belgium",
  "denmark",
  "norway",
  "finland",
  "argentina",
  "chile",
  "colombia",
]);

/**
 * Words that must never be treated as a place. "hiring engineers with
 * experience in Next.js" would otherwise parse "Next.js" as a location and
 * poison the whole search (real bug observed in production).
 */
const NON_LOCATION_TERMS = new Set([
  // languages / frameworks / platforms
  "next.js",
  "nextjs",
  "next",
  "react",
  "react.js",
  "reactjs",
  "react native",
  "vue",
  "vue.js",
  "nuxt",
  "angular",
  "svelte",
  "sveltekit",
  "node",
  "node.js",
  "nodejs",
  "express",
  "nestjs",
  "javascript",
  "typescript",
  "python",
  "django",
  "flask",
  "fastapi",
  "java",
  "kotlin",
  "swift",
  "swiftui",
  "objective-c",
  "php",
  "laravel",
  "symfony",
  "ruby",
  "rails",
  "go",
  "golang",
  "rust",
  "c#",
  "csharp",
  ".net",
  "dotnet",
  "c++",
  "sql",
  "mysql",
  "postgres",
  "postgresql",
  "mongodb",
  "graphql",
  "html",
  "css",
  "tailwind",
  "flutter",
  "dart",
  "wordpress",
  "shopify",
  "webflow",
  "wix",
  "squarespace",
  "figma",
  "excel",
  "salesforce",
  "hubspot",
  "quickbooks",
  "xero",
  "sap",
  "tableau",
  "power bi",
  // infra / cloud
  "aws",
  "azure",
  "gcp",
  "docker",
  "kubernetes",
  "k8s",
  "terraform",
  "devops",
  "linux",
  "windows",
  "ios",
  "android",
  // domains / functions / industries (common after "in ...")
  "ai",
  "ml",
  "machine learning",
  "deep learning",
  "llm",
  "nlp",
  "data",
  "data science",
  "analytics",
  "engineering",
  "software",
  "frontend",
  "backend",
  "fullstack",
  "full stack",
  "web development",
  "webdev",
  "mobile",
  "design",
  "ux",
  "ui",
  "seo",
  "ppc",
  "marketing",
  "sales",
  "finance",
  "accounting",
  "hr",
  "legal",
  "operations",
  "security",
  "cybersecurity",
  "blockchain",
  "web3",
  "crypto",
  "fintech",
  "healthtech",
  "edtech",
  "saas",
  "ecommerce",
  "e-commerce",
  "retail",
  "healthcare",
  "tech",
  "technology",
  "startups",
  "gaming",
  "media",
  "advertising",
  "construction",
  "real estate",
  "manufacturing",
  "logistics",
  "insurance",
  "banking",
  "biotech",
  "pharma",
  "10-k",
  "10k",
  "sec",
]);

function looksLikeTechTerm(candidate: string): boolean {
  const key = candidate.toLowerCase().trim();
  if (!key) return false;
  if (NON_LOCATION_TERMS.has(key)) return true;
  // dotted tech names ("next.js", "vue.js", "socket.io") and versioned terms
  if (/\.[a-z0-9]{1,4}$/.test(key)) return true;
  if (/\d/.test(key) && !/^\d+(st|nd|rd|th)\b/.test(key)) return true;
  // every word individually a tech/function term → not a place
  const words = key.split(/\s+/);
  if (words.length > 1 && words.every((w) => NON_LOCATION_TERMS.has(w))) return true;
  return false;
}

/**
 * Case-insensitive "in X" / "near X" / "around X" extractor.
 * Strips trailing filler words and normalizes common country aliases.
 */
export function extractLocationFromQuery(text: string): string | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  const m =
    raw.match(/\b(?:in|near|around|at)\s+([a-z0-9][\w\s.'-]{0,48}?)(?:\s*[?!,.]|$)/i) ||
    raw.match(/\b(?:based in|located in)\s+([a-z0-9][\w\s.'-]{0,48}?)(?:\s*[?!,.]|$)/i);
  if (!m) return null;
  let loc = m[1]
    .replace(
      /\b(agenc(?:y|ies)|companies|company|businesses|business|firms|firm|please|today)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  // Drop trailing skill leftovers that got captured (e.g. "India marketing")
  loc = loc
    .replace(/\b(marketing|seo|design|software|tech|digital|agency|agencies)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!loc || loc.length < 2) return null;
  if (looksLikeTechTerm(loc)) return null;
  const key = loc.toLowerCase();
  if (LOCATION_ALIASES[key]) return LOCATION_ALIASES[key];
  // Title-case multi-word places
  return loc
    .split(/\s+/)
    .map((w) =>
      w.length <= 2 && /^[a-z]+$/i.test(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

/**
 * Demand verbs that flip a "companies …" query from DIRECTORY to BUYER-INTENT.
 *
 * "marketing agencies in London"      → directory: list me these companies
 * "companies looking for writers"     → buyer intent: companies WITH A SIGNAL
 *
 * Both contain a directory entity noun, but they are opposite requests. Reading
 * the second as a directory sent it down the Places path, which then returned
 * ZERO sources attempted because no city was named — a whole class of natural
 * queries ("companies hiring designers", "businesses that need editors")
 * silently produced nothing.
 */
const DIRECTORY_DEMAND_VERB_RE =
  /\b(?:looking\s+for|look\s+for|hiring|hire|need(?:s|ing)?|want(?:s|ing)?|require(?:s|ing)?|seeking|searching\s+for|in\s+search\s+of|recruiting|after)\b/i;

export function isDirectoryQuery(text: string): boolean {
  const t = text || "";
  if (!DIRECTORY_ENTITY_RE.test(t)) return false;
  // "The company is SOC 2…" is a buying signal, not a directory ICP listing.
  if (/^(the\s+)?compan(?:y|ies)\s+(is|are|offers|has|have)\b/i.test(t.trim())) return false;
  // A demand verb means the user wants companies that WANT something, not a
  // catalogue of companies. That's buyer intent, whatever nouns are present.
  if (DIRECTORY_DEMAND_VERB_RE.test(t)) return false;
  // Prefer plural / agency-list phrasing for directory mode
  if (/\b(agenc(?:y|ies)|companies|businesses|firms|studios|shops)\b/i.test(t)) return true;
  // Singular company/business/firm only when paired with a location ("companies in X" style)
  return !!extractLocationFromQuery(t);
}

export function isCountryLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return COUNTRY_LOCATIONS.has(location.toLowerCase());
}

/** ICP fillers like "for startups" — strip from skill seed, keep as audience hint. */
const ICP_FOR_NOUN_RE =
  /\bfor\s+(startups?|agenc(?:y|ies)|small businesses|smbs?|founders?|companies|businesses|freelancers?)\b/gi;

/** Extract ICP noun from "… for startups" style buyer phrasing. */
function extractForIcpNoun(raw: string): string | null {
  const forM = (raw || "")
    .toLowerCase()
    .match(
      /\bfor\s+(startups?|agenc(?:y|ies)|small businesses|smbs?|founders?|companies|businesses|freelancers?)\b/i,
    );
  if (!forM) return null;
  const n = forM[1].toLowerCase();
  if (/^startup/.test(n)) return "startups";
  if (/^agenc/.test(n)) return "agencies";
  if (/^smb|^small business/.test(n)) return "small businesses";
  if (/^founder/.test(n)) return "founders";
  if (/^compan/.test(n)) return "companies";
  if (/^business/.test(n)) return "businesses";
  if (/^freelancer/.test(n)) return "freelancers";
  return null;
}

/** Strip location + entity nouns so skill becomes "marketing" from "marketing agencies in india". */
export function stripLocationAndEntities(text: string, location: string | null): string {
  let s = (text || "").toLowerCase();
  if (location) {
    const locRe = new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    s = s.replace(locRe, " ");
    // also strip aliases that map to this location
    for (const [alias, canon] of Object.entries(LOCATION_ALIASES)) {
      if (canon.toLowerCase() === location.toLowerCase()) {
        s = s.replace(new RegExp(`\\b${alias}\\b`, "gi"), " ");
      }
    }
  }
  s = s
    .replace(ICP_FOR_NOUN_RE, " ")
    .replace(/\b(in|near|around|at|based|located)\b/gi, " ")
    .replace(DIRECTORY_ENTITY_RE, " ")
    // Strip buyer-demand openers so skill seed is clean ("need a web development" → "web development")
    .replace(
      /\b(i need|we need|need an?|looking for an?|looking for someone|who can|willing to pay)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

function buildIcpNoun(skill: string, raw: string): string | null {
  const lower = raw.toLowerCase();
  // Buyer queries: "need a web development for startups" → icpNoun = startups
  const forIcp = extractForIcpNoun(raw);
  if (forIcp) return forIcp;
  if (!isDirectoryQuery(raw)) return null;
  if (/\bagenc(?:y|ies)\b/.test(lower)) return `${skill} agency`.replace(/\s+/g, " ").trim();
  if (/\b(companies|company)\b/.test(lower)) return `${skill} company`.replace(/\s+/g, " ").trim();
  if (/\b(businesses|business)\b/.test(lower))
    return `${skill} business`.replace(/\s+/g, " ").trim();
  if (/\b(firms|firm)\b/.test(lower)) return `${skill} firm`.replace(/\s+/g, " ").trim();
  if (/\b(studios|studio)\b/.test(lower)) return `${skill} studio`.replace(/\s+/g, " ").trim();
  if (/\b(shops|shop)\b/.test(lower)) return `${skill} shop`.replace(/\s+/g, " ").trim();
  return `${skill} business`;
}

// ── Skill mention detection ──────────────────────────────────────────────────
// Word-boundary scan for concrete skills/technologies inside a plain-English
// signal ("Currently hiring 3+ engineers with experience in Next.js" →
// ["next.js"]). Most-specific patterns first so "react native" wins over
// "react" and "javascript" isn't shadowed by "java".
const SKILL_PATTERNS: Array<{ canonical: string; re: RegExp }> = [
  { canonical: "react native", re: /\breact[\s-]?native\b/i },
  { canonical: "next.js", re: /\bnext\.?js\b/i },
  { canonical: "node.js", re: /\bnode(?:\.?js)?\b/i },
  { canonical: "vue", re: /\bvue(?:\.?js)?\b|\bnuxt\b/i },
  { canonical: "angular", re: /\bangular\b/i },
  { canonical: "svelte", re: /\bsvelte(?:kit)?\b/i },
  { canonical: "typescript", re: /\btypescript\b/i },
  { canonical: "javascript", re: /\bjavascript\b/i },
  { canonical: "react", re: /\breact(?:\.?js)?\b/i },
  { canonical: "django", re: /\bdjango\b/i },
  { canonical: "fastapi", re: /\bfastapi\b/i },
  { canonical: "flask", re: /\bflask\b/i },
  { canonical: "python", re: /\bpython\b/i },
  { canonical: "laravel", re: /\blaravel\b/i },
  { canonical: "php", re: /\bphp\b/i },
  { canonical: "rails", re: /\brails\b|\bruby on rails\b/i },
  { canonical: "ruby", re: /\bruby\b/i },
  { canonical: "golang", re: /\bgolang\b|\bgo (?:developer|engineer|dev)\b/i },
  { canonical: "rust", re: /\brust\b/i },
  { canonical: "kotlin", re: /\bkotlin\b/i },
  { canonical: "java", re: /\bjava\b(?!script)/i },
  { canonical: "c#", re: /\bc#|\bcsharp\b|\b\.net\b|\bdotnet\b/i },
  { canonical: "swift", re: /\bswift(?:ui)?\b/i },
  { canonical: "ios", re: /\bios\b|\biphone app\b/i },
  { canonical: "android", re: /\bandroid\b/i },
  { canonical: "flutter", re: /\bflutter\b|\bdart\b/i },
  { canonical: "wordpress", re: /\bwordpress\b|\bwoocommerce\b/i },
  { canonical: "shopify", re: /\bshopify\b/i },
  { canonical: "webflow", re: /\bwebflow\b/i },
  { canonical: "devops", re: /\bdevops\b|\bsre\b|\bsite reliability\b/i },
  { canonical: "kubernetes", re: /\bkubernetes\b|\bk8s\b/i },
  { canonical: "docker", re: /\bdocker\b/i },
  { canonical: "aws", re: /\baws\b|\bamazon web services\b/i },
  { canonical: "terraform", re: /\bterraform\b/i },
  { canonical: "machine learning", re: /\bmachine[\s-]?learning\b|\bml engineer\b/i },
  { canonical: "llm", re: /\bllms?\b|\bgpt\b|\bopenai\b|\banthropic\b|\brag\b/i },
  { canonical: "ai", re: /\bai\b|\bartificial intelligence\b/i },
  { canonical: "data science", re: /\bdata scien(?:ce|tist)\b/i },
  { canonical: "data engineering", re: /\bdata engineer(?:ing)?\b|\betl\b/i },
  { canonical: "sql", re: /\bsql\b|\bpostgres(?:ql)?\b|\bmysql\b/i },
  { canonical: "blockchain", re: /\bblockchain\b|\bweb3\b|\bsolidity\b|\bsmart contracts?\b/i },
  {
    canonical: "cybersecurity",
    re: /\bcyber\s?security\b|\binfosec\b|\bpenetration test(?:ing)?\b|\bsoc 2\b/i,
  },
  { canonical: "seo", re: /\bseo\b|\bsearch engine optimi[sz]ation\b/i },
  { canonical: "ppc", re: /\bppc\b|\bgoogle ads\b|\bfacebook ads\b|\bmeta ads\b|\bpaid ads\b/i },
  { canonical: "email marketing", re: /\bemail marketing\b|\bklaviyo\b|\bmailchimp\b/i },
  { canonical: "social media", re: /\bsocial media\b|\binstagram\b|\btiktok\b/i },
  {
    canonical: "content writing",
    re: /\bcontent writ(?:er|ing)\b|\bcopywrit(?:er|ing)\b|\bghostwrit/i,
  },
  {
    canonical: "video editing",
    re: /\bvideo edit(?:or|ing)\b|\bpremiere pro\b|\bafter effects\b/i,
  },
  { canonical: "graphic design", re: /\bgraphic design(?:er)?\b|\blogo design\b|\bbranding\b/i },
  { canonical: "ux design", re: /\bui\s*\/?\s*ux\b|\bux\b|\bproduct design(?:er)?\b|\bfigma\b/i },
  {
    canonical: "web design",
    re: /\bweb design(?:er|ing)?\b|\bwebsite design\b|\blanding page design\b/i,
  },
  // Last among design patterns so "graphic/web/ux design" win when present.
  { canonical: "design", re: /\bdesign(?:er|ing)?\b/i },
  { canonical: "marketing", re: /\bmarketing\b|\bgrowth hack(?:ing|er)\b|\bdemand gen\b/i },
  { canonical: "sales", re: /\bsales\b|\bsdr\b|\bbdr\b|\baccount executive\b/i },
  { canonical: "accounting", re: /\baccount(?:ing|ant)\b|\bbookkeep(?:ing|er)\b|\bquickbooks\b/i },
  { canonical: "hr", re: /\bhr\b|\bhuman resources\b|\brecruit(?:er|ing|ment)\b/i },
  { canonical: "frontend", re: /\bfront[\s-]?end\b|\bfrontend\b/i },
  { canonical: "backend", re: /\bback[\s-]?end\b|\bbackend\b/i },
  { canonical: "full stack", re: /\bfull[\s-]?stack\b/i },
  { canonical: "mobile", re: /\bmobile (?:app|developer|dev)\b/i },
  { canonical: "web development", re: /\bweb (?:developer|development|dev)\b|\bwebsite\b/i },
];

/** Concrete skills/technologies mentioned in a query, most specific first. */
export function detectSkillMentions(text: string): string[] {
  const out: string[] = [];
  for (const { canonical, re } of SKILL_PATTERNS) {
    if (re.test(text) && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

// Boilerplate words in plain-English signals; removed when falling back to a
// keyword skill because no concrete technology was detected.
const SIGNAL_BOILERPLATE = new Set([
  "currently",
  "hiring",
  "hire",
  "hired",
  "looking",
  "look",
  "seeking",
  "seek",
  "need",
  "needs",
  "needed",
  "want",
  "wants",
  "wanted",
  "experience",
  "experienced",
  "engineer",
  "engineers",
  "developer",
  "developers",
  "designer",
  "designers",
  "specialist",
  "specialists",
  "people",
  "person",
  "candidates",
  "roles",
  "role",
  "positions",
  "asking",
  "ask",
  "find",
  "finding",
  "companies",
  "company",
  "services",
  "service",
  "position",
  "openings",
  "opening",
  "jobs",
  "job",
  "team",
  "teams",
  "company",
  "companies",
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "of",
  "for",
  "with",
  "and",
  "or",
  "to",
  "who",
  "that",
  "have",
  "has",
  "had",
  "are",
  "is",
  "was",
  "were",
  "their",
  "they",
  "them",
  "more",
  "than",
  "last",
  "past",
  "recent",
  "recently",
  "months",
  "month",
  "weeks",
  "week",
  "days",
  "day",
  "years",
  "year",
  "mention",
  "mentions",
  "mentioned",
]);

function fallbackSignalSkill(text: string): string {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !SIGNAL_BOILERPLATE.has(w) && !/^\d+[+]?$/.test(w));
  return words.slice(0, 4).join(" ");
}

/** Detect Coldreach-style plain-English buying signals. */
export function detectSignalFamily(text: string): SignalFamily {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return null;
  if (/\b(10-?k|sec filing|form\s*10|edgar)\b/.test(t)) return "sec_10k";
  if (/\b(linkedin\s+(post|posts|activity)|company\s+linkedin|going to .+ conference)\b/.test(t)) {
    return "linkedin_company";
  }
  if (/\b(onboarded|joined as|hired a|new hire|mentioned .+ on their linkedin)\b/.test(t)) {
    return "employees";
  }
  if (
    /\b(soc\s*2|type\s*2|compliant|offers .+ services|on (their|the) website|company website)\b/.test(
      t,
    )
  ) {
    return "website";
  }
  if (/\b(data breach|cybersecurity|raised|funding|acquired|announced|faced .+ attack)\b/.test(t)) {
    return "news";
  }
  if (
    /\b(job description|in (finance|engineering|marketing) job|mentions .+ in .+ job)\b/.test(t)
  ) {
    return "job_description";
  }
  if (
    /\b(currently hiring|hiring \d|looking to hire|open roles?|job openings?|engineers with)\b/.test(
      t,
    )
  ) {
    return "job_opening";
  }
  // Want/need demand phrasing — a buyer asking directly, not posting a job.
  // Include bare "need a/an" (project auto-queries: "need a web development for…").
  if (
    /\b(i need|i want|we need|we want|need someone|want someone|can someone|who can|willing to pay|looking for someone|looking for a|looking for an|need a|need an)\b/.test(
      t,
    )
  ) {
    return "custom";
  }
  // Long descriptive prompts that aren't a short skill/role → custom signal
  if (
    t.split(/\s+/).length >= 6 &&
    /\b(companies?|that|who|which|have|has|with|in the last|past \d)\b/.test(t)
  ) {
    return "custom";
  }
  return null;
}

export function isBuyingSignalQuery(text: string): boolean {
  return detectSignalFamily(text) !== null;
}

function withMeta(
  base: Omit<
    ClassifiedQuery,
    "location" | "intentMode" | "icpNoun" | "signalMode" | "signalFamily"
  >,
  location: string | null,
  intentMode: IntentMode,
  icpNoun: string | null,
  signalMode: SignalMode,
  signalFamily: SignalFamily,
): ClassifiedQuery {
  return { ...base, location, intentMode, icpNoun, signalMode, signalFamily };
}

/** Seller/product pitch: extract capability keywords for customer-hunt fan-out. */
export function isProductPitchQuery(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return false;
  if (/\b(i'?m|i am|we'?re|we are)\s+selling\b/.test(t)) return true;
  if (
    /\b(selling|building|launched|built)\s+(a|an|my|our)\s+(product|app|tool|saas|platform|software|service)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\bmy (product|app|tool|saas|platform|software)\b.{0,40}\b(that|which|helps|does)\b/.test(t)) {
    return true;
  }
  if (/\b(customers?|clients?|users?|leads?)\s+for\s+(my|our)\b/.test(t)) return true;
  return false;
}

const PRODUCT_STOP = new Set([
  "product", "app", "tool", "saas", "platform", "software", "service", "that",
  "which", "helps", "help", "does", "lets", "allows", "enables", "with", "from",
  "their", "them", "this", "into", "onto", "your", "my", "our", "the", "and",
  "for", "who", "can", "are", "looking", "need", "want", "people", "users",
]);

/** Audience noun the product serves — e.g. freelancers, founders, agencies. */
export function extractProductPitchAudience(text: string): string | null {
  const t = (text || "").trim();
  const m =
    t.match(/\bhelps?\s+([a-z][\w-]*)\b/i) ||
    t.match(/\bfor\s+([a-z][\w-]*)\s+(?:who|to|looking|needing)\b/i) ||
    t.match(/\b(?:selling|building)\s+(?:a|an|my|our)\s+\w+\s+for\s+([a-z][\w-]*)\b/i);
  if (!m?.[1]) return null;
  const a = m[1].toLowerCase();
  if (PRODUCT_STOP.has(a) || /^(you|them|someone|anyone)$/i.test(a)) return null;
  return a;
}

/**
 * Pull capability phrases the product helps with — the real search keys.
 * "helps freelancers find clients and manage invoices" →
 * ["find clients", "manage invoices", "invoices", "freelancers"]
 */
export function extractProductPitchKeywords(text: string): string[] {
  const t = (text || "").trim();
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const s = raw.replace(/\s+/g, " ").trim().toLowerCase();
    if (s.length < 3 || seen.has(s) || PRODUCT_STOP.has(s)) return;
    if (/^(i'm|i am|we're|selling|building)\b/.test(s)) return;
    seen.add(s);
    ordered.push(s);
  };

  const audience = extractProductPitchAudience(t);
  if (audience) add(audience);

  // Verb phrases after "helps X …" / "that does …"
  const afterHelp = t.match(
    /\b(?:that|which)\s+(?:does|helps?|lets?|allows?|enables?)\s+(?:[a-z][\w-]*\s+)?(.+?)(?:\.|$|\s+and\s+i\b)/i,
  );
  const clause = (afterHelp?.[1] || "").trim();
  if (clause) {
    // Only strip the known audience subject — keep objects like "find clients".
    const audienceRe = audience
      ? new RegExp(`\\b${audience.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
      : null;
    const parts = clause
      .split(/\s+and\s+|,\s*|\s+or\s+/i)
      .map((p) => {
        let cleaned = p;
        if (audienceRe) cleaned = cleaned.replace(audienceRe, " ");
        return cleaned.replace(/\s+/g, " ").trim();
      })
      .filter((p) => p.length >= 4);
    for (const p of parts) add(p);
    // Noun anchors inside phrases — skip bare verbs.
    const bareVerb = /^(find|manage|track|get|book|hire|schedule|send|create|build|sell|buy|pay|help|need)$/i;
    for (const p of parts) {
      for (const w of p.split(/\s+/)) {
        if (w.length > 4 && !PRODUCT_STOP.has(w.toLowerCase()) && !bareVerb.test(w)) add(w);
      }
    }
  }

  // Avoid swallowing the whole pitch as one junk term.
  const forMy = t.match(/\b(?:customers?|clients?|users?|leads?)\s+for\s+(?:my|our)\s+(.+?)(?:\.|$)/i);
  if (forMy?.[1]) {
    const noun = forMy[1].replace(/\b(product|app|tool|saas|platform|software)\b/gi, " ").trim();
    if (noun.length >= 3) add(noun);
  }

  const selling = t.match(
    /\b(?:selling|building|launched)\s+(?:a|an|my|our)\s+([a-z0-9][\w+-]*(?:\s+[a-z0-9][\w+-]*){0,2})/i,
  );
  if (
    selling?.[1] &&
    !/^(product|app|tool|saas|platform|software|service)$/i.test(selling[1]) &&
    !/\b(that|which|helps?)\b/i.test(selling[1])
  ) {
    add(selling[1]);
  }

  return ordered.slice(0, 10);
}

export function classifyQuery(raw: string): ClassifiedQuery {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const location = extractLocationFromQuery(trimmed);
  const directory = isDirectoryQuery(trimmed);
  const intentMode: IntentMode = directory ? "directory_smb" : "buyer_intent";

  // Product / seller pitches must win BEFORE buying-signal "custom" family —
  // otherwise "I'm selling a product that helps freelancers…" becomes
  // coreSkill "selling product" and fans out "need a selling product".
  if (!directory && isProductPitchQuery(trimmed)) {
    const related = extractProductPitchKeywords(trimmed);
    const audience = extractProductPitchAudience(trimmed);
    // Prefer capability phrase over audience noun as core skill
    // ("find clients" beats "freelancers" for fan-out quality).
    const capability =
      related.find((r) => /\s/.test(r) && r !== audience) ||
      related.find((r) => r !== audience) ||
      related[0];
    const seed =
      capability ||
      extractProductKeywords(lower).slice(0, 3).join(" ") ||
      "product";
    const who = audience || "people";
    return withMeta(
      {
        raw: trimmed,
        type: "product",
        coreSkill: seed,
        roleTitle: seed,
        relatedSkills: related.length ? related : extractProductKeywords(lower),
        targetCustomerDesc: `${who} who need ${seed}`,
      },
      location,
      "buyer_intent",
      null,
      "skill_role",
      null,
    );
  }

  const signalFamily = directory ? null : detectSignalFamily(trimmed);
  const signalMode: SignalMode = !directory && signalFamily ? "buying_signal" : "skill_role";
  // A stated craft ("I am a writer …") beats anything filler-subtraction can
  // recover from the rest of the sentence — see extractSelfDescribedCraft.
  const selfCraft = extractSelfDescribedCraft(trimmed);
  const skillSeed = selfCraft || stripLocationAndEntities(trimmed, location) || lower;

  // Known crafts (e.g. "lead generation services") must win over product-keyword
  // substring hits — "services".includes("service") used to force type=product
  // and explode relevance on bare tokens lead/generation/services.
  const roleMatch = findRoleMatch(skillSeed) ?? findRoleMatch(lower);
  const isProduct =
    !directory &&
    signalMode === "skill_role" &&
    !roleMatch &&
    PRODUCT_KEYWORDS.some((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower));
  if (isProduct) {
    const related = extractProductKeywords(lower).filter(
      (t) => !/^(lead|leads|generation|service|services|client|clients)$/i.test(t),
    );
    return withMeta(
      {
        raw: trimmed,
        type: "product",
        coreSkill: skillSeed,
        roleTitle: trimmed,
        relatedSkills: related.length ? related : [skillSeed],
        targetCustomerDesc: `people who need ${trimmed}`,
      },
      location,
      "buyer_intent",
      null,
      signalMode,
      signalFamily,
    );
  }

  if (roleMatch && signalMode === "skill_role") {
    const { key, entry } = roleMatch;
    const isDept = DEPARTMENT_KEYWORDS.includes(key);
    const coreSkill = directory ? stripLocationAndEntities(key, null) || key : key;
    const icpNoun = buildIcpNoun(coreSkill, trimmed);
    return withMeta(
      {
        raw: trimmed,
        type: isDept ? "department" : "role",
        coreSkill,
        roleTitle: directory && icpNoun ? icpNoun : entry.roleTitle,
        relatedSkills: entry.relatedSkills,
        targetCustomerDesc: directory
          ? `${icpNoun || coreSkill} listings${location ? ` in ${location}` : ""}`
          : entry.targetCustomerDesc,
      },
      location,
      intentMode,
      icpNoun,
      signalMode,
      signalFamily,
    );
  }

  if (
    signalMode === "skill_role" &&
    DEPARTMENT_KEYWORDS.some((d) => skillSeed === d || skillSeed.includes(d) || lower.includes(d))
  ) {
    const coreSkill = extractCoreSkill(skillSeed) || skillSeed;
    const icpNoun = buildIcpNoun(coreSkill, trimmed);
    return withMeta(
      {
        raw: trimmed,
        type: "department",
        coreSkill,
        roleTitle: directory && icpNoun ? icpNoun : `${coreSkill} specialist`,
        relatedSkills: [coreSkill, skillSeed].filter(Boolean),
        targetCustomerDesc: directory
          ? `${icpNoun || coreSkill} listings${location ? ` in ${location}` : ""}`
          : `businesses needing ${coreSkill} help`,
      },
      location,
      intentMode,
      icpNoun,
      signalMode,
      signalFamily,
    );
  }

  // Buying-signal path: known crafts in the raw sentence must win before
  // filler-subtraction / fallbackSignalSkill. Otherwise
  // "…asking for lead generation services" becomes coreSkill
  // "find asking lead generation" and every social dork misses real posts.
  if (signalMode === "buying_signal") {
    const roleFromRaw =
      findRoleMatch(lower) ?? findRoleMatch(skillSeed) ?? findRoleMatch(extractCoreSkill(skillSeed));
    const detected = detectSkillMentions(trimmed);
    const primary =
      roleFromRaw?.key ||
      detected[0] ||
      fallbackSignalSkill(skillSeed) ||
      extractCoreSkill(skillSeed) ||
      trimmed.split(/\s+/).slice(0, 4).join(" ");
    // Always expand bare skills ("design") via ROLE_CATALOG — detected-only
    // lookup left relatedSkills=[design] and starved Reddit/forhire queries.
    const roleEntry =
      roleFromRaw ??
      findRoleMatch(primary) ??
      findRoleMatch(skillSeed) ??
      (detected[0] ? findRoleMatch(detected[0]) : null);
    const related = [
      ...detected.slice(0, 6),
      ...(roleEntry?.entry.relatedSkills ?? []),
      ...(roleEntry ? [roleEntry.key] : []),
    ].filter((v, i, a) => !!v && a.indexOf(v) === i && v.toLowerCase() !== primary.toLowerCase());
    return withMeta(
      {
        raw: trimmed,
        type: roleEntry ? "role" : "generic",
        coreSkill: primary,
        roleTitle: roleEntry?.entry.roleTitle || primary,
        relatedSkills: related.length ? related : [primary].filter(Boolean),
        targetCustomerDesc:
          roleEntry?.entry.targetCustomerDesc || `companies matching signal: ${trimmed}`,
      },
      location,
      "buyer_intent",
      null,
      signalMode,
      signalFamily,
    );
  }

  const coreSkill = extractCoreSkill(skillSeed) || skillSeed;
  const icpNoun = buildIcpNoun(coreSkill, trimmed);
  return withMeta(
    {
      raw: trimmed,
      type: "generic",
      coreSkill,
      roleTitle: directory && icpNoun ? icpNoun : `${coreSkill} specialist`,
      relatedSkills: [coreSkill],
      targetCustomerDesc: directory
        ? `${icpNoun || coreSkill} listings${location ? ` in ${location}` : ""}`
        : `people needing ${coreSkill} help`,
    },
    location,
    intentMode,
    icpNoun,
    signalMode,
    signalFamily,
  );
}

export function getSubredditBoostsForQuery(query: ClassifiedQuery): string[] {
  if (query.intentMode === "directory_smb") return [];
  const match =
    findRoleMatch(query.coreSkill.toLowerCase()) ?? findRoleMatch(query.raw.toLowerCase());
  const boosts = [...(match?.entry.subredditBoosts ?? [])];
  const loc = (query.location || "").toLowerCase();
  if (
    loc.includes("canada") ||
    loc.includes("toronto") ||
    loc.includes("vancouver") ||
    loc.includes("montreal")
  ) {
    for (const s of ["canada", "toronto", "vancouver", "montreal", "smallbusiness", "startups"]) {
      if (!boosts.some((b) => b.toLowerCase() === s)) boosts.push(s);
    }
  }
  return boosts;
}
