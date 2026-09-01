import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { mySupabase } from "@/integrations/my-supabase/client";
import { registerInnerCircle, repairAuthEmail, checkAuthEmail } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Mail, Lock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import heroLogoAsset from "@/assets/hero-logo.jpg";
import authColumnsAsset from "@/assets/auth-columns.png";

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
  if (
    m.includes("password") &&
    (m.includes("at least") || m.includes("weak") || m.includes("short"))
  ) {
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

  const inputClass = "bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-1 focus-visible:ring-white/20";
  const inputErrorClass = "bg-white/5 border-red-400/50 text-white placeholder:text-white/40 focus-visible:ring-1 focus-visible:ring-red-500/50";

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#050505] text-white relative overflow-hidden font-sans">
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at 50% -20%, rgba(191,238,255,0.06), transparent 50%)"
      }} />

      <div className="w-full h-full flex flex-col md:flex-row bg-[#080808] relative z-10">
        
        {/* LEFT HALF (Form) */}
        <div className="w-full md:w-[45%] lg:w-1/2 p-8 md:p-14 lg:p-20 flex flex-col h-full overflow-y-auto relative z-10 custom-scrollbar">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors mb-12"
          >
            <ArrowLeft className="size-4" /> Back to home
          </Link>

          <div className="flex items-center gap-2.5 mb-10 shrink-0">
            <img src={heroLogoAsset} alt="" className="h-8 w-auto filter invert brightness-0 saturate-100 contrast-100 opacity-90 mix-blend-screen" />
            <span className="font-['Instrument_Serif','Times_New_Roman',serif] italic text-[1.75rem] tracking-[-0.04em]">Scrapivo</span>
          </div>

          <div className="relative bg-white/5 border border-white/10 p-1 rounded-full w-full max-w-[240px] mb-8 shrink-0 flex items-center">
            <motion.div
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-full pointer-events-none"
              initial={false}
              animate={{ left: tab === "signin" ? "4px" : "calc(50%)" }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
            <button
              onClick={() => setMode("signin")}
              className={`flex-1 text-sm font-medium py-1.5 z-10 text-center transition-colors ${tab === "signin" ? "text-black" : "text-white/70 hover:text-white"}`}
            >
              Sign in
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 text-sm font-medium py-1.5 z-10 text-center transition-colors ${tab === "signup" ? "text-black" : "text-white/70 hover:text-white"}`}
            >
              Sign up
            </button>
          </div>

          <div className="flex-1 flex flex-col">
            <h2 className="text-3xl font-medium tracking-tight mb-8 shrink-0 font-['Times_New_Roman_MT_Condensed','Times_New_Roman',Times,serif]">
              {tab === "signin" ? "Welcome back" : "Join the Inner Circle"}
            </h2>

            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, x: tab === "signin" ? -20 : 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: tab === "signin" ? 20 : -20 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="space-y-4 shrink-0 flex flex-col"
              >
                {tab === "signup" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-name" className="text-white/70 text-sm">Your name</Label>
                    <Input
                      id="signup-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className={inputClass}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-white/70 text-sm">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => setEmailTouched(true)}
                      placeholder="hello@scrapivo.com"
                      className={`${emailTouched && emailError ? inputErrorClass : inputClass} pl-10`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          tab === "signin" ? void signIn() : void signUp();
                        }
                      }}
                    />
                  </div>
                  {emailTouched && emailError && <p className="text-xs text-red-400 mt-1">{emailError}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-white/70 text-sm">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your password"
                      className={`${inputClass} pl-10`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          tab === "signin" ? void signIn() : void signUp();
                        }
                      }}
                    />
                  </div>
                </div>

                {tab === "signup" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-issue" className="text-white/70 text-sm">What issue do you have finding leads?</Label>
                    <Textarea
                      id="signup-issue"
                      value={leadIssue}
                      onChange={(e) => setLeadIssue(e.target.value)}
                      placeholder="What's your biggest frustration finding leads right now?"
                      rows={3}
                      className={`${inputClass} resize-none min-h-[80px]`}
                    />
                  </div>
                )}

                <div className="pt-4 mt-auto">
                  <Button
                    onClick={tab === "signin" ? () => void signIn() : () => void signUp()}
                    disabled={loading || (tab === "signup" ? (!name.trim() || !leadIssue.trim() || !emailOk || password.length < 6) : (!emailOk || password.length < 6))}
                    className="w-full bg-white text-black hover:bg-white/90 font-semibold py-6 rounded-xl transition-transform active:scale-[0.98]"
                  >
                    {loading ? "Please wait..." : (tab === "signin" ? "Sign In" : "Create Account")}
                  </Button>
                </div>
                
                <div className="text-center mt-2 pb-4">
                  <button
                    type="button"
                    onClick={() => setMode(tab === "signin" ? "signup" : "signin")}
                    className="text-xs text-white/50 hover:text-white/90 transition-colors"
                  >
                    {tab === "signin" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* RIGHT HALF (Columns Image) */}
        <div className="hidden md:block md:w-[55%] lg:w-1/2 relative h-full bg-[#050505]">
          <img 
            src={authColumnsAsset} 
            alt="" 
            className="w-full h-full object-cover mix-blend-screen opacity-90" 
          />
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#080808] to-transparent pointer-events-none" />
        </div>

      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
      />
    </div>
  );
}
