import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AddToProfile, { type AdditionInit } from "../components/AddToProfile";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { CheckCircle2, Circle, ExternalLink, FolderTree, Hammer, RefreshCw, Search, Sparkles, Trophy } from "lucide-react";
import { api, type LearningPlan, type Profile, type Resource, type SkillPlan } from "../lib/api";
import { Badge, Button, Card, Empty, Input, PageHeader, Progress, Select, Skeleton } from "../components/ui";
import { useToast } from "../components/Toast";

export default function Learning() {
  const qc = useQueryClient(); const toast = useToast();
  const plan = useQuery({ queryKey: ["plan"], queryFn: () => api.get<LearningPlan | null>("/api/plan") });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile | null>("/api/profile") });
  const [weekly, setWeekly] = useState(10); const [topN, setTopN] = useState(6);
  const gen = useMutation({ mutationFn: () => api.post<LearningPlan>("/api/plan/generate", { weekly_hours: weekly, top_n: topN }), onSuccess: (p) => { qc.setQueryData(["plan"], p); toast("success", "Plan ready."); }, onError: (e) => toast("error", (e as Error).message) });
  const save = useMutation({ mutationFn: (p: LearningPlan) => api.put<LearningPlan>("/api/plan", p), onSuccess: (p) => { qc.setQueryData(["plan"], p); qc.invalidateQueries({ queryKey: ["analytics"] }); } });

  const p = plan.data;
  const toggle = (path: "milestone" | "step", si: number, ti: number) => {
    if (!p) return;
    const next: LearningPlan = JSON.parse(JSON.stringify(p));
    if (path === "milestone") next.portfolio_project.milestones[ti].done = !next.portfolio_project.milestones[ti].done;
    else next.skills[si].steps[ti].done = !next.skills[si].steps[ti].done;
    qc.setQueryData(["plan"], next); save.mutate(next);
  };

  const Generator = (
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px]"><div className="text-muted mb-1">Hours / week</div><Select value={weekly} onChange={(e) => setWeekly(Number(e.target.value))}>{[5, 8, 10, 15, 20].map((h) => <option key={h} value={h}>{h}</option>)}</Select></label>
        <label className="text-[13px]"><div className="text-muted mb-1">Gap skills to include</div><Select value={topN} onChange={(e) => setTopN(Number(e.target.value))}>{[3, 4, 5, 6, 8].map((h) => <option key={h} value={h}>{h}</option>)}</Select></label>
        <Button variant="primary" loading={gen.isPending} onClick={() => gen.mutate()}><Sparkles className="size-4" /> {gen.isPending ? "Designing (1–2 min)…" : p ? "Regenerate plan" : "Generate plan"}</Button>
        <div className="text-[12.5px] text-muted">Built from your gap analysis: one portfolio project that closes several gaps, decomposed into per-skill steps, scoped to ≤12 weeks.</div>
      </div>
    </Card>
  );

  if (plan.isLoading) return <Skeleton className="h-64" />;
  if (!p) return <div><PageHeader title="Learning" subtitle="Turn the gap analysis into a plan you can actually finish." />{Generator}<div className="mt-4"><Empty icon={<Hammer className="size-7" />} title="No plan yet" body={<>Track a few jobs on the <Link className="text-accent" to="/tailor">Analyze</Link> page, then generate.</>} /></div></div>;

  const pp = p.portfolio_project;
  const mDone = pp.milestones.filter((m) => m.done).length;
  const total = pp.milestones.length + p.skills.reduce((a, s) => a + s.steps.length, 0);
  const done = mDone + p.skills.reduce((a, s) => a + s.steps.filter((x) => x.done).length, 0);

  return (
    <div>
      <PageHeader title="Learning" subtitle={`${p.weeks_to_complete} weeks at ${p.weekly_hours_assumed} h/week · ${done}/${total} steps done · generated ${p.generated_at}`} />
      <details className="mb-4"><summary className="text-[13px] text-muted cursor-pointer hover:text-text">Regenerate with different settings</summary><div className="mt-3">{Generator}</div></details>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[12px] font-medium text-muted uppercase tracking-wider flex items-center gap-1.5"><Trophy className="size-3.5" /> Portfolio project</div>
            <h2 className="text-xl font-bold tracking-tight mt-1">{pp.name}</h2>
            <p className="text-[13.5px] text-muted mt-1.5 max-w-3xl leading-relaxed">{pp.pitch}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">{pp.skills_covered.map((s) => <Badge key={s} tone="accent">{s}</Badge>)}</div>
          </div>
          <div className="text-right shrink-0"><div className="num text-3xl font-semibold">{mDone}<span className="text-muted text-lg">/{pp.milestones.length}</span></div><div className="text-[12px] text-muted">milestones</div></div>
        </div>
        <Progress value={(100 * mDone) / Math.max(1, pp.milestones.length)} tone="success" className="mt-4" />
        <ol className="mt-4 space-y-1.5">
          {pp.milestones.map((m, i) => (
            <li key={i}><button onClick={() => toggle("milestone", 0, i)} className={clsx("w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-2", m.done && "opacity-60")}>
              {m.done ? <CheckCircle2 className="size-[18px] text-success shrink-0 mt-0.5" /> : <Circle className="size-[18px] text-faint shrink-0 mt-0.5" />}
              <span className={clsx("text-[13.5px] leading-relaxed flex-1", m.done && "line-through")}>{m.title}</span>
              <span className="num text-[12px] text-faint shrink-0">~{m.hours}h</span>
            </button></li>
          ))}
        </ol>
        <details className="mt-3 text-[13px]"><summary className="cursor-pointer text-muted hover:text-text inline-flex items-center gap-1.5"><FolderTree className="size-3.5" /> Suggested repo structure</summary><pre className="mt-2 num text-[12.5px] text-muted bg-surface-2 rounded-lg p-3">{pp.repo_structure.join("\n")}</pre></details>
      </Card>

      <h3 className="font-semibold mt-6 mb-3">Skills</h3>
      <div className="space-y-3">{p.skills.map((s, si) => <SkillCard key={s.skill} s={s} si={si} toggle={toggle} profile={profile.data ?? null} />)}</div>

      <h3 className="font-semibold mt-6 mb-3">Free credentials</h3>
      <Credentials gapSkills={p.skills.map((s) => s.skill)} />
    </div>
  );
}

interface Credential { title: string; url: string; issuer: string; issuer_tier: "vendor" | "platform" | "other"; credential: "certificate" | "badge" | "accreditation" | "none"; cost: "free" | "free_audit" | "paid"; skills: string[]; hours: number | null; why: string; caveat: string | null }
const COST: Record<Credential["cost"], { label: string; tone: "success" | "warn" | "neutral" }> = { free: { label: "free", tone: "success" }, free_audit: { label: "free to audit · certificate paid", tone: "warn" }, paid: { label: "paid", tone: "neutral" } };
const TIER: Record<Credential["issuer_tier"], string> = { vendor: "vendor credential", platform: "major platform", other: "unrecognised issuer" };

/**
 * Free courses and assessments that end in a badge or certificate a recruiter will recognise, for
 * the plan's gap skills. Anything paid or from an unknown issuer is shown greyed with the reason,
 * not hidden. "Add to profile" hands a finished one to the addition flow as a course, where a
 * credential alone is capped at familiar unless a project was built with it.
 */
function Credentials({ gapSkills }: { gapSkills: string[] }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>(gapSkills.slice(0, 6));
  const [extra, setExtra] = useState("");
  const [res, setRes] = useState<Credential[] | null>(null);
  const [adding, setAdding] = useState<AdditionInit | undefined>();
  const find = useMutation({ mutationFn: () => api.post<{ skills: string[]; credentials: Credential[] }>("/api/plan/credentials", { skills: picked }), onSuccess: (r) => setRes(r.credentials), onError: (e) => toast("error", (e as Error).message) });
  const toggleSkill = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const good = (c: Credential) => c.cost === "free" && c.issuer_tier !== "other" && c.credential !== "none";
  return (
    <Card className="p-5">
      <p className="text-[13px] text-muted">Courses and assessments that are free end to end and issue a badge or certificate from the vendor or a major platform. Worth having as a line under a project, not instead of one: on the profile a credential alone counts as <em>familiar</em>.</p>
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {[...new Set([...gapSkills, ...picked])].map((s) => <button key={s} onClick={() => toggleSkill(s)} className={clsx("rounded-full border px-2.5 py-0.5 text-[12.5px] transition", picked.includes(s) ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text")}>{s}</button>)}
        <Input value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && extra.trim()) { setPicked((p) => [...p, extra.trim()]); setExtra(""); } }} placeholder="+ another skill, Enter" className="h-7 w-44 text-[12.5px]" />
        <Button size="sm" variant="primary" loading={find.isPending} disabled={picked.length === 0} onClick={() => find.mutate()}><Search className="size-3.5" /> {find.isPending ? "Searching (1–2 min)…" : res ? "Search again" : "Find free credentials"}</Button>
      </div>
      {res && res.length === 0 && <p className="text-[13px] text-muted mt-3">Nothing free and recognised came back for those skills. Try fewer skills at a time.</p>}
      {res && res.length > 0 && (
        <div className="mt-4 space-y-2">
          {res.map((c) => (
            <div key={c.url} className={clsx("rounded-lg border border-border px-4 py-3", good(c) ? "bg-surface-2/60" : "opacity-60")}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <a href={c.url} target="_blank" rel="noreferrer" className="text-[13.5px] font-medium hover:underline">{c.title}</a>
                  <div className="text-[12.5px] text-muted mt-0.5">{c.issuer} · {TIER[c.issuer_tier]} · {c.credential}{c.hours ? ` · ~${c.hours}h` : ""}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge tone={COST[c.cost].tone}>{COST[c.cost].label}</Badge>
                  {good(c) && <Button size="sm" onClick={() => setAdding({ kind: "course", name: c.title, org: c.issuer, url: c.url, description: `${c.why} Covers: ${c.skills.join(", ")}.` })}>Done → Add to profile</Button>}
                </div>
              </div>
              <div className="text-[13px] mt-1.5">{c.why}</div>
              {c.caveat && <div className="text-[12.5px] text-warn mt-1">{c.caveat}</div>}
              <div className="flex flex-wrap gap-1 mt-2">{c.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>
            </div>
          ))}
        </div>
      )}
      <AddToProfile open={!!adding} onClose={() => setAdding(undefined)} initial={adding} />
    </Card>
  );
}

function SkillCard({ s, si, toggle, profile }: { s: SkillPlan; si: number; toggle: (p: "step", si: number, ti: number) => void; profile: Profile | null }) {
  const qc = useQueryClient(); const toast = useToast();
  const [open, setOpen] = useState(s.progress < 100);
  const [res, setRes] = useState<Resource[] | null>(null);
  const [evidence, setEvidence] = useState("");
  const find = useMutation({ mutationFn: () => api.post<Resource[]>("/api/plan/resources", { skill: s.skill }), onSuccess: setRes, onError: (e) => toast("error", (e as Error).message) });
  const learned = useMutation({ mutationFn: () => api.post("/api/plan/learned", { skill: s.skill, evidence }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["profile"] }); qc.invalidateQueries({ queryKey: ["plan"] }); toast("success", `${s.skill} is now hands-on in your profile. Re-score applications to see scores move.`); }, onError: (e) => toast("error", (e as Error).message) });
  const already = profile?.skills.some((x) => x.name.toLowerCase() === s.skill.toLowerCase() && (x.proficiency === "hands_on" || x.proficiency === "expert"));
  const done = s.steps.filter((x) => x.done).length;
  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left px-5 py-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2"><span className="font-semibold">{s.skill}</span><Badge>{s.from_proficiency} → {s.to_proficiency}</Badge>{already && <Badge tone="success">in profile</Badge>}</div>
          <div className="text-[12.5px] text-muted mt-0.5 truncate">{s.why}</div>
        </div>
        <div className="w-40 shrink-0"><div className="flex justify-between text-[12px] text-muted mb-1"><span>{done}/{s.steps.length} steps</span><span className="num">~{s.hours}h</span></div><Progress value={s.progress} tone={s.progress >= 100 ? "success" : "accent"} /></div>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
          <ol className="space-y-1">
            {s.steps.map((st, ti) => (
              <li key={ti}><button onClick={() => toggle("step", si, ti)} className={clsx("w-full flex items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2 transition", st.done && "opacity-60")}>
                {st.done ? <CheckCircle2 className="size-[18px] text-success shrink-0 mt-0.5" /> : <Circle className="size-[18px] text-faint shrink-0 mt-0.5" />}
                <span className={clsx("text-[13.5px] flex-1 leading-relaxed", st.done && "line-through")}>{st.title}</span><Badge>{st.kind}</Badge><span className="num text-[12px] text-faint w-10 text-right">~{st.hours}h</span>
              </button></li>
            ))}
          </ol>
          <div className="rounded-lg bg-accent-soft/50 px-4 py-3 text-[13px]"><span className="font-semibold text-accent">Proof it's learned: </span>{s.proof}</div>
          <div>
            <Button size="sm" loading={find.isPending} onClick={() => find.mutate()}><Search className="size-4" /> {find.isPending ? "Searching the web (1–2 min)…" : res ? "Search again" : "Find resources"}</Button>
            {res && <ul className="mt-3 space-y-2">{res.map((r) => <li key={r.url} className="text-[13px]"><a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline inline-flex items-center gap-1">{r.title} <ExternalLink className="size-3" /></a> <Badge className="ml-1">{r.kind.replace("_", " ")}</Badge><div className="text-muted mt-0.5">{r.why}</div></li>)}</ul>}
          </div>
          {!already && (
            <div className="flex gap-2 items-center">
              <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence — what you built (this goes on your profile). e.g. Glue PySpark job writing partitioned Parquet; repo github.com/…" />
              <Button variant="primary" size="md" disabled={evidence.trim().length < 10} loading={learned.isPending} onClick={() => learned.mutate()} className="shrink-0"><RefreshCw className="size-4" /> Mark learned</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
