import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { BookOpenCheck, Clock, MessagesSquare, NotebookPen, Pencil, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { api, type CaseStudy, type CpdPayload } from "../lib/api";
import { Button, Card, CardHeader, Empty, Input, PageHeader, Segmented, Select, Skeleton, Stat, Textarea } from "../components/ui";
import { Drawer } from "../components/Drawer";
import { CopyButton } from "../components/Copy";
import AddToProfile, { type AdditionInit } from "../components/AddToProfile";
import { useToast } from "../components/Toast";

const KIND_LABEL: Record<string, string> = { course: "Course", workshop: "Workshop", conference: "Conference", supervision: "Supervision", reading: "Reading", case_review: "Case review", teaching: "Teaching", other: "Other" };
const today = () => new Date().toISOString().slice(0, 10);

export default function Cpd() {
  const [tab, setTab] = useState<"cpd" | "cases">("cpd");
  return (
    <div>
      <PageHeader title="CPD & cases" subtitle="Your continuing professional development and the cases you can talk about in an interview."
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: "cpd", label: "CPD log" }, { value: "cases", label: "Case studies" }]} />} />
      {tab === "cpd" ? <CpdLog /> : <Cases />}
    </div>
  );
}

// ---------------------------------------------------------------- CPD log
function CpdLog() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ["cpd"], queryFn: () => api.get<CpdPayload>("/api/cpd") });
  const blank = { date: today(), kind: "course", title: "", provider: "", hours: "", reflection: "" };
  const [f, setF] = useState(blank);
  const [adding, setAdding] = useState<AdditionInit | undefined>();
  const add = useMutation({
    mutationFn: () => api.post<CpdPayload>("/api/cpd", { ...f, hours: Number(f.hours) || 0 }),
    onSuccess: (d) => { qc.setQueryData(["cpd"], d); setF(blank); toast("success", "Logged."); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const del = useMutation({ mutationFn: (id: number) => api.del<CpdPayload>(`/api/cpd/${id}`), onSuccess: (d) => qc.setQueryData(["cpd"], d) });
  if (q.isLoading || !q.data) return <Skeleton className="h-64" />;
  const { entries, summary, kinds } = q.data;
  const thisYear = summary.by_year.find((y) => y.year === today().slice(0, 4))?.hours ?? 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <div className="space-y-4">
        <Card className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-[150px_150px_1fr] gap-3">
            <label className="text-[13px] text-muted">Date<Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="mt-1" /></label>
            <label className="text-[13px] text-muted">Type<Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="w-full mt-1">{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</Select></label>
            <label className="text-[13px] text-muted">What was it?<Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Upper limb rehabilitation after stroke (webinar)" className="mt-1" /></label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3 mt-3">
            <label className="text-[13px] text-muted">Provider<Input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="e.g. AIOTA, OpenWHO, department in-service" className="mt-1" /></label>
            <label className="text-[13px] text-muted">Hours<Input type="number" min={0} step={0.5} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} className="mt-1" /></label>
          </div>
          <label className="block text-[13px] text-muted mt-3">Reflection: what changed in your practice?<Textarea rows={2} value={f.reflection} onChange={(e) => setF({ ...f, reflection: e.target.value })} placeholder="One or two lines. Regulators and panels ask for this." className="mt-1" /></label>
          <div className="flex justify-end mt-3"><Button variant="primary" disabled={!f.title.trim()} loading={add.isPending} onClick={() => add.mutate()}><Plus className="size-4" /> Log it</Button></div>
        </Card>
        {entries.length === 0 ? <Card><Empty icon={<BookOpenCheck className="size-8" />} title="Nothing logged yet" body="Courses, webinars, supervision, in-service teaching and reading all count. Hours add up quickly and many regulators ask for them." /></Card> : (
          <Card>
            <CardHeader title="Log" subtitle={`${entries.length} entries`} />
            <div className="px-3 pb-3 space-y-1">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2/60">
                  <div className="num text-[12px] text-faint w-20 shrink-0 pt-0.5">{e.date}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium">{e.title}</div>
                    <div className="text-[12px] text-muted">{KIND_LABEL[e.kind] ?? e.kind}{e.provider ? ` · ${e.provider}` : ""} · {e.hours} h</div>
                    {e.reflection && <div className="text-[12.5px] text-muted mt-1 italic">{e.reflection}</div>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setAdding({ kind: "course", name: e.title, org: e.provider, date: e.date.slice(0, 7), description: `${KIND_LABEL[e.kind]}, ${e.hours} hours. ${e.reflection}` })}>Add to profile</Button>
                  <button onClick={() => del.mutate(e.id)} className="p-1.5 text-faint hover:text-danger" title="Delete"><Trash2 className="size-4" /></button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
      <div className="space-y-4">
        <Stat label="CPD hours this year" value={thisYear} hint={`${summary.total_hours} h in total`} icon={<Clock className="size-5" />} />
        {summary.by_kind.length > 0 && (
          <Card><CardHeader title="By type" /><div className="px-5 pb-5 space-y-1.5 text-[13px]">{summary.by_kind.map((k) => <div key={k.kind} className="flex justify-between"><span>{KIND_LABEL[k.kind] ?? k.kind}</span><span className="num text-muted">{k.hours} h</span></div>)}</div></Card>
        )}
        <Card className="p-4 text-[12.5px] text-muted leading-relaxed">Keep the certificate for each entry in <b className="text-text">Documents</b> (CPD / course certificate). <b className="text-text">Add to profile</b> turns an entry into evidence; a course alone counts as supervised, not independent, practice.</Card>
      </div>
      <AddToProfile open={!!adding} onClose={() => setAdding(undefined)} initial={adding} />
    </div>
  );
}

// ---------------------------------------------------------------- Case studies
const FIELDS: { key: string; label: string; hint: string; rows?: number }[] = [
  { key: "client_group", label: "Client group & condition", hint: "e.g. Left MCA stroke, right hemiparesis" },
  { key: "age_band", label: "Age band", hint: "e.g. 60s (never an exact age with a date)" },
  { key: "setting", label: "Setting & stage", hint: "e.g. Inpatient rehab, week 2 after onset" },
  { key: "presentation", label: "Presentation", hint: "What you saw: function, cognition, what the client wanted", rows: 2 },
  { key: "assessments", label: "Assessments used", hint: "e.g. Fugl-Meyer UE 22/66, MBI 45, MoCA 24", rows: 2 },
  { key: "goals", label: "Goals", hint: "What you and the client agreed, ideally SMART", rows: 2 },
  { key: "interventions", label: "Interventions", hint: "What you did and why, sessions per week, who else was involved", rows: 3 },
  { key: "outcomes", label: "Outcomes", hint: "Re-assessment scores, functional change, discharge; partial is fine", rows: 2 },
  { key: "role", label: "Your role", hint: "What you did yourself vs with the team" },
  { key: "reflection", label: "What you'd do differently", hint: "Panels love an honest answer here", rows: 2 },
];

function Cases() {
  const qc = useQueryClient(); const toast = useToast(); const nav = useNavigate();
  const q = useQuery({ queryKey: ["cases"], queryFn: () => api.get<{ cases: CaseStudy[] }>("/api/cases") });
  const [editing, setEditing] = useState<CaseStudy | "new" | null>(null);
  const story = useMutation({
    mutationFn: (id: number) => api.post<CaseStudy>(`/api/cases/${id}/story`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cases"] }); toast("success", "Interview story ready."); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/cases/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["cases"] }) });
  if (q.isLoading || !q.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-start gap-3 border-accent/30 bg-accent-soft/30">
        <ShieldCheck className="size-5 text-accent shrink-0 mt-0.5" />
        <div className="text-[13px] leading-relaxed flex-1"><b>De-identified only.</b> No names or initials, no exact dates, no hospital numbers, no photos. Use age bands and the condition. The story builder also leaves out anything that looks identifying and tells you what it removed.</div>
        <Button variant="primary" onClick={() => setEditing("new")} className="shrink-0"><Plus className="size-4" /> New case</Button>
      </Card>
      {q.data.cases.length === 0 ? <Card><Empty icon={<NotebookPen className="size-8" />} title="No cases yet" body="Write up two or three cases you know well: one neuro, one where the outcome was only partial. They become your strongest interview answers." /></Card> : (
        q.data.cases.map((c) => (
          <Card key={c.id}>
            <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap">
              <div><h3 className="font-semibold text-[15px]">{c.title}</h3><div className="text-[12.5px] text-muted mt-0.5">{[c.input.client_group, c.input.age_band, c.input.setting].filter(Boolean).join(" · ")}</div></div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant={c.story ? "secondary" : "primary"} loading={story.isPending && story.variables === c.id} onClick={() => story.mutate(c.id)}><Sparkles className="size-3.5" /> {c.story ? "Rebuild story" : "Build interview story"}</Button>
                <Button size="sm" onClick={() => nav("/interview", { state: { mode: "case", case_id: c.id } })}><MessagesSquare className="size-3.5" /> Practise defending it</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)}><Pencil className="size-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${c.title}"?`)) del.mutate(c.id); }}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
            {c.story ? (
              <div className="px-5 pb-5 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(["situation", "task", "action", "result"] as const).map((k) => <div key={k} className="rounded-lg bg-surface-2/60 px-3.5 py-3"><div className="text-[11px] uppercase tracking-wider font-semibold text-accent">{k}</div><div className="text-[13.5px] leading-relaxed mt-1">{c.story![k]}</div></div>)}
                </div>
                <div className="rounded-lg border border-border px-3.5 py-2.5 flex items-start gap-3"><div className="flex-1 text-[13.5px]"><span className="text-muted">Resume line: </span>{c.story.resume_bullet}</div><CopyButton text={c.story.resume_bullet} /></div>
                <div className="text-[13px]"><div className="text-muted mb-1">A panel will likely ask</div><ul className="list-disc pl-5 space-y-1">{c.story.interview_questions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                {c.story.privacy_notes.length > 0 && <div className="text-[12.5px] text-warn flex gap-2"><ShieldCheck className="size-4 shrink-0" />Left out for privacy: {c.story.privacy_notes.join("; ")}</div>}
              </div>
            ) : <div className="px-5 pb-5 text-[13px] text-muted">Build the story to get a STAR answer, a resume line and the questions a panel will ask.</div>}
          </Card>
        ))
      )}
      <CaseDrawer c={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CaseDrawer({ c, onClose }: { c: CaseStudy | "new" | null; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [title, setTitle] = useState(""); const [f, setF] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<CaseStudy | "new" | null>(null);
  if (c !== seen) { setSeen(c); setTitle(c && c !== "new" ? c.title : ""); setF(c && c !== "new" ? c.input : {}); }
  const save = useMutation({
    mutationFn: () => (c && c !== "new" ? api.put(`/api/cases/${c.id}`, { title, fields: f }) : api.post("/api/cases", { title, fields: f })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cases"] }); toast("success", "Case saved. Build the story when you're ready."); onClose(); },
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <Drawer open={!!c} onClose={onClose} title={c === "new" ? "New case study" : "Edit case study"} width={620}>
      <div className="space-y-3.5">
        <label className="block text-[13px] text-muted">Short title (no names)<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Upper limb recovery after stroke" className="mt-1" /></label>
        {FIELDS.map((x) => (
          <label key={x.key} className="block text-[13px] text-muted">{x.label}
            {x.rows ? <Textarea rows={x.rows} value={f[x.key] ?? ""} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} placeholder={x.hint} className="mt-1" />
              : <Input value={f[x.key] ?? ""} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} placeholder={x.hint} className="mt-1" />}
          </label>
        ))}
        <Button variant="primary" size="lg" className={clsx("w-full")} disabled={!title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save case</Button>
      </div>
    </Drawer>
  );
}
