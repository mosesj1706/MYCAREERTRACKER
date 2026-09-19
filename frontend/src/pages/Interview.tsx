import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { clsx } from "clsx";
import { Bot, Send, Square, Save, Trash2, User, BrainCircuit, History, CheckCircle2, XCircle } from "lucide-react";
import { api, streamSSE, type Application, type Gap, type InterviewRecord, type MCQ, type Profile } from "../lib/api";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Segmented, Select, Skeleton, Progress } from "../components/ui";
import { useToast } from "../components/Toast";

type Msg = { role: "user" | "assistant"; content: string };
type Tab = "mock" | "mcq" | "history";

export default function Interview() {
  const [tab, setTab] = useState<Tab>("mock");
  return (
    <div>
      <PageHeader title="Interview playground" subtitle="A recruiter who has read your profile, the job, and your gaps — and goes straight for them."
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: "mock", label: "Mock interview" }, { value: "mcq", label: "Quick-fire MCQs" }, { value: "history", label: "Past sessions" }]} />} />
      {tab === "mock" && <Mock />}{tab === "mcq" && <Mcq />}{tab === "history" && <HistoryTab />}
    </div>
  );
}

function Mock() {
  const toast = useToast(); const qc = useQueryClient();
  const loc = useLocation() as { state?: { app_id?: number } };
  const apps = useQuery({ queryKey: ["applications"], queryFn: () => api.get<{ items: Application[] }>("/api/applications") });
  const [appId, setAppId] = useState<number>(loc.state?.app_id ?? 0);
  const [mode, setMode] = useState<"mixed" | "technical" | "behavioral" | "project">("mixed");
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile | null>("/api/profile") });
  const [project, setProject] = useState<string>("");
  const [sid, setSid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [ended, setEnded] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, streaming]);

  const send = async (text: string | null, id: string | null = sid) => {
    if (!id) return;
    if (text) setMsgs((m) => [...m, { role: "user", content: text }]);
    setMsgs((m) => [...m, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      await streamSSE(`/api/interview/${id}/message`, { text }, (chunk) => setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + chunk }; return c; }));
    } catch (e) { toast("error", (e as Error).message); }
    setStreaming(false);
    if (text?.trim().toLowerCase() === "end") setEnded(true);
  };
  const start = async () => {
    if (mode === "project" && !project) { toast("error", "Pick a project to deep-dive."); return; }
    const r = await api.post<{ session_id: string }>("/api/interview", { app_id: appId || null, mode, project: mode === "project" ? project : null });
    setSid(r.session_id); setMsgs([]); setEnded(false);
    await send(null, r.session_id);
  };
  const save = useMutation({ mutationFn: () => api.post(`/api/interview/${sid}/save`), onSuccess: () => { setSid(null); setMsgs([]); qc.invalidateQueries({ queryKey: ["interviews"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); toast("success", "Session saved."); } });
  const discard = async () => { if (sid) await api.del(`/api/interview/${sid}`); setSid(null); setMsgs([]); };

  if (!sid) {
    return (
      <Card className="p-6 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-[13px]"><div className="text-muted mb-1.5">Interview for</div>
            <Select value={appId} onChange={(e) => setAppId(Number(e.target.value))} className="w-full">
              <option value={0}>General — your target role</option>
              {apps.data?.items.map((a) => <option key={a.id} value={a.id}>#{a.id} · {a.title}{a.company ? " @ " + a.company : ""}</option>)}
            </Select></label>
          <label className="text-[13px]"><div className="text-muted mb-1.5">Mode</div>
            <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-full"><option value="mixed">Mixed — includes your risk flags</option><option value="technical">Technical deep-dive</option><option value="behavioral">Behavioral (STAR)</option><option value="project">Project deep-dive — defend one of your repos</option></Select></label>
          {mode === "project" && (
            <label className="text-[13px] md:col-span-2"><div className="text-muted mb-1.5">Project</div>
              <Select value={project} onChange={(e) => setProject(e.target.value)} className="w-full">
                <option value="">Choose a project…</option>
                {profile.data?.projects.map((p) => <option key={p.name} value={p.name}>{p.name}{p.url ? " · GitHub" : ""}</option>)}
              </Select>
              <div className="text-[12px] text-muted mt-1">Projects linked to a synced GitHub repo load the README and file tree, so questions are about your actual code.</div></label>
          )}
        </div>
        <ul className="text-[13px] text-muted mt-4 space-y-1 list-disc pl-5">
          <li>One question at a time. Every answer gets a <b className="text-text">grade, a critique, and the pro answer</b> built from your real background.</li>
          <li>Type <code className="px-1 rounded bg-surface-2">tutor</code> if you're lost — it explains the concept, then asks again.</li>
          <li>Type <code className="px-1 rounded bg-surface-2">end</code> for a final report with the one question to rehearse most.</li>
        </ul>
        <Button variant="primary" size="lg" className="mt-5" onClick={start}><Bot className="size-4" /> Start interview</Button>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
      <Card className="flex flex-col h-[calc(100vh-190px)] min-h-[520px]">
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {msgs.map((m, i) => (
            <div key={i} className={clsx("flex gap-3", m.role === "user" && "flex-row-reverse")}>
              <div className={clsx("size-8 rounded-full grid place-items-center shrink-0", m.role === "assistant" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}>{m.role === "assistant" ? <Bot className="size-4" /> : <User className="size-4" />}</div>
              <div className={clsx("max-w-[80%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed", m.role === "assistant" ? "bg-surface-2 rounded-tl-md" : "bg-accent text-white rounded-tr-md")}>
                {m.role === "assistant" ? <div className="prose-chat">{m.content ? <ReactMarkdown>{m.content}</ReactMarkdown> : <span className="inline-flex gap-1 py-1"><Dot /><Dot d={1} /><Dot d={2} /></span>}</div> : m.content}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (input.trim() && !streaming) { send(input.trim()); setInput(""); } }} className="border-t border-border p-3 flex gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={ended ? "Session ended — save it." : "Answer as you would out loud… (Enter to send, Shift+Enter for newline)"} disabled={streaming || ended}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }}
            className="flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent outline-none" />
          <Button type="submit" variant="primary" disabled={!input.trim() || streaming || ended} className="h-auto"><Send className="size-4" /></Button>
        </form>
      </Card>
      <div className="space-y-3">
        <Card className="p-4 text-[13px] space-y-2">
          <div className="text-muted">Session</div>
          <div><Badge tone="accent">{mode}</Badge> <span className="text-muted">{msgs.filter((m) => m.role === "user").length} answers</span></div>
          <div className="pt-2 space-y-2">
            <Button className="w-full" onClick={() => !streaming && send("end")} disabled={streaming || ended}><Square className="size-4" /> End & get report</Button>
            <Button variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate()} disabled={streaming}><Save className="size-4" /> Save session</Button>
            <Button variant="ghost" className="w-full" onClick={discard}><Trash2 className="size-4" /> Discard</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
const Dot = ({ d = 0 }: { d?: number }) => <span className="size-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: `${d * 120}ms` }} />;

function Mcq() {
  const toast = useToast(); const qc = useQueryClient();
  const gaps = useQuery({ queryKey: ["gaps", 1], queryFn: () => api.get<Gap[]>("/api/gaps?min_jobs=1") });
  const stats = useQuery({ queryKey: ["mcq-stats"], queryFn: () => api.get<{ topic: string; answered: number; accuracy: number }[]>("/api/mcq/stats") });
  const gapTopics = (gaps.data ?? []).filter((g) => g.pressure > 0).slice(0, 8).map((g) => g.skill);
  const pool = [...new Set([...gapTopics, "AWS", "SQL", "Python", "Apache Airflow"])];
  const [topics, setTopics] = useState<string[] | null>(null);
  const sel = topics ?? gapTopics.slice(0, 3);
  const [n, setN] = useState(5);
  const [qs, setQs] = useState<MCQ[] | null>(null);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const gen = useMutation({ mutationFn: () => api.post<MCQ[]>("/api/mcq/generate", { topics: sel, n }), onSuccess: (r) => { setQs(r); setPicks({}); setChecked(false); }, onError: (e) => toast("error", (e as Error).message) });
  const check = async () => {
    setChecked(true);
    await Promise.all(qs!.map((q, i) => api.post("/api/mcq/record", { question: q, correct: picks[i] === q.answer_index })));
    qc.invalidateQueries({ queryKey: ["mcq-stats"] }); qc.invalidateQueries({ queryKey: ["analytics"] });
  };
  const score = qs ? qs.filter((q, i) => picks[i] === q.answer_index).length : 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
      <div className="space-y-4">
        <Card className="p-5">
          <div className="text-[13px] text-muted mb-2">Topics — defaults to your biggest gaps</div>
          <div className="flex flex-wrap gap-1.5">{pool.map((t) => <button key={t} onClick={() => setTopics(sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t])} className={clsx("rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition", sel.includes(t) ? "bg-accent text-white border-accent" : "border-border text-muted hover:border-border-strong")}>{t}</button>)}</div>
          <div className="flex items-center gap-3 mt-4">
            <Select value={n} onChange={(e) => setN(Number(e.target.value))}>{[3, 5, 8, 10].map((x) => <option key={x} value={x}>{x} questions</option>)}</Select>
            <Button variant="primary" loading={gen.isPending} disabled={sel.length === 0} onClick={() => gen.mutate()}><BrainCircuit className="size-4" /> {gen.isPending ? "Writing scenario questions…" : "Generate"}</Button>
          </div>
        </Card>
        {qs && (
          <div className="space-y-3">
            {qs.map((q, i) => { const ok = picks[i] === q.answer_index; return (
              <Card key={i} className={clsx("p-5", checked && (ok ? "border-success/40" : "border-danger/40"))}>
                <div className="flex items-center gap-2 text-[12px] text-muted mb-2"><Badge>{q.topic}</Badge><Badge tone={q.difficulty === "deep" ? "accent" : "neutral"}>{q.difficulty}</Badge></div>
                <div className="font-medium text-[14.5px] leading-relaxed">{i + 1}. {q.question}</div>
                <div className="mt-3 space-y-1.5">
                  {q.options.map((o, j) => (
                    <button key={j} disabled={checked} onClick={() => setPicks((p) => ({ ...p, [i]: j }))}
                      className={clsx("w-full text-left rounded-lg border px-3 py-2 text-[13.5px] transition", picks[i] === j ? "border-accent bg-accent-soft/60" : "border-border hover:border-border-strong",
                        checked && j === q.answer_index && "border-success bg-success-soft/60", checked && picks[i] === j && j !== q.answer_index && "border-danger bg-danger-soft/60")}>
                      <span className="num text-faint mr-2">{"ABCD"[j]}</span>{o}
                    </button>
                  ))}
                </div>
                {checked && <div className="mt-3 text-[13px] text-muted flex gap-2">{ok ? <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" /> : <XCircle className="size-4 text-danger shrink-0 mt-0.5" />}<span>{q.explanation}</span></div>}
              </Card>
            ); })}
            {!checked ? <Button variant="primary" size="lg" disabled={Object.keys(picks).length < qs.length} onClick={check}>Check answers</Button>
              : <Card className="p-5 flex items-center justify-between"><div className="text-lg font-semibold">Score <span className="num">{score}/{qs.length}</span></div><Button onClick={() => gen.mutate()} loading={gen.isPending}>Another set</Button></Card>}
          </div>
        )}
      </div>
      <Card>
        <CardHeader title="Accuracy by topic" subtitle="Weakest first" />
        <div className="px-5 pb-5 space-y-3">
          {stats.isLoading ? <Skeleton className="h-24" /> : (stats.data ?? []).length === 0 ? <div className="text-sm text-muted">Answer a set to start tracking.</div> : stats.data!.map((s) => (
            <div key={s.topic}><div className="flex justify-between text-[13px]"><span className="font-medium truncate">{s.topic}</span><span className="num text-muted">{s.accuracy}% · {s.answered}</span></div><Progress value={s.accuracy} tone={s.accuracy >= 75 ? "success" : s.accuracy >= 50 ? "warn" : "danger"} className="mt-1.5" /></div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function HistoryTab() {
  const q = useQuery({ queryKey: ["interviews"], queryFn: () => api.get<InterviewRecord[]>("/api/interviews") });
  const [open, setOpen] = useState<number | null>(null);
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (!q.data?.length) return <Empty icon={<History className="size-7" />} title="No saved sessions" body="Finish a mock interview and save it — transcripts and final reports land here." />;
  return (
    <div className="space-y-3">
      {q.data.map((s) => (
        <Card key={s.id} className="p-4">
          <button className="w-full text-left flex items-center justify-between gap-3" onClick={() => setOpen(open === s.id ? null : s.id)}>
            <div><div className="font-medium text-[14px]">{s.title ? `${s.title}${s.company ? " @ " + s.company : ""}` : "General interview"}</div><div className="text-[12px] text-muted">{s.created_at.slice(0, 16)} · {s.transcript.filter((m) => m.role === "user").length} answers</div></div>
            <Badge>{open === s.id ? "Hide" : "Open"}</Badge>
          </button>
          {open === s.id && (
            <div className="mt-4 space-y-4 border-t border-border pt-4">
              {s.summary && <div className="rounded-lg bg-accent-soft/50 px-4 py-3 text-[13.5px] prose-chat"><ReactMarkdown>{s.summary}</ReactMarkdown></div>}
              {s.transcript.map((m, i) => <div key={i} className={clsx("text-[13.5px] rounded-xl px-4 py-3", m.role === "assistant" ? "bg-surface-2 prose-chat" : "bg-accent-soft/40")}>{m.role === "assistant" ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}</div>)}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
