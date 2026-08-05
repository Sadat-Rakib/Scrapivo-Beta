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
import { X } from "lucide-react";

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
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);

  const mut = useMutation({
    mutationFn: () => upd({ data: {
      full_name: form.full_name ?? "",
      job_title: form.job_title ?? "",
      years_experience: form.years_experience ? Number(form.years_experience) : null,
      rate_range: form.rate_range ?? "",
      work_preference: form.work_preference ?? "",
      location: form.location ?? "",
      skills: form.skills ?? [],
      notify_email: !!form.notify_email,
      slack_webhook: form.slack_webhook ?? "",
    } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["profile"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSkill = () => {
    const s = skillInput.trim();
    if (!s) return;
    setForm((f: any) => ({ ...f, skills: Array.from(new Set([...(f.skills ?? []), s])) }));
    setSkillInput("");
  };

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Personalize outreach and notifications.</p>
      </div>
      <Field label="Full name"><Input value={form.full_name ?? ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
      <Field label="Job title"><Input value={form.job_title ?? ""} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Senior React developer" /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Years of experience"><Input type="number" value={form.years_experience ?? ""} onChange={(e) => setForm({ ...form, years_experience: e.target.value })} /></Field>
        <Field label="Rate range"><Input value={form.rate_range ?? ""} onChange={(e) => setForm({ ...form, rate_range: e.target.value })} placeholder="$80–120/hr" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Work preference"><Input value={form.work_preference ?? ""} onChange={(e) => setForm({ ...form, work_preference: e.target.value })} placeholder="Remote, part-time" /></Field>
        <Field label="Location"><Input value={form.location ?? ""} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
      </div>
      <Field label="Skills">
        <div className="flex gap-2">
          <Input value={skillInput} onChange={(e) => setSkillInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }} placeholder="Type a skill and press Enter" />
          <Button type="button" variant="secondary" onClick={addSkill}>Add</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(form.skills ?? []).map((s: string) => (
            <span key={s} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-xs">
              {s}
              <button onClick={() => setForm({ ...form, skills: form.skills.filter((x: string) => x !== s) })}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      </Field>
      <Field label="Slack webhook (optional)"><Input value={form.slack_webhook ?? ""} onChange={(e) => setForm({ ...form, slack_webhook: e.target.value })} placeholder="https://hooks.slack.com/services/…" /></Field>
      <div className="flex items-center justify-between p-3 rounded-lg border border-border">
        <div>
          <div className="text-sm font-medium">Email notifications</div>
          <div className="text-xs text-muted-foreground">Get notified about new hot leads.</div>
        </div>
        <Switch checked={!!form.notify_email} onCheckedChange={(v) => setForm({ ...form, notify_email: v })} />
      </div>
      <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Save changes"}</Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}