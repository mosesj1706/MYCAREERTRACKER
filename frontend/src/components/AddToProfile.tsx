import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Award, BookOpen, Briefcase, FolderGit2, RefreshCw, Sparkles } from "lucide-react";
import { api, type Profile } from "../lib/api";
import { Badge, Button, Input, Segmented, Select, Textarea } from "./ui";
import { Drawer } from "./Drawer";
import { useToast } from "./Toast";

type Kind = "certification" | "course" | "project" | "experience";
interface Addition { kind: Kind; name: string; org: string; url: string; date: string; end: string; status: "completed" | "in_progress" | "planned"; description: string }
interface MergeSkill { name: string; category: string; proficiency: string; evidence: string }
interface Merge { skills: MergeSkill[]; certification?: unknown; course?: unknown; project?: unknown; experience?: { bullets: string[] } | null; resolved_risk_flags: string[]; notes: string[] }
interface Applied { profile: Profile; changes: { skill: string; from: string | null; to: string }[]; resolved_risk_flags: string[]; applications: number }
interface Rescored { id: number; title: string; company: string | null; before: number; after: number }

const KINDS: { value: Kind; label: string; icon: React.ReactNode; org: string; name: string; desc: string }[] = [
  { value: "certification", label: "Certification", icon: <Award className="size-3.5" />, org: "Issuer (AWS, Google, Databricks…)", name: "AWS Certified Solutions Architect - Associate", desc: "What the exam covered and anything you built while preparing. A certificate alone counts as familiar, not hands-on." },
  { value: "course", label: "Course", icon: <BookOpen className="size-3.5" />, org: "Provider (Coursera, DataCamp, Udemy…)", name: "Data Engineering on AWS", desc: "What it covered. If you built a project in it, describe the project and link the repo: that is what turns a course into hands-on evidence." },
  { value: "project", label: "Project", icon: <FolderGit2 className="size-3.5" />, org: "For whom (client, personal, hackathon)", name: "nyc-lakehouse-aws", desc: "What it does, what you used, what came out of it. Name the actual services and tools; link the repo. If it is on GitHub, a re-sync will add the code evidence too." },
  { value: "experience", label: "Job", icon: <Briefcase className="size-3.5" />, org: "Company", name: "Data Engineer", desc: "What you did there, one achievement per line. Keep the numbers you know. The model splits this into resume bullets." },
];
const PROF_TONE: Record<string, "neutral" | "warn" | "success" | "accent"> = { learning: "neutral", familiar: "warn", hands_on: "success", expert: "accent" };
const blank = (kind: Kind): Addition => ({ kind, name: "", org: "", url: "", date: "", end: "", status: "completed", description: "" });

/**
 * Add a certification, course, project or job. The model proposes what it proves (skills with
 * evidence, the normalised entry, which recruiter risk flags it settles); the user reviews, then it
 * is written with the same rules as the GitHub sync: proficiency only rises, a certificate alone is
 * capped at familiar, nothing is removed. Afterwards, tracked applications can be re-scored.
 */
export type AdditionInit = Partial<Addition> & { kind: Kind };

export default function AddToProfile({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: AdditionInit }) {
  const qc = useQueryClient(); const toast = useToast();
  const [a, setA] = useState<Addition>(initial ? { ...blank(initial.kind), ...initial } : blank("certification"));
  useEffect(() => { if (initial) { setA({ ...blank(initial.kind), ...initial }); setMerge(null); setApplied(null); setRescored(null); } }, [initial]);
  const [merge, setMerge] = useState<Merge | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [rescored, setRescored] = useState<Rescored[] | null>(null);
  const meta = KINDS.find((k) => k.value === a.kind)!;
  const set = (patch: Partial<Addition>) => { setA({ ...a, ...patch }); setMerge(null); setApplied(null); };
  const payload = () => ({ ...a, org: a.org || null, url: a.url || null, date: a.date || null, end: a.end || null });

  const propose = useMutation({ mutationFn: () => api.post<Merge>("/api/profile/additions/propose", payload()), onSuccess: setMerge, onError: (e) => toast("error", (e as Error).message) });
  const apply = useMutation({
    mutationFn: () => api.post<Applied>("/api/profile/additions/apply", { addition: payload(), merge }),
    onSuccess: (r) => { setApplied(r); qc.setQueryData(["profile"], r.profile); qc.invalidateQueries({ queryKey: ["linkedin"] }); toast("success", `${a.name} added to the profile.`); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const rescore = useMutation({
    mutationFn: () => api.post<Rescored[]>("/api/applications/rescore-all"),
    onSuccess: (r) => { setRescored(r); qc.invalidateQueries({ queryKey: ["applications"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); qc.invalidateQueries({ queryKey: ["gaps"] }); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const reset = () => { setA(blank(a.kind)); setMerge(null); setApplied(null); setRescored(null); };

  return (
    <Drawer open={open} onClose={onClose} title="Add to profile" width={640}>
      <div className="space-y-5">
        <Segmented value={a.kind} onChange={(k) => { setA(blank(k)); setMerge(null); setApplied(null); setRescored(null); }} options={KINDS.map((k) => ({ value: k.value, label: <span className="inline-flex items-center gap-1.5">{k.icon}{k.label}</span> }))} />
        <p className="text-[12.5px] text-muted">{meta.desc}</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="block text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">{a.kind === "experience" ? "Title" : "Name"}</label><Input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder={meta.name} /></div>
          <div><label className="block text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">{meta.org.split(" (")[0]}</label><Input value={a.org} onChange={(e) => set({ org: e.target.value })} placeholder={meta.org} /></div>
          <div><label className="block text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">URL</label><Input value={a.url} onChange={(e) => set({ url: e.target.value })} placeholder={a.kind === "certification" ? "Credential link" : "Repo or page"} /></div>
          <div><label className="block text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">{a.kind === "experience" ? "Start (YYYY-MM)" : "When (YYYY-MM)"}</label><Input value={a.date} onChange={(e) => set({ date: e.target.value })} placeholder="2026-09" /></div>
          {a.kind === "experience"
            ? <div><label className="block text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">End (blank if current)</label><Input value={a.end} onChange={(e) => set({ end: e.target.value })} placeholder="" /></div>
            : <div><label className="block text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">Status</label><Select value={a.status} onChange={(e) => set({ status: e.target.value as Addition["status"] })} className="w-full"><option value="completed">Completed</option><option value="in_progress">In progress</option><option value="planned">Planned</option></Select></div>}
          <div className="col-span-2"><label className="block text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">{a.kind === "experience" ? "What you did" : "What it covered / what you built"}</label>
            <Textarea rows={5} value={a.description} onChange={(e) => set({ description: e.target.value })} placeholder="In your own words. Name the tools and services you actually used." /></div>
        </div>
        {!merge && <div className="flex justify-end"><Button variant="primary" loading={propose.isPending} disabled={a.name.trim().length < 2} onClick={() => propose.mutate()}><Sparkles className="size-4" /> What does this prove?</Button></div>}

        {merge && !applied && (
          <div className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-4">
            <h3 className="text-[13px] font-semibold">Proposed changes</h3>
            {merge.skills.length === 0 && <p className="text-[12.5px] text-muted">No skill changes: the description does not name anything concrete. Add the tools you used and try again, or apply just the entry.</p>}
            {merge.skills.map((s) => (
              <div key={s.name} className="text-[13px]"><span className="font-medium">{s.name}</span> <Badge tone={PROF_TONE[s.proficiency]} className="ml-1">{s.proficiency.replace("_", " ")}</Badge>
                <div className="text-[12.5px] text-muted">{s.evidence}</div></div>
            ))}
            {merge.experience?.bullets && <div className="text-[12.5px]"><div className="block text-[11.5px] font-medium text-muted uppercase tracking-wider mb-1">Bullets</div><ul className="list-disc pl-5 text-muted space-y-0.5">{merge.experience.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
            {merge.resolved_risk_flags.length > 0 && <div className="text-[12.5px]"><span className="text-success font-medium">Settles:</span> {merge.resolved_risk_flags.join(" · ")}</div>}
            {merge.notes.map((n, i) => <p key={i} className="text-[12.5px] text-warn">{n}</p>)}
            <p className="text-[11.5px] text-faint">Applied with fixed rules: proficiency only rises, a certificate or course alone is capped at familiar, nothing is removed.</p>
            <div className="flex justify-end gap-2"><Button size="sm" onClick={() => setMerge(null)}>Edit</Button><Button size="sm" variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>Apply to profile</Button></div>
          </div>
        )}

        {applied && (
          <div className="space-y-3 rounded-lg border border-success/30 bg-success-soft/30 p-4">
            <h3 className="text-[13px] font-semibold">Added</h3>
            {applied.changes.length > 0
              ? <div className="flex flex-wrap gap-1.5">{applied.changes.map((c) => <Badge key={c.skill} tone={PROF_TONE[c.to]}>{c.skill}: {c.from ? `${c.from.replace("_", " ")} → ` : "new · "}{c.to.replace("_", " ")}</Badge>)}</div>
              : <p className="text-[12.5px] text-muted">Entry added; no proficiency changed (evidence was appended).</p>}
            {applied.applications > 0 && !rescored && (
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="text-muted">Your fit scores were judged against the old profile.</span>
                <Button size="sm" loading={rescore.isPending} onClick={() => rescore.mutate()}><RefreshCw className="size-3.5" /> Re-score {applied.applications} application{applied.applications > 1 ? "s" : ""}</Button>
              </div>
            )}
            {rescore.isPending && <p className="text-[12px] text-faint">One model call per application, about a minute each.</p>}
            {rescored && <div className="text-[12.5px] space-y-1">{rescored.map((r) => <div key={r.id} className="flex justify-between"><span>{r.title}{r.company ? ` · ${r.company}` : ""}</span><span className="num">{r.before}% → <b>{r.after}%</b></span></div>)}</div>}
            <div className="flex justify-end"><Button size="sm" onClick={reset}>Add another</Button></div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
