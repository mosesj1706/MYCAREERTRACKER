import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { RefreshCw, Plus, Download, FileUp, Flag, Link2, MapPin, Save, Sparkles, Pencil, BadgeCheck, Languages } from "lucide-react";
import { api, redirectIfLoggedOut, type Profile } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, PageHeader, Skeleton, Textarea } from "../components/ui";
import { useToast } from "../components/Toast";
import GitHubCard from "../components/GitHubCard";
import LinkedInDrawer from "../components/LinkedInDrawer";
import AddToProfile from "../components/AddToProfile";
import { TellCheck } from "../components/TellCheck";
import ProfileEditor from "../components/ProfileEditor";
import { label, usePack } from "../lib/pack";

const PROF_TONE: Record<string, "success" | "accent" | "warn" | "neutral"> = { expert: "success", hands_on: "success", familiar: "warn", learning: "neutral" };

export default function ProfilePage() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile | null>("/api/profile") });
  const pack = usePack();
  const [role, setRole] = useState("Cloud Data Engineer (AWS)");
  useEffect(() => { setRole(q.data?.target.primary_role ?? pack.default_role); }, [pack.default_role, q.data?.target.primary_role]);
  const [editing, setEditing] = useState(false);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [linkedin, setLinkedin] = useState(false);
  const [adding, setAdding] = useState(false);
  const refreshFlags = useMutation({ mutationFn: () => api.post<Profile>("/api/profile/risk-flags/refresh"), onSuccess: (p) => { qc.setQueryData(["profile"], p); toast("success", "Probe list refreshed from the current profile."); }, onError: (e) => toast("error", (e as Error).message) });
  const build = useMutation({
    mutationFn: async () => { const fd = new FormData(); if (file) fd.append("file", file); const r = await fetch(`/api/profile/build?target_role=${encodeURIComponent(role)}`, { method: "POST", body: fd }); redirectIfLoggedOut(r); if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText); return r.json() as Promise<Profile>; },
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
      <PageHeader title="Profile" subtitle={`Updated ${p.updated_at} · ${p.hands_on} ${pack.proficiency_labels.hands_on.toLowerCase()} · ${p.learning} ${pack.proficiency_labels.learning.toLowerCase()} · ${p.years} yrs`}
        actions={<div className="flex gap-2"><Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" /> Add to profile</Button><a href="/api/resume.pdf" download><Button variant="secondary"><Download className="size-4" /> Resume PDF</Button></a><Button variant="secondary" onClick={() => setLinkedin(true)}><Link2 className="size-4" /> LinkedIn text</Button>{pack.features.edit_json ? <Button variant="secondary" onClick={() => setJson(json === null ? JSON.stringify(p, null, 2) : null)}>{json === null ? "Edit as JSON" : "Close editor"}</Button> : <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit profile</Button>}</div>} />
      {!pack.features.edit_json && <ProfileEditor open={editing} onClose={() => setEditing(false)} profile={p} />}
      <LinkedInDrawer open={linkedin} onClose={() => setLinkedin(false)} />
      <AddToProfile open={adding} onClose={() => setAdding(false)} />
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
            <CardHeader title="Skills" subtitle="Tap a skill to see its evidence" />
            <div className="px-5 pb-5 space-y-3">
              {Object.entries(groups).map(([cat, skills]) => {
                const open = skills.find((s) => s.name === openSkill);
                return (
                  <div key={cat}><div className="text-[11.5px] uppercase tracking-wider text-faint mb-1.5">{pack.categories[cat] ?? cat.replace("_", " ")}</div>
                    <div className="flex flex-wrap gap-1.5">{skills.map((s) => <button key={s.name} onClick={() => setOpenSkill(openSkill === s.name ? null : s.name)} title={s.evidence.join("\n") || "No evidence"}><Badge tone={PROF_TONE[s.proficiency]} className={openSkill === s.name ? "ring-2 ring-[var(--ring)]" : undefined}>{s.name}<span className="opacity-60 ml-1">· {pack.proficiency_labels[s.proficiency]}</span></Badge></button>)}</div>
                    {open && <div className="mt-2 rounded-lg bg-surface-2/70 px-3 py-2 text-[12.5px] text-muted">{open.evidence.length ? <ul className="list-disc pl-4 space-y-0.5">{open.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul> : "No evidence recorded yet."}</div>}
                  </div>
                );
              })}
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
          {(p.projects.length > 0 || pack.key === "tech") && <Card>
            <CardHeader title={label(pack, "projects", "Projects")} />
            <div className="px-5 pb-5 space-y-3">{p.projects.map((pr, i) => <div key={i}><div className="font-medium">{pr.url ? <a href={pr.url} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">{pr.name}<Link2 className="size-3.5 text-faint" /></a> : pr.name}</div><div className="text-[13px] text-muted mt-0.5">{pr.description}</div><div className="flex flex-wrap gap-1 mt-1.5">{pr.technologies.map((t) => <Badge key={t}>{t}</Badge>)}</div></div>)}</div>
          </Card>}
        </div>
        <div className="space-y-4">
          {pack.features.github && <GitHubCard />}
          {pack.key === "ot" && <RegistrationsCard p={p} onEdit={() => setEditing(true)} />}
          <Card className="p-4"><TellCheck url="/api/profile/tells" compact onApplied={() => qc.invalidateQueries({ queryKey: ["profile"] })} /></Card>
          <Card>
            <CardHeader title={label(pack, "probe", "What a recruiter will probe")} subtitle="Rehearse answers for each" action={<Button size="sm" loading={refreshFlags.isPending} onClick={() => refreshFlags.mutate()} title="Re-derive from the profile as it is now. One model call."><RefreshCw className="size-3.5" /> Refresh</Button>} />
            <ul className="px-5 pb-5 space-y-2.5">{p.risk_flags.map((r, i) => <li key={i} className="flex gap-2 text-[13px] text-muted"><Flag className="size-3.5 mt-0.5 shrink-0 text-warn" />{r}</li>)}</ul>
          </Card>
          <Card>
            <CardHeader title="Education & certs" />
            <div className="px-5 pb-5 space-y-2 text-[13px]">
              {p.education.map((e, i) => <div key={i}><div className="font-medium">{e.degree}{e.field ? ` — ${e.field}` : ""}</div><div className="text-muted">{e.institution}{e.end_year ? ` · ${e.end_year}` : ""}</div></div>)}
              {p.certifications.map((c, i) => <div key={i} className="flex items-center justify-between gap-2"><span>{c.name}</span><Badge tone={c.status === "completed" ? "success" : "warn"}>{c.status.replace("_", " ")}</Badge></div>)}
              {(p.courses ?? []).map((c, i) => <div key={i}><div className="flex items-center justify-between gap-2"><span>{c.name}</span><Badge>course{c.year ? ` · ${c.year}` : ""}</Badge></div>{c.provider && <div className="text-muted">{c.provider}{c.project ? ` · ${c.project}` : ""}</div>}</div>)}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RegistrationsCard({ p, onEdit }: { p: Profile; onEdit: () => void }) {
  const regs = p.registrations ?? [], langs = p.languages ?? [];
  return (
    <Card>
      <CardHeader title="Registration & languages" subtitle="Regulators and HR check these first" action={<Button size="sm" onClick={onEdit}><Pencil className="size-3.5" /> Edit</Button>} />
      <div className="px-5 pb-5 space-y-3 text-[13px]">
        {regs.length === 0 ? <p className="text-muted">No registration or licence recorded. Add your AIOTA or state council number: you need it for a certificate of good standing.</p>
          : regs.map((r, i) => (
            <div key={i} className="flex items-start gap-2"><BadgeCheck className="size-4 text-accent shrink-0 mt-0.5" /><div className="min-w-0"><div className="font-medium">{r.body}</div><div className="text-muted text-[12.5px]">{r.kind}{r.number ? ` · ${r.number}` : ""} · {r.status}{r.expires ? ` · valid to ${r.expires}` : ""}</div></div></div>
          ))}
        {langs.length > 0 && <div className="flex items-start gap-2 pt-1"><Languages className="size-4 text-accent shrink-0 mt-0.5" /><div className="flex flex-wrap gap-1.5">{langs.map((l) => <Badge key={l.name}>{l.name} · {l.level}</Badge>)}</div></div>}
      </div>
    </Card>
  );
}
