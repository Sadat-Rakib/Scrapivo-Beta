import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { mySupabase } from "@/integrations/my-supabase/client";
import { registerInnerCircle, repairAuthEmail, checkAuthEmail } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

const LOGO_SRC =
  "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/unnamed__1_-removebg-preview.png";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthSearch = { mode?: "signin" | "signup" };

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    mode: search.mode === "signup" || search.mode === "signin" ? search.mode : undefined,
  }),
  head: () => ({
    meta: [{ title: "Scrapivo — Join the Inner Circle" }],
  }),
  component: AuthPage,
});

function emailHint(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!v.includes("@")) {
    return "Add @ and a domain. Example: you@gmail.com";
  }
  if (!EMAIL_RE.test(v.toLowerCase())) {
    return "Use a full email like you@company.com";
  }
  return null;
}

function friendlyAuthError(message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("invalid login credentials") || m.includes("invalid_credentials")) {
    return "Wrong password for that email. Use Sign up with the same email to set a new password and get in.";
  }
  if (m.includes("email not confirmed")) {
    return "Try signing in again. New accounts are confirmed automatically.";
  }
  if (m.includes("user already registered") || m.includes("already been registered")) {
    return "That email already has an account. Switch to Sign in, or use Sign up again to set a new password.";
  }
  if (m.includes("password") && (m.includes("at least") || m.includes("weak") || m.includes("short"))) {
    return "Password must be at least 6 characters.";
  }
  if (m.includes("valid email") || m.includes("unable to validate email")) {
    return "Enter a valid email address (you@domain.com).";
  }
  return message || "Something went wrong. Please try again.";
}

function AuthPage() {
  const navigate = useNavigate();
  const register = useServerFn(registerInnerCircle);
  const repair = useServerFn(repairAuthEmail);
  const checkEmail = useServerFn(checkAuthEmail);
  const { mode } = Route.useSearch();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [leadIssue, setLeadIssue] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [tab, setTab] = useState<"signin" | "signup">(mode === "signup" ? "signup" : "signin");

  const normalizedEmail = email.trim().toLowerCase();
  const emailError = useMemo(() => emailHint(email), [email]);
  const emailOk = !emailError && EMAIL_RE.test(normalizedEmail);

  useEffect(() => {
    if (mode === "signup" || mode === "signin") setTab(mode);
  }, [mode]);

  useEffect(() => {
    mySupabase.auth.getSession().then(({ data }) => {
      // Only auto-enter the app when already signed in on the Sign in flow,
      // never immediately after a fresh Sign up redirect.
      if (data.session && mode !== "signup") navigate({ to: "/discover" });
    });
  }, [navigate, mode]);

  const setMode = (next: "signin" | "signup") => {
    setTab(next);
    void navigate({ to: "/auth", search: { mode: next }, replace: true });
  };

  const goDiscover = () => navigate({ to: "/discover" });

  const signIn = async () => {
    setEmailTouched(true);
    if (!emailOk) {
      toast.error(emailError || "Enter a valid email address (you@domain.com).");
      return;
    }
    if (!password || password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    let { data, error } = await mySupabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    // Confirm email if needed, then retry once.
    if (error && /invalid login credentials/i.test(error.message)) {
      try {
        const fixed = await repair({ data: { email: normalizedEmail } });
        if (fixed.exists) {
          ({ data, error } = await mySupabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          }));
        }
        if (error) {
          const check = await checkEmail({ data: { email: normalizedEmail } });
          setLoading(false);
          if (check.exists) {
            toast.error("Wrong password. Try again, or use Sign up to set a new password.");
            return;
          }
          toast.error("No account for that email yet. Create one on Sign up.");
          setMode("signup");
          return;
        }
      } catch {
        // fall through
      }
    }

    setLoading(false);
    if (error) return toast.error(friendlyAuthError(error.message));
    if (!data.session) {
      return toast.error("Sign in did not create a session. Try again.");
    }
    goDiscover();
  };

  const signUp = async () => {
    setEmailTouched(true);
    const nameVal = name.trim();
    const issueVal = leadIssue.trim();
    if (!nameVal) {
      toast.error("Please enter your name.");
      return;
    }
    if (!issueVal) {
      toast.error("Tell us what issue you have finding leads.");
      return;
    }
    if (!emailOk) {
      toast.error(emailError || "Enter a valid email address (you@domain.com).");
      return;
    }
    if (!password || password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      await register({
        data: {
          email: normalizedEmail,
          password,
          full_name: nameVal,
          lead_issue: issueVal,
        },
      });

      // Never auto-enter the app after signup — send them to Sign in.
      await mySupabase.auth.signOut().catch(() => {});
      setLoading(false);
      setMode("signin");
      toast.success("Account ready. Sign in with your email and password.");
    } catch (e) {
      setLoading(false);
      const msg = e instanceof Error ? e.message : "Could not create account.";
      toast.error(friendlyAuthError(msg));
    }
  };

  const inputClass = "bg-white/10 border-white/15 text-white placeholder:text-white/40";
  const inputErrorClass = "bg-white/10 border-red-400/60 text-white placeholder:text-white/40";

  return (
    <div
      className="min-h-screen flex flex-col px-4 relative overflow-hidden"
      style={{ background: "#050505", color: "#fff" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 20%, rgba(191,238,255,.10), transparent 42%), radial-gradient(ellipse at 80% 80%, rgba(216,194,255,.06), transparent 40%)",
        }}
      />
      <div className="pt-6 relative z-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          <ArrowLeft className="size-4" /> Back to home
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center relative z-10 py-10">
        <div
          className="w-full max-w-sm rounded-[28px] p-8"
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            backdropFilter: "blur(32px) saturate(180%)",
            WebkitBackdropFilter: "blur(32px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow:
              "0 20px 60px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
          }}
        >
          <div className="flex items-center gap-2 justify-center mb-2">
            <img src={LOGO_SRC} alt="" style={{ height: 36, width: "auto" }} />
            <span
              style={{
                fontFamily: '"Instrument Serif", "Times New Roman", serif',
                fontStyle: "italic",
                fontSize: 28,
                letterSpacing: "-0.04em",
              }}
            >
              Scrapivo
            </span>
          </div>
          <p
            className="text-center mb-6"
            style={{
              fontFamily: '"Instrument Serif", serif',
              fontStyle: "italic",
              fontSize: 22,
              color: "rgba(255,255,255,0.9)",
            }}
          >
            Join the Inner Circle
          </p>
          <Tabs
            value={tab}
            onValueChange={(v) => setMode(v as "signin" | "signup")}
            className="w-full"
          >
            <TabsList className="grid grid-cols-2 w-full bg-white/10 border border-white/10">
              <TabsTrigger value="signin" className="data-[state=active]:bg-white/15">
                Sign in
              </TabsTrigger>
              <TabsTrigger value="signup" className="data-[state=active]:bg-white/15">
                Sign up
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="m-0 mt-6 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="signin-email" className="text-white/70">
                  Email
                </Label>
                <Input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void signIn();
                  }}
                  className={emailTouched && emailError ? inputErrorClass : inputClass}
                />
                {emailTouched && emailError ? (
                  <p className="text-xs text-red-300">{emailError}</p>
                ) : (
                  <p className="text-xs text-white/40">Must include @domain, e.g. you@gmail.com</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signin-password" className="text-white/70">
                  Password
                </Label>
                <Input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void signIn();
                  }}
                  className={inputClass}
                />
              </div>
              <Button
                className="w-full mt-2 bg-white text-black hover:bg-white/90"
                disabled={loading || !emailOk || password.length < 6}
                onClick={() => void signIn()}
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-white/45 hover:text-white/75 mt-1"
                onClick={() => setMode("signup")}
              >
                Forgot password? Use Sign up to set a new one
              </button>
            </TabsContent>

            <TabsContent value="signup" className="m-0 mt-6 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="signup-name" className="text-white/70">
                  Your name
                </Label>
                <Input
                  id="signup-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-issue" className="text-white/70">
                  What issue do you have finding leads?
                </Label>
                <Textarea
                  id="signup-issue"
                  rows={3}
                  placeholder="What's your biggest frustration finding leads right now?"
                  value={leadIssue}
                  onChange={(e) => setLeadIssue(e.target.value)}
                  className={`${inputClass} resize-none`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-email" className="text-white/70">
                  Email
                </Label>
                <Input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  className={emailTouched && emailError ? inputErrorClass : inputClass}
                />
                {emailTouched && emailError ? (
                  <p className="text-xs text-red-300">{emailError}</p>
                ) : (
                  <p className="text-xs text-white/40">Must include @domain, e.g. you@gmail.com</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-password" className="text-white/70">
                  Password
                </Label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void signUp();
                  }}
                  className={inputClass}
                />
              </div>
              <Button
                className="w-full mt-2 bg-white text-black hover:bg-white/90"
                disabled={
                  loading ||
                  !name.trim() ||
                  !leadIssue.trim() ||
                  !emailOk ||
                  password.length < 6
                }
                onClick={() => void signUp()}
              >
                {loading ? "Joining…" : "Join Inner Circle"}
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
      />
    </div>
  );
}
