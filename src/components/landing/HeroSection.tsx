import { useState, useEffect } from "react";
import heroStatueAsset from "@/assets/hero-statue.png";
import heroLogoAsset from "@/assets/hero-logo.jpg";
import heroCloudAsset from "@/assets/hero-cloud.png";
import { Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { motion, AnimatePresence } from "framer-motion";
import { LandingSearchBox } from "./LandingSearchBox";

// --- BENTO ANIMATION COMPONENTS ---

function Card1Flow() {
  const [phase, setPhase] = useState<"typing" | "searching" | "revealing" | "holding">("typing");
  const [query, setQuery] = useState("");
  const targetQuery = "find me SaaS founders in NY";
  const statuses = [
    "Searching social media...",
    "Searching public websites...",
    "Searching directories...",
    "Searching government sites...",
  ];
  const [statusIdx, setStatusIdx] = useState(0);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (query.length < targetQuery.length) {
        t = setTimeout(
          () => setQuery(targetQuery.slice(0, query.length + 1)),
          50 + Math.random() * 40,
        );
      } else {
        t = setTimeout(() => setPhase("searching"), 300);
      }
    } else if (phase === "searching") {
      if (statusIdx < statuses.length - 1) {
        t = setTimeout(() => setStatusIdx((i) => i + 1), 600);
      } else {
        t = setTimeout(() => setPhase("revealing"), 600);
      }
    } else if (phase === "revealing") {
      t = setTimeout(() => setPhase("holding"), 2000);
    } else if (phase === "holding") {
      t = setTimeout(() => {
        setQuery("");
        setStatusIdx(0);
        setPhase("typing");
      }, 500);
    }
    return () => clearTimeout(t);
  }, [phase, query, statusIdx]);

  return (
    <div className="scravipo-flow" aria-label="Query to delivery process">
      <div
        style={{
          position: "relative",
          marginBottom: "0.5rem",
          padding: "0.5rem 0.75rem",
          background: "rgba(0,0,0,0.3)",
          borderRadius: "0.5rem",
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.8)", fontFamily: "monospace" }}
        >
          {query}
          <span style={{ opacity: phase === "typing" ? 1 : 0 }}>|</span>
        </span>
        <div
          style={{
            width: "1.2rem",
            height: "1.2rem",
            borderRadius: "50%",
            background: phase !== "typing" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.2s",
            boxShadow: phase !== "typing" ? "0 0 8px rgba(255,255,255,0.2)" : "none",
          }}
        >
          <span style={{ fontSize: "0.6rem", color: "#fff" }}>↗</span>
        </div>
      </div>

      <div
        style={{
          minHeight: "3rem",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <AnimatePresence mode="wait">
          {phase === "searching" && (
            <motion.div
              key="searching"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.5)" }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "10px",
                  height: "10px",
                  border: "2px solid rgba(255,255,255,0.2)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                  verticalAlign: "middle",
                  marginRight: "6px",
                }}
              />
              {statuses[statusIdx]}
            </motion.div>
          )}
          {phase === "revealing" || phase === "holding" ? (
            <motion.div
              key="revealing"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                padding: "0.5rem",
                background: "rgba(134,197,160,0.1)",
                border: "1px solid rgba(134,197,160,0.2)",
                borderRadius: "0.4rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.6rem",
                  color: "#86c5a0",
                  fontWeight: "bold",
                  marginBottom: "0.2rem",
                }}
              >
                ✓ Found 142 leads
              </div>
              <div style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.6)" }}>
                Top match: Sarah Jenkins, Founder @ DataSync NY
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Card2Enrich() {
  const entities = [
    {
      name: "Acme AI",
      type: "Company",
      loading: "examining public signals...",
      result: "Actively hiring engineers",
      dot: "is-blue",
    },
    {
      name: "Northstar Labs",
      type: "Startup",
      loading: "examining recent activity...",
      result: "Raised Series A ($12M)",
      dot: "is-green",
    },
    {
      name: "Atlas Ventures",
      type: "Investor",
      loading: "checking recent activity...",
      result: "Invested in AI last 30 days",
      dot: "is-amber",
    },
    {
      name: "Alex Morgan",
      type: "Person",
      loading: "verifying role/company context...",
      result: "Founder at Northstar Labs",
      dot: "is-blue",
    },
  ];

  const [activeIdx, setActiveIdx] = useState(0);
  const [status, setStatus] = useState<"pending" | "checking" | "enriched">("pending");

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (status === "pending") {
      t = setTimeout(() => setStatus("checking"), 600);
    } else if (status === "checking") {
      t = setTimeout(() => setStatus("enriched"), 1500);
    } else if (status === "enriched") {
      t = setTimeout(() => {
        setStatus("pending");
        setActiveIdx((i) => (i + 1) % entities.length);
      }, 2500);
    }
    return () => clearTimeout(t);
  }, [status, activeIdx]);

  return (
    <div
      className="scravipo-signal-window"
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
    >
      {entities.map((ent, idx) => {
        const isActive = idx === activeIdx;
        const isPast =
          idx < activeIdx ||
          (activeIdx === 0 && idx === entities.length - 1 && status === "pending");
        const state = isActive ? status : isPast ? "pending" : "pending";

        return (
          <div key={ent.name} style={{ opacity: isActive ? 1 : 0.3, transition: "opacity 0.3s" }}>
            <div style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.9)", fontWeight: "bold" }}>
              {ent.name}{" "}
              <span style={{ fontWeight: "normal", color: "rgba(255,255,255,0.4)" }}>
                ({ent.type})
              </span>
            </div>
            <div style={{ minHeight: "1.2rem", marginTop: "0.2rem" }}>
              {state === "pending" && (
                <div style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.3)" }}>
                  Waiting...
                </div>
              )}
              {state === "checking" && (
                <div style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.6)" }}>
                  {ent.loading}
                </div>
              )}
              {state === "enriched" && (
                <motion.div
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
                >
                  <span className={`scravipo-signal-window__dot ${ent.dot}`} />
                  <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.8)" }}>
                    {ent.result}
                  </span>
                </motion.div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Card3Verified() {
  const contacts = [
    { name: "Alex Morgan", detail: "alex@acme.ai", check: "verified email" },
    { name: "Sarah Jenkins", detail: "+1 (415) 555-0198", check: "verified phone" },
    { name: "David Chen", detail: "david@northstar.co", check: "verified email" },
  ];
  const [activeIdx, setActiveIdx] = useState(0);
  const [status, setStatus] = useState<"pending" | "verifying" | "verified">("pending");

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (status === "pending") {
      t = setTimeout(() => setStatus("verifying"), 400);
    } else if (status === "verifying") {
      t = setTimeout(() => setStatus("verified"), 1200);
    } else if (status === "verified") {
      t = setTimeout(() => {
        setStatus("pending");
        setActiveIdx((i) => (i + 1) % contacts.length);
      }, 2000);
    }
    return () => clearTimeout(t);
  }, [status, activeIdx]);

  const contact = contacts[activeIdx];

  return (
    <div className="scravipo-contact-proof" aria-hidden="true" style={{ height: "4rem" }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeIdx}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          style={{ display: "flex", alignItems: "center", gap: "0.58rem", width: "100%" }}
        >
          <span className="scravipo-contact-proof__avatar">
            {contact.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </span>
          <span className="scravipo-contact-proof__identity">
            <strong>{contact.name}</strong>
            <small style={{ fontFamily: "monospace" }}>{contact.detail}</small>
          </span>
          {status === "verifying" && (
            <span
              style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.5)", marginLeft: "auto" }}
            >
              verifying...
            </span>
          )}
          {status === "verified" && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.3rem" }}
            >
              <span style={{ fontSize: "0.5rem", color: "#9fd1ac" }}>{contact.check}</span>
              <span className="scravipo-contact-proof__check">✓</span>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Card4Outreach() {
  const drafts = [
    {
      lead: "Alex Morgan",
      text: "Hi Alex,\n\nSaw you're leading growth at Acme AI. I noticed your recent Series A and wanted to reach out. We help AI startups scale their outbound efforts securely.\n\nWould you be open to a quick chat next week to see if there's a fit?\n\nBest,\nScrapivo Team",
    },
    {
      lead: "Sarah Jenkins",
      text: "Hey Sarah; I loved your recent post about data sync challenges. Our new API solves exactly this. Let me know if you want to test it out!",
    },
  ];

  const [draftIdx, setDraftIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "holding" | "clearing">("typing");

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const targetText = drafts[draftIdx].text;

    if (phase === "typing") {
      if (typed.length < targetText.length) {
        t = setTimeout(
          () => setTyped(targetText.slice(0, typed.length + 1)),
          15 + Math.random() * 15,
        );
      } else {
        t = setTimeout(() => setPhase("holding"), 3000);
      }
    } else if (phase === "holding") {
      t = setTimeout(() => setPhase("clearing"), 50);
    } else if (phase === "clearing") {
      t = setTimeout(() => {
        setTyped("");
        setDraftIdx((i) => (i + 1) % drafts.length);
        setPhase("typing");
      }, 500);
    }
    return () => clearTimeout(t);
  }, [phase, typed, draftIdx]);

  return (
    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.5rem" }}>
        Drafting for:{" "}
        <span style={{ color: "rgba(255,255,255,0.9)" }}>{drafts[draftIdx].lead}</span>
      </div>
      <div
        style={{
          height: "10.5rem",
          background: "rgba(0,0,0,0.3)",
          borderRadius: "0.5rem",
          border: "1px solid rgba(255,255,255,0.1)",
          padding: "0.75rem",
          fontSize: "0.75rem",
          color: "rgba(255,255,255,0.8)",
          lineHeight: 1.5,
          opacity: phase === "clearing" ? 0 : 1,
          transition: "opacity 0.3s",
          whiteSpace: "pre-wrap",
          overflow: "hidden",
        }}
      >
        {typed}
        <span style={{ opacity: phase === "typing" ? 1 : 0 }}>|</span>
      </div>
    </div>
  );
}

/**
 * Scravipo visual direction: dark editorial monument.
 * Preserve the reference's graphite texture, chalk-ivory Times New Roman MT Condensed-style
 * headline, compact frosted nav, asymmetric statue crop, and restrained tactile motion.
 */

const statueAsset = heroStatueAsset;
const brandMarkAsset = heroLogoAsset;
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

const navItems = [
  { label: "Home", href: "#home" },
  { label: "About", href: "#dashboard" },
  { label: "How it Works", href: "#how-it-works" },
  { label: "FAQ", href: "#faq" },
];

type DashboardCategory =
  | "Mixed"
  | "Investor"
  | "Local Business"
  | "Executive"
  | "Person"
  | "Venture Capital";

type LeadRecord = {
  id: string;
  name: string;
  secondary: string;
  initials: string;
  image?: string;
  imageAlt?: string;
  fields: Record<string, string>;
  tags?: string[];
};

type CategoryConfig = {
  title: string;
  subtitle: string;
  columns: { key: string; label: string }[];
  rows: LeadRecord[];
};

const dashboardConfigs: Record<DashboardCategory, CategoryConfig> = {
  Mixed: {
    title: "All",
    subtitle: "Your full sales pipeline, ready to close",
    columns: [
      { key: "name", label: "Name / Entity" },
      { key: "category", label: "Category" },
      { key: "location", label: "Location" },
      { key: "contact", label: "Contact" },
      { key: "relevance", label: "Relevance" },
    ],
    rows: [
      {
        id: "mixed-1",
        name: "Aziza Satybaldyeva",
        secondary: "Investment Associate · DOMiNO Ventures",
        initials: "AS",
        fields: {
          category: "Investor",
          location: "Tashkent, UZ",
          contact: "aziza@dominovc.com",
          relevance: "Invested in AI pre-seed rounds recently",
        },
        tags: ["Pre-seed"],
      },
      {
        id: "mixed-2",
        name: "Ferncroft Capital",
        secondary: "Emerging early-stage fund",
        initials: "FC",
        fields: {
          category: "Venture Capital",
          location: "Austin, US",
          contact: "team@ferncroftcap.com",
          relevance: "Actively deploying in early-stage AI",
        },
        tags: ["AI"],
      },
      {
        id: "mixed-3",
        name: "Priya Natarajan",
        secondary: "Co-founder · Loopwire",
        initials: "PN",
        fields: {
          category: "Person",
          location: "Toronto, CA",
          contact: "priya@loopwire.io",
          relevance: "Raised seed funding this quarter",
        },
        tags: ["Verified"],
      },
      {
        id: "mixed-4",
        name: "Cedar & Pine Bakery",
        secondary: "Neighborhood bakery",
        initials: "CP",
        fields: {
          category: "Local Business",
          location: "Portland, US",
          contact: "hello@cedarpinebakery.com",
          relevance: "No website — high-intent opportunity",
        },
        tags: ["No website"],
      },
      {
        id: "mixed-5",
        name: "Northbeam Analytics",
        secondary: "Data tooling startup",
        initials: "NA",
        fields: {
          category: "Company",
          location: "Denver, US",
          contact: "contact@northbeamhq.com",
          relevance: "Actively hiring across engineering",
        },
        tags: ["Hiring"],
      },
    ],
  },
  Investor: {
    title: "Investors",
    subtitle: "High-intent investor leads",
    columns: [
      { key: "name", label: "Investor / Firm" },
      { key: "location", label: "Location" },
      { key: "phone", label: "Public phone / route" },
      { key: "email", label: "Public email / route" },
      { key: "checkSize", label: "Check size" },
      { key: "sectors", label: "Sectors" },
      { key: "relevance", label: "Relevance" },
    ],
    rows: [
      {
        id: "investor-1",
        name: "Alfred Lin",
        secondary: "Partner · Sequoia Capital",
        initials: "AL",
        image:
          "https://framerusercontent.com/images/qN8j54q8Vi2GA6Fqt0OG8fQSJw.webp?width=880&height=880",
        imageAlt: "Alfred Lin",
        fields: {
          location: "San Francisco, CA",
          phone: "Firm directory",
          email: "Early-AL@sequoiacap.com",
          checkSize: "$1M–$25M",
          relevance: "Backed breakout SaaS at seed stage",
        },
        tags: ["Consumer", "SaaS"],
      },
      {
        id: "investor-2",
        name: "Aileen Lee",
        secondary: "Founder · Cowboy Ventures",
        initials: "AL",
        image:
          "https://cdn.prod.website-files.com/637b82f903cd694c0b0f7546/63ce452d8de9f286395dac25_Aileen_profile_pic.webp",
        imageAlt: "Aileen Lee",
        fields: {
          location: "Palo Alto, CA",
          phone: "Firm directory",
          email: "hello@cowboy.vc",
          checkSize: "$250K–$5M",
          relevance: "Leading seed rounds in enterprise AI",
        },
        tags: ["Enterprise", "Seed"],
      },
      {
        id: "investor-3",
        name: "Josh Kopelman",
        secondary: "Partner · First Round",
        initials: "JK",
        image:
          "https://cdn.sanity.io/images/m6i10uln/production/eb12eb2d830fd3e3b118a6c326d0d1692003c4d4-1024x1256.png?fm=webp&w=3840&q=80",
        imageAlt: "Josh Kopelman",
        fields: {
          location: "Philadelphia, PA",
          phone: "Firm directory",
          email: "team@firstround.com",
          checkSize: "$100K–$20M",
          relevance: "Invested in AI pre-seed rounds recently",
        },
        tags: ["AI", "B2B"],
      },
      {
        id: "investor-4",
        name: "Sarah Tavel",
        secondary: "General Partner · Benchmark",
        initials: "ST",
        image: favicon("benchmark.com"),
        imageAlt: "Benchmark official mark",
        fields: {
          location: "San Francisco, CA",
          phone: "Firm directory",
          email: "contact@benchmark.com",
          checkSize: "$1M–$25M",
          relevance: "Active in fintech marketplace deals",
        },
        tags: ["Marketplaces", "Fintech"],
      },
    ],
  },
  "Local Business": {
    title: "Local Businesses",
    subtitle: "Businesses discovered across global markets",
    columns: [
      { key: "name", label: "Business" },
      { key: "location", label: "Location" },
      { key: "category", label: "Category" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "website", label: "Website" },
      { key: "relevance", label: "Relevance" },
    ],
    rows: [
      {
        id: "business-1",
        name: "Joe's Plumbing",
        secondary: "Independent contractor",
        initials: "JP",
        fields: {
          location: "Austin, US",
          category: "Plumbing",
          phone: "+1 (512) 555-0199",
          email: "joesplumbingatx@gmail.com",
          website: "None found",
          relevance: "No website — high-intent opportunity",
        },
        tags: ["No website"],
      },
      {
        id: "business-2",
        name: "Maria's Flower Shop",
        secondary: "Local florist",
        initials: "MF",
        fields: {
          location: "Chicago, US",
          category: "Retail",
          phone: "+1 (312) 555-0145",
          email: "mariaflowers@yahoo.com",
          website: "None found",
          relevance: "No website — high-intent opportunity",
        },
        tags: ["No website"],
      },
      {
        id: "business-3",
        name: "Apex Roofers",
        secondary: "Roofing & repair",
        initials: "AR",
        fields: {
          location: "Denver, US",
          category: "Construction",
          phone: "+1 (720) 555-0182",
          email: "apexroofingdenver@gmail.com",
          website: "None found",
          relevance: "Recently expanded service area",
        },
        tags: ["No website"],
      },
      {
        id: "business-4",
        name: "Golden Wok",
        secondary: "Family restaurant",
        initials: "GW",
        fields: {
          location: "Seattle, US",
          category: "Restaurant",
          phone: "+1 (206) 555-0123",
          email: "goldenwokseattle@gmail.com",
          website: "None found",
          relevance: "No online ordering — outreach window",
        },
        tags: ["No website"],
      },
    ],
  },
  Executive: {
    title: "Executives",
    subtitle: "Global company executives & leadership",
    columns: [
      { key: "name", label: "Person" },
      { key: "title", label: "Title" },
      { key: "company", label: "Company" },
      { key: "location", label: "Location" },
      { key: "email", label: "Email" },
      { key: "relevance", label: "Relevance" },
    ],
    rows: [
      {
        id: "exec-1",
        name: "Satya Nadella",
        secondary: "Microsoft",
        initials: "SN",
        fields: {
          title: "CEO",
          company: "Microsoft",
          location: "Redmond, US",
          email: "satyan@microsoft.com",
          relevance: "Overseeing major AI platform bets",
        },
        tags: ["Enterprise"],
      },
      {
        id: "exec-2",
        name: "Tim Cook",
        secondary: "Apple",
        initials: "TC",
        fields: {
          title: "CEO",
          company: "Apple",
          location: "Cupertino, US",
          email: "tcook@apple.com",
          relevance: "Directing services-led growth push",
        },
        tags: ["Verified"],
      },
      {
        id: "exec-3",
        name: "Ruth Porat",
        secondary: "Alphabet",
        initials: "RP",
        fields: {
          title: "President & CIO",
          company: "Alphabet",
          location: "Mountain View, US",
          email: "ruth@abc.xyz",
          relevance: "Steering cloud investment priorities",
        },
        tags: ["Finance"],
      },
      {
        id: "exec-4",
        name: "Marc Benioff",
        secondary: "Salesforce",
        initials: "MB",
        fields: {
          title: "Chair & CEO",
          company: "Salesforce",
          location: "San Francisco, US",
          email: "ceo@salesforce.com",
          relevance: "Acquiring AI startups this year",
        },
        tags: ["Cloud"],
      },
    ],
  },
  Person: {
    title: "Startup Founders",
    subtitle: "Founders & early-stage leaders",
    columns: [
      { key: "name", label: "Person" },
      { key: "title", label: "Title" },
      { key: "company", label: "Company" },
      { key: "location", label: "Location" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "relevance", label: "Relevance" },
    ],
    rows: [
      {
        id: "person-1",
        name: "Dario Amodei",
        secondary: "Anthropic",
        initials: "DA",
        fields: {
          title: "Founder & CEO",
          company: "Anthropic",
          location: "San Francisco, US",
          phone: "Anthropic newsroom",
          email: "press@anthropic.com",
          relevance: "Raised funding at record valuation",
        },
        tags: ["Verified"],
      },
      {
        id: "person-2",
        name: "Brian Chesky",
        secondary: "Airbnb",
        initials: "BC",
        image:
          "https://news.airbnb.com/wp-content/uploads/sites/4/2016/10/Brian-Chesky-Headshot-IR-Crop-Airbnb-2.jpg?w=624",
        imageAlt: "Brian Chesky",
        fields: {
          title: "Co-founder & CEO",
          company: "Airbnb",
          location: "San Francisco, US",
          phone: "Airbnb newsroom",
          email: "contact.press@airbnb.com",
          relevance: "Expanding into new travel verticals",
        },
        tags: ["Leadership"],
      },
      {
        id: "person-3",
        name: "Jensen Huang",
        secondary: "NVIDIA",
        initials: "JH",
        image:
          "https://iprsoftwaremedia.com/219/files/202604/f0e9efa72f909f3f08cdd0a48ff92880/69e6b9293d633260eec67804_jensen-1920x1920/jensen-1920x1920_6a7e6ad5-c215-4503-b70d-fe6e5e9de205-prv.jpg?v=6a7e6ad5-c215-4503-b70d-fe6e5e9de205",
        imageAlt: "Jensen Huang",
        fields: {
          title: "Founder & CEO",
          company: "NVIDIA",
          location: "Santa Clara, US",
          phone: "+1 (408) 486-2000",
          email: "info@nvidia.com",
          relevance: "Keynote speaker on AI infrastructure",
        },
        tags: ["Leadership"],
      },
      {
        id: "person-4",
        name: "Melanie Perkins",
        secondary: "Canva",
        initials: "MP",
        fields: {
          title: "Co-founder & CEO",
          company: "Canva",
          location: "Sydney, AU",
          phone: "Canva newsroom",
          email: "comms@canva.com",
          relevance: "Raised seed funding this quarter",
        },
        tags: ["Design"],
      },
    ],
  },
  "Venture Capital": {
    title: "Venture Capital",
    subtitle: "VC firms, funds & investment organizations",
    columns: [
      { key: "name", label: "VC firm" },
      { key: "location", label: "Location" },
      { key: "stage", label: "Stage" },
      { key: "sectors", label: "Sectors" },
      { key: "website", label: "Website" },
      { key: "email", label: "Email / route" },
      { key: "relevance", label: "Relevance" },
    ],
    rows: [
      {
        id: "vc-1",
        name: "Accel",
        secondary: "Global venture firm",
        initials: "AC",
        image: favicon("accel.com"),
        imageAlt: "Accel official mark",
        fields: {
          location: "Palo Alto, US",
          stage: "Seed–Growth",
          website: "accel.com",
          email: "partners@accel.com",
          phone: "+1 650 614 4800",
          relevance: "Actively deploying in early-stage AI",
        },
        tags: ["Enterprise", "AI"],
      },
      {
        id: "vc-2",
        name: "Index Ventures",
        secondary: "Technology investor",
        initials: "IV",
        image: favicon("indexventures.com"),
        imageAlt: "Index Ventures official mark",
        fields: {
          location: "London, UK",
          stage: "Seed–Growth",
          website: "indexventures.com",
          email: "press@indexventures.com",
          phone: "+44 20 7154 2020",
          relevance: "New fintech fund announced",
        },
        tags: ["Fintech", "SaaS"],
      },
      {
        id: "vc-3",
        name: "General Catalyst",
        secondary: "Transformation investor",
        initials: "GC",
        image: favicon("generalcatalyst.com"),
        imageAlt: "General Catalyst official mark",
        fields: {
          location: "Cambridge, US",
          stage: "Early–Growth",
          website: "generalcatalyst.com",
          email: "info@generalcatalyst.com",
          phone: "+1 415 659 5000",
          relevance: "Hiring AI partners for new fund",
        },
        tags: ["Healthcare", "AI"],
      },
      {
        id: "vc-4",
        name: "Bessemer Venture Partners",
        secondary: "Cloud & technology investor",
        initials: "BV",
        image: favicon("bvp.com"),
        imageAlt: "Bessemer Venture Partners official mark",
        fields: {
          location: "Menlo Park, US",
          stage: "Seed–Growth",
          website: "bvp.com",
          email: "contact@bvp.com",
          phone: "Firm directory",
          relevance: "Backing cloud security seed rounds",
        },
        tags: ["Cloud", "Security"],
      },
    ],
  },
};

export function HeroSection({ cta, ctaLabel }: { cta: string; ctaLabel?: string }) {
  const signupSearch = cta === "/auth" ? { mode: "signup" as const } : undefined;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Word cycling for hero headline
  const topWords = ["Opportunities", "Leads"];
  const bottomWords = ["matter", "convert"];
  const [wordIdx, setWordIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setWordIdx((i) => (i + 1) % 2);
        setFade(true);
      }, 600);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  // Dashboard Auto-Type Effect — deterministic scripted state machine
  // Each scripted query maps directly to one predefined result dataset.
  // No real search/filter logic. No empty states. This is a marketing demo.
  const autoQueries: { text: string; configKey: DashboardCategory }[] = [
    { text: "100+ investors and VCs; Early-Stage AI", configKey: "Venture Capital" },
    {
      text: "Want to sell my website service; find me 200+ global local businesses rn",
      configKey: "Local Business",
    },
    {
      text: "Yo actively looking for jobs; asap find me 100+ startup founders",
      configKey: "Person",
    },
    { text: "find me 50+ global company executives rn", configKey: "Executive" },
  ];

  // scriptPhase: "initial" = showing Mixed, awaiting first type | "typing" = character-by-character | "holding" = showing result, waiting before delete | "deleting" = erasing query
  const [scriptIdx, setScriptIdx] = useState(0);
  const [scriptPhase, setScriptPhase] = useState<"initial" | "typing" | "holding" | "deleting">(
    "initial",
  );
  const [displayedQuery, setDisplayedQuery] = useState("");
  // Which result set is currently shown in the dashboard table
  const [activeResultKey, setActiveResultKey] = useState<DashboardCategory>("Mixed");
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    if (scriptPhase === "initial") {
      // Show Mixed state for 3 seconds, then start typing the first query
      timeout = setTimeout(() => {
        setScriptPhase("typing");
      }, 3000);
    } else if (scriptPhase === "typing") {
      const targetText = autoQueries[scriptIdx].text;
      if (displayedQuery.length < targetText.length) {
        timeout = setTimeout(
          () => {
            setDisplayedQuery(targetText.slice(0, displayedQuery.length + 1));
          },
          60 + Math.random() * 40,
        );
      } else {
        // Typing complete → swap dashboard to the scripted result set
        timeout = setTimeout(() => {
          setActiveResultKey(autoQueries[scriptIdx].configKey);
          setSelectedRows([]);
          setScriptPhase("holding");
        }, 100);
      }
    } else if (scriptPhase === "holding") {
      // Hold the result for 2.8 seconds
      timeout = setTimeout(() => {
        setScriptPhase("deleting");
      }, 2800);
    } else if (scriptPhase === "deleting") {
      if (displayedQuery.length > 0) {
        timeout = setTimeout(() => {
          setDisplayedQuery(displayedQuery.slice(0, -1));
        }, 25);
      } else {
        // Move to next query — all state updates batched inside setTimeout
        timeout = setTimeout(() => {
          const nextIdx = (scriptIdx + 1) % autoQueries.length;
          setScriptIdx(nextIdx);
          setActiveResultKey("Mixed");
          setScriptPhase("typing");
        }, 600);
      }
    }

    return () => clearTimeout(timeout);
  }, [scriptPhase, displayedQuery, scriptIdx]);

  const activeConfig = dashboardConfigs[activeResultKey];

  const toggleRow = (id: string) => {
    setSelectedRows((current) =>
      current.includes(id) ? current.filter((rowId) => rowId !== id) : [...current, id],
    );
  };
  const allVisibleSelected =
    activeConfig.rows.length > 0 && activeConfig.rows.every((row) => selectedRows.includes(row.id));

  const toggleAllVisible = () => {
    setSelectedRows((current) => {
      if (allVisibleSelected)
        return current.filter((id) => !activeConfig.rows.some((row) => row.id === id));
      return Array.from(new Set([...current, ...activeConfig.rows.map((row) => row.id)]));
    });
  };

  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <section className="scravipo-hero" id="home" aria-label="Scravipo hero section">
        <div className="scravipo-hero__texture" aria-hidden="true" />
        <div className="scravipo-hero__vignette" aria-hidden="true" />
        <div className="scravipo-hero__grain" aria-hidden="true" />

        <header className="scravipo-nav-wrap">
          <nav className="scravipo-nav" aria-label="Primary navigation">
            <a className="scravipo-brand" href="#home" aria-label="Scravipo home">
              <img
                className="scravipo-brand__mark"
                src={brandMarkAsset}
                alt=""
                aria-hidden="true"
              />
              <span>Scravipo</span>
            </a>

            <div className="scravipo-nav__links" aria-label="Desktop links">
              {navItems.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.label}
                </a>
              ))}
            </div>

            <Link className="scravipo-join scravipo-join--nav" to={cta} search={signupSearch}>
              {ctaLabel || "Join"}
            </Link>

            <button
              className="scravipo-menu-toggle"
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span />
              <span />
            </button>
          </nav>

          <div
            className={`scravipo-mobile-backdrop${menuOpen ? " is-open" : ""}`}
            aria-hidden={!menuOpen}
            onClick={() => setMenuOpen(false)}
          />
          <div
            className={`scravipo-mobile-menu${menuOpen ? " is-open" : ""}`}
            aria-hidden={!menuOpen}
          >
            {navItems.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                {item.label}
              </a>
            ))}
            <Link to={cta} search={signupSearch} onClick={() => setMenuOpen(false)}>
              {ctaLabel || "Join"}
            </Link>
          </div>
        </header>

        <img className="scravipo-statue" src={statueAsset} alt="" aria-hidden="true" />

        <main className="scravipo-hero__content">
          <p className="scravipo-eyebrow">Scravipo</p>
          <h1>
            <span className="scravipo-hero__line-top">
              Get{" "}
              <span className="scravipo-cycle-word" style={{ opacity: fade ? 1 : 0 }}>
                {topWords[wordIdx]}
              </span>
            </span>
            <span className="scravipo-hero__line-bottom">
              that{" "}
              <span className="scravipo-cycle-word" style={{ opacity: fade ? 1 : 0 }}>
                {bottomWords[wordIdx]}
              </span>
            </span>
          </h1>
          <p className="scravipo-description">
            Scravipo turns live web signals into verified business
            <br className="scravipo-description__desktop-break" /> opportunities; clients, talent,
            and deals worth pursuing.
          </p>
          <p
            className="scravipo-signals"
            aria-label="Real-time signals, verified contacts, no random leads"
          >
            <span>Real-time signals</span>
            <i aria-hidden="true">·</i>
            <span>Verified contacts</span>
            <i aria-hidden="true">·</i>
            <span>No random leads</span>
          </p>
          <Link className="scravipo-join scravipo-join--hero" to={cta} search={signupSearch}>
            {ctaLabel || "Start free"}
          </Link>
        </main>

        <span className="scravipo-scratch" aria-hidden="true" />

        <style>
          {`
        .scravipo-hero {
          --chalk: #f3f1ec;
          --muted-chalk: rgba(243, 241, 236, 0.74);
          --quiet-chalk: rgba(243, 241, 236, 0.46);
          --charcoal: #0d0d0f;
          position: relative;
          isolation: isolate;
          min-height: 100svh;
          overflow: hidden;
          background: #0d0d0f;
          color: var(--chalk);
          font-family: Arial, Helvetica, sans-serif;
        }

        .scravipo-hero,
        .scravipo-hero * {
          box-sizing: border-box;
        }

        .scravipo-hero a,
        .scravipo-hero button {
          -webkit-tap-highlight-color: transparent;
        }

        .scravipo-hero__texture,
        .scravipo-hero__vignette,
        .scravipo-hero__grain {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .scravipo-hero__texture {
          z-index: -4;
          background: #090a0c;
        }

        .scravipo-hero__vignette {
          z-index: -3;
          background:
            radial-gradient(circle at 50% 30%, rgba(30, 35, 45, 0.15) 0%, rgba(10, 10, 12, 0.5) 50%, rgba(4, 4, 5, 0.95) 100%);
        }

        .scravipo-hero__grain {
          z-index: -2;
          opacity: 0.22;
          mix-blend-mode: screen;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.86' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.13'/%3E%3C/svg%3E");
          background-size: 220px 220px;
        }

        .scravipo-nav-wrap {
          position: relative;
          z-index: 5;
          padding: clamp(1.25rem, 3.1vw, 3.15rem) clamp(1rem, 6vw, 5.5rem) 0;
        }

        .scravipo-nav {
          display: grid;
          grid-template-columns: minmax(160px, 1fr) auto minmax(160px, 1fr);
          align-items: center;
          min-height: 4.5rem;
          padding: 0.8rem 1.25rem 0.8rem 2rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          background: rgba(20, 20, 23, 0.75);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1.5rem 4rem rgba(0, 0, 0, 0.2);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          animation: scravipo-rise 0.72s cubic-bezier(0.23, 1, 0.32, 1) both;
        }

        .scravipo-brand {
          display: inline-flex;
          align-items: center;
          justify-self: start;
          gap: 0.56rem;
          color: var(--chalk);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 0.94rem;
          font-weight: 600;
          letter-spacing: -0.045em;
          text-decoration: none;
        }

        .scravipo-brand__mark {
          height: 1.8rem;
          width: auto;
          object-fit: contain;
        }

        .scravipo-nav__links {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: clamp(2rem, 4vw, 4.5rem);
        }

        .scravipo-nav__links a,
        .scravipo-mobile-menu a {
          color: rgba(243, 241, 236, 0.86);
          font-size: 0.95rem;
          font-weight: 500;
          letter-spacing: -0.01em;
          text-decoration: none;
          transition: color 160ms ease-out, transform 160ms ease-out;
        }

        .scravipo-nav__links a:hover,
        .scravipo-mobile-menu a:hover {
          color: var(--chalk);
          transform: translateY(-1px);
        }

        .scravipo-join {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 999px;
          background: var(--chalk);
          color: #111113;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 0.95rem;
          font-weight: 600;
          padding: 0.85rem 1.95rem;
          line-height: 1;
          text-decoration: none;
          transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), background-color 160ms ease-out, box-shadow 160ms ease-out;
        }

        .scravipo-join:hover {
          background: #fffefa;
          box-shadow: 0 0.4rem 1.25rem rgba(243, 241, 236, 0.12);
          transform: translateY(-1px);
        }

        .scravipo-join:active {
          transform: scale(0.97);
        }

        .scravipo-join:focus-visible,
        .scravipo-brand:focus-visible,
        .scravipo-nav__links a:focus-visible,
        .scravipo-mobile-menu a:focus-visible,
        .scravipo-menu-toggle:focus-visible {
          outline: 2px solid var(--chalk);
          outline-offset: 4px;
        }

        .scravipo-join--nav {
          justify-self: end;
        }

        .scravipo-menu-toggle {
          display: none;
          width: 2.5rem;
          height: 2.5rem;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 0.34rem;
          border: 1px solid rgba(243, 241, 236, 0.16);
          border-radius: 0.5rem;
          background: transparent;
          color: var(--chalk);
        }

        .scravipo-menu-toggle span {
          width: 0.95rem;
          height: 1px;
          background: currentColor;
          transition: transform 180ms ease-out;
        }

        .scravipo-mobile-menu {
          display: none;
        }

        .scravipo-hero__content {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          flex-direction: column;
          width: min(46rem, calc(100% - 2rem));
          margin: clamp(7rem, 14.5vh, 10.2rem) auto 0;
          text-align: center;
          animation: scravipo-rise 0.84s 80ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }

        .scravipo-eyebrow {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }

        .scravipo-hero h1 {
          display: flex;
          align-items: center;
          flex-direction: column;
          margin: 0;
          color: var(--chalk);
          font-family: "Times New Roman MT Condensed", "Times New Roman", Times, serif;
          font-size: clamp(4rem, 7.65vw, 7.2rem);
          font-weight: 400;
          letter-spacing: -0.085em;
          line-height: 1.1;
          text-wrap: balance;
        }

        .scravipo-hero h1 > span {
          display: block;
          white-space: nowrap;
        }

        .scravipo-hero__line-top,
        .scravipo-hero__line-bottom {
          display: block;
          white-space: nowrap;
        }

        .scravipo-cycle-word {
          display: inline;
          transition: opacity 0.6s ease;
        }

        .scravipo-description {
          max-width: 29rem;
          margin: 2.05rem 0 0;
          color: var(--muted-chalk);
          font-size: clamp(0.78rem, 1vw, 0.9rem);
          font-weight: 400;
          letter-spacing: -0.035em;
          line-height: 1.36;
        }

        .scravipo-signals {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0.58rem;
          margin: 0.72rem 0 0;
          color: var(--quiet-chalk);
          font-size: 0.54rem;
          font-weight: 700;
          letter-spacing: 0.145em;
          line-height: 1.3;
          text-transform: uppercase;
        }

        .scravipo-signals i {
          color: rgba(243, 241, 236, 0.4);
          font-style: normal;
        }

        .scravipo-join--hero {
          margin-top: 2.12rem;
        }

        .scravipo-statue {
          position: absolute;
          z-index: 2;
          right: clamp(-4.8rem, -3.4vw, -1.35rem);
          bottom: clamp(-4.8rem, -3.9vw, -1.1rem);
          width: min(39rem, 42vw);
          height: auto;
          pointer-events: none;
          user-select: none;
          filter: saturate(0.72) contrast(0.96) brightness(0.88);
          opacity: 0.96;
          animation: scravipo-statue-in 1.2s 140ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }

        .scravipo-scratch {
          position: absolute;
          z-index: 0;
          right: 8%;
          bottom: 15%;
          width: 13rem;
          height: 22rem;
          border-radius: 50%;
          opacity: 0.16;
          background: radial-gradient(ellipse at center, rgba(141, 141, 148, 0.25) 0%, transparent 67%);
          filter: blur(2.2rem);
          pointer-events: none;
          transform: rotate(-18deg);
        }

        .scravipo-cloud {
          position: absolute;
          z-index: 1;
          width: clamp(16rem, 24vw, 28rem);
          height: auto;
          pointer-events: none;
          user-select: none;
          opacity: 0.65;
          filter: brightness(0.9) contrast(1.05);
        }

        .scravipo-cloud--left {
          left: clamp(-8rem, -6vw, -4rem);
          top: clamp(-8rem, -7vw, -6rem);
        }

        .scravipo-cloud--right {
          right: clamp(-8rem, -6vw, -4rem);
          top: clamp(-8rem, -7vw, -6rem);
          transform: scaleX(-1);
        }

        @keyframes scravipo-rise {
          from { opacity: 0; transform: translateY(0.7rem); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes scravipo-statue-in {
          from { opacity: 0; transform: translate3d(1.1rem, 1.8rem, 0) scale(0.985); }
          to { opacity: 0.96; transform: translate3d(0, 0, 0) scale(1); }
        }

        @media (max-width: 760px) {
          .scravipo-nav-wrap {
            padding-top: 1rem;
          }

          .scravipo-nav {
            grid-template-columns: 1fr auto;
            min-height: 4rem;
            padding: 0.7rem 1rem 0.7rem 1.25rem;
            border-radius: 999px;
          }

          .scravipo-nav__links,
          .scravipo-join--nav {
            display: none;
          }

          .scravipo-menu-toggle {
            display: inline-flex;
            justify-self: end;
          }

          .scravipo-mobile-backdrop {
            display: none;
          }

          .scravipo-mobile-backdrop.is-open {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 4;
            background: rgba(0, 0, 0, 0.55);
          }

          .scravipo-mobile-menu {
            display: flex;
            position: absolute;
            top: calc(100% + 0.45rem);
            right: 0;
            left: 0;
            z-index: 50;
            align-items: stretch;
            flex-direction: column;
            gap: 1.1rem;
            max-height: 0;
            overflow: hidden;
            visibility: hidden;
            opacity: 0;
            transform: translateY(-0.4rem);
            padding: 0 1.1rem;
            border: 1px solid transparent;
            border-radius: 0.75rem;
            background: rgba(24, 24, 27, 0.92);
            backdrop-filter: blur(18px);
            pointer-events: none;
            transition: max-height 220ms ease-out, padding 220ms ease-out, border-color 220ms ease-out, opacity 220ms ease-out, transform 220ms ease-out, visibility 220ms;
          }

          .scravipo-mobile-menu.is-open {
            visibility: visible;
            opacity: 1;
            transform: translateY(0);
            max-height: 18rem;
            padding: 1.1rem;
            border-color: rgba(255, 255, 255, 0.07);
            pointer-events: auto;
          }

          .scravipo-mobile-menu a:last-child {
            color: var(--chalk);
          }

          .scravipo-cloud--left {
            left: -4rem;
            top: -5rem;
            bottom: auto;
            width: clamp(12rem, 32vw, 16rem);
            opacity: 0.45;
          }

          .scravipo-cloud--right {
            right: -4rem;
            top: -5rem;
            bottom: auto;
            width: clamp(12rem, 32vw, 16rem);
            opacity: 0.45;
          }

          .scravipo-hero__content {
            width: calc(100% - 2rem);
            margin-top: clamp(6.7rem, 16vh, 9rem);
          }

          .scravipo-hero h1 {
            max-width: 100%;
            font-size: clamp(2.25rem, 11.5vw, 3.5rem);
            letter-spacing: -0.085em;
          }

          .scravipo-hero h1 > span,
          .scravipo-hero__line-top,
          .scravipo-hero__line-bottom {
            max-width: 100%;
          }

          .scravipo-description {
            max-width: 21rem;
            margin-top: 1.55rem;
            font-size: 0.77rem;
          }

          .scravipo-description__desktop-break {
            display: none;
          }

          .scravipo-signals {
            max-width: 18rem;
            font-size: 0.48rem;
          }

          .scravipo-statue {
            right: -6.5rem;
            bottom: -2rem;
            width: min(34rem, 89vw);
            opacity: 0.8;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .scravipo-nav,
          .scravipo-hero__content,
          .scravipo-statue {
            animation: none;
          }

          .scravipo-nav__links a,
          .scravipo-mobile-menu a,
          .scravipo-join,
          .scravipo-menu-toggle span,
          .scravipo-mobile-menu {
            transition-duration: 0.01ms;
          }
        }
        html,
        body,
        #root {
          width: 100%;
          min-width: 0;
          background: #0a0a0a;
          overflow-x: hidden;
        }

        .scravipo-dashboard {
          position: relative;
          width: 100%;
          box-sizing: border-box;
          z-index: 3;
          min-height: 100svh;
          padding: clamp(5rem, 10vw, 9.5rem) clamp(1rem, 6vw, 5.5rem) clamp(4.2rem, 7vw, 6.6rem);
          background:
            radial-gradient(circle at 50% 20%, rgba(104, 130, 151, 0.08), transparent 38%),
            linear-gradient(180deg, #0b0d0f 0%, #090a0b 42%, #0a0a0a 100%);
          color: #f3f1ec;
          font-family: Arial, Helvetica, sans-serif;
          overflow: hidden;
        }

        .scravipo-dashboard,
        .scravipo-dashboard * {
          box-sizing: border-box;
        }

        .scravipo-dashboard::before {
          position: absolute;
          top: 0;
          right: 6vw;
          left: 6vw;
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          content: "";
        }

        .scravipo-dashboard__intro {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 2rem;
          max-width: 79rem;
          margin: 0 auto 2.4rem;
          position: relative;
          z-index: 2;
        }

        .scravipo-dashboard__kicker {
          margin: 0 0 0.8rem;
          color: rgba(243, 241, 236, 0.43);
          font-size: 0.62rem;
          font-weight: 600;
          letter-spacing: 0.15em;
          text-transform: uppercase;
        }

        .scravipo-dashboard__kicker span {
          padding: 0 0.35rem;
          color: rgba(243, 241, 236, 0.23);
        }

        .scravipo-dashboard h2 {
          margin: 0;
          color: #f3f1ec;
          font-family: "Times New Roman MT Condensed", "Times New Roman", Times, serif;
          font-size: clamp(2.65rem, 5.1vw, 5.3rem);
          font-weight: 400;
          letter-spacing: -0.075em;
          line-height: 0.93;
        }

        .scravipo-dashboard__subtitle {
          max-width: 27rem;
          margin: 0.85rem 0 0;
          color: rgba(243, 241, 236, 0.47);
          font-size: 0.77rem;
          letter-spacing: -0.02em;
          line-height: 1.45;
        }

        .scravipo-dashboard__pulse {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.58rem 0.76rem;
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 999px;
          color: rgba(243, 241, 236, 0.56);
          font-size: 0.62rem;
          letter-spacing: 0.03em;
          white-space: nowrap;
        }

        .scravipo-dashboard__pulse-dot {
          width: 0.38rem;
          height: 0.38rem;
          border-radius: 50%;
          background: #7cc49c;
          box-shadow: 0 0 0 3px rgba(124, 196, 156, 0.1);
        }

        .scravipo-category-nav {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          max-width: 79rem;
          margin: 0 auto 0.85rem;
          overflow-x: auto;
          scrollbar-width: none;
        }

        .scravipo-category-nav::-webkit-scrollbar { display: none; }

        .scravipo-category-nav button,
        .scravipo-tool-button,
        .scravipo-table-more button,
        .scravipo-load-more {
          border: 1px solid transparent;
          background: transparent;
          color: rgba(243, 241, 236, 0.47);
          font-family: Arial, Helvetica, sans-serif;
          cursor: pointer;
          transition: color 150ms ease-out, border-color 150ms ease-out, background-color 150ms ease-out, transform 150ms ease-out;
        }

        .scravipo-category-nav button {
          flex: 0 0 auto;
          padding: 0.68rem 0.86rem;
          border-radius: 0.72rem;
          background: rgba(255, 255, 255, 0.025);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(18px) saturate(1.15);
          -webkit-backdrop-filter: blur(18px) saturate(1.15);
          font-size: 0.69rem;
          font-weight: 600;
          letter-spacing: -0.02em;
        }

        .scravipo-category-nav button:hover { color: #f3f1ec; }

        .scravipo-category-nav button.is-active {
          border-color: rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.06);
          color: #f3f1ec;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
        }

        .scravipo-lead-panel {
          max-width: 79rem;
          margin: 0 auto;
          /* Visuals handled by .liquid-glass */
        }

        .scravipo-lead-panel__header,
        .scravipo-lead-panel__footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1.35rem 1.35rem 1.15rem;
        }

        .scravipo-lead-panel__header {
          min-height: 5.4rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .scravipo-lead-panel__header h3 {
          margin: 0;
          color: rgba(243, 241, 236, 0.95);
          font-size: 0.96rem;
          font-weight: 600;
          letter-spacing: -0.035em;
        }

        .scravipo-lead-panel__header p {
          margin: 0.34rem 0 0;
          color: rgba(243, 241, 236, 0.4);
          font-size: 0.67rem;
          letter-spacing: -0.01em;
        }

        .scravipo-lead-panel__actions {
          display: flex;
          align-items: center;
          justify-content: end;
          gap: 0.44rem;
        }

        .scravipo-search {
          display: flex;
          align-items: center;
          width: min(15rem, 25vw);
          height: 2.15rem;
          padding: 0 0.52rem 0 0.72rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.68rem;
          background: rgba(255, 255, 255, 0.045);
          color: rgba(243, 241, 236, 0.48);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0.7rem 2rem rgba(0, 0, 0, 0.08);
          backdrop-filter: blur(22px) saturate(1.2);
          -webkit-backdrop-filter: blur(22px) saturate(1.2);
        }

        .scravipo-search__icon {
          margin-right: 0.45rem;
          font-size: 1rem;
          line-height: 1;
          transform: translateY(-1px) rotate(-20deg);
        }

        .scravipo-search input {
          min-width: 0;
          flex: 1;
          border: 0;
          outline: 0;
          background: transparent;
          color: #f3f1ec;
          font: inherit;
          font-size: 0.67rem;
        }

        .scravipo-search input::placeholder { color: rgba(243, 241, 236, 0.35); }

        .scravipo-search kbd {
          padding: 0.2rem 0.28rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 0.25rem;
          color: rgba(243, 241, 236, 0.32);
          font-size: 0.53rem;
          white-space: nowrap;
        }

        .scravipo-tool-button {
          height: 2.15rem;
          padding: 0 0.65rem;
          border-color: rgba(255, 255, 255, 0.07);
          border-radius: 0.48rem;
          font-size: 0.63rem;
        }

        .scravipo-tool-button span {
          display: inline-block;
          margin-right: 0.24rem;
          color: rgba(243, 241, 236, 0.7);
          font-size: 0.84rem;
          vertical-align: -1px;
        }

        .scravipo-tool-button:hover { border-color: rgba(255, 255, 255, 0.15); color: #f3f1ec; }

        .scravipo-table-scroll {
          width: 100%;
          max-width: 100%;
          overflow-x: auto;
          overscroll-behavior-x: contain;
        }

        .scravipo-lead-table {
          width: 100%;
          min-width: 720px;
          border-collapse: collapse;
          table-layout: auto;
        }

        .scravipo-lead-table th {
          padding: 0.78rem 0.78rem;
          color: rgba(243, 241, 236, 0.34);
          font-size: 0.54rem;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-align: left;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .scravipo-lead-table td {
          padding: 0.92rem 0.78rem;
          border-top: 1px solid rgba(255, 255, 255, 0.055);
          color: rgba(243, 241, 236, 0.63);
          font-size: 0.68rem;
          letter-spacing: -0.01em;
          white-space: nowrap;
        }

        .scravipo-lead-table tbody tr { transition: background-color 140ms ease-out; }
        .scravipo-lead-table tbody tr:hover { background: rgba(255, 255, 255, 0.025); }
        .scravipo-lead-table tbody tr.is-selected { background: rgba(116, 151, 185, 0.07); }

        .scravipo-table-check {
          width: 3rem;
          padding-right: 0.24rem !important;
          padding-left: 1.35rem !important;
          text-align: center;
        }

        .scravipo-table-more {
          width: 3rem;
          padding-right: 1.35rem !important;
          text-align: right !important;
        }

        .scravipo-table-more button {
          padding: 0.2rem;
          color: rgba(243, 241, 236, 0.38);
          font-size: 0.7rem;
          letter-spacing: 0.08em;
        }

        .scravipo-table-more button:hover { color: #f3f1ec; }

        @keyframes scravipo-blink {
          0%, 100% { border-right-color: transparent; }
          50% { border-right-color: rgba(255,255,255,0.7); }
        }


        .scravipo-lead-table input[type="checkbox"] {
          width: 0.85rem;
          height: 0.85rem;
          margin: 0;
          appearance: none;
          border: 1px solid rgba(243, 241, 236, 0.23);
          border-radius: 0.22rem;
          background: transparent;
          cursor: pointer;
          vertical-align: middle;
        }

        .scravipo-lead-table input[type="checkbox"]:checked {
          border-color: #b8d0dc;
          background: #b8d0dc;
          box-shadow: inset 0 0 0 3px #16191a;
        }

        .scravipo-identity {
          display: inline-flex;
          align-items: center;
          min-width: 13.5rem;
          gap: 0.66rem;
        }

        .scravipo-avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.8rem;
          height: 1.8rem;
          flex: 0 0 1.8rem;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 50%;
          background: linear-gradient(145deg, #36383a, #171819);
          color: rgba(243, 241, 236, 0.76);
          font-size: 0.55rem;
          font-weight: 700;
          letter-spacing: -0.04em;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
        }

        .scravipo-avatar.has-image img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: saturate(0.82) contrast(1.05);
        }

        .scravipo-identity strong,
        .scravipo-identity small {
          display: block;
        }

        .scravipo-identity strong {
          color: rgba(243, 241, 236, 0.91);
          font-size: 0.71rem;
          font-weight: 600;
          letter-spacing: -0.025em;
        }

        .scravipo-identity small {
          margin-top: 0.23rem;
          color: rgba(243, 241, 236, 0.36);
          font-size: 0.58rem;
          letter-spacing: -0.01em;
        }

        .scravipo-tags {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 0.3rem;
          max-width: 12rem;
        }

        .scravipo-tags em {
          padding: 0.25rem 0.42rem;
          border: 1px solid rgba(145, 181, 192, 0.13);
          border-radius: 999px;
          background: rgba(112, 151, 165, 0.08);
          color: rgba(192, 221, 227, 0.66);
          font-size: 0.54rem;
          font-style: normal;
          letter-spacing: -0.01em;
        }

        .scravipo-mono {
          color: rgba(243, 241, 236, 0.52);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.59rem;
        }

        .scravipo-linkish { color: rgba(166, 199, 206, 0.7); }

        .scravipo-empty {
          padding: 3rem 1rem !important;
          color: rgba(243, 241, 236, 0.4) !important;
          text-align: center;
        }

        .scravipo-lead-panel__footer {
          min-height: 3.7rem;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          color: rgba(243, 241, 236, 0.31);
          font-size: 0.6rem;
        }

        .scravipo-load-more {
          padding: 0.42rem 0.62rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 0.38rem;
          color: rgba(243, 241, 236, 0.55);
          font-size: 0.61rem;
          text-decoration: none;
        }

        .scravipo-load-more span { margin-left: 0.25rem; color: rgba(243, 241, 236, 0.75); }
        .scravipo-load-more:hover { border-color: rgba(255, 255, 255, 0.16); color: #f3f1ec; }

        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        @media (max-width: 860px) {
          .scravipo-dashboard__intro { align-items: start; flex-direction: column; }
          .scravipo-dashboard__pulse { align-self: start; }
          .scravipo-lead-panel__header { align-items: start; flex-direction: column; }
          .scravipo-lead-panel__actions { width: 100%; justify-content: start; }
          .scravipo-search { width: min(18rem, 100%); }
        }

        @media (max-width: 560px) {
          .scravipo-dashboard { padding-right: 1rem; padding-left: 1rem; }
          .scravipo-dashboard::before { right: 1rem; left: 1rem; }
          .scravipo-dashboard__intro { margin-bottom: 1.6rem; }
          .scravipo-dashboard h2 { font-size: clamp(3rem, 15vw, 4.6rem); }
          .scravipo-dashboard__subtitle { max-width: 20rem; }
          .scravipo-category-nav { margin-right: -1rem; margin-left: -0.3rem; padding-right: 1rem; }
          .scravipo-lead-panel__header { padding: 1rem; }
          .scravipo-lead-panel__actions { flex-wrap: wrap; }
          .scravipo-lead-panel__footer { padding: 1rem; }
          .scravipo-table-check { padding-left: 1rem !important; }
          .scravipo-table-more { padding-right: 1rem !important; }
          .scravipo-liquid-search-container { padding: 1rem; gap: 0.85rem; }
          .scravipo-liquid-search__input-row { font-size: 1rem; }
          .scravipo-liquid-search__controls { flex-wrap: wrap; gap: 0.5rem; }
          .scravipo-liquid-search__chips {
            flex: 1 1 100%;
            max-width: 100%;
            overflow-x: auto;
            scrollbar-width: none;
            padding-bottom: 0.15rem;
          }
          .scravipo-liquid-search__chips::-webkit-scrollbar { display: none; }
          .scravipo-liquid-search__chips .scravipo-liquid-btn { flex: 0 0 auto; }
          .scravipo-liquid-btn { padding: 0.42rem 0.75rem; font-size: 0.78rem; }
          .scravipo-liquid-btn--icon,
          .scravipo-liquid-btn--submit { flex: 0 0 auto; }
          .scravipo-liquid-search__actions { flex: 1 1 100%; justify-content: flex-end; }
        }

        @media (prefers-reduced-motion: reduce) {
          .scravipo-category-nav button,
          .scravipo-tool-button,
          .scravipo-table-more button,
          .scravipo-load-more,
          .scravipo-lead-table tbody tr { transition-duration: 0.01ms; }
        }
        .scravipo-bento {
          position: relative;
          width: 100%;
          min-height: auto;
          padding: clamp(4.5rem, 8vw, 7rem) clamp(1rem, 6vw, 5.5rem) clamp(2rem, 3.8vw, 3.7rem);
          overflow: hidden;
          box-sizing: border-box;
          background: #0a0a0a;
          color: #f3f1ec;
          font-family: Arial, Helvetica, sans-serif;
        }

        .scravipo-bento,
        .scravipo-bento * { box-sizing: border-box; }

        .scravipo-bento::before {
          position: absolute;
          top: 0;
          right: 6vw;
          left: 6vw;
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          content: "";
        }

        .scravipo-bento::after {
          position: absolute;
          top: -12rem;
          left: 50%;
          width: 52rem;
          height: 26rem;
          border-radius: 50%;
          background: radial-gradient(ellipse, rgba(117, 143, 166, 0.13), transparent 68%);
          content: "";
          filter: blur(3rem);
          pointer-events: none;
          transform: translateX(-50%);
        }

        .scravipo-bento__heading {
          position: relative;
          z-index: 1;
          max-width: 79rem;
          margin: 0 auto 2.7rem;
          text-align: center;
        }

        .scravipo-bento__kicker {
          margin: 0 0 0.85rem;
          color: rgba(243, 241, 236, 0.42);
          font-size: 0.61rem;
          font-weight: 600;
          letter-spacing: 0.15em;
          text-transform: uppercase;
        }

        .scravipo-bento__kicker span { padding: 0 0.35rem; color: rgba(243, 241, 236, 0.21); }

        .scravipo-bento__heading h2 {
          margin: 0;
          color: #f3f1ec;
          font-family: "Times New Roman MT Condensed", "Times New Roman", Times, serif;
          font-size: clamp(3.05rem, 6vw, 6.2rem);
          font-weight: 400;
          letter-spacing: -0.08em;
          line-height: 0.92;
        }

        .scravipo-bento__heading > p:last-child {
          margin: 1rem auto 0;
          color: rgba(243, 241, 236, 0.45);
          font-size: 1.05rem;
          letter-spacing: -0.02em;
        }

        .scravipo-bento__grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.42fr);
          grid-template-rows: minmax(21rem, 0.95fr) minmax(16rem, 0.72fr);
          gap: 1.15rem;
          max-width: 79rem;
          min-height: 0;
          margin: 0 auto;
        }

        .scravipo-bento-card {
          position: relative;
          display: flex;
          flex-direction: column;
          min-width: 0;
          overflow: hidden;
          padding: clamp(1.25rem, 2.2vw, 2rem);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 1.15rem;
          background:
            linear-gradient(145deg, rgba(75, 86, 95, 0.48), rgba(25, 29, 33, 0.56) 47%, rgba(10, 11, 12, 0.76)),
            rgba(23, 26, 29, 0.56);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.13), inset 0 0 0 1px rgba(138, 180, 205, 0.09), 0 1.7rem 4.5rem rgba(0, 0, 0, 0.26);
          backdrop-filter: blur(30px) saturate(1.25);
          -webkit-backdrop-filter: blur(30px) saturate(1.25);
          isolation: isolate;
          transition: border-color 180ms ease-out, transform 180ms ease-out, box-shadow 180ms ease-out;
        }

        .scravipo-bento-card::before {
          position: absolute;
          inset: 1px;
          z-index: -1;
          border-radius: inherit;
          background:
            linear-gradient(135deg, rgba(206, 230, 240, 0.13), transparent 31%, transparent 68%, rgba(255, 255, 255, 0.05)),
            radial-gradient(circle at 16% 0%, rgba(255, 255, 255, 0.11), transparent 36%);
          content: "";
          pointer-events: none;
          animation: scravipo-breathe 4s ease-in-out infinite;
        }

        @keyframes scravipo-breathe {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .scravipo-bento-card:hover {
          border-color: rgba(178, 210, 224, 0.23);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1.8rem 4.8rem rgba(0, 0, 0, 0.27), 0 0 2rem rgba(127, 166, 185, 0.06);
          transform: translateY(-2px);
        }

        .scravipo-bento-card--tall { grid-column: 1; grid-row: 1; }
        .scravipo-bento-card--qualify { grid-column: 2; grid-row: 1; }
        .scravipo-bento-card--verified { grid-column: 1; grid-row: 2; }
        .scravipo-bento-card--outreach { grid-column: 2; grid-row: 2; }

        .scravipo-bento-card__copy { position: relative; z-index: 2; max-width: 28rem; }

        .scravipo-bento-card__label {
          display: flex;
          align-items: center;
          gap: 0.52rem;
          margin: 0 0 1.2rem;
          color: rgba(190, 219, 228, 0.68);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.85rem;
          letter-spacing: 0.11em;
          text-transform: uppercase;
        }

        .scravipo-bento-card__label span { color: rgba(243, 241, 236, 0.35); letter-spacing: 0.07em; }

        .scravipo-bento-card h3 {
          max-width: 19rem;
          margin: 0;
          color: rgba(247, 246, 241, 0.93);
          font-family: "Times New Roman MT Condensed", "Times New Roman", Times, serif;
          font-size: clamp(1.85rem, 3vw, 3.35rem);
          font-weight: 400;
          letter-spacing: -0.07em;
          line-height: 0.94;
        }

        .scravipo-bento-card__copy > p:last-child {
          max-width: 25rem;
          margin: 1rem 0 0;
          color: rgba(243, 241, 236, 0.58);
          font-size: 1rem;
          letter-spacing: -0.018em;
          line-height: 1.5;
        }

        .scravipo-flow {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          gap: 0.22rem;
          margin-top: auto;
          padding: 0.9rem 0.95rem;
          border: 1px solid rgba(177, 213, 228, 0.18);
          border-radius: 0.75rem;
          background: linear-gradient(145deg, rgba(97, 120, 137, 0.27), rgba(23, 27, 30, 0.52));
          box-shadow: inset 0 1px 0 rgba(211, 233, 239, 0.14), 0 1.2rem 2.8rem rgba(0, 0, 0, 0.17);
        }

        .scravipo-flow__step {
          display: grid;
          grid-template-columns: 1.8rem 1fr auto;
          align-items: center;
          min-height: 2.8rem;
          gap: 0.6rem;
        }

        .scravipo-flow__number {
          color: rgba(181, 213, 225, 0.55);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.53rem;
        }

        .scravipo-flow__step strong,
        .scravipo-flow__step small { display: block; }
        .scravipo-flow__step strong { color: rgba(243, 241, 236, 0.84); font-size: 0.66rem; font-weight: 600; }
        .scravipo-flow__step small { margin-top: 0.18rem; color: rgba(243, 241, 236, 0.36); font-size: 0.56rem; }
        .scravipo-flow__step i { color: rgba(172, 210, 222, 0.53); font-size: 0.75rem; font-style: normal; }

        .scravipo-signal-window,
        .scravipo-contact-proof,
        .scravipo-outreach-strip {
          margin-top: auto;
          border: 1px solid rgba(177, 213, 228, 0.16);
          background: rgba(85, 108, 124, 0.16);
          box-shadow: inset 0 1px 0 rgba(211, 233, 239, 0.12);
        }

        .scravipo-signal-window { padding: 0.6rem 0.8rem; border-radius: 0.67rem; }
        .scravipo-signal-window__line { display: grid; grid-template-columns: 0.55rem 1fr auto; align-items: center; gap: 0.48rem; min-height: 2rem; border-bottom: 1px solid rgba(255, 255, 255, 0.055); color: rgba(243, 241, 236, 0.6); font-size: 0.61rem; }
        .scravipo-signal-window__line:last-child { border-bottom: 0; }
        .scravipo-signal-window__line strong { color: rgba(192, 224, 232, 0.8); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.57rem; font-weight: 500; }
        .scravipo-signal-window__dot { width: 0.36rem; height: 0.36rem; border-radius: 50%; }
        .scravipo-signal-window__dot.is-blue { background: #91b9db; box-shadow: 0 0 0 3px rgba(145, 185, 219, 0.11); }
        .scravipo-signal-window__dot.is-green { background: #86c5a0; box-shadow: 0 0 0 3px rgba(134, 197, 160, 0.1); }
        .scravipo-signal-window__dot.is-amber { background: #c9a978; box-shadow: 0 0 0 3px rgba(201, 169, 120, 0.1); }

        .scravipo-contact-proof { display: flex; align-items: center; gap: 0.58rem; padding: 0.75rem; border-radius: 0.67rem; }
        .scravipo-contact-proof__avatar { display: inline-flex; align-items: center; justify-content: center; width: 1.9rem; height: 1.9rem; border-radius: 50%; background: linear-gradient(145deg, #717e85, #283039); color: rgba(243, 241, 236, 0.83); font-size: 0.55rem; font-weight: 700; }
        .scravipo-contact-proof__identity { flex: 1; }
        .scravipo-contact-proof__identity strong,
        .scravipo-contact-proof__identity small { display: block; }
        .scravipo-contact-proof__identity strong { color: rgba(243, 241, 236, 0.82); font-size: 0.63rem; font-weight: 600; }
        .scravipo-contact-proof__identity small { margin-top: 0.18rem; color: rgba(243, 241, 236, 0.38); font-size: 0.55rem; }
        .scravipo-contact-proof__check { display: inline-flex; align-items: center; justify-content: center; width: 1.15rem; height: 1.15rem; border: 1px solid rgba(134, 197, 160, 0.36); border-radius: 50%; color: #9fd1ac; font-size: 0.65rem; }

        .scravipo-outreach-strip { display: flex; align-items: center; flex-wrap: wrap; gap: 0.55rem; margin-top: 1.25rem; padding: 0.6rem 0.75rem; border-radius: 0.6rem; color: rgba(243, 241, 236, 0.36); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.54rem; }
        .scravipo-outreach-strip b { color: rgba(243, 241, 236, 0.78); font-size: 0.58rem; font-weight: 500; }
        .scravipo-outreach-strip b.is-accent { color: #acd2de; }

        .scravipo-adapts { display: flex; align-items: start; gap: 0.65rem; max-width: 25rem; margin-top: auto; padding-top: 1.1rem; border-top: 1px solid rgba(255, 255, 255, 0.07); }
        .scravipo-adapts__icon { display: inline-flex; align-items: center; justify-content: center; width: 1.45rem; height: 1.45rem; border: 1px solid rgba(172, 210, 222, 0.22); border-radius: 50%; color: rgba(172, 210, 222, 0.8); font-size: 0.75rem; }
        .scravipo-adapts strong,
        .scravipo-adapts small { display: block; }
        .scravipo-adapts strong { color: rgba(243, 241, 236, 0.82); font-size: 0.65rem; font-weight: 600; }
        .scravipo-adapts small { max-width: 18rem; margin-top: 0.25rem; color: rgba(243, 241, 236, 0.4); font-size: 0.57rem; line-height: 1.4; }

        @media (max-width: 860px) {
          .scravipo-bento__grid { grid-template-columns: 1fr 1fr; grid-template-rows: auto; min-height: 0; }
          .scravipo-bento-card--tall { grid-column: auto; grid-row: auto; }
          .scravipo-bento-card--qualify,
          .scravipo-bento-card--verified { grid-column: auto; }
          .scravipo-bento-card--outreach { grid-column: 1 / span 2; grid-row: auto; min-height: 34rem; }
        }

        @media (max-width: 580px) {
          .scravipo-bento { padding-right: 1rem; padding-left: 1rem; }
          .scravipo-bento::before { right: 1rem; left: 1rem; }
          .scravipo-bento__heading { margin-bottom: 2rem; text-align: left; }
          .scravipo-bento__heading h2 { font-size: clamp(3.1rem, 15vw, 4.5rem); }
          .scravipo-bento__heading > p:last-child { max-width: 18rem; margin-left: 0; line-height: 1.4; }
          .scravipo-bento__grid { display: flex; flex-direction: column; gap: 0.8rem; }
          .scravipo-bento-card { min-height: 26rem; padding: 1.15rem; }
          .scravipo-bento-card--tall { min-height: 34rem; }
          .scravipo-bento-card--outreach { }
        }

        @media (prefers-reduced-motion: reduce) {
          .scravipo-bento-card { transition-duration: 0.01ms; }
        }

        .scravipo-footer {
          position: relative;
          width: calc(100% - clamp(2rem, 8vw, 7rem));
          margin: 0 auto clamp(1.25rem, 3vw, 3rem);
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.045);
          background: #020202;
          color: #f3f1ec;
          font-family: Arial, Helvetica, sans-serif;
          border-radius: 1.5rem;
          padding: 4rem clamp(1.5rem, 5vw, 5.5rem) 1.5rem;
        }

        .scravipo-footer::before {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.018), transparent 13%, transparent 100%);
          content: "";
          pointer-events: none;
        }

        .scravipo-footer__atmosphere {
          position: absolute;
          top: 25%;
          left: 50%;
          width: min(70vw, 62rem);
          height: min(36vw, 32rem);
          border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(112, 116, 121, 0.14) 0%, rgba(41, 43, 45, 0.07) 32%, transparent 70%);
          filter: blur(2.7rem);
          pointer-events: none;
          transform: translateX(-50%);
        }

        .scravipo-footer__content {
          position: relative;
          z-index: 2;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 2rem;
          align-items: center;
        }

        .scravipo-footer__label {
          margin: 0 0 1rem;
          color: rgba(243, 241, 236, 0.42);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.59rem;
          font-weight: 500;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .scravipo-footer__copy {
          margin: 0;
          color: rgba(243, 241, 236, 0.93);
          font-family: "Times New Roman MT Condensed", "Times New Roman", Times, serif;
          font-size: clamp(1.55rem, 2.55vw, 3rem);
          font-weight: 400;
          letter-spacing: -0.06em;
          line-height: 0.98;
        }

        .scravipo-footer__email {
          display: inline-flex;
          align-items: center;
          gap: 0.58rem;
          margin-top: 1.45rem;
          padding: 0.6rem 0.78rem;
          border: 1px solid rgba(243, 241, 236, 0.22);
          color: rgba(243, 241, 236, 0.78);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.59rem;
          letter-spacing: 0.07em;
          text-decoration: none;
          text-transform: uppercase;
          transition: color 150ms ease-out, border-color 150ms ease-out, background-color 150ms ease-out;
        }

        .scravipo-footer__email:hover { border-color: rgba(243, 241, 236, 0.55); background: rgba(243, 241, 236, 0.06); color: #fff; }

        .scravipo-footer__socials { justify-self: start; }

        .scravipo-footer__social-list {
          display: flex;
          flex-direction: column;
          align-items: start;
          gap: 0.38rem;
        }

        .scravipo-footer__social-list a {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: clamp(9.5rem, 14vw, 13rem);
          min-height: 2rem;
          padding: 0.4rem 0.56rem 0.4rem 0.68rem;
          border: 1px solid rgba(243, 241, 236, 0.18);
          background: #020202;
          color: rgba(243, 241, 236, 0.72);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.57rem;
          letter-spacing: 0.08em;
          text-decoration: none;
          text-transform: uppercase;
          transition: color 150ms ease-out, border-color 150ms ease-out, transform 150ms ease-out;
        }

        .scravipo-footer__social-list a:hover { border-color: rgba(243, 241, 236, 0.58); color: #fff; transform: translateX(3px); }
        .scravipo-footer__social-list a span:last-child { color: rgba(243, 241, 236, 0.42); font-size: 0.78rem; }

        .scravipo-footer__mark {
          justify-self: center;
          width: 9rem;
          height: 9rem;
          border-radius: 50%;
          overflow: hidden;
        }

        .scravipo-footer__mark img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .scravipo-footer__top {
          padding: 0.45rem 0.62rem;
          border: 1px solid rgba(243, 241, 236, 0.13);
          background: transparent;
          color: rgba(243, 241, 236, 0.48);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.53rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          transition: border-color 150ms ease-out, color 150ms ease-out, transform 150ms ease-out;
        }

        .scravipo-footer__top:hover { border-color: rgba(243, 241, 236, 0.48); color: #fff; transform: translateY(-1px); }

        .scravipo-footer__bottom {
          position: relative;
          z-index: 3;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 1.5rem;
          margin-top: 4rem;
          border-top: 1px solid rgba(243, 241, 236, 0.12);
          color: rgba(243, 241, 236, 0.38);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.8rem;
          letter-spacing: 0.04em;
        }

        @media (max-width: 620px) {
          .scravipo-footer {
            width: calc(100% - 2rem);
            min-height: 47rem;
          }

          .scravipo-footer__content {
            right: 1.2rem;
            bottom: 6rem;
            left: 1.2rem;
            grid-template-columns: 1fr;
            gap: 2.4rem;
          }

          .scravipo-footer__copy { font-size: clamp(1.65rem, 8vw, 2.5rem); }
          .scravipo-footer__socials { justify-self: start; }
          .scravipo-footer__mark { right: 0.1rem; bottom: 5rem; width: 8.4rem; height: 10.6rem; }
          .scravipo-footer__mark span { font-size: 19rem; }
          .scravipo-footer__bottom { right: 1.2rem; bottom: 1.2rem; left: 1.2rem; align-items: start; flex-direction: column; gap: 0.55rem; }
        }

        @media (prefers-reduced-motion: reduce) {
          .scravipo-footer__email,
          .scravipo-footer__social-list a { transition-duration: 0.01ms; }
        }

        .scravipo-faq-item {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.025);
          border-radius: 1.1rem;
          padding: 0 1.5rem;
          backdrop-filter: blur(24px) saturate(1.2);
          -webkit-backdrop-filter: blur(24px) saturate(1.2);
          box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.06);
          margin-bottom: 0.85rem;
          transition: background 200ms ease, border-color 200ms ease;
        }

        .scravipo-faq-item:hover {
          background: rgba(255, 255, 255, 0.045);
          border-color: rgba(255, 255, 255, 0.15);
        }

        @keyframes blink-opacity {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        /* --- Apple Liquid Glass Design System --- */
        .liquid-glass {
          position: relative;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(24px) saturate(140%);
          -webkit-backdrop-filter: blur(24px) saturate(140%);
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.25),
            inset 0 -1px 0 rgba(0, 0, 0, 0.25);
          overflow: hidden;
        }

        .liquid-glass::before {
          content: "";
          position: absolute;
          top: -20%;
          left: -10%;
          width: 60%;
          height: 60%;
          background: radial-gradient(
            circle,
            rgba(255, 255, 255, 0.18) 0%,
            rgba(255, 255, 255, 0) 70%
          );
          pointer-events: none;
        }

        .liquid-glass:focus-within,
        .liquid-glass:hover {
          background: rgba(255, 255, 255, 0.08);
          box-shadow:
            0 8px 36px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.32),
            inset 0 -1px 0 rgba(0, 0, 0, 0.25);
          transition: background 0.4s ease, box-shadow 0.4s ease;
        }

        @media (prefers-reduced-motion: reduce) {
          .liquid-glass:focus-within,
          .liquid-glass:hover {
            transition: none;
          }
        }
        /* ---------------------------------------- */

        .scravipo-liquid-search-container {
          width: min(42rem, 100%);
          padding: 1.25rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          cursor: text;
        }

        .scravipo-liquid-search__input-row {
          display: flex;
          align-items: center;
          font-size: 1.15rem;
          color: #fff;
          z-index: 1;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          letter-spacing: -0.01em;
        }

        .scravipo-search__placeholder {
          color: rgba(255, 255, 255, 0.4);
        }

        .scravipo-liquid-btn {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.5rem 1rem;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(24px) saturate(140%);
          -webkit-backdrop-filter: blur(24px) saturate(140%);
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.85rem;
          font-weight: 500;
          border: none;
          outline: none;
          cursor: pointer;
          
          box-shadow: 
            0 4px 16px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.25),
            inset 0 -1px 0 rgba(0, 0, 0, 0.25);
            
          transition: background 0.4s ease, box-shadow 0.4s ease, color 0.4s ease;
          z-index: 1;
          overflow: hidden;
        }

        .scravipo-liquid-btn::before {
          content: "";
          position: absolute;
          top: -20%;
          left: -10%;
          width: 40%;
          height: 80%;
          background: radial-gradient(
            circle,
            rgba(255, 255, 255, 0.18) 0%,
            rgba(255, 255, 255, 0) 70%
          );
          pointer-events: none;
        }

        .scravipo-liquid-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
          box-shadow: 
            0 4px 20px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.32),
            inset 0 -1px 0 rgba(0, 0, 0, 0.25);
        }

        .scravipo-liquid-btn--active {
          background: rgba(255, 255, 255, 0.15);
          color: #fff;
          box-shadow: 
            inset 0 1px 0 rgba(255, 255, 255, 0.4),
            inset 0 -1px 0 rgba(0, 0, 0, 0.2);
        }

        .scravipo-liquid-btn--active::before {
          background: radial-gradient(
            circle,
            rgba(255, 255, 255, 0.25) 0%,
            rgba(255, 255, 255, 0) 70%
          );
        }

        .scravipo-liquid-btn--icon {
          padding: 0;
          width: 2.2rem;
          height: 2.2rem;
          justify-content: center;
        }

        .scravipo-liquid-btn--submit {
          background: #fff;
          color: #000;
          padding: 0;
          width: 2.2rem;
          height: 2.2rem;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(255, 255, 255, 0.3);
        }

        .scravipo-liquid-btn--submit::before {
          display: none;
        }

        .scravipo-liquid-btn--submit:hover {
          background: #f0f0f0;
          box-shadow: 0 6px 16px rgba(255, 255, 255, 0.4);
        }

        .scravipo-liquid-search__controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 1;
        }

        .scravipo-liquid-search__chips,
        .scravipo-liquid-search__actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }
      `}
        </style>
      </section>

      <section className="scravipo-dashboard" id="dashboard" aria-labelledby="dashboard-title">
        <img
          className="scravipo-cloud scravipo-cloud--left"
          src={heroCloudAsset}
          alt=""
          aria-hidden="true"
        />
        <img
          className="scravipo-cloud scravipo-cloud--right"
          src={heroCloudAsset}
          alt=""
          aria-hidden="true"
        />
        <div
          className="scravipo-dashboard__intro"
          style={{
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginBottom: "3.5rem",
          }}
        >
          <div>
            <h2 id="dashboard-title">
              Leads for{" "}
              <em style={{ fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif" }}>
                everything.
              </em>
            </h2>
          </div>

          {/* Home-parity composer: same visuals as Discover UnifiedComposer, click routes to signup/discover */}
          <div
            style={{
              marginTop: "2rem",
              width: "100%",
              display: "flex",
              justifyContent: "center",
              position: "relative",
              zIndex: 10,
            }}
          >
            <div style={{ width: "min(42rem, 100%)" }}>
              <LandingSearchBox
                cta={cta}
                signupSearch={signupSearch}
                displayedQuery={displayedQuery}
                typing={scriptPhase === "typing" || scriptPhase === "deleting"}
              />
            </div>
          </div>
        </div>

        <div className="scravipo-lead-panel liquid-glass">
          <div className="scravipo-lead-panel__header">
            <div>
              <h3>{activeConfig.title}</h3>
              <p>{activeConfig.subtitle}</p>
            </div>
          </div>

          <div className="scravipo-table-scroll">
            <table className="scravipo-lead-table">
              <thead>
                <tr>
                  <th className="scravipo-table-check">
                    <input
                      type="checkbox"
                      aria-label="Select all visible leads"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  {activeConfig.columns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeConfig.rows.map((row) => {
                  const isSelected = selectedRows.includes(row.id);
                  return (
                    <tr key={row.id} className={isSelected ? "is-selected" : ""}>
                      <td className="scravipo-table-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.name}`}
                          checked={isSelected}
                          onChange={() => toggleRow(row.id)}
                        />
                      </td>
                      {activeConfig.columns.map((column) => (
                        <td key={column.key}>
                          {column.key === "name" ? (
                            <div className="scravipo-identity">
                              <span className={`scravipo-avatar${row.image ? " has-image" : ""}`}>
                                {row.image ? (
                                  <img src={row.image} alt={row.imageAlt ?? `${row.name} mark`} />
                                ) : (
                                  row.initials
                                )}
                              </span>
                              <span>
                                <strong>{row.name}</strong>
                                <small>{row.secondary}</small>
                              </span>
                            </div>
                          ) : column.key === "sectors" ? (
                            <span className="scravipo-tags">
                              {(row.tags ?? []).map((tag) => (
                                <em key={tag}>{tag}</em>
                              ))}
                            </span>
                          ) : (
                            <span
                              className={
                                column.key === "website"
                                  ? "scravipo-mono scravipo-linkish"
                                  : column.key === "email"
                                    ? "scravipo-mono"
                                    : ""
                              }
                            >
                              {row.fields[column.key] ?? "—"}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="scravipo-lead-panel__footer">
            <span>
              Showing {activeConfig.rows.length} of {activeConfig.rows.length} signals
            </span>
            <Link to={cta} search={signupSearch} className="scravipo-load-more">
              Load more <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="scravipo-bento" id="how-it-works" aria-labelledby="bento-title">
        <div className="scravipo-bento__heading">
          <h2 id="bento-title">Find the right one.</h2>
          <p>Scravipo does the work between a query and a conversation worth having.</p>
        </div>

        <div className="scravipo-bento__grid">
          <article className="scravipo-bento-card scravipo-bento-card--tall">
            <div className="scravipo-bento-card__copy">
              <p className="scravipo-bento-card__label">
                01 <span>Live discovery</span>
              </p>
              <h3>Real-time search across everything.</h3>
              <p>
                There is no static database to search through. The moment a query arrives, Scravipo
                searches live across multiple sources and turns the freshest signals into a usable
                result.
              </p>
            </div>
            <Card1Flow />
          </article>

          <article className="scravipo-bento-card scravipo-bento-card--qualify">
            <div className="scravipo-bento-card__copy">
              <p className="scravipo-bento-card__label">
                02 <span>Intent intelligence</span>
              </p>
              <h3>Enrich & qualify.</h3>
              <p>
                A raw result is only the beginning. Each one is enriched and checked against intent
                signals before it reaches you, with the reason it qualifies made explicit.
              </p>
            </div>
            <Card2Enrich />
          </article>

          <article className="scravipo-bento-card scravipo-bento-card--verified">
            <div className="scravipo-bento-card__copy">
              <p className="scravipo-bento-card__label">
                03 <span>Trust layer</span>
              </p>
              <h3>Verified contacts.</h3>
              <p>
                Email, phone, and professional details are checked before delivery. No
                scraped-and-dumped lists; only contact paths that have earned their place.
              </p>
            </div>
            <Card3Verified />
          </article>

          <article className="scravipo-bento-card scravipo-bento-card--outreach">
            <div className="scravipo-bento-card__copy">
              <p className="scravipo-bento-card__label">
                04 <span>Workflow ready</span>
              </p>
              <h3>Built for outreach.</h3>
              <p>
                Every lead arrives with the role, contact, and relevance context your sales or BD
                workflow needs, so research becomes a next step; not another spreadsheet.
              </p>
            </div>
            <Card4Outreach />
            <div className="scravipo-adapts">
              <span className="scravipo-adapts__icon">↗</span>
              <span>
                <strong>Adapts to what you search.</strong>
                <small>
                  Investor, business, person, company, VC, job; the search and schema reshape around
                  the intent.
                </small>
              </span>
            </div>
          </article>
        </div>
      </section>

      <section
        className="w-full bg-[#0a0a0a] text-[#f3f1ec] py-24 px-4 sm:px-6 lg:px-8 border-t border-white/5"
        id="faq"
      >
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[0.61rem] font-semibold tracking-[0.15em] uppercase text-[#f3f1ec]/40 mb-3">
              Answers
            </p>
            <h2 className="text-4xl md:text-5xl font-normal tracking-[-0.08em] font-['Times_New_Roman_MT_Condensed','Times_New_Roman',Times,serif] leading-[0.92]">
              Frequently Asked Questions.
            </h2>
          </div>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1" className="scravipo-faq-item">
              <AccordionTrigger className="text-sm hover:no-underline hover:text-white text-[#f3f1ec]/90 py-4 font-semibold tracking-[-0.02em]">
                What is Scrapivo?
              </AccordionTrigger>
              <AccordionContent className="text-[#f3f1ec]/60 text-xs leading-relaxed pb-5">
                Scrapivo is an AI-powered B2B lead generation platform that discovers and qualifies
                buyer intent in real-time.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2" className="scravipo-faq-item">
              <AccordionTrigger className="text-sm hover:no-underline hover:text-white text-[#f3f1ec]/90 py-4 font-semibold tracking-[-0.02em]">
                How does it source leads?
              </AccordionTrigger>
              <AccordionContent className="text-[#f3f1ec]/60 text-xs leading-relaxed pb-5">
                We scan the open web, including news, job boards, and company updates, to find
                high-intent signals.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3" className="scravipo-faq-item">
              <AccordionTrigger className="text-sm hover:no-underline hover:text-white text-[#f3f1ec]/90 py-4 font-semibold tracking-[-0.02em]">
                Is there a free tier?
              </AccordionTrigger>
              <AccordionContent className="text-[#f3f1ec]/60 text-xs leading-relaxed pb-5">
                Yes, you can join the Inner Circle and start exploring basic signals for free.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-4" className="scravipo-faq-item">
              <AccordionTrigger className="text-sm hover:no-underline hover:text-white text-[#f3f1ec]/90 py-4 font-semibold tracking-[-0.02em]">
                How is this different from other lead-gen tools?
              </AccordionTrigger>
              <AccordionContent className="text-[#f3f1ec]/60 text-xs leading-relaxed pb-5">
                Instead of stale databases, we provide verified, real-time signals with explicit
                context on why you should reach out.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      <footer className="scravipo-footer" id="footer">
        <div className="scravipo-footer__atmosphere" aria-hidden="true" />

        <div className="scravipo-footer__content">
          <div className="scravipo-footer__contact">
            <p className="scravipo-footer__label">CONTACT:</p>
            <p className="scravipo-footer__copy">
              Reach out for freelance collaborations
              <br className="scravipo-footer__desktop-break" /> or just to say hi :)
            </p>
            <a className="scravipo-footer__email" href="mailto:mirsadat@scrapivo.com">
              Email <span aria-hidden="true">↗</span>
            </a>
          </div>

          <div className="scravipo-footer__socials">
            <p className="scravipo-footer__label">SOCIALS:</p>
            <div className="scravipo-footer__social-list">
              {[
                ["Instagram", "https://www.instagram.com/scrapivo/"],
                ["LinkedIn", "https://www.linkedin.com/company/scrapivo/"],
              ].map(([label, href]) => (
                <a key={label} href={href} target="_blank" rel="noreferrer">
                  <span>{label}</span>
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
            </div>
          </div>

          <div className="scravipo-footer__mark" aria-hidden="true">
            <img src={brandMarkAsset} alt="Scrapivo Logo Mark" />
          </div>
        </div>

        <div className="scravipo-footer__bottom">
          <span>All rights reserved.</span>
          <button className="scravipo-footer__top" type="button" onClick={handleBackToTop}>
            Back to top <span aria-hidden="true">↑</span>
          </button>
          <span>
            Design &amp; dev by Scravipo <b aria-hidden="true">▪▪</b>
          </span>
        </div>
      </footer>
    </>
  );
}
