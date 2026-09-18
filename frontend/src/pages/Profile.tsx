import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { FileUp, Flag, Link2, MapPin, Save, Sparkles } from "lucide-react";
import { api, type Profile } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, PageHeader, Skeleton, Textarea } from "../components/ui";
import { useToast } from "../components/Toast";

const PROF: Record<string, { label: string; tone: "success" | "accent" | "warn" | "neutral" }> = {
  expert: { label: "Expert", tone: "success" }, hands_on: { label: "Hands-on", tone: "success" }, familiar: { label: "Familiar", tone: "warn" }, learning: { label: "Learning", tone: "neutral" },
};

export default function ProfilePage() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile | null>("/api/profile") });
  const [role, setRole] = useState("Cloud Data Engineer (AWS)");
  const [file, setFile] = useState<File | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const build = useMutation({
    mutationFn: async () => { const fd = new FormData(); if (file) fd.append("file", file); const r = await fetch(`/api/profile/build?target_role=${encodeURIComponent(role)}`, { method: "POST", body: fd }); if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText); return r.json() as Promise<Profile>; },
    onSuccess: (p) => { qc.setQueryData(["profile"], p); qc.invalidateQueries(); toast("success", "Profile built."); }, onError: (e) => toast("error", (e as Error).message),
  });
  const save = useMutation({ mutationFn: (p: unknown) => api.put<Profile>("/api/profile", p), onSuccess: (p) => { qc.setQueryData(["profile"], p); setJson(null); toast("success", "Profile saved."); }, onError: (e) => toast("error", (e as Error).message) });
  const p = q.data;
  const groups = useMemo(() => { const g: Record<string, Profile["skills"]> = {}; for (const s of p?.skills ?? []) (g[s.category] ??= []).push(s); return g; }, [p]);

  const Builder = (
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px] flex-1 min-w-56"><div className="text-muted mb-1">Target role</div><Input value={role} onChange={(e) => setRole(e.target.value)} /></label>
        <label className="text-[13px]"><div className="text-muted mb-1">Resume PDF</div>
          <label className={clsx("h-9 px-3 inline-flex items-center gap-2 rounded-lg border border-dashed cursor-pointer text-sm", file ? "border-accent text-accent" : "border-border-strong text-muted hover:text-text")}><FileUp className="size-4" />{file ? file.name : "Choose file"}<input type="file" accept="application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label></label>
        <Button variant="primary" loading={build.isPending} onClick={() => build.mutate()} disabled={!file && !p}><Sparkles className="size-4" /> {build.isPending ? "Reading & grading (~1 min)…" : p ? "Rebuild" : "Build profile"}</Button>
      </div>
      <p className="text-[12.5px] text-muted mt-3">Skills are graded from evidence in the resume — "learning" stays "learning". Nothing is invented. You can edit the result below.</p>
    </Card>
  );

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (!p) return <div><PageHeader title="Profile" subtitle="The single source of truth every other page reads from." />{Builder}</div>;

  return (
    <div>
      <PageHeader title="Profile" subtitle={`Updated ${p.updated_at} · ${p.hands_on} hands-on · ${p.learning} learning · ${p.years} yrs`}
        actions={<Button variant="secondary" onClick={() => setJson(json === null ? JSON.stringify(p, null, 2) : null)}>{json === null ? "Edit as JSON" : "Close editor"}</Button>} />
      <details className="mb-4"><summary className="text-[13px] text-muted cursor-pointer hover:text-text">Rebuild from a resume</summary><div className="mt-3">{Builder}</div></details>
      {json !== null && (
        <Card className="p-4 mb-4"><Textarea rows={22} value={json} onChange={(e) => setJson(e.target.value)} className="num text-[12.5px]" /><div className="flex justify-end mt-2"><Button variant="primary" loading={save.isPending} onClick={() => { try { save.mutate(JSON.parse(json)); } catch { toast("error", "Invalid JSON"); } }}><Save className="size-4" /> Save</Button></div></Card>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5">
            <h2 className="text-xl font-bold tracking-tight">{p.personal_info.name}</h2>
            <div className="text-muted text-[13.5px]">{p.personal_info.headline}</div>
            <div className="flex flex-wrap gap-3 mt-2 text-[12.5px] text-muted">
              {p.personal_info.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{p.personal_info.location}</span>}
              {p.personal_info.linkedin && <a className="inline-flex items-center gap-1 hover:text-text" href={p.personal_info.linkedin.startsWith("http") ? p.personal_info.linkedin : "https://" + p.personal_info.linkedin} target="_blank" rel="noreferrer"><Link2 className="size-3.5" />LinkedIn</a>}
              {p.personal_info.github && <a className="inline-flex items-center gap-1 hover:text-text" href={p.personal_info.github} target="_blank" rel="noreferrer"><Link2 className="size-3.5" />GitHub</a>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5"><Badge tone="accent">{p.target.primary_role}</Badge><Badge>{p.target.seniority}</Badge>{p.target.secondary_roles.map((r) => <Badge key={r}>{r}</Badge>)}</div>
            <p className="text-[13.5px] leading-relaxed mt-4">{p.summary}</p>
          </Card>
          <Card>
            <CardHeader title="Skills" subtitle="Hover a skill to see its evidence" />
            <div className="px-5 pb-5 space-y-3">
              {Object.entries(groups).map(([cat, skills]) => (
                <div key={cat}><div className="text-[11.5px] uppercase tracking-wider text-faint mb-1.5">{cat.replace("_", " ")}</div>
                  <div className="flex flex-wrap gap-1.5">{skills.map((s) => <span key={s.name} title={s.evidence.join("\n") || "No evidence"}><Badge tone={PROF[s.proficiency].tone}>{s.name}<span className="opacity-60 ml-1">· {PROF[s.proficiency].label}</span></Badge></span>)}</div></div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Experience" />
            <div className="px-5 pb-5 space-y-4">
              {p.experience.map((e, i) => (
                <div key={i}><div className="flex items-baseline justify-between gap-3"><div className="font-medium">{e.title} <span className="text-muted">· {e.company}</span></div><div className="num text-[12px] text-faint">{e.start} → {e.end ?? "present"}</div></div>
                  <ul className="mt-1.5 space-y-1 text-[13px] text-muted list-disc pl-5">{e.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul></div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Projects" />
            <div className="px-5 pb-5 space-y-3">{p.projects.map((pr, i) => <div key={i}><div className="font-medium">{pr.name}</div><div className="text-[13px] text-muted mt-0.5">{pr.description}</div><div className="flex flex-wrap gap-1 mt-1.5">{pr.technologies.map((t) => <Badge key={t}>{t}</Badge>)}</div></div>)}</div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="What a recruiter will probe" subtitle="Rehearse answers for each" />
            <ul className="px-5 pb-5 space-y-2.5">{p.risk_flags.map((r, i) => <li key={i} className="flex gap-2 text-[13px] text-muted"><Flag className="size-3.5 mt-0.5 shrink-0 text-warn" />{r}</li>)}</ul>
          </Card>
          <Card>
            <CardHeader title="Education & certs" />
            <div className="px-5 pb-5 space-y-2 text-[13px]">
              {p.education.map((e, i) => <div key={i}><div className="font-medium">{e.degree}{e.field ? ` — ${e.field}` : ""}</div><div className="text-muted">{e.institution}{e.end_year ? ` · ${e.end_year}` : ""}</div></div>)}
              {p.certifications.map((c, i) => <div key={i} className="flex items-center justify-between gap-2"><span>{c.name}</span><Badge tone={c.status === "completed" ? "success" : "warn"}>{c.status.replace("_", " ")}</Badge></div>)}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
