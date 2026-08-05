import type { SearchQuery } from "./types.ts";

const ROLE_MAP: Record<string, string> = {
  react: "React developer",
  "react developer": "React developer",
  next: "Next.js developer",
  nextjs: "Next.js developer",
  vue: "Vue.js developer",
  angular: "Angular developer",
  python: "Python developer",
  django: "Django developer",
  node: "Node.js developer",
  nodejs: "Node.js developer",
  fullstack: "full stack developer",
  "full stack": "full stack developer",
  frontend: "frontend developer",
  backend: "backend developer",
  ios: "iOS developer",
  android: "Android developer",
  flutter: "Flutter developer",
  "react native": "React Native developer",
  ux: "UX designer",
  ui: "UI designer",
  "ui ux": "UI/UX designer",
  "graphic design": "graphic designer",
  copywriter: "copywriter",
  "content writer": "content writer",
  "content creator": "content creator",
  seo: "SEO specialist",
  marketing: "marketing consultant",
  "social media": "social media manager",
  "video editor": "video editor",
  "data scientist": "data scientist",
  ml: "ML engineer",
  "machine learning": "ML engineer",
  ai: "AI developer",
  devops: "DevOps engineer",
  blockchain: "blockchain developer",
  solidity: "Solidity developer",
  web3: "Web3 developer",
  wordpress: "WordPress developer",
  shopify: "Shopify developer",
  photographer: "photographer",
  accountant: "accountant",
  bookkeeper: "bookkeeper",
  lawyer: "lawyer",
  legal: "lawyer",
  "virtual assistant": "virtual assistant",
  va: "virtual assistant",
  "project manager": "project manager",
  pm: "project manager",
  "product manager": "product manager",
  designer: "designer",
  developer: "developer",
  engineer: "engineer",
};

export function expandQuery(rawInput: string): SearchQuery {
  const raw = rawInput.trim();
  const lower = raw.toLowerCase();

  const skill =
    lower
      .replace(/^(i('m| am) (a |an )?)?(looking for |need |want )/i, "")
      .replace(
        /\b(developer|engineer|designer|specialist|expert|professional|consultant)\b/gi,
        (m) => m,
      )
      .trim() || raw;

  const role = ROLE_MAP[lower] || ROLE_MAP[skill.toLowerCase()] || `${skill} developer`;

  const keywords = [skill, role, ...skill.split(" ")].filter(
    (k, i, arr) => k.length > 2 && arr.indexOf(k) === i,
  );

  const buyerPhrases = [
    `looking for ${skill}`,
    `need a ${skill}`,
    `hiring ${skill}`,
    `need ${skill} developer`,
    `seeking ${skill}`,
    `want to hire ${skill}`,
    `${skill} needed`,
    `${skill} wanted`,
    `${role} needed`,
    `need someone for ${skill}`,
    `can anyone recommend ${skill}`,
    `anyone know a good ${skill}`,
    `recommend a ${skill}`,
    `${skill} for our startup`,
    `${skill} for our company`,
    `${skill} freelancer`,
    `${skill} contractor`,
    `budget for ${skill}`,
    `paying for ${skill}`,
  ];

  const negativePhrases = [
    "available for hire",
    "available for work",
    "for hire",
    "open to work",
    "i am a",
    "i'm a",
    "hire me",
    "my portfolio",
    "my work",
    "my services",
    "i offer",
    "i provide",
    "i specialize",
    "i can help",
    "i build",
    "check out my",
    "years of experience",
    "my github",
    "my linkedin",
    "tutorial",
    "how to",
    "learn",
    "course",
    "beginners guide",
    "documentation",
    "getting started",
    "introduction to",
    "what is",
    "2014",
    "2015",
    "2016",
    "2017",
    "2018",
    "2019",
    "2020",
  ];

  return { raw, skill, role, keywords, buyerPhrases, negativePhrases };
}
