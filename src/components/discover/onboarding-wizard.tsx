// Chat-style onboarding: Scrapy asks one question at a time; answers become a
// structured Project that pre-fills every search ("the 75% info"). Skippable.
import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Send, CheckCircle2 } from "lucide-react";
import { isOpenNiche } from "@/lib/project-context";

export type OnboardingAnswers = {
  kind: "business" | "freelance";
  business_name: string;
  website?: string;
  about_doc?: string;
  service: string;
  niche: string;
  location: string;
  audience: "companies" | "agencies" | "people" | "all";
  goal: "jobs" | "clients" | "both";
  experience_level: "0-1" | "2-4" | "5+";
  work_style: "remote" | "onsite" | "any";
};

type StepId =
  | "goal"
  | "kind"
  | "business_name"
  | "website"
  | "about"
  | "service"
  | "niche"
  | "location"
  | "experience_level"
  | "work_style"
  | "audience";

type Step = {
  id: StepId;
  prompt: (a: Partial<OnboardingAnswers>) => string;
  input?: "text" | "textarea";
  placeholder?: string;
  optional?: boolean;
  chips?: Array<{ label: string; value: string }>;
};

const STEPS: Step[] = [
  {
    id: "goal",
    prompt: () => "Hey, I'm Scrapy 👋 Let's set up your first project. What do you need help with?",
    chips: [
      { label: "Getting clients for my service or product", value: "clients" },
      { label: "Finding jobs / opportunities", value: "jobs" },
      { label: "Both", value: "both" },
    ],
  },
  {
    id: "kind",
    prompt: (a) =>
      a.goal === "jobs"
        ? "Are you freelancing, or representing a business / team?"
        : "Are you selling as a business, or as a freelancer / solo?",
    chips: [
      { label: "Business / product", value: "business" },
      { label: "Freelance / solo", value: "freelance" },
    ],
  },
  {
    id: "business_name",
    prompt: (a) =>
      a.kind === "business" ? "What's your business called?" : "What's your name (or brand)?",
    input: "text",
    placeholder: "e.g. Mir Sadat / Acme Studio",
  },
  {
    id: "website",
    prompt: () => "Got a website or portfolio? Paste the link — or skip.",
    input: "text",
    placeholder: "https://…",
    optional: true,
    chips: [{ label: "Skip", value: "" }],
  },
  {
    id: "about",
    prompt: () =>
      "Tell me about you — what you've done, your strengths, or past work. The more detail, the better your matches.",
    input: "textarea",
    placeholder: "e.g. 3 years building web apps, 20+ client projects, strongest in React/Next.js…",
    optional: true,
    chips: [{ label: "Skip for now", value: "" }],
  },
  {
    id: "service",
    prompt: (a) =>
      a.goal === "jobs"
        ? "What role or craft are you targeting?"
        : "What service or product are you offering?",
    input: "text",
    placeholder: "e.g. web development, video editing, SEO, invoice SaaS",
  },
  {
    id: "niche",
    prompt: (a) =>
      a.goal === "jobs"
        ? "Any industry or niche you want roles in?"
        : "Who is your ideal customer or niche?",
    input: "text",
    placeholder: "e.g. SaaS startups, ecommerce brands, fitness coaches",
    chips: [{ label: "All niches", value: "all" }],
  },
  {
    id: "location",
    prompt: () => "Any target location or region?",
    input: "text",
    placeholder: "e.g. United States, London, Germany, Remote…",
    optional: true,
    chips: [
      { label: "Anywhere", value: "Anywhere" },
      { label: "United States", value: "United States" },
      { label: "Canada", value: "Canada" },
      { label: "Europe", value: "Europe" },
      { label: "Asia", value: "Asia" },
      { label: "Latin America", value: "Latin America" },
    ],
  },
  {
    id: "experience_level",
    prompt: () => "How much experience do you have? (Results stay matched to your level)",
    chips: [
      { label: "0–1 years", value: "0-1" },
      { label: "2–4 years", value: "2-4" },
      { label: "5+ years", value: "5+" },
    ],
  },
  {
    id: "work_style",
    prompt: () => "Remote, onsite, or anything goes?",
    chips: [
      { label: "Remote", value: "remote" },
      { label: "Onsite", value: "onsite" },
      { label: "Any", value: "any" },
    ],
  },
  {
    id: "audience",
    prompt: (a) =>
      a.goal === "jobs"
        ? "Focus on companies hiring, agencies, people posting roles — or all?"
        : "Focus on companies, agencies, people — or all of them?",
    chips: [
      { label: "Companies", value: "companies" },
      { label: "Agencies", value: "agencies" },
      { label: "People", value: "people" },
      { label: "All", value: "all" },
    ],
  },
];

type TranscriptItem = { role: "scrapy" | "user"; text: string };

export function OnboardingWizard({
  onComplete,
  onSkip,
  busy,
}: {
  onComplete: (answers: OnboardingAnswers) => void;
  onSkip: () => void;
  busy?: boolean;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Partial<OnboardingAnswers>>({});
  const [input, setInput] = useState("");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([
    { role: "scrapy", text: STEPS[0].prompt({}) },
  ]);
  const endRef = useRef<HTMLDivElement>(null);
  const step = STEPS[stepIdx];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript.length]);

  const advance = (value: string, display?: string) => {
    const fieldKey = step.id === "about" ? "about_doc" : step.id;
    const next: Partial<OnboardingAnswers> = {
      ...answers,
      [fieldKey]: value || undefined,
    };
    setAnswers(next);
    const items: TranscriptItem[] = [
      ...transcript,
      { role: "user", text: display ?? (value || "(skipped)") },
    ];
    if (stepIdx + 1 < STEPS.length) {
      items.push({ role: "scrapy", text: STEPS[stepIdx + 1].prompt(next) });
      setTranscript(items);
      setStepIdx(stepIdx + 1);
      setInput("");
    } else {
      items.push({
        role: "scrapy",
        text:
          next.goal === "jobs"
            ? "Perfect — project saved! Every search starts from this context. Let's find opportunities! 🚀"
            : "Perfect — project saved! Every search starts from this context. Let's find your leads! 🚀",
      });
      setTranscript(items);
      const nicheRaw = (next.niche || "").trim();
      const nicheNorm = isOpenNiche(nicheRaw) ? "all" : nicheRaw;
      onComplete({
        kind: (next.kind as OnboardingAnswers["kind"]) || "freelance",
        business_name: next.business_name || "My project",
        website: next.website || undefined,
        about_doc: next.about_doc || undefined,
        service: next.service || "",
        niche: nicheNorm,
        location: next.location || "Anywhere",
        audience: (next.audience as OnboardingAnswers["audience"]) || "all",
        goal: (next.goal as OnboardingAnswers["goal"]) || "clients",
        experience_level: (next.experience_level as OnboardingAnswers["experience_level"]) || "0-1",
        work_style: (next.work_style as OnboardingAnswers["work_style"]) || "remote",
      });
    }
  };

  const submitText = () => {
    const v = input.trim();
    if (!v && !step.optional) return;
    advance(v);
  };

  return (
    <div className="max-w-xl mx-auto w-full">
      <div className="liquid-glass rounded-2xl border border-white/10 p-6 sm:p-8 space-y-5">
        {/* Card Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white text-xs font-semibold">
              S
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Setup project</h2>
              <p className="text-[11px] text-white/50">Personalizes all Scrapivo searches</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-white/40 hover:text-white transition-colors"
          >
            Skip for now
          </button>
        </div>

        {/* Chat Transcript */}
        <div className="max-h-[44vh] overflow-y-auto pr-1 space-y-3 no-scrollbar">
          {transcript.map((t, i) => (
            <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                  t.role === "user"
                    ? "bg-white/15 text-white border border-white/20 rounded-br-sm font-medium"
                    : "bg-white/[0.04] text-white/90 border border-white/10 rounded-bl-sm"
                }`}
              >
                {t.text}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {/* Action Controls */}
        <div className="pt-2 space-y-3">
          {step.chips && (
            <div className="flex flex-wrap gap-2">
              {step.chips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  disabled={busy}
                  onClick={() => advance(c.value, c.label)}
                  className="glass-pill px-3.5 py-1.5 text-xs font-medium text-white/80 hover:text-white transition-all"
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {step.input && (
            <div className="flex items-end gap-2">
              {step.input === "textarea" ? (
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={step.placeholder}
                  rows={3}
                  className="flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitText();
                  }}
                />
              ) : (
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={step.placeholder}
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitText();
                  }}
                />
              )}
              <Button
                size="sm"
                className="h-9 glass-pill px-4 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/20"
                disabled={busy || (!input.trim() && !step.optional)}
                onClick={submitText}
              >
                <Send className="size-3.5" />
              </Button>
            </div>
          )}

          {/* Caption Step Counter */}
          <div className="text-[11px] text-white/40 pt-1">
            Step {stepIdx + 1} of {STEPS.length} — pre-fills your default search context.
          </div>
        </div>
      </div>
    </div>
  );
}
