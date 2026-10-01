import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile, updateMyProfile } from "@/lib/profile.functions";
import { Switch } from "@/components/ui/switch";
import { CollapsibleSection } from "@/components/shared/collapsible-section";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Mail, MessageCircle, Send, Settings as SettingsIcon, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [{ title: "Scrapivo — Settings" }],
  }),
  component: ProfilePage,
});

type ProfileForm = {
  full_name?: string | null;
  sender_name?: string | null;
  job_title?: string | null;
  years_experience?: number | string | null;
  work_preference?: string | null;
  location?: string | null;
  skills?: string[] | null;
  notify_email?: boolean | null;
  slack_webhook?: string | null;
};

export function ProfilePage({ heading = "Settings" }: { heading?: string }) {
  const qc = useQueryClient();
  const get = useServerFn(getMyProfile);
  const upd = useServerFn(updateMyProfile);
  const q = useQuery({ queryKey: ["profile"], queryFn: () => get() });
  const [form, setForm] = useState<ProfileForm>({});
  const [skillInput, setSkillInput] = useState("");

  useEffect(() => {
    if (!q.data) return;
    const data = q.data as ProfileForm;
    const full = (data.full_name ?? "").trim();
    const sender = (data.sender_name ?? "").trim();
    if (sender && sender.length > full.length) {
      setForm({ ...data, full_name: sender });
    } else {
      setForm(data);
    }
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () =>
      upd({
        data: {
          full_name: form.full_name ?? "",
          // The form edits one display name; write it to sender_name too so the
          // load-side "prefer the longer sender_name" rule can't resurrect a
          // stale value and silently drop the user's edit on the next load.
          sender_name: form.full_name ?? "",
          job_title: form.job_title ?? "",
          years_experience: form.years_experience ? Number(form.years_experience) : null,
          work_preference: form.work_preference ?? "",
          location: form.location ?? "",
          skills: form.skills ?? [],
          notify_email: !!form.notify_email,
          slack_webhook: form.slack_webhook ?? "",
        },
      }),
    onSuccess: (res) => {
      // The server returns the persisted row; only toast on a real write.
      if (!res?.profile) {
        toast.error("Settings were not saved. Please try again.");
        return;
      }
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSkill = () => {
    const s = skillInput.trim();
    if (!s) return;
    setForm((f: ProfileForm) => ({ ...f, skills: Array.from(new Set([...(f.skills ?? []), s])) }));
    setSkillInput("");
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto w-full space-y-6 text-white">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">
          <SettingsIcon className="size-3.5" />
          <span>Account Preferences</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{heading}</h1>
        <p className="text-xs text-white/60 mt-1">
          Personalize outreach, report delivery, and how Scrapivo understands you.
        </p>
      </div>

      {/* Profile Section */}
      <CollapsibleSection id="profile-context" title="Profile Context">
        <Field label="Full name">
          <input
            value={form.full_name ?? ""}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="e.g. Mir Sadat Bin Rakib"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
          <p className="text-[11px] text-white/40 mt-1">Shown on Discover greeting.</p>
        </Field>

        <Field label="Job title / craft">
          <input
            value={form.job_title ?? ""}
            onChange={(e) => setForm({ ...form, job_title: e.target.value })}
            placeholder="e.g. React developer, video editor"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Years of experience">
            <input
              type="number"
              value={form.years_experience ?? ""}
              onChange={(e) => setForm({ ...form, years_experience: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
          </Field>
          <Field label="Work preference">
            <input
              value={form.work_preference ?? ""}
              onChange={(e) => setForm({ ...form, work_preference: e.target.value })}
              placeholder="Remote, part-time"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
          </Field>
        </div>

        <Field label="Location">
          <input
            value={form.location ?? ""}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
        </Field>

        <Field label="Skills">
          <div className="flex gap-2">
            <input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
              }}
              placeholder="Type a skill and press Enter"
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
            <button
              type="button"
              onClick={addSkill}
              className="glass-pill px-4 py-2 text-xs font-semibold text-white bg-white/10 hover:bg-white/20"
            >
              Add
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(form.skills ?? []).map((s: string) => (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-xs text-white"
              >
                <span>{s}</span>
                <button
                  type="button"
                  onClick={() =>
                    setForm({ ...form, skills: (form.skills ?? []).filter((x: string) => x !== s) })
                  }
                  className="text-white/40 hover:text-white"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </Field>
      </CollapsibleSection>

      {/* Report Delivery Section */}
      <CollapsibleSection
        id="report-delivery"
        title="Report Delivery"
        description="When signal watches find new leads, send reports to your inbox or Slack."
      >
        <div className="flex items-center justify-between p-4 rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-start gap-3">
            <Mail className="size-4 mt-0.5 text-white/60" />
            <div>
              <div className="text-xs font-semibold text-white">Email Notifications</div>
              <div className="text-[11px] text-white/50">Hot leads and watch digests.</div>
            </div>
          </div>
          <Switch
            checked={!!form.notify_email}
            onCheckedChange={(v) => setForm({ ...form, notify_email: v })}
          />
        </div>

        <Field label="Slack Webhook URL">
          <input
            value={form.slack_webhook ?? ""}
            onChange={(e) => setForm({ ...form, slack_webhook: e.target.value })}
            placeholder="https://hooks.slack.com/services/…"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="rounded-xl border border-dashed border-white/10 p-3 bg-white/[0.01]">
            <div className="flex items-center gap-2 text-xs font-medium text-white/70 mb-1">
              <Send className="size-3.5 text-white/40" /> Telegram
            </div>
            <p className="text-[10px] text-white/40">Coming soon — bot pings.</p>
          </div>
          <div className="rounded-xl border border-dashed border-white/10 p-3 bg-white/[0.01]">
            <div className="flex items-center gap-2 text-xs font-medium text-white/70 mb-1">
              <MessageCircle className="size-3.5 text-white/40" /> WhatsApp
            </div>
            <p className="text-[10px] text-white/40">Coming soon — direct digests.</p>
          </div>
        </div>
      </CollapsibleSection>

      {/* Save Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="glass-pill px-6 py-2.5 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/20 inline-flex items-center gap-2"
        >
          <Save className="size-4" />
          <span>{mut.isPending ? "Saving..." : "Save Changes"}</span>
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-white/70">{label}</label>
      {children}
    </div>
  );
}

// WS3 note: the Settings → Profile & Defaults route (/settings/profile)
// imports ProfilePage from here. Route files must not use a trailing
// `export { ... }` re-export — the TanStack/vite route transform fails it
// with "Export 'ProfilePage' is not defined" and the whole dev app 500s.
