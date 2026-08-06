import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile, updateMyProfile } from "@/lib/profile.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Mail, MessageCircle, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const qc = useQueryClient();
  const get = useServerFn(getMyProfile);
  const upd = useServerFn(updateMyProfile);
  const q = useQuery({ queryKey: ["profile"], queryFn: () => get() });
  const [form, setForm] = useState<any>({});
  const [skillInput, setSkillInput] = useState("");
  useEffect(() => {
    if (!q.data) return;
    const full = (q.data.full_name ?? "").trim();
    const sender = (q.data.sender_name ?? "").trim();
    // If the full name was only typed into the (now-removed) CASL sender field,
    // surface it as Full name so Discover greets with the complete name.
    if (sender && sender.length > full.length) {
      setForm({ ...q.data, full_name: sender });
    } else {
      setForm(q.data);
    }
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () =>
      upd({
        data: {
          full_name: form.full_name ?? "",
          job_title: form.job_title ?? "",
          years_experience: form.years_experience ? Number(form.years_experience) : null,
          work_preference: form.work_preference ?? "",
          location: form.location ?? "",
          skills: form.skills ?? [],
          notify_email: !!form.notify_email,
          slack_webhook: form.slack_webhook ?? "",
        },
      }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["my-profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSkill = () => {
    const s = skillInput.trim();
    if (!s) return;
    setForm((f: any) => ({ ...f, skills: Array.from(new Set([...(f.skills ?? []), s])) }));
    setSkillInput("");
  };

  return (
    <div className="h-full overflow-y-auto p-6 sm:p-8 max-w-2xl mx-auto w-full space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Personalize outreach, delivery, and how Scrapivo understands you.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-border/80 bg-card/50 p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Profile</h2>
        <Field label="Full name">
          <Input
            value={form.full_name ?? ""}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="e.g. Mir Sadat Bin Rakib"
          />
          <p className="text-[11px] text-muted-foreground">
            Shown on Discover — use your full name, not just part of it.
          </p>
        </Field>
        <Field label="Job title / craft">
          <Input
            value={form.job_title ?? ""}
            onChange={(e) => setForm({ ...form, job_title: e.target.value })}
            placeholder="e.g. React developer, video editor"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Years of experience">
            <Input
              type="number"
              value={form.years_experience ?? ""}
              onChange={(e) => setForm({ ...form, years_experience: e.target.value })}
            />
          </Field>
          <Field label="Work preference">
            <Input
              value={form.work_preference ?? ""}
              onChange={(e) => setForm({ ...form, work_preference: e.target.value })}
              placeholder="Remote, part-time"
            />
          </Field>
        </div>
        <Field label="Location">
          <Input
            value={form.location ?? ""}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </Field>
        <Field label="Skills">
          <div className="flex gap-2">
            <Input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
              }}
              placeholder="Type a skill and press Enter"
            />
            <Button type="button" variant="secondary" onClick={addSkill}>
              Add
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(form.skills ?? []).map((s: string) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-xs"
              >
                {s}
                <button
                  type="button"
                  onClick={() =>
                    setForm({ ...form, skills: form.skills.filter((x: string) => x !== s) })
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </Field>
      </section>

      <section className="space-y-4 rounded-2xl border border-border/80 bg-card/50 p-5">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Report delivery
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            When watches find new signals, send a report here. Email and Slack work today;
            Telegram and WhatsApp are next.
          </p>
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-background/60">
          <div className="flex items-start gap-3">
            <Mail className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Email notifications</div>
              <div className="text-xs text-muted-foreground">Hot leads and watch digests to your inbox.</div>
            </div>
          </div>
          <Switch
            checked={!!form.notify_email}
            onCheckedChange={(v) => setForm({ ...form, notify_email: v })}
          />
        </div>
        <Field label="Slack webhook">
          <Input
            value={form.slack_webhook ?? ""}
            onChange={(e) => setForm({ ...form, slack_webhook: e.target.value })}
            placeholder="https://hooks.slack.com/services/…"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-dashed border-border p-3 opacity-80">
            <div className="flex items-center gap-2 text-sm font-medium mb-1">
              <Send className="size-3.5" /> Telegram
            </div>
            <p className="text-[11px] text-muted-foreground">Coming soon — bot + chat id for digests.</p>
          </div>
          <div className="rounded-xl border border-dashed border-border p-3 opacity-80">
            <div className="flex items-center gap-2 text-sm font-medium mb-1">
              <MessageCircle className="size-3.5" /> WhatsApp
            </div>
            <p className="text-[11px] text-muted-foreground">Coming soon — report pings to your number.</p>
          </div>
        </div>
      </section>

      <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
        {mut.isPending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
