import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { clsx } from "clsx";
import { Bot, Send, Square, Save, Trash2, User, BrainCircuit, History, CheckCircle2, XCircle, Mic, MicOff, Volume2, VolumeX, Timer, BookOpen, Info, ExternalLink } from "lucide-react";
import { api, streamSSE, type Application, type CaseStudy, type CountriesPayload, type ExamsPayload, type Gap, type InterviewRecord, type MCQ, type Profile } from "../lib/api";
import { flag, label, usePack } from "../lib/pack";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Segmented, Select, Skeleton, Progress, SwitchRow } from "../components/ui";
import { useToast } from "../components/Toast";

type Msg = { role: "user" | "assistant"; content: string };
type Tab = "mock" | "mcq" | "history";
type NavState = { app_id?: number; mode?: string; case_id?: number };

const TECH_MODES = [
  { value: "mixed", label: "Mixed — includes your risk flags" }, { value: "technical", label: "Technical deep-dive" },
  { value: "behavioral", label: "Behavioral (STAR)" }, { value: "project", label: "Project deep-dive — defend one of your repos" },
];

export default function Interview() {
  const pack = usePack();
  const loc = useLocation() as { state?: NavState };
  const [tab, setTab] = useState<Tab>("mock");
  return (
    <div>
      <PageHeader title={pack.key === "ot" ? "Interview practice" : "Interview playground"} subtitle={label(pack, "interviewer", "A recruiter who has read your profile, the job, and your gaps — and goes straight for them.")}
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: "mock", label: "Mock interview" }, { value: "mcq", label: label(pack, "mcq_tab", "Quick-fire MCQs") }, { value: "history", label: "Past sessions" }]} />} />
      {tab === "mock" && <Mock init={loc.state} />}{tab === "mcq" && <Mcq />}{tab === "history" && <HistoryTab />}
    </div>
  );
}

// ---------------------------------------------------------------- voice (Safari/Chrome Web Speech)
type Recognition = { start: () => void; stop: () => void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null };
const SpeechRec = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
/** Read the interviewer's next question aloud: the text after the last "---" (skips grade and critique). */
function speak(markdown: string) {
  if (!("speechSynthesis" in window)) return;
  const tail = markdown.split(/\n-{3,}\n/).pop() ?? markdown;
  const text = tail.replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = "en-GB"; u.rate = 1;
  window.speechSynthesis.speak(u);
}

function Mock({ init }: { init?: NavState }) {
  const toast = useToast(); const qc = useQueryClient(); const pack = usePack();
  const ot = pack.key === "ot";
  const modes = pack.interview_modes.length ? pack.interview_modes : TECH_MODES;
  const apps = useQuery({ queryKey: ["applications"], queryFn: () => api.get<{ items: Application[] }>("/api/applications") });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile | null>("/api/profile") });
  const ctry = useQuery({ queryKey: ["countries"], queryFn: () => api.get<CountriesPayload>("/api/countries"), enabled: ot });
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => api.get<{ cases: CaseStudy[] }>("/api/cases"), enabled: ot });
  const [appId, setAppId] = useState<number>(init?.app_id ?? 0);
  const [mode, setMode] = useState<string>(init?.mode ?? "mixed");
  const [project, setProject] = useState<string>("");
  const [caseId, setCaseId] = useState<number>(init?.case_id ?? 0);
  const [country, setCountry] = useState<string>("");
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem("voice") === "on"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("voice", voice ? "on" : "off"); } catch {} if (!voice && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, [voice]);
  const app = apps.data?.items.find((a) => a.id === appId);
  useEffect(() => { if (ot) setCountry(app?.country ?? ctry.data?.selection.primary ?? ""); }, [ot, app?.country, ctry.data?.selection.primary]);
  const [sid, setSid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [ended, setEnded] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const live = useRef<string | null>(null);  // the session whose reply is streaming; discard/save clear it so late text is dropped
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, streaming]);

  const send = async (text: string | null, id: string | null = sid) => {
    if (!id) return;
    rec.current?.stop();
    if (text) setMsgs((m) => [...m, { role: "user", content: text }]);
    setMsgs((m) => [...m, { role: "assistant", content: "" }]);
    setStreaming(true);
    let reply = "";
    try {
      live.current = id;
      await streamSSE(`/api/interview/${id}/message`, { text }, (chunk) => {
        if (live.current !== id) return;  // session discarded or saved mid-reply
        reply += chunk;
        setMsgs((m) => { if (!m.length) return m; const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + chunk }; return c; });
      });
    } catch (e) { toast("error", (e as Error).message); }
    setStreaming(false);
    if (voice && reply && live.current === id) speak(reply);
    if (text?.trim().toLowerCase() === "end") setEnded(true);
  };
  const start = async () => {
    if (mode === "project" && !project) { toast("error", "Pick a project to deep-dive."); return; }
    if (mode === "case" && !caseId) { toast("error", "Pick a case study to defend."); return; }
    try {
      const r = await api.post<{ session_id: string }>("/api/interview", { app_id: appId || null, mode, project: mode === "project" ? project : null, country: country || null, case_id: mode === "case" ? caseId : null });
      setSid(r.session_id); setMsgs([]); setEnded(false);
      await send(null, r.session_id);
    } catch (e) { toast("error", (e as Error).message); }
  };
  const dictate = () => {
    if (!SpeechRec) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SpeechRec(); r.continuous = true; r.interimResults = false; r.lang = "en-IN";
    const base = input ? input.trimEnd() + " " : "";
    let said = "";
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += e.results[i][0].transcript + " "; setInput(base + said.trim()); };
    r.onend = () => setListening(false);
    rec.current = r; r.start(); setListening(true);
  };
  const save = useMutation({ mutationFn: () => api.post(`/api/interview/${sid}/save`), onSuccess: () => { live.current = null; setSid(null); setMsgs([]); qc.invalidateQueries({ queryKey: ["interviews"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); toast("success", "Session saved."); } });
  const discard = async () => { live.current = null; if ("speechSynthesis" in window) window.speechSynthesis.cancel(); const id = sid; setSid(null); setMsgs([]); setStreaming(false); if (id) await api.del(`/api/interview/${id}`); };
  const selectedCountries = ctry.data?.countries.filter((c) => ctry.data!.selection.selected.includes(c.code)) ?? [];
  const modeLabel = modes.find((m) => m.value === mode)?.label.split(" — ")[0] ?? mode;

  if (!sid) {
    return (
      <Card className="p-6 max-w-3xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-[13px]"><div className="text-muted mb-1.5">Interview for</div>
            <Select value={appId} onChange={(e) => setAppId(Number(e.target.value))} className="w-full">
              <option value={0}>General — your target role</option>
              {apps.data?.items.map((a) => <option key={a.id} value={a.id}>#{a.id} · {a.title}{a.company ? " @ " + a.company : ""}</option>)}
            </Select></label>
          <label className="text-[13px]"><div className="text-muted mb-1.5">Mode</div>
            <Select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full">{modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></label>
          {ot && (
            <label className="text-[13px]"><div className="text-muted mb-1.5">Country style</div>
              <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full">
                <option value="">Any country</option>
                {(selectedCountries.length ? selectedCountries : ctry.data?.countries ?? []).map((c) => <option key={c.code} value={c.code}>{flag(c.code)} {c.name}</option>)}
              </Select></label>
          )}
          {mode === "case" && (
            <label className="text-[13px]"><div className="text-muted mb-1.5">Case study</div>
              <Select value={caseId} onChange={(e) => setCaseId(Number(e.target.value))} className="w-full">
                <option value={0}>Choose a case…</option>
                {cases.data?.cases.map((c) => <option key={c.id} value={c.id}>{c.title}{c.story ? "" : " (no story yet)"}</option>)}
              </Select>
              {cases.data && cases.data.cases.length === 0 && <div className="text-[12px] text-warn mt-1">No case studies yet: add one under CPD & cases.</div>}</label>
          )}
          {mode === "project" && (
            <label className="text-[13px] md:col-span-2"><div className="text-muted mb-1.5">Project</div>
              <Select value={project} onChange={(e) => setProject(e.target.value)} className="w-full">
                <option value="">Choose a project…</option>
                {profile.data?.projects.map((p) => <option key={p.name} value={p.name}>{p.name}{p.url ? " · GitHub" : ""}</option>)}
              </Select>
              <div className="text-[12px] text-muted mt-1">Projects linked to a synced GitHub repo load the README and file tree, so questions are about your actual code.</div></label>
          )}
        </div>
        {ot && (
          <div className="mt-4 rounded-[12px] bg-fill-2 px-4 py-1.5">
            <SwitchRow checked={voice} onChange={setVoice} hint="The panel's questions are read aloud; answer with the microphone button or the iPad keyboard's dictation.">
              <span className="inline-flex items-center gap-2 font-medium"><Volume2 className="size-4 text-accent" /> Voice practice</span>
            </SwitchRow>
          </div>
        )}
        <ul className="text-[13px] text-muted mt-4 space-y-1 list-disc pl-5">
          <li>One question at a time. Every answer gets a <b className="text-text">grade, a critique, and the pro answer</b> built from your real background.</li>
          <li>Type <code className="px-1 rounded bg-surface-2">tutor</code> if you're lost — it explains, then asks again.</li>
          <li>Type <code className="px-1 rounded bg-surface-2">end</code> for a final report with the one question to rehearse most.</li>
        </ul>
        <Button variant="primary" size="lg" className="mt-5" onClick={start}><Bot className="size-4" /> Start interview</Button>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
      <Card className="flex flex-col h-[calc(100dvh-190px)] min-h-[480px]">
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {msgs.map((m, i) => (
            <div key={i} className={clsx("flex gap-3", m.role === "user" && "flex-row-reverse")}>
              <div className={clsx("size-8 rounded-full grid place-items-center shrink-0", m.role === "assistant" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}>{m.role === "assistant" ? <Bot className="size-4" /> : <User className="size-4" />}</div>
              <div className={clsx("max-w-[82%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed", m.role === "assistant" ? "bg-surface-2 rounded-tl-md" : "bg-accent text-white rounded-tr-md")}>
                {m.role === "assistant" ? <div className="prose-chat">{m.content ? <ReactMarkdown>{m.content}</ReactMarkdown> : <span className="inline-flex gap-1 py-1"><Dot /><Dot d={1} /><Dot d={2} /></span>}</div> : m.content}
                {m.role === "assistant" && m.content && !streaming && <button onClick={() => speak(m.content)} className="mt-1.5 text-[11.5px] text-faint hover:text-text inline-flex items-center gap-1"><Volume2 className="size-3" /> Read aloud</button>}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (input.trim() && !streaming) { send(input.trim()); setInput(""); } }} className="border-t border-border p-3 flex gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={ended ? "Session ended — save it." : listening ? "Listening… speak your answer" : "Answer as you would out loud… (Enter to send, Shift+Enter for newline)"} disabled={streaming || ended}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }}
            className="flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent outline-none" />
          {SpeechRec && <Button type="button" variant={listening ? "danger" : "secondary"} onClick={dictate} disabled={streaming || ended} className="h-auto" title={listening ? "Stop dictation" : "Answer by voice"}>{listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}</Button>}
          <Button type="submit" variant="primary" disabled={!input.trim() || streaming || ended} className="h-auto"><Send className="size-4" /></Button>
        </form>
      </Card>
      <div className="space-y-3">
        <Card className="p-4 text-[13px] space-y-2">
          <div className="text-muted">Session</div>
          <div className="flex flex-wrap gap-1.5 items-center"><Badge tone="accent">{modeLabel}</Badge>{country && <Badge>{flag(country)} {country}</Badge>}<span className="text-muted">{msgs.filter((m) => m.role === "user").length} answers</span></div>
          {ot && <button onClick={() => setVoice(!voice)} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-text">{voice ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />} Voice {voice ? "on" : "off"}</button>}
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

// ---------------------------------------------------------------- MCQs / licensing exam practice
function Mcq() {
  const toast = useToast(); const qc = useQueryClient(); const pack = usePack();
  const ot = pack.key === "ot";
  const gaps = useQuery({ queryKey: ["gaps", 1], queryFn: () => api.get<Gap[]>("/api/gaps?min_jobs=1") });
  const catalogue = useQuery({ queryKey: ["exams"], queryFn: () => api.get<ExamsPayload>("/api/exams"), enabled: ot });
  const [examId, setExamId] = useState<string>("");
  const exams = catalogue.data?.exams ?? [];
  useEffect(() => { if (ot && !examId && exams.length) setExamId((exams.find((e) => e.tracked) ?? exams.find((e) => e.selected_country) ?? exams[0]).id); }, [ot, examId, exams]);
  const exam = exams.find((e) => e.id === examId);
  const stats = useQuery({ queryKey: ["mcq-stats", ot ? examId : ""], queryFn: () => api.get<{ topic: string; answered: number; accuracy: number }[]>(`/api/mcq/stats${ot && examId ? `?exam=${examId}` : ""}`), enabled: !ot || !!examId });
  // OT: licences, BLS and soft skills are requirements, not exam topics. Exams with a domain blueprint
  // (NBCOT, NOTCE) practise by domain only.
  const gapTopics = (gaps.data ?? []).filter((g) => g.pressure > 0 && !(ot && ["credentials", "soft"].includes(g.category ?? ""))).slice(0, 8).map((g) => g.skill);
  const blueprint = !!exam && (exam.weights?.length || exam.id === "notce");
  const base = ot ? (exam?.topics ?? pack.mcq_topics) : [...gapTopics, ...pack.mcq_topics];
  const pool = [...new Set(ot ? [...base, ...(blueprint ? [] : gapTopics.filter((g) => !base.includes(g)).slice(0, 4))] : base)];
  const [topics, setTopics] = useState<string[] | null>(null);
  const sel = topics ?? (ot ? (blueprint ? base : base.slice(0, 3)) : gapTopics.slice(0, 3));
  const [format, setFormat] = useState<"quick" | "timed">("quick");
  const [n, setN] = useState(5);
  const [qs, setQs] = useState<MCQ[] | null>(null);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!deadline || checked) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [deadline, checked]);
  const left = deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : null;
  const perQuestion = exam?.seconds_per_question ?? 72;  // the real exam's pace
  const pick = (id: string) => { setExamId(id); setTopics(null); setQs(null); setDeadline(null); };
  const gen = useMutation({
    mutationFn: () => api.post<MCQ[]>("/api/mcq/generate", { topics: sel, n, exam: ot ? examId || null : null }),
    onSuccess: (r) => { setQs(r); setPicks({}); setChecked(false); setDeadline(format === "timed" ? Date.now() + r.length * perQuestion * 1000 : null); setNow(Date.now()); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const check = async () => {
    if (!qs || checked) return;
    setChecked(true);
    await Promise.all(qs.map((q, i) => api.post("/api/mcq/record", { question: q, correct: picks[i] === q.answer_index, exam: ot ? examId || null : null })));
    qc.invalidateQueries({ queryKey: ["mcq-stats"] }); qc.invalidateQueries({ queryKey: ["analytics"] });
  };
  useEffect(() => { if (left === 0 && qs && !checked) { toast("info", "Time's up — marking your answers."); check(); } }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const score = qs ? qs.filter((q, i) => picks[i] === q.answer_index).length : 0;
  const byTopic = qs && checked ? Object.entries(qs.reduce<Record<string, [number, number]>>((acc, q, i) => { const a = acc[q.topic] ?? [0, 0]; acc[q.topic] = [a[0] + (picks[i] === q.answer_index ? 1 : 0), a[1] + 1]; return acc; }, {})) : [];
  const instant = ot && format === "quick";  // OT quick-fire: feedback per question; tech: check at the end as before
  const groups: [string, typeof exams][] = [
    ["Your countries", exams.filter((e) => e.selected_country)],
    ["Gulf", exams.filter((e) => !e.selected_country && ["AE", "SA", "QA", "OM", "KW", "BH"].includes(e.country))],
    ["Other countries", exams.filter((e) => !e.selected_country && !["AE", "SA", "QA", "OM", "KW", "BH"].includes(e.country))],
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
      <div className="space-y-4">
        {ot && (
          <Card className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
              <label className="text-[13px]"><div className="text-muted mb-1.5">Licensing exam</div>
                <Select value={examId} onChange={(e) => pick(e.target.value)} className="w-full">
                  {groups.map(([g, list]) => list.length > 0 && <optgroup key={g} label={g}>{list.map((e) => <option key={e.id} value={e.id}>{flag(e.country)} {e.name} · {e.country_name}</option>)}</optgroup>)}
                </Select></label>
              <div className="text-[13px]"><div className="text-muted mb-1.5">Format</div>
                <Segmented value={format} onChange={(v) => { setFormat(v); setN(v === "timed" ? 20 : 5); }} options={[{ value: "quick", label: "Quick-fire" }, { value: "timed", label: "Timed mock exam" }]} /></div>
            </div>
            {exam && (
              <div className="mt-4 rounded-[12px] bg-fill-2 px-4 py-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0"><div className="font-semibold text-[15px]">{flag(exam.country)} {exam.name}</div><div className="text-[12.5px] text-muted">{exam.regulator} · {exam.provider}</div></div>
                  <a href={exam.official_url} target="_blank" rel="noreferrer" className="text-[13px] text-accent hover:underline inline-flex items-center gap-1 shrink-0">Official site <ExternalLink className="size-3" /></a>
                </div>
                <ul className="mt-2.5 space-y-1 text-[13px]">{exam.format.map((f, i) => <li key={i} className="flex gap-2"><span className="text-faint">•</span><span>{f}</span></li>)}</ul>
                <div className="text-[11.5px] text-faint mt-2">Source: {exam.source}. Rules change; check the official site before you book.</div>
              </div>
            )}
          </Card>
        )}
        <Card className="p-5">
          <div className="text-[13px] text-muted mb-2">{ot ? (blueprint ? "Exam domains" : "Topics") : "Topics — defaults to your biggest gaps"}</div>
          <div className="flex flex-wrap gap-1.5">{pool.map((t, i) => <button key={t} onClick={() => setTopics(sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t])} className={clsx("rounded-full px-3 py-1 text-[13px] font-medium transition", sel.includes(t) ? "bg-accent text-white" : "bg-fill text-text hover:brightness-95")}>{t}{exam?.weights?.[i] != null && base.includes(t) ? <span className="opacity-70 ml-1">{exam.weights[i]}%</span> : null}</button>)}</div>
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <Select value={n} onChange={(e) => setN(Number(e.target.value))} className="w-auto">{(format === "timed" ? [10, 20, 30] : [3, 5, 8, 10]).map((x) => <option key={x} value={x}>{x} questions{format === "timed" ? ` · ${Math.round((x * perQuestion) / 60)} min` : ""}</option>)}</Select>
            <Button variant="primary" loading={gen.isPending} disabled={sel.length === 0 || (ot && !examId)} onClick={() => gen.mutate()}><BrainCircuit className="size-4" /> {gen.isPending ? (n > 10 ? "Writing the exam (1–2 min)…" : "Writing questions…") : format === "timed" ? "Start mock exam" : "Generate"}</Button>
          </div>
          {ot && format === "timed" && <p className="text-[12.5px] text-muted mt-2">Timed at the real exam's pace: about {perQuestion} seconds a question.</p>}
          {ot && <p className="text-[12px] text-muted mt-3 flex gap-1.5"><Info className="size-3.5 shrink-0 mt-0.5" />AI-written practice in the style of the exam, not real exam questions. A second review checks every answer key and drops disputed questions; still check anything surprising in your textbook.</p>}
        </Card>
        {ot && (catalogue.data?.no_exam.length ?? 0) > 0 && (
          <details className="px-1">
            <summary className="text-[13.5px] text-accent cursor-pointer">Countries without a licensing exam</summary>
            <div className="mt-2 rounded-[12px] bg-fill-2 divide-y divide-border">{catalogue.data!.no_exam.map((c) => <div key={c.country} className="px-4 py-2.5 text-[13px]"><span className="font-medium">{flag(c.country)} {c.country_name}</span><span className="text-muted"> · {c.note}</span></div>)}</div>
          </details>
        )}
        {qs && (
          <div className="space-y-3">
            {deadline && !checked && (
              <Card className="px-5 py-3 flex items-center justify-between sticky top-2 z-10">
                <span className="inline-flex items-center gap-2 font-semibold"><Timer className="size-4 text-accent" /> <span className={clsx("num", left! < 60 && "text-danger")}>{Math.floor(left! / 60)}:{String(left! % 60).padStart(2, "0")}</span></span>
                <span className="text-[13px] text-muted">{Object.keys(picks).length}/{qs.length} answered</span>
                <Button size="sm" variant="primary" onClick={check}>Submit</Button>
              </Card>
            )}
            {qs.map((q, i) => { const ok = picks[i] === q.answer_index; const reveal = checked || (instant && picks[i] !== undefined); return (
              <Card key={i} className={clsx("p-5", reveal && (ok ? "border-success/40" : "border-danger/40"))}>
                <div className="flex items-center gap-2 text-[12px] text-muted mb-2"><Badge>{q.topic}</Badge><Badge tone={q.difficulty === "deep" ? "accent" : "neutral"}>{q.difficulty}</Badge></div>
                <div className="font-medium text-[15px] leading-relaxed">{i + 1}. {q.question}</div>
                <div className="mt-3 space-y-1.5">
                  {q.options.map((o, j) => (
                    <button key={j} disabled={reveal} onClick={() => setPicks((p) => ({ ...p, [i]: j }))}
                      className={clsx("w-full text-left rounded-[10px] border px-3.5 py-2.5 text-[14px] transition", picks[i] === j ? "border-accent bg-accent-soft/60" : "border-border hover:border-border-strong",
                        reveal && j === q.answer_index && "border-success bg-success-soft/60", reveal && picks[i] === j && j !== q.answer_index && "border-danger bg-danger-soft/60")}>
                      <span className="num text-faint mr-2">{"ABCD"[j]}</span>{o}
                    </button>
                  ))}
                </div>
                {reveal && <div className="mt-3 text-[13px] text-muted flex gap-2">{ok ? <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" /> : <XCircle className="size-4 text-danger shrink-0 mt-0.5" />}<span>{q.explanation}{q.reference && <span className="block mt-1 text-[12px] inline-flex items-center gap-1"><BookOpen className="size-3" /> Read more: {q.reference}</span>}</span></div>}
              </Card>
            ); })}
            {!checked ? (deadline ? null : <Button variant="primary" size="lg" disabled={Object.keys(picks).length < qs.length} onClick={check}>{instant ? "Finish & record" : "Check answers"}</Button>)
              : (
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-3 flex-wrap"><div className="text-lg font-semibold">Score <span className="num">{score}/{qs.length}</span> <span className="text-muted text-[15px] font-normal">· {Math.round((100 * score) / qs.length)}%</span></div><Button onClick={() => gen.mutate()} loading={gen.isPending}>Another set</Button></div>
                  {byTopic.length > 1 && <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">{byTopic.map(([t, [r, all]]) => <div key={t} className="text-[13px]"><div className="flex justify-between"><span className="truncate">{t}</span><span className="num text-muted">{r}/{all}</span></div><Progress value={(100 * r) / all} tone={r / all >= 0.75 ? "success" : r / all >= 0.5 ? "warn" : "danger"} className="mt-1" /></div>)}</div>}
                </Card>
              )}
          </div>
        )}
      </div>
      <Card>
        <CardHeader title="Accuracy by topic" subtitle={ot && exam ? `${exam.name} · weakest first` : "Weakest first"} />
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
