// Buyer-intent query expansion engine.
import {
  classifyQuery,
  getSubredditBoostsForQuery,
  type ClassifiedQuery,
  type QueryType,
} from "./query-classifier";
import { generateDorkQueries } from "./dork-engine";

export interface ExpandedQueries {
  raw: string;
  skill: string;
  role: string;
  queryType: QueryType;
  relatedSkills: string[];
  buyerIntentQueries: string[];
  buyerPhrases: string[];
  jobBoardQueries: string[];
  jobBoardTerms: string[];
  socialQueries: string[];
  redditBuyerQueries: string[];
  booleanWebQueries: string[];
  customerPhrases: string[];
  subreddits: string[];
  negativePhrases: string[];
  negativeSignals: string[];
}

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
];

const ROLE_MAP: Record<string, string> = {
  // ── Development ────────────────────────────────────────────────
  react: "React developer",
  "react developer": "React developer",
  "react dev": "React developer",
  next: "Next.js developer",
  nextjs: "Next.js developer",
  "next.js": "Next.js developer",
  vue: "Vue.js developer",
  angular: "Angular developer",
  svelte: "Svelte developer",
  frontend: "frontend developer",
  "front end": "frontend developer",
  "front-end": "frontend developer",
  backend: "backend developer",
  "back end": "backend developer",
  "back-end": "backend developer",
  fullstack: "full stack developer",
  "full stack": "full stack developer",
  "full-stack": "full stack developer",
  python: "Python developer",
  django: "Django developer",
  flask: "Flask developer",
  fastapi: "FastAPI developer",
  node: "Node.js developer",
  nodejs: "Node.js developer",
  express: "Node.js developer",
  ruby: "Ruby developer",
  rails: "Rails developer",
  ror: "Rails developer",
  go: "Go developer",
  golang: "Go developer",
  rust: "Rust developer",
  java: "Java developer",
  spring: "Spring developer",
  kotlin: "Kotlin developer",
  ".net": ".NET developer",
  dotnet: ".NET developer",
  "c#": "C# developer",
  csharp: "C# developer",
  php: "PHP developer",
  laravel: "Laravel developer",
  ios: "iOS developer",
  swift: "iOS developer",
  android: "Android developer",
  mobile: "mobile app developer",
  flutter: "Flutter developer",
  "react native": "React Native developer",
  devops: "DevOps engineer",
  sre: "Site Reliability engineer",
  platform: "platform engineer",
  blockchain: "blockchain developer",
  solidity: "Solidity developer",
  web3: "Web3 developer",
  wordpress: "WordPress developer",
  shopify: "Shopify developer",
  webflow: "Webflow developer",
  qa: "QA engineer",
  test: "QA engineer",
  automation: "QA automation engineer",
  // ── AI / Data ──────────────────────────────────────────────────
  ai: "AI engineer",
  "ai engineer": "AI engineer",
  ml: "machine learning engineer",
  "ml engineer": "machine learning engineer",
  "machine learning": "machine learning engineer",
  "data scientist": "data scientist",
  "data analyst": "data analyst",
  "data engineer": "data engineer",
  llm: "LLM engineer",
  rag: "RAG engineer",
  prompt: "prompt engineer",
  "prompt engineer": "prompt engineer",
  mlops: "MLOps engineer",
  // ── Design ─────────────────────────────────────────────────────
  ux: "UX designer",
  ui: "UI designer",
  "ui ux": "UI/UX designer",
  "ux ui": "UI/UX designer",
  "ux designer": "UX designer",
  "ui designer": "UI designer",
  "product designer": "product designer",
  "graphic design": "graphic designer",
  "graphic designer": "graphic designer",
  brand: "brand designer",
  "brand designer": "brand designer",
  logo: "logo designer",
  motion: "motion designer",
  "motion designer": "motion designer",
  illustrator: "illustrator",
  "3d": "3D artist",
  "3d artist": "3D artist",
  figma: "Figma designer",
  interior: "interior designer",
  // ── Marketing & Growth ─────────────────────────────────────────
  marketing: "marketing consultant",
  growth: "growth marketer",
  "growth marketer": "growth marketer",
  seo: "SEO specialist",
  ppc: "PPC specialist",
  "google ads": "Google Ads specialist",
  "facebook ads": "paid social specialist",
  "meta ads": "paid social specialist",
  email: "email marketer",
  "email marketing": "email marketer",
  "social media": "social media manager",
  community: "community manager",
  "brand strategy": "brand strategist",
  pr: "PR consultant",
  // ── Content ────────────────────────────────────────────────────
  copywriter: "copywriter",
  copywriting: "copywriter",
  "content writer": "content writer",
  content: "content writer",
  "technical writer": "technical writer",
  ghostwriter: "ghostwriter",
  "video editor": "video editor",
  "video editing": "video editor",
  podcast: "podcast editor",
  "podcast editor": "podcast editor",
  photographer: "photographer",
  photography: "photographer",
  voiceover: "voiceover artist",
  vo: "voiceover artist",
  // ── Business & Ops ─────────────────────────────────────────────
  va: "virtual assistant",
  "virtual assistant": "virtual assistant",
  "project manager": "project manager",
  pm: "project manager",
  "product manager": "product manager",
  operations: "operations manager",
  ops: "operations manager",
  recruiter: "recruiter",
  talent: "recruiter",
  sales: "sales rep",
  sdr: "SDR",
  bdr: "BDR",
  "customer success": "customer success manager",
  cs: "customer success manager",
  bookkeeper: "bookkeeper",
  accountant: "accountant",
  cfo: "fractional CFO",
  lawyer: "lawyer",
  legal: "lawyer",
  paralegal: "paralegal",
  hr: "HR consultant",
  "people ops": "HR consultant",
  // ── Trades & Local Services ────────────────────────────────────
  plumber: "plumber",
  electrician: "electrician",
  contractor: "general contractor",
  "real estate": "real estate agent",
  realtor: "real estate agent",
  tutor: "tutor",
  coach: "coach",
  therapist: "therapist",
  fitness: "fitness trainer",
  "personal trainer": "fitness trainer",
};

const SKILL_SUBS: Record<string, string[]> = {
  react: ["reactjs", "webdev", "javascript"],
  javascript: ["javascript", "webdev", "node"],
  typescript: ["typescript", "javascript", "webdev"],
  python: ["Python", "django", "flask"],
  node: ["node", "javascript", "webdev"],
  vue: ["vuejs", "webdev"],
  angular: ["angular", "webdev"],
  design: ["web_design", "graphic_design", "UI_Design"],
  ux: ["userexperience", "UI_Design", "web_design"],
  ui: ["UI_Design", "web_design"],
  marketing: ["marketing", "digital_marketing", "SEO"],
  seo: ["SEO", "bigseo", "digital_marketing"],
  copywrit: ["copywriting", "freelanceWriters", "HireaWriter"],
  content: ["freelanceWriters", "writing", "HireaWriter"],
  writer: ["HireaWriter", "freelanceWriters", "writing", "copywriting", "Blogging"],
  teacher: [
    "tutors",
    "Teachers",
    "HomeworkHelp",
    "learnprogramming",
    "GetStudying",
    "APStudents",
    "Sat",
    "Parenting",
  ],
  tutor: [
    "tutors",
    "HomeworkHelp",
    "learnprogramming",
    "GetStudying",
    "APStudents",
    "Sat",
    "tutor",
  ],
  investor: ["startups", "startup_funding", "VentureCapital", "AngelInvesting", "Entrepreneur"],
  video: ["VideoEditing", "editors"],
  photo: ["photography", "AskPhotography"],
  mobile: ["androiddev", "iOSProgramming"],
  ios: ["iOSProgramming", "swift"],
  android: ["androiddev", "kotlin"],
  flutter: ["FlutterDev"],
  devops: ["devops", "aws", "docker"],
  data: ["datascience", "MachineLearning"],
  ai: ["MachineLearning", "artificial", "OpenAI"],
  ml: ["MachineLearning", "learnmachinelearning"],
  llm: ["LocalLLaMA", "MachineLearning"],
  rust: ["rust"],
  go: ["golang"],
  solidity: ["ethdev", "solidity"],
  blockchain: ["ethdev", "CryptoCurrency"],
  wordpress: ["Wordpress", "ProWordPress"],
  shopify: ["shopify"],
  legal: ["legaltech", "Lawyertalk"],
  account: ["Accounting", "Bookkeeping"],
  assistant: ["virtualassistants"],
};

function extractCoreSkill(input: string): string {
  let s = input.toLowerCase();
  for (const f of FILLERS) {
    s = s.replace(new RegExp(`\\b${f}\\b`, "gi"), " ");
  }
  s = s.replace(/\s+/g, " ").trim();
  return s || input.toLowerCase().trim();
}

function extractRole(input: string): string {
  const n = input.toLowerCase().trim();
  if (ROLE_MAP[n]) return ROLE_MAP[n];
  for (const [k, v] of Object.entries(ROLE_MAP)) {
    if (n.includes(k)) return v;
  }
  // Generic fallback so non-developer queries still produce a sensible role.
  return `${input.trim()} specialist`;
}

function getSkillSubreddits(skill: string): string[] {
  for (const [k, subs] of Object.entries(SKILL_SUBS)) {
    if (skill.includes(k)) return subs;
  }
  return ["forhire", "Entrepreneur", "smallbusiness"];
}

function baseNegativeSignals(): string[] {
  return [
    "available for hire",
    "available for work",
    "open to work",
    "open for work",
    "for hire",
    "hire me",
    "i am a ",
    "i'm a ",
    "i am an ",
    "i'm an ",
    "i offer",
    "i provide",
    "i specialize",
    "i can help",
    "i build",
    "i will build",
    "my portfolio",
    "check out my",
    "my work",
    "my services",
    "my github",
    "my linkedin",
    "years of experience",
    "years experience",
    "yrs of experience",
    "yrs experience",
    "seeking role",
    "seeking position",
    "seeking opportunities",
    "seeking work",
    "seeking a job",
    "looking for a job",
    "looking for job",
    "job hunting",
    "job seeker",
    "looking for work",
    "looking for opportunities",
    "looking for a role",
    "looking for a position",
    "looking for my next",
    "looking for new opportunities",
    "open to opportunities",
    "i have built",
    "i've built",
    "i have worked",
    "i've worked",
    "let me know if you",
    "feel free to reach out",
    "tutorial",
    "how to",
    "learn ",
    "course",
    "documentation",
    "cheatsheet",
    "cheat sheet",
    "steps to",
    "become a",
    "how to become",
    "guide to",
    "career path",
    "career in",
    "wikipedia",
    "wiki/",
    "/wiki",
    "what is",
    "introduction to",
    "getting started",
    "boilerplate",
    "starter template",
    "just released",
    "new library",
    "open source project",
    " 2014",
    " 2015",
    " 2016",
    " 2017",
    " 2018",
    " 2019",
    " 2020",
    " 2021",
  ];
}

// The original hand-written boolean web queries. Kept as a fallback layer:
// their loose OR-groups (e.g. `"skill" ("hiring" OR "looking for")`) recover
// results in cases where the dork engine's stricter exact-phrase queries
// (`"skill needed"`) return nothing — a real recall tradeoff observed during
// verification. HN / Instagram / Upwork-Indeed scopes live only here.
export function handwrittenBooleanQueries(skill: string, role: string): string[] {
  return [
    `site:reddit.com "${skill}" ("looking for" OR "hiring" OR "need a") -"for hire" -"available"`,
    `site:linkedin.com/posts "${skill}" ("hiring" OR "looking for" OR "we need") -"open to work"`,
    `(site:twitter.com OR site:x.com) "${skill}" ("hiring" OR "looking for" OR "need a") -"open to work"`,
    `site:news.ycombinator.com "${skill}" ("hiring" OR "looking for" OR "need")`,
    `site:instagram.com "${skill}" ("hiring" OR "looking for" OR "collaboration") -"dm for collab"`,
    `site:facebook.com/groups "${skill}" ("hiring" OR "looking for" OR "need")`,
    `"${skill}" ("need a" OR "looking for" OR "hiring") ("budget" OR "paid" OR "contract") -site:github.com -site:stackoverflow.com`,
    `"${role}" (site:upwork.com OR site:wellfound.com OR site:indeed.com) "remote" "contract"`,
    `site:tiktok.com "${skill}" ("hiring" OR "looking for" OR "need a")`,
    `site:youtube.com "${skill}" ("hiring" OR "looking for" OR "need a" OR "freelancer")`,
    `site:chat.whatsapp.com ("${skill}" OR "${role}") (hiring OR jobs OR freelance)`,
    `(site:disboard.org OR site:top.gg/servers) "${skill}" (hiring OR jobs OR gigs)`,
    `"${skill}" ("need a website" OR "need a developer" OR "looking for a freelancer" OR "who can build")`,
    `("${skill}" OR "${role}") (inurl:about OR inurl:careers) ("hiring" OR "we're looking for") -site:linkedin.com`,
  ];
}

// Task 0.2 — replace the ad-hoc hand-written boolean queries with the
// systematic dork engine (Phase 0.1), while keeping the hand-written set as a
// recall fallback. Dork queries come first (platform-round-robin: reddit,
// linkedin, twitter/x, facebook groups, quora, indie forums), giving broader,
// deduplicated coverage. Consumers (searchWebBoolean, searchLinkedIn) still
// slice this list, so ordering matters — the dork engine already interleaves
// platforms so the first N span multiple sources.
export function buildBooleanWebQueries(
  skill: string,
  role: string,
  relatedSkills: string[],
): string[] {
  const primary = role || skill;
  const dork = generateDorkQueries({
    role: primary,
    relatedRoles: [skill, ...relatedSkills.slice(0, 3)].filter(
      (r) => r && r.toLowerCase() !== primary.toLowerCase(),
    ),
    platformScope: [
      "reddit",
      "linkedin_posts",
      "twitter_x",
      "facebook_groups",
      "quora",
      "indie_forums",
      // NOTE: fiverr_public intentionally excluded here — Fiverr's indexed
      // pages are seller gig listings (providers), not buyer requests, and
      // they polluted results in live testing. The dedicated Fiverr source
      // (startup-sources) still runs with its own buyer filtering.
      "instagram",
      "tiktok",
      "threads",
      "youtube",
      "company_pages",
      "discord_public",
      "whatsapp_public",
      "github_public",
    ],
    dateRange: "week",
    limit: 20,
  });
  // Interleave hand-written (loose OR-groups → high raw yield) with dork
  // (strict exact-phrase → complementary, net-new coverage esp. LinkedIn).
  // Verified: dork-only in the first slice loses volume; interleaving keeps
  // the high-yield loose queries AND adds the complementary dork ones inside
  // whatever N a consumer slices (searchWebBoolean uses 8).
  const hand = handwrittenBooleanQueries(skill, role);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (q: string) => {
    const k = q.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(q);
  };
  const maxLen = Math.max(hand.length, dork.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < hand.length) push(hand[i]); // yield first in each pair
    if (i < dork.length) push(dork[i]); // complementary coverage
  }
  return out;
}

function expandRoleSkillQuery(cq: ClassifiedQuery, negativeSignals: string[]): ExpandedQueries {
  const { raw, coreSkill: skill, roleTitle: role, relatedSkills, type: queryType } = cq;
  const skillTerms = [skill, ...relatedSkills.slice(0, 3)].filter(Boolean);
  const skillLower = (skill || "").toLowerCase();

  // Investor: find startups raising — never "hiring an investor".
  if (/investor|fundraising|venture|angel\b/i.test(skillLower) || /investor/i.test(role)) {
    const raisePhrases = [
      `"looking for investors"`,
      `"raising" "seed"`,
      `"raising" "pre-seed"`,
      `"raising a round"`,
      `"seeking investment"`,
      `"raising capital"`,
      `"open to investors"`,
      `"raising" "series a"`,
      `"looking to raise"`,
      `"fundraising"`,
      ...relatedSkills.slice(0, 4).map((s) => `"${s}"`),
    ];
    return {
      raw,
      skill: "fundraising",
      role: "Investor",
      queryType,
      relatedSkills: relatedSkills.length
        ? relatedSkills
        : ["raising", "seed round", "looking for investors"],
      buyerIntentQueries: raisePhrases,
      buyerPhrases: raisePhrases,
      jobBoardQueries: ["raising", "fundraising", "seed"],
      jobBoardTerms: ["raising", "fundraising", "seed"],
      socialQueries: raisePhrases.slice(0, 5),
      redditBuyerQueries: [
        "looking for investors",
        "raising seed",
        "raising capital",
        "seeking investment",
        "fundraising",
      ],
      booleanWebQueries: [
        `("looking for investors" OR "raising capital" OR "raising a seed" OR "seeking investment") (startup OR founder)`,
        `site:reddit.com ("looking for investors" OR "raising" OR "fundraising")`,
      ],
      customerPhrases: raisePhrases,
      subreddits: [
        "startups",
        "startup_funding",
        "VentureCapital",
        "AngelInvesting",
        "Entrepreneur",
        "SaaS",
        "forhire",
      ],
      negativePhrases: [
        ...negativeSignals,
        "hire me",
        "my portfolio",
        "angel investor looking for",
        "i invest in",
      ],
      negativeSignals: [
        ...negativeSignals,
        "hire me",
        "my portfolio",
        "angel investor looking for",
        "i invest in",
      ],
    };
  }

  // Teacher/tutor: find students needing help — not "hiring a teacher" jobs only.
  if (/tutor|teacher|tutoring|lessons|instructor/i.test(`${skillLower} ${role}`)) {
    const subjects = [
      "math",
      "mathematics",
      "algebra",
      "calculus",
      "english",
      "writing",
      "physics",
      "chemistry",
      "biology",
      "SAT",
      "ACT",
      "ESL",
      "Spanish",
      "French",
      "coding",
      "programming",
      "piano",
      "guitar",
    ];
    const tutorPhrases = [
      `"need a tutor"`,
      `"looking for a tutor"`,
      `"need tutoring"`,
      `"homework help"`,
      `"looking for lessons"`,
      `"private tutor"`,
      `"online tutor"`,
      `"struggling with" "homework"`,
      `"need a teacher"`,
      `"tutoring needed"`,
      `"tutor needed"`,
      `"looking for tutoring"`,
      ...subjects.flatMap((s) => [
        `"need a ${s} tutor"`,
        `"looking for a ${s} tutor"`,
        `"${s} tutor needed"`,
        `"help with ${s}"`,
      ]),
      ...relatedSkills.slice(0, 3).map((s) => `"need" "${s}"`),
    ];
    const buyerPhrasesTutor = [...tutorPhrases];
    for (const term of skillTerms) {
      buyerPhrasesTutor.push(`"looking for" "${term}"`, `"need a" "${term}"`);
    }
    return {
      raw,
      skill: "tutor",
      role: "tutor",
      queryType,
      relatedSkills: [
        "tutor",
        "tutoring",
        "homework help",
        "private tutor",
        "online tutor",
        ...subjects.slice(0, 10),
        ...relatedSkills,
      ],
      buyerIntentQueries: buyerPhrasesTutor,
      buyerPhrases: buyerPhrasesTutor,
      jobBoardQueries: ["tutor", "tutoring", "homework", "math tutor", "english tutor", skill],
      jobBoardTerms: ["tutor", "tutoring", "homework", "math tutor", "english tutor", skill],
      socialQueries: tutorPhrases.slice(0, 12),
      redditBuyerQueries: [
        "need a tutor",
        "looking for a tutor",
        "homework help",
        "need tutoring",
        "looking for lessons",
        "tutor needed",
        "math tutor",
        "english tutor",
        "SAT tutor",
        "online tutor",
      ],
      booleanWebQueries: [
        `("need a tutor" OR "looking for a tutor" OR "homework help" OR "need tutoring" OR "tutor needed")`,
        `site:reddit.com ("tutor" OR "tutoring" OR "homework help") ("need" OR "looking for" OR struggling)`,
        `("math tutor" OR "english tutor" OR "SAT tutor" OR "online tutor") ("need" OR "looking for" OR wanted)`,
        `site:facebook.com ("need a tutor" OR "looking for a tutor" OR "homework help")`,
      ],
      customerPhrases: tutorPhrases,
      subreddits: [
        "tutors",
        "HomeworkHelp",
        "learnprogramming",
        "Teachers",
        "tutor",
        "GetStudying",
        "APStudents",
        "Sat",
        "ACT",
        "college",
        "ApplyingToCollege",
        "Parenting",
        "forhire",
        "slavelabour",
        ...getSkillSubreddits(skill),
      ],
      negativePhrases: [
        ...negativeSignals.filter(
          (s) =>
            !/^(tutorial|how to|learn |course|documentation|cheatsheet|cheat sheet|steps to|become a|guide to)$/i.test(
              s.trim(),
            ),
        ),
        "hire me as a tutor",
        "available to tutor",
        "I am a tutor",
      ],
      negativeSignals: [
        ...negativeSignals.filter(
          (s) =>
            !/^(tutorial|how to|learn |course|documentation|cheatsheet|cheat sheet|steps to|become a|guide to)$/i.test(
              s.trim(),
            ),
        ),
        "hire me as a tutor",
        "available to tutor",
        "I am a tutor",
      ],
    };
  }

  const buyerPhrases: string[] = [];
  for (const term of skillTerms) {
    buyerPhrases.push(
      `"looking for" "${term}"`,
      `"need a" "${term}"`,
      `"need an" "${term}"`,
      `"hiring" "${term}"`,
      `"we need" "${term}"`,
      `"seeking" "${term}"`,
      `"want to hire" "${term}"`,
      `"${term}" "needed"`,
      `"${term}" "wanted"`,
      `"${term}" "freelancer"`,
      `"${term}" "contractor"`,
      `"${term}" help`,
    );
  }
  if (role !== skill) {
    buyerPhrases.push(
      `"looking for" "${role}"`,
      `"hiring" "${role}"`,
      `"${role}" position`,
      `"${role}" role`,
      `"${role}" needed`,
    );
  }
  buyerPhrases.push(
    `"can anyone recommend" "${skill}"`,
    `"anyone know a good" "${skill}"`,
    `"recommend a" "${skill}"`,
    `"our startup needs" "${skill}"`,
    `"our company needs" "${skill}"`,
    `"our team needs" "${skill}"`,
    `"building" "need" "${skill}"`,
    `"budget" "${skill}"`,
    `"paid" "${skill}" "project"`,
    `"i need" "${skill}"`,
    `"i want" "${skill}"`,
    `"willing to pay" "${skill}"`,
    `"who can help" "${skill}"`,
  );

  const redditBuyerQueries = [
    skill,
    `"${skill}" hiring`,
    `"${skill}" needed`,
    `hiring ${skill}`,
    `need ${skill}`,
    `looking for ${skill}`,
    `i need ${skill}`,
    `willing to pay ${skill}`,
    ...relatedSkills.slice(0, 2).map((s) => `hiring ${s}`),
  ];

  const engFamily =
    /\b(developer|engineer|devops|sre|programmer|fullstack|full[- ]?stack|frontend|backend|react|node|python|java|golang|rust|ios|android)\b/i.test(
      `${skill} ${role}`,
    );
  const jobBoardTerms = [
    role,
    skill,
    ...(engFamily ? [`${skill} developer`, `${skill} engineer`] : []),
    ...relatedSkills.slice(0, 3),
  ].filter((v, i, arr) => arr.indexOf(v) === i && !!v);

  const booleanWebQueries = buildBooleanWebQueries(skill, role, relatedSkills);

  const socialQueries = [
    `("hiring" OR "looking for" OR "need" OR "seeking") "${skill}"`,
    `"${role}" ("available" OR "wanted" OR "needed")`,
    `"${skill}" freelancer ("budget" OR "paid" OR "$")`,
  ];

  const subreddits = [
    "forhire",
    "hiring",
    "freelance",
    "Entrepreneur",
    "startups",
    "smallbusiness",
    ...getSkillSubreddits(skill),
  ];

  return {
    raw,
    skill,
    role,
    queryType,
    relatedSkills,
    buyerIntentQueries: buyerPhrases,
    buyerPhrases,
    jobBoardQueries: jobBoardTerms,
    jobBoardTerms,
    socialQueries,
    redditBuyerQueries,
    booleanWebQueries,
    customerPhrases: [],
    subreddits,
    negativePhrases: negativeSignals,
    negativeSignals,
  };
}

/** Detect "customers/clients for my X" — find people who need that service. */
function isCustomerHuntQuery(raw: string): boolean {
  return (
    /\b(customers?|clients?|users?|leads?)\s+for\s+(my|our|a)\b/i.test(raw) ||
    /\bneed\s+customers?\b/i.test(raw) ||
    /\bfind\s+(customers?|clients?)\b/i.test(raw) ||
    /\b(i'?m|i am|we'?re)\s+selling\b/i.test(raw) ||
    /\b(selling|building)\s+(a|an|my|our)\s+(product|app|tool|saas|platform)\b/i.test(raw)
  );
}

function productDemandTerms(raw: string, related: string[]): string[] {
  const lower = raw.toLowerCase();
  // Prefer multi-word capability phrases first (from pitch keyword extract).
  const ranked = [...related.filter((r) => /\s/.test(r)), ...related.filter((r) => !/\s/.test(r))];
  const terms = new Set<string>();
  for (const r of ranked.slice(0, 10)) {
    const t = r.toLowerCase().trim();
    if (t.length >= 3 && !/^(i'm selling|selling a|building a)\b/.test(t)) terms.add(t);
  }

  // Strip hunt wrapper → leftover product noun (short pitches only)
  if (terms.size < 3) {
    const product = lower
      .replace(/\b(i'?m|i am|we'?re|we are)\s+selling\b/gi, " ")
      .replace(/\b(i need|need|find|looking for)\s+/gi, " ")
      .replace(/\b(customers?|clients?|users?|leads?)\s+for\s+(my|our|a)\s+/gi, " ")
      .replace(/\b(a|an|my|our)\s+(product|app|tool|saas|platform|software|service)\b/gi, " ")
      .replace(/\b(that|which)\s+(does|helps?|lets?|allows?|enables?)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (product.length >= 3 && product.length <= 48) terms.add(product);
  }

  if (/invoice|billing|bookkeep/i.test(lower) || related.some((r) => /invoice|billing/i.test(r))) {
    [
      "invoicing",
      "invoice software",
      "freelance invoicing",
      "billing tool",
      "invoices",
      "bookkeeping",
    ].forEach((t) => terms.add(t));
  }
  if (
    /client|freelance|lead gen|find clients/i.test(lower) ||
    related.some((r) => /client|freelance/i.test(r))
  ) {
    [
      "clients",
      "get clients",
      "more clients",
      "finding clients",
      "client acquisition",
      "freelance clients",
      "lead generation",
      "leads for freelancers",
    ].forEach((t) => terms.add(t));
  }
  if (/chatbot|chat bot|ai agent|support bot/i.test(lower)) {
    [
      "chatbot",
      "chat bot",
      "customer support",
      "ai agent",
      "support automation",
      "helpdesk",
    ].forEach((t) => terms.add(t));
  }
  if (/marketing/i.test(lower)) {
    ["marketing", "growth", "seo", "ads", "lead gen"].forEach((t) => terms.add(t));
  }
  if (/web\s*dev|website|web design/i.test(lower)) {
    ["website", "web developer", "web design", "landing page", "wordpress"].forEach((t) =>
      terms.add(t),
    );
  }
  return Array.from(terms).filter(Boolean).slice(0, 16);
}

function expandProductQuery(cq: ClassifiedQuery, negativeSignals: string[]): ExpandedQueries {
  const { raw, coreSkill: skill, roleTitle: role, relatedSkills, type: queryType } = cq;
  const hunt = isCustomerHuntQuery(raw);
  const demandTerms = productDemandTerms(raw, relatedSkills);
  const productNegatives = [
    ...negativeSignals,
    ...(hunt
      ? ["hire me", "my portfolio", "available for hire", "open to work"]
      : [
          "i built",
          "i made",
          "i created",
          "launched my",
          "my app",
          "show hn",
          "product hunt",
          "built with",
          "source code",
        ]),
  ];

  // Prefer multi-word capability phrases; never fan out bare lead/services/generation.
  const safeDemandEarly = demandTerms.filter(
    (t) => t.length >= 4 && !/^(lead|leads|generation|service|services)$/i.test(t),
  );
  const fanTerms = safeDemandEarly.length
    ? safeDemandEarly
    : [/\blead\s*gen/i.test(skill) ? "lead generation" : skill].filter(Boolean);

  // Customer-hunt: find people EXPRESSING need for the service/product
  const customerPhrases = hunt
    ? [
        ...fanTerms.flatMap((t) => [
          `"looking for" "${t}"`,
          `"need a" "${t}"`,
          `"need an" "${t}"`,
          `"anyone know" "${t}"`,
          `"recommend a" "${t}"`,
          `"best" "${t}"`,
          `"alternative to" "${t}"`,
          `"struggling with" "${t}"`,
          `"need help with" "${t}"`,
        ]),
        `"need help with" ${fanTerms[0] || skill}`,
        `"struggling with" ${fanTerms[0] || skill}`,
        `"what do you use for" ${fanTerms[0] || skill}`,
        `"any good" ${fanTerms[0] || skill}`,
        `"recommendations for" ${fanTerms[0] || skill}`,
      ]
    : [
        `"looking for" "${raw}"`,
        `"need a" "${raw}"`,
        `"recommend" "${raw}"`,
        `"best" "${raw}"`,
        `"alternative to" "${raw}"`,
        `"${raw}" "recommendations"`,
        `"${raw}" "any good"`,
        `"${raw}" "suggestions"`,
        `"anyone use" "${raw}"`,
        ...relatedSkills
          .filter((s) => !/^(lead|generation|services)$/i.test(s))
          .map((s) => `"looking for" "${s}"`),
        ...relatedSkills
          .filter((s) => !/^(lead|generation|services)$/i.test(s))
          .map((s) => `"best" "${s}"`),
      ];

  const booleanWebQueries = hunt
    ? [
        `(${fanTerms
          .slice(0, 5)
          .map((t) => `"${t}"`)
          .join(
            " OR ",
          )}) ("looking for" OR "need a" OR "recommend" OR "struggling with" OR "best tool" OR alternative)`,
        `site:reddit.com (${fanTerms
          .slice(0, 4)
          .map((t) => `"${t}"`)
          .join(" OR ")}) ("looking for" OR "need" OR recommend OR struggling)`,
        `site:softwarerecs.stackexchange.com (${fanTerms
          .slice(0, 3)
          .map((t) => `"${t}"`)
          .join(" OR ")})`,
        `(${fanTerms
          .slice(0, 3)
          .map((t) => `"${t}"`)
          .join(" OR ")}) site:indiehackers.com`,
      ]
    : [
        `site:reddit.com "${raw}" ("recommend" OR "looking for" OR "best" OR "suggestions")`,
        `"${raw}" ("recommendation" OR "alternative" OR "best tool") -"i built" -"launched"`,
      ];

  // Prefer a short searchable noun for marketplaces — never bare ambiguous
  // tokens like "lead" / "services" / "generation".
  const marketplaceTerm =
    fanTerms.find((t) => /\s/.test(t) && t.length >= 6) ||
    fanTerms.find(
      (t) =>
        !/\s/.test(t) &&
        t.length >= 5 &&
        !/^(lead|leads|generation|service|services|client|clients)$/i.test(t),
    ) ||
    fanTerms.find((t) => /\blead\s*gen/i.test(t)) ||
    (/\blead\s*gen/i.test(skill) ? "lead generation" : null) ||
    fanTerms[0] ||
    skill;

  const demandForFanout = fanTerms.length ? fanTerms : [marketplaceTerm].filter(Boolean);

  return {
    raw,
    skill: marketplaceTerm,
    role: marketplaceTerm,
    queryType,
    relatedSkills: demandForFanout.length
      ? demandForFanout
      : relatedSkills.filter((r) => !/^(lead|generation|services)$/i.test(r)),
    buyerIntentQueries: customerPhrases.slice(0, 18),
    buyerPhrases: customerPhrases.slice(0, 18),
    jobBoardQueries: hunt ? demandForFanout.slice(0, 8) : [raw, ...relatedSkills.slice(0, 2)],
    jobBoardTerms: hunt ? demandForFanout.slice(0, 8) : [raw, ...relatedSkills.slice(0, 2)],
    socialQueries: customerPhrases.slice(0, 10),
    redditBuyerQueries: hunt
      ? demandForFanout
          .slice(0, 6)
          .flatMap((t) => [
            `looking for ${t}`,
            `need ${t}`,
            `recommend ${t}`,
            `best ${t}`,
            `struggling with ${t}`,
          ])
      : [
          `${marketplaceTerm} recommendation`,
          `best ${marketplaceTerm}`,
          `looking for ${marketplaceTerm}`,
          `need ${marketplaceTerm}`,
          `${marketplaceTerm} alternative`,
        ],
    booleanWebQueries,
    customerPhrases,
    subreddits: [
      "Entrepreneur",
      "startups",
      "smallbusiness",
      "SaaS",
      "SideProject",
      "freelance",
      "forhire",
      "hiring",
      "Accounting",
      "bookkeeping",
      "solo",
      "Flipping",
      "sweatystartup",
      "IndieBiz",
    ],
    negativePhrases: productNegatives,
    negativeSignals: productNegatives,
  };
}

export function expandFromClassified(cq: ClassifiedQuery): ExpandedQueries {
  const negativeSignals = baseNegativeSignals();
  if (cq.intentMode === "directory_smb") return expandDirectoryQuery(cq, negativeSignals);
  if (cq.type === "product") return expandProductQuery(cq, negativeSignals);
  // "need a writer" is buying_signal+role — use the craft expander so synonyms /
  // investor / tutor templates apply. Plain Coldreach signals stay on the
  // buying-signal expander.
  if (cq.signalMode === "buying_signal" && cq.type === "role") {
    return expandRoleSkillQuery(cq, negativeSignals);
  }
  if (cq.signalMode === "buying_signal") return expandBuyingSignalQuery(cq, negativeSignals);
  return expandRoleSkillQuery(cq, negativeSignals);
}

/**
 * Inject clarifier / classified geography into dorks so US/UK/EU selections
 * actually change what sources fetch — not only soft post-filters.
 */
export function injectLocationBias(
  qx: ExpandedQueries,
  location: string | null | undefined,
): ExpandedQueries {
  const loc = (location || "").trim();
  if (!loc || /^(global|worldwide|anywhere|remote)$/i.test(loc)) return qx;

  const withLoc = (q: string) => {
    if (new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q)) return q;
    return `${q} "${loc}"`;
  };
  const biasFirst = (qs: string[], n = 5) => qs.map((q, i) => (i < n ? withLoc(q) : q));

  const geoWeb = [
    `"${qx.skill}" ("need a" OR "looking for" OR hiring OR freelancer) "${loc}"`,
    `("${qx.skill}") "${loc}" ("who can" OR "willing to pay" OR budget)`,
  ];

  return {
    ...qx,
    booleanWebQueries: [...geoWeb, ...biasFirst(qx.booleanWebQueries, 6)].slice(0, 16),
    socialQueries: biasFirst(qx.socialQueries, 5),
    redditBuyerQueries: biasFirst(qx.redditBuyerQueries, 6),
    buyerIntentQueries: biasFirst(qx.buyerIntentQueries, 5),
    jobBoardQueries: biasFirst(qx.jobBoardQueries, 4),
  };
}

/** Coldreach-style plain-English buying signal → source-specific query sets. */
function expandBuyingSignalQuery(cq: ClassifiedQuery, negativeSignals: string[]): ExpandedQueries {
  const signal = cq.raw.trim();
  const family = cq.signalFamily;
  const skill = cq.coreSkill || signal.split(/\s+/).slice(0, 3).join(" ");
  // Short searchable role ("Next.js developer") — job/social APIs choke on the
  // raw sentence, so it must never be used as a search term there.
  const roleTerm = extractRole(skill);

  const phrases = [signal, `"${signal}"`];
  let jobBoardQueries: string[] = [];
  let booleanWebQueries: string[] = [];
  let socialQueries: string[] = [signal];
  let redditBuyerQueries: string[] = [];
  let buyerIntentQueries: string[] = [signal];

  switch (family) {
    case "job_opening":
    case "job_description":
      jobBoardQueries = [skill, roleTerm, ...cq.relatedSkills.slice(0, 2)]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);
      booleanWebQueries = [
        `(hiring OR "we're hiring" OR "looking for") "${skill}"`,
        `"${roleTerm}" (hiring OR "open role" OR "join our team")`,
        `"${signal}" (hiring OR careers OR jobs)`,
      ];
      socialQueries = [`hiring ${skill}`, `looking for ${roleTerm}`, `need a ${skill}`];
      redditBuyerQueries = [`hiring ${skill}`, `"looking for" ${skill}`, `need ${skill}`, skill];
      break;
    case "news":
      booleanWebQueries = [signal, `"${skill}" (funding OR breach OR acquired OR announced)`];
      buyerIntentQueries = [signal, `${skill} funding`, `${skill} data breach`];
      break;
    case "website":
      booleanWebQueries = [
        signal,
        `"SOC 2" OR "SOC2" ${skill}`,
        `site:.com "${signal.split(/\s+/).slice(0, 6).join(" ")}"`,
      ];
      break;
    case "employees":
      socialQueries = [signal, `hired ${skill}`, `onboarded ${skill}`];
      booleanWebQueries = [`"${signal}"`, `LinkedIn hired ${skill}`];
      break;
    case "sec_10k":
      booleanWebQueries = [`site:sec.gov ${signal}`, `site:sec.gov 10-K ${skill}`, signal];
      break;
    case "linkedin_company":
      socialQueries = [signal, `${skill} conference LinkedIn`];
      booleanWebQueries = [`site:linkedin.com/posts ${skill}`, signal];
      break;
    default: {
      // "need a design" / "looking for a developer" — demand hunt, not job boards.
      const related = (cq.relatedSkills || []).filter(Boolean).slice(0, 5);
      const craftTerms = [skill, roleTerm, ...related].filter(
        (v, i, a) => !!v && a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
      );
      buyerIntentQueries = craftTerms
        .flatMap((t) => [`need a ${t}`, `looking for ${t}`, `hiring ${t}`, `who can ${t}`])
        .slice(0, 12);
      socialQueries = buyerIntentQueries.slice(0, 6);
      redditBuyerQueries = [
        ...craftTerms.flatMap((t) => [
          `need a ${t}`,
          `looking for ${t}`,
          `hiring ${t}`,
          `[Hiring] ${t}`,
        ]),
        signal,
      ].slice(0, 14);
      booleanWebQueries = [
        `("${craftTerms.slice(0, 3).join('" OR "')}") ("need a" OR "looking for" OR "who can" OR hiring OR freelancer)`,
        `site:reddit.com/r/forhire ("${craftTerms.slice(0, 3).join('" OR "')}")`,
        `site:reddit.com ("need a" OR "looking for") ("${craftTerms.slice(0, 3).join('" OR "')}")`,
      ];
      jobBoardQueries = craftTerms.slice(0, 4);
      break;
    }
  }

  try {
    const dorks = generateDorkQueries({
      role: skill,
      relatedRoles: cq.relatedSkills,
      limit: 6,
      dateRange: "month",
    });
    booleanWebQueries = [...booleanWebQueries, ...dorks.slice(0, 4)];
  } catch {
    /* optional */
  }

  const roleSubs = getSubredditBoostsForQuery(cq);
  const demandSubs = [
    "forhire",
    "hiring",
    "slavelabour",
    "HireaWriter",
    "design_critiques",
    ...roleSubs,
    "startups",
    "Entrepreneur",
    "smallbusiness",
    "SaaS",
  ].filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);

  return {
    raw: cq.raw,
    skill,
    // Searchable role, not the raw sentence — LinkedIn jobs, Bluesky, etc.
    // use qx.role directly as a keyword query.
    role: roleTerm,
    queryType: cq.type,
    relatedSkills: cq.relatedSkills,
    buyerIntentQueries,
    buyerPhrases: phrases.length > 2 ? phrases : buyerIntentQueries.slice(0, 8),
    jobBoardQueries,
    jobBoardTerms: jobBoardQueries,
    socialQueries,
    redditBuyerQueries,
    booleanWebQueries,
    customerPhrases: phrases,
    subreddits:
      family === "news"
        ? ["technology", "startups", "cybersecurity"]
        : family === "job_opening" || family === "job_description"
          ? ["forhire", "hiring", "jobs", ...roleSubs].slice(0, 12)
          : demandSubs.slice(0, 14),
    negativePhrases: negativeSignals,
    negativeSignals,
  };
}

/** Directory / SMB ICP — find agencies/companies in a place, not "hire a marketer". */
function expandDirectoryQuery(cq: ClassifiedQuery, negativeSignals: string[]): ExpandedQueries {
  const skill = cq.coreSkill;
  const icp = cq.icpNoun || `${skill} agency`;
  const loc = cq.location;
  const locSuffix = loc ? ` "${loc}"` : "";

  const phrases = [
    `"${icp}"${locSuffix}`,
    `"${skill} agency"${locSuffix}`,
    `"${skill} agencies"${locSuffix}`,
    `"digital ${skill} agency"${locSuffix}`,
    `"advertising agency"${locSuffix}`,
    `"${skill} firm"${locSuffix}`,
  ];

  const booleanWebQueries = [
    loc
      ? `("${icp}" OR "${skill} agency" OR "${skill} agencies") ("${loc}" OR site:.in)`
      : `"${icp}" OR "${skill} agency"`,
    loc && loc.toLowerCase() === "india"
      ? `site:.in ("${skill} agency" OR "digital marketing agency")`
      : `"${skill} agency"${locSuffix}`,
  ];

  return {
    raw: cq.raw,
    skill,
    role: icp,
    queryType: cq.type,
    relatedSkills: cq.relatedSkills,
    buyerIntentQueries: phrases,
    buyerPhrases: phrases,
    jobBoardQueries: [],
    jobBoardTerms: [],
    socialQueries: phrases.slice(0, 3),
    redditBuyerQueries: [],
    booleanWebQueries,
    customerPhrases: phrases,
    subreddits: [],
    negativePhrases: [
      ...negativeSignals,
      "looking for advice",
      "taking a break",
      "recently started a role",
      "my store",
      "chick-fil-a",
      "chickfila",
    ],
    negativeSignals: [
      ...negativeSignals,
      "looking for advice",
      "taking a break",
      "recently started a role",
    ],
  };
}

export function expandQuery(rawInput: string): ExpandedQueries {
  return expandFromClassified(classifyQuery(rawInput));
}

// =====================================================================
// Skill relevance — every lead must mention the requested skill or a
// close synonym. Without this, generic "hiring" posts (legal, sales,
// ops, etc.) pollute searches for technical roles.
// =====================================================================
const SKILL_SYNONYMS: Record<string, string[]> = {
  react: [
    "react",
    "react.js",
    "reactjs",
    "next.js",
    "nextjs",
    "frontend",
    "front-end",
    "javascript",
    "typescript",
    "jsx",
    "tsx",
  ],
  next: ["next.js", "nextjs", "react", "frontend"],
  vue: ["vue", "vue.js", "vuejs", "nuxt", "frontend"],
  angular: ["angular", "frontend"],
  svelte: ["svelte", "sveltekit", "frontend"],
  frontend: [
    "frontend",
    "front-end",
    "react",
    "vue",
    "angular",
    "svelte",
    "javascript",
    "typescript",
    "css",
    "html",
  ],
  backend: [
    "backend",
    "back-end",
    "api",
    "server",
    "node",
    "python",
    "go",
    "java",
    "rails",
    "django",
  ],
  fullstack: ["fullstack", "full stack", "full-stack", "frontend", "backend"],
  python: ["python", "django", "flask", "fastapi", "pandas", "pytorch"],
  django: ["django", "python"],
  node: ["node", "node.js", "nodejs", "express", "nestjs", "javascript", "typescript"],
  ruby: ["ruby", "rails", "ror"],
  rails: ["rails", "ruby"],
  golang: ["golang", "go developer", "go engineer"],
  rust: ["rust"],
  java: ["java", "spring", "kotlin"],
  ".net": [".net", "dotnet", "c#", "csharp"],
  php: ["php", "laravel", "symfony", "wordpress"],
  ios: ["ios", "swift", "swiftui", "objective-c", "mobile"],
  android: ["android", "kotlin", "java", "mobile"],
  flutter: ["flutter", "dart", "mobile"],
  "react native": ["react native", "react", "mobile"],
  devops: ["devops", "sre", "kubernetes", "k8s", "docker", "aws", "gcp", "terraform", "ci/cd"],
  blockchain: ["blockchain", "web3", "solidity", "ethereum", "evm", "smart contract"],
  solidity: ["solidity", "ethereum", "evm", "smart contract", "web3"],
  wordpress: ["wordpress", "wp", "woocommerce", "php"],
  shopify: ["shopify", "liquid", "e-commerce", "ecommerce"],
  webflow: ["webflow"],
  ai: [
    "ai",
    "artificial intelligence",
    "ml",
    "machine learning",
    "llm",
    "openai",
    "anthropic",
    "gpt",
    "rag",
  ],
  ml: ["ml", "machine learning", "ai", "pytorch", "tensorflow"],
  llm: ["llm", "openai", "anthropic", "gpt", "claude", "rag", "ai"],
  data: ["data", "analytics", "sql", "etl", "warehouse", "bi", "tableau", "looker"],
  design: [
    "web design",
    "web designer",
    "ui",
    "ux",
    "ui/ux",
    "figma",
    "graphic design",
    "graphic designer",
    "product design",
    "logo",
    "branding",
    "landing page",
    "visual design",
    "website design",
    "designer",
  ],
  designer: [
    "web designer",
    "ui designer",
    "ux designer",
    "graphic designer",
    "product designer",
    "figma",
    "logo designer",
  ],
  ux: ["ux", "user experience", "ui", "product design", "figma"],
  ui: ["ui", "user interface", "ux", "figma"],
  graphic: ["graphic", "branding", "logo", "illustrator", "photoshop"],
  motion: ["motion", "animation", "after effects", "ae"],
  seo: ["seo", "search engine", "google ranking", "backlinks", "serp"],
  ppc: ["ppc", "google ads", "adwords", "paid search"],
  marketing: [
    "marketing",
    "growth",
    "ads",
    "seo",
    "ppc",
    "email",
    "social",
    "growth marketing",
    "go to market",
    "gtm",
  ],
  growth: ["growth", "marketing", "growth marketing", "acquisition", "funnel", "gtm"],
  chatbot: [
    "chatbot",
    "chat bot",
    "ai agent",
    "customer support",
    "support bot",
    "helpdesk",
    "conversational ai",
  ],
  "web develop": [
    "web developer",
    "web development",
    "website",
    "web design",
    "landing page",
    "frontend",
    "front end",
    "front-end",
    "fullstack",
    "full stack",
    "full-stack",
    "wordpress",
    "webflow",
  ],
  copywriter: ["copywriter", "copywriting", "copy", "content writer", "writer", "writing"],
  content: ["content writer", "copywriter", "blog", "article", "ghostwriter", "writer", "writing"],
  writer: [
    "writer",
    "writing",
    "copywriter",
    "copywriting",
    "content writer",
    "content writing",
    "ghostwriter",
    "technical writer",
    "blog",
    "article",
    "SEO writing",
  ],
  teacher: ["teacher", "tutor", "tutoring", "lessons", "instructor", "homework help", "coaching"],
  tutor: ["tutor", "tutoring", "teacher", "lessons", "homework help", "online tutor", "instructor"],
  investor: [
    "investor",
    "raising",
    "fundraising",
    "seed round",
    "looking for investors",
    "raising capital",
    "pre-seed",
    "angel",
    "newly founded",
    "startup",
    "seeking investment",
  ],
  fundraising: [
    "fundraising",
    "raising",
    "looking for investors",
    "raising capital",
    "seed",
    "pre-seed",
    "seeking investment",
    "newly founded",
    "startup",
    "founder",
  ],
  video: ["video editor", "video editing", "premiere", "final cut", "davinci"],
  photo: ["photographer", "photography", "photo"],
  va: ["virtual assistant", "va ", "executive assistant", "admin support"],
  assistant: ["virtual assistant", "assistant", "admin"],
  bookkeeper: ["bookkeeper", "bookkeeping", "accounting", "quickbooks", "xero"],
  accountant: ["accountant", "accounting", "cpa", "bookkeeping"],
  lawyer: ["lawyer", "attorney", "legal counsel", "paralegal"],
  plumber: ["plumber", "plumbing"],
  electrician: ["electrician", "electrical"],
  contractor: ["contractor", "general contractor", "remodel", "construction"],
  coach: ["coach", "coaching", "mentor"],
  sales: [
    "sales",
    "sales rep",
    "salesperson",
    "salesman",
    "saleswoman",
    "sdr",
    "bdr",
    "account executive",
    "closer",
    "outbound",
    "inbound",
    "pipeline",
    "crm",
  ],
};

// Bare generic words that must NEVER count as skill evidence.
const GENERIC_WORDS = new Set([
  "development",
  "developer",
  "developers",
  "engineering",
  "engineer",
  "engineers",
  "dev",
  "web",
  "app",
  "apps",
  "tech",
  "software",
  "data",
  "cloud",
  "management",
  "manager",
  "science",
  "analyst",
  "design",
  "help",
  "admin",
  "email",
  "social",
  "content",
  "ads",
  "ai",
  "server",
  "api",
  // Ambiguous splits from multi-word crafts — "lead generation" must NOT
  // admit "Team Lead" / "AI generation" / "notary services".
  "lead",
  "leads",
  "generation",
  "service",
  "services",
  "client",
  "clients",
  "specialist",
  "specialists",
  "system",
  "systems",
  "solution",
  "solutions",
]);

/** Tokens that are too ambiguous to use alone in product/Freelancer bags. */
export function isAmbiguousSkillToken(token: string): boolean {
  const t = (token || "").toLowerCase().trim();
  return GENERIC_WORDS.has(t) || /^(lead|leads|generation|service|services)$/i.test(t);
}

export function getSkillSynonyms(skill: string): string[] {
  const s = (skill || "").toLowerCase().trim();
  if (!s) return [];
  const tokens = new Set<string>([s]);
  // Never add bare generic tokens ("web", "development", "lead") — they match everything.
  for (const w of s.split(/\s+/)) {
    if (w.length > 1 && !GENERIC_WORDS.has(w)) tokens.add(w);
  }
  // Prefer phrase forms for lead-gen so "Team Lead" cannot pass.
  if (/\blead\s*gen(?:eration)?\b/i.test(s) || /\blead\s+generation\b/i.test(s)) {
    tokens.add("lead generation");
    tokens.add("lead gen");
    tokens.add("lead-gen");
    tokens.delete("lead");
    tokens.delete("leads");
    tokens.delete("generation");
    tokens.delete("services");
    tokens.delete("service");
  }
  for (const [k, syns] of Object.entries(SKILL_SYNONYMS)) {
    if (s.includes(k))
      syns.forEach((x) => {
        if (!GENERIC_WORDS.has(x.toLowerCase())) tokens.add(x);
      });
  }
  return Array.from(tokens).filter(
    (t) => t.length > 1 && (t === s || !GENERIC_WORDS.has(t.toLowerCase())),
  );
}

// Word-boundary token matching — substring checks were a real relevance bug:
// "react" matched "reactivation" and "ai" matched "email"/"maintain", letting
// marketing/payroll posts through React/AI searches. Tokens must stand alone.
const TOKEN_RE_CACHE = new Map<string, RegExp>();
function tokenMatches(lowerText: string, token: string): boolean {
  const t = token.toLowerCase();
  let re = TOKEN_RE_CACHE.get(t);
  if (!re) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9+#])${esc}(?![a-z0-9])`);
    TOKEN_RE_CACHE.set(t, re);
  }
  return re.test(lowerText);
}

export function isRelevantToSkill(text: string, skill: string): boolean {
  if (!skill) return true;
  const lower = ` ${(text || "").toLowerCase()} `;
  if (lower.trim().length === 0) return false;
  const syns = getSkillSynonyms(skill);
  return syns.some((t) => tokenMatches(lower, t));
}

// ── Strong vs weak skill matching ────────────────────────────────────────────
// Family terms like "javascript"/"frontend" appear in the tech-stack blurb of
// nearly EVERY job post, so a body-text hit on them is not evidence the post
// is about the user's skill (real bug: a BizDev role scored 100 for a React
// search because its description mentioned JavaScript). A "strong" synonym is
// the skill itself and its direct variants only.

// Family terms: too broad as evidence for a SPECIFIC skill (a React search
// must not accept any post that says "javascript"), but perfectly valid when
// the user's own skill IS the family ("web development" → Frontend Developer
// posts are exactly what they want).
const WEAK_FAMILY_TERMS = new Set([
  ...GENERIC_WORDS,
  "frontend",
  "front-end",
  "backend",
  "back-end",
  "fullstack",
  "full stack",
  "full-stack",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "css",
  "html",
  "ui",
  "ux",
  "web development",
  "website",
  "mobile",
  "web developer",
  "designer",
  "growth",
  "marketing",
  "assistant",
]);

export function getStrongSkillSynonyms(skill: string): string[] {
  const s = (skill || "").toLowerCase().trim();
  if (!s) return [];
  const isFamilyQuery = WEAK_FAMILY_TERMS.has(s);
  return getSkillSynonyms(skill).filter((t) => {
    const tl = t.toLowerCase();
    if (tl === s) return true; // the searched phrase itself always counts
    if (GENERIC_WORDS.has(tl)) return false; // bare generics never count
    if (WEAK_FAMILY_TERMS.has(tl)) return isFamilyQuery; // family ↔ family only
    return true;
  });
}

/** True when the text mentions the skill itself / a direct variant — not just a family word. */
export function isStronglyRelevantToSkill(text: string, skill: string): boolean {
  if (!skill) return true;
  const lower = ` ${(text || "").toLowerCase()} `;
  if (lower.trim().length === 0) return false;
  const s = skill.toLowerCase().trim();
  // Bare "design" matches interior/character/3D — require digital design signals
  // or deny adjacent crafts.
  if (/^(design|designer)$/i.test(s)) {
    if (
      /\b(interior design(?:er)?|sculptor|mold caster|3d print(?:er|ing)|motion graphics|3d animation|character design|graphic novel|concept artist|industrial design(?:er)?|room makeover|explainer videos?|carport|renovat(?:e|ion)|landscape design(?:er)?|prosthetic|jeans artist|fashion design(?:er)?|apparel|tattoo|furniture design|architecture|construction)\b/i.test(
        lower,
      )
    ) {
      return false;
    }
    return (
      /\b(ui|ux|figma|web design|website design|product design|graphic design|logo|landing page|responsive design|frontend design|front-end design|visual design|brand design)\b/i.test(
        lower,
      ) ||
      /\b(looking for|need|hiring)\b.{0,40}\b(a |an )?(ui |ux |web |product |graphic |logo )?(designer|design)\b/i.test(
        lower,
      )
    );
  }
  if (getStrongSkillSynonyms(skill).some((t) => tokenMatches(lower, t))) return true;
  // Morphological variants (writer↔writing↔writers) — craftVariants covers
  // unmapped generics that only have relatedSkills=[self].
  try {
    // Lazy require avoided — inline stem-ish checks for -er/-ing/-ors.
    const stems = new Set<string>([s]);
    if (s.endsWith("ers")) stems.add(s.slice(0, -1));
    if (s.endsWith("er")) {
      stems.add(s.slice(0, -2) + "ing");
      stems.add(s.slice(0, -2) + "e");
      stems.add(s);
    }
    if (s.endsWith("ing") && s.length > 5) {
      stems.add(s.slice(0, -3));
      stems.add(s.slice(0, -3) + "er");
      stems.add(s.slice(0, -3) + "ers");
    }
    if (s.endsWith("or")) stems.add(s.slice(0, -2) + "ing");
    for (const stem of stems) {
      if (stem.length >= 3 && tokenMatches(lower, stem)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Family words that never count as evidence on their own (see WEAK_FAMILY_TERMS). */
export function isWeakFamilyTerm(term: string): boolean {
  return WEAK_FAMILY_TERMS.has((term || "").toLowerCase().trim());
}

/** Freshness-first: social buyer posts max 48h, job boards max 72h. Scoring
 * additionally boosts the last few hours hardest, so minutes/hours-old posts
 * always rank on top. Clients-goal social prefer ≤24h when a date exists. */
export const SOCIAL_MAX_AGE_DAYS = 2;
/** Preferred social window for goal=clients buyer demand. */
/** Clients social freshness window (days). Wider than 2d so sparse crafts can fill tabs; rank still boosts under-24h higher. */
export const CLIENTS_SOCIAL_MAX_AGE_DAYS = 7;
export const JOB_BOARD_MAX_AGE_DAYS = 3;
/** Named-company ATS / boards on clients path — longer than social (2d). */
export const ATS_COMPANY_MAX_AGE_DAYS = 7;
const MAX_AGE_DAYS = SOCIAL_MAX_AGE_DAYS;

export function isRecent(dateStr: string | null | undefined, maxDays = MAX_AGE_DAYS): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const ageDays = (Date.now() - d.getTime()) / 86_400_000;
  return ageDays >= 0 && ageDays <= maxDays;
}

/**
 * Pull a publish date out of SERP title/snippet when the engine omitted `date`.
 * Handles "28w", "3mo", "Mar 22, 2019", "Nov 15, 2023", "2 days ago".
 */
export function extractDateFromText(text: string): string | undefined {
  if (!text) return undefined;
  const s = text.replace(/\s+/g, " ").trim();

  // Compact social ages: 28w, 3mo, 2y, 5d, 12h, 30m
  const compact = s.match(/\b(\d+)\s*(w|mo|y|d|h|m)\b/i);
  if (compact) {
    const n = Number(compact[1]);
    const u = compact[2].toLowerCase();
    const ms =
      u === "m"
        ? n * 60_000
        : u === "h"
          ? n * 3_600_000
          : u === "d"
            ? n * 86_400_000
            : u === "w"
              ? n * 7 * 86_400_000
              : u === "mo"
                ? n * 30 * 86_400_000
                : n * 365 * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }

  const rel = s.match(/\b(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = unit.startsWith("second")
      ? n * 1_000
      : unit.startsWith("minute")
        ? n * 60_000
        : unit.startsWith("hour")
          ? n * 3_600_000
          : unit.startsWith("day")
            ? n * 86_400_000
            : unit.startsWith("week")
              ? n * 7 * 86_400_000
              : unit.startsWith("month")
                ? n * 30 * 86_400_000
                : n * 365 * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }

  // Absolute: Mar 22, 2019 / November 15, 2023 / 2019-03-22
  const abs = s.match(
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2}|\d{4}-\d{2}-\d{2})\b/i,
  );
  if (abs) {
    const t = Date.parse(abs[1]);
    if (!Number.isNaN(t) && t < Date.now() + 86_400_000) return new Date(t).toISOString();
  }

  return undefined;
}

/** Age in days from ISO, or null if unparseable. */
export function ageDays(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

const BUYER_SIGNALS = [
  // explicit hiring
  "looking for",
  "need a",
  "need an",
  "need someone",
  "need help with",
  "hiring",
  "we are hiring",
  "we're hiring",
  "now hiring",
  "[hiring]",
  "we need",
  "i need",
  "our team needs",
  "our startup needs",
  "our company needs",
  "searching for",
  "seeking a",
  "seeking an",
  "want to hire",
  "looking to hire",
  "want to bring on",
  "bring someone on",
  "join our team",
  "join my team",
  // recommendations / referrals
  "can anyone recommend",
  "anyone know a good",
  "recommend a",
  "recommend an",
  "who do you use",
  "who should i hire",
  "suggestions?",
  "referral",
  // freelance / gig
  "freelancer needed",
  "freelance gig",
  "freelance opportunity",
  "help wanted",
  "project available",
  "work available",
  "paid gig",
  "paid project",
  "paid work",
  // budget / money
  "budget",
  "budget:",
  "paying for",
  "compensation",
  "salary:",
  "rate:",
  "hourly",
  "up to $",
  "pay $",
  "$ /hr",
  "/hour",
  "/year",
  // contract / role
  "contract work",
  "contract position",
  "contract available",
  "open role",
  "open position",
  "position available",
  "job opportunity",
  "job posting",
  "remote position",
  "short term project",
  "long term",
  "part time",
  "full time",
  "contract",
  // want/demand phrasing (non-job-post buyers)
  "i want a",
  "i want to build",
  "want someone",
  "who can build",
  "who can help",
  "willing to pay",
  "can someone build",
  "can someone help",
  "need this built",
  // urgency / action
  "asap",
  "urgent",
  "urgently",
  "immediately",
  "this week",
  "starting soon",
  "right away",
  "dm me",
  "dm to apply",
  "reach out if",
  "apply here",
  "apply at",
  // procurement / RFP
  "rfp",
  "request for proposal",
  "tender",
  "bid",
  "scope of work",
  "statement of work",
];

export function isBuyerContent(text: string, negativePhrases: string[]): boolean {
  const lower = (text || "").toLowerCase();
  if (!lower) return false;
  // Seller/provider pitches that misuse buyer keywords (agency CTAs included).
  if (
    /\b(hire me|my portfolio|my rates|i('?m| am) a (freelance|web )?developer|available for hire|open to work|check out my gig|i build websites for|need a pro .{0,40} service|get a quote|our web team|we (design|build) websites?|across the (uk|us|usa)|book a (free )?consultation|dm (us|me) for (a )?quote|looking for a (freelance |web )?(developer|designer|website).{0,50}for your (business|company|startup)|if you are a (business )?(founder|owner)|dm me your (requirements|project|brief|details)|commission[- ]based partner|partner to find .{0,30}(clients|customers))\b/i.test(
      text,
    )
  ) {
    if (
      !/\b(need someone to|our (startup|company|team) needs|looking to hire|willing to pay|who can (build|help|make))\b/i.test(
        text,
      )
    ) {
      return false;
    }
  }
  if (negativePhrases.some((n) => lower.includes(n))) return false;

  const hireLooking =
    /\blooking to hire\b/i.test(text) ||
    (/\blooking for (a |an )?(freelance[rs]?|developer|designer|contractor|engineer|someone (to|who)|help with|web developer|web designer)\b/i.test(
      text,
    ) &&
      !/\bfor your (business|company|startup)\b/i.test(text) &&
      !/\bdm me your\b/i.test(text) &&
      !/\bpartner to find\b/i.test(text));

  const otherBuyer = BUYER_SIGNALS.some((s) => s !== "looking for" && lower.includes(s));
  return otherBuyer || hireLooking;
}

export function detectDecisionMaker(text: string): boolean {
  return /\b(ceo|cto|coo|founder|co-?founder|owner|director|vp|head of|managing|principal|hiring manager|recruiter|talent)\b/i.test(
    text || "",
  );
}

export const URL_BLOCKLIST = [
  "wikipedia.org",
  "npmjs.com",
  "/wiki/",
  "docs.",
  "tutorial",
  "stackoverflow.com/questions",
  "medium.com/@",
  "medium.com/",
  "dev.to/",
  "toptal.com",
  "freelancer.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "dice.com",
  "linkedin.com/jobs/collections",
  "linkedin.com/jobs/search",
  "hiring now:",
  "fiverr.com/categories/",
];
