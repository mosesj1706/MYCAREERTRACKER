import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { BookOpen, Check, CheckCircle2, ChevronLeft, ChevronRight, Download, FileText, Flag, GraduationCap, Info, LayoutGrid, Lock, RotateCcw, Timer, Trash2, Trophy, XCircle } from "lucide-react";
import { api, type ExamBank, type ExamInfo, type ExamItem, type ExamPath, type ExamSession, type ExamsPayload, type PathReport, type PathStep } from "../lib/api";
import { flag } from "../lib/pack";
import { Badge, Button, Card, CardHeader, Empty, Progress, Segmented, Select, Skeleton } from "../components/ui";
import { Drawer } from "../components/Drawer";
import { useToast } from "../components/Toast";

type Mode = "quick" | "timed" | "full";
type Source = "bank" | "mistakes";
type Answers = Record<number, { picked?: number; flagged?: boolean }>;
const GULF = ["AE", "SA", "QA", "OM", "KW", "BH"];

const fmtTime = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
const MODE_LABEL: Record<Mode, string> = { quick: "Quick-fire", timed: "Timed practice", full: "Full mock" };
const SOURCE_LABEL: Record<string, string> = { new: "New questions", bank: "Question bank", mistakes: "My mistakes" };  // "new": older sessions

/**
 * Licensing-exam practice (OT). The study path comes first: quick-fire rounds of 5, 10 and 15 questions, timed rounds
 * of 10, 20, 30 and 50, then a full mock exam; passing each unlocks the next. Answers and time are saved as she goes,
 * so she can leave mid-round and carry on later. Extra practice by topic or from her mistakes sits below. Nothing
 * here calls the AI.
 */
export default function ExamPractice() {
  const toast = useToast(); const qc = useQueryClient();
  const catalogue = useQuery({ queryKey: ["exams"], queryFn: () => api.get<ExamsPayload>("/api/exams") });
  const exams = catalogue.data?.exams ?? [];
  const [examId, setExamId] = useState("");
  useEffect(() => { if (!examId && exams.length) setExamId((exams.find((e) => e.tracked) ?? exams.find((e) => e.selected_country) ?? exams[0]).id); }, [examId, exams]);
  const exam = exams.find((e) => e.id === examId);
  const bank = useQuery({ queryKey: ["exam-bank", examId], queryFn: () => api.get<ExamBank>(`/api/exam-bank/${examId}`), enabled: !!examId });
  const path = useQuery({ queryKey: ["exam-path", examId], queryFn: () => api.get<ExamPath>(`/api/exam-path/${examId}`), enabled: !!examId });
  const [active, setActive] = useState<ExamSession | null>(null);
  const [review, setReview] = useState<number | null>(null);
  const [source, setSource] = useState<Source>("bank");
  const [extra, setExtra] = useState(false);
  const pickSource = (s: Source) => { setSource(s); setExtra(true); setTimeout(() => document.getElementById("exam-start")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); };
  const unfinished = bank.data?.sessions.find((s) => !s.finished_at && !s.round);  // free practice she left; path rounds resume from the path

  const refresh = () => { ["exam-bank", "exam-path", "mcq-stats", "analytics"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const done = () => { setActive(null); refresh(); };
  const open = async (id: number) => { try { setActive(await api.get<ExamSession>(`/api/exam-sessions/${id}`)); } catch (e) { toast("error", (e as Error).message); } };
  const startRound = async (round: string) => { try { setActive(await api.post<ExamSession>("/api/exam-sessions", { exam: examId, round })); refresh(); } catch (e) { toast("error", (e as Error).message); } };
  const mistakes = async (id: number) => { try { setActive(await api.post<ExamSession>("/api/exam-sessions", { exam: examId, mode: "quick", source: "mistakes", retry_of: id })); } catch (e) { toast("error", (e as Error).message); } };

  if (active) {
    const steps = path.data?.steps ?? [];
    const at = steps.findIndex((s) => s.id === active.round);
    const next = at >= 0 ? steps[at + 1] : undefined;
    return <SessionView key={active.id} session={active} exam={exams.find((e) => e.id === active.exam)} passMark={active.round ? path.data?.pass_percent : undefined}
      next={next && exam ? stepLabel(next, exam) : undefined}
      onLeave={() => { setActive(null); refresh(); }} onExit={done} onMistakes={() => mistakes(active.id)}
      onRetry={active.round ? () => startRound(active.round!) : undefined}
      onNext={next ? () => startRound(next.id) : undefined} />;
  }

  const groups: [string, ExamInfo[]][] = [
    ["Your countries", exams.filter((e) => e.selected_country)],
    ["Gulf", exams.filter((e) => !e.selected_country && GULF.includes(e.country))],
    ["Other countries", exams.filter((e) => !e.selected_country && !GULF.includes(e.country))],
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <div className="space-y-4">
        {unfinished && (
          <Card className="p-4 flex items-center gap-3 border-accent/40">
            <Timer className="size-5 text-accent shrink-0" />
            <div className="flex-1 text-[14px]"><b>You have an unfinished practice session.</b> <span className="text-muted">{MODE_LABEL[unfinished.mode]} · {unfinished.total} questions.</span></div>
            <Button size="sm" variant="primary" onClick={() => open(unfinished.id)}>Resume</Button>
            <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Discard this unfinished session?")) { await api.del(`/api/exam-sessions/${unfinished.id}`).catch(() => {}); refresh(); } }}>Discard</Button>
          </Card>
        )}
        <Card className="p-5">
          <label className="text-[13px] block"><div className="text-muted mb-1.5">Licensing exam</div>
            <Select value={examId} onChange={(e) => setExamId(e.target.value)} className="w-full">
              {groups.map(([g, list]) => list.length > 0 && <optgroup key={g} label={g}>{list.map((e) => <option key={e.id} value={e.id}>{flag(e.country)} {e.name} · {e.country_name}</option>)}</optgroup>)}
            </Select></label>
          {exam && (
            <details className="mt-3 rounded-[12px] bg-fill-2 px-4 py-3">
              <summary className="cursor-pointer text-[13.5px]"><span className="font-semibold">{flag(exam.country)} {exam.name}</span><span className="text-muted"> · {exam.regulator} · exam format</span></summary>
              <ul className="mt-2.5 space-y-1 text-[13px]">{exam.format.map((f, i) => <li key={i} className="flex gap-2"><span className="text-faint">•</span><span>{f}</span></li>)}</ul>
              <div className="text-[11.5px] text-faint mt-2">Source: {exam.source}. Rules change; check the <a href={exam.official_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">official site</a> before you book.</div>
            </details>
          )}
        </Card>
        {exam && path.data && ((bank.data?.total ?? 0) > 0
          ? <PathCard exam={exam} path={path.data} onStart={startRound} onResume={open} onRestart={async () => {
              if (!confirm("Start the study path again from round 1? Your report for this run is kept.")) return;
              try { await api.post(`/api/exam-path/${examId}/restart`); refresh(); } catch (e) { toast("error", (e as Error).message); } }} />
          : <Card className="p-5 text-[13.5px] text-muted">No questions in the bank for this exam yet, so its study path can't start.</Card>)}
        {exam && (
          <details open={extra} onToggle={(e) => setExtra(e.currentTarget.open)} className="px-1">
            <summary className="text-[14px] font-medium text-accent cursor-pointer">Extra practice: pick topics, or redo your mistakes</summary>
            <div className="mt-3 -mx-1"><StartCard key={exam.id} exam={exam} bank={bank.data} source={source} setSource={setSource} onStart={(s) => { setActive(s); refresh(); }} /></div>
          </details>
        )}
        {(catalogue.data?.no_exam.length ?? 0) > 0 && (
          <details className="px-1">
            <summary className="text-[13.5px] text-accent cursor-pointer">Countries without a licensing exam</summary>
            <div className="mt-2 rounded-[12px] bg-fill-2 divide-y divide-border">{catalogue.data!.no_exam.map((c) => <div key={c.country} className="px-4 py-2.5 text-[13px]"><span className="font-medium">{flag(c.country)} {c.country_name}</span><span className="text-muted"> · {c.note}</span></div>)}</div>
          </details>
        )}
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Question bank" subtitle={exam ? exam.name : undefined} />
          <div className="px-5 pb-4 grid grid-cols-3 gap-2 text-center">
            {([["Questions", bank.data?.total, "bank"], ["Answered", bank.data?.answered, null], ["Mistakes", bank.data?.mistakes, "mistakes"]] as const).map(([l, v, to]) => {
              const tile = <><div className="rounded-num text-[22px] font-semibold">{v ?? "–"}</div><div className={clsx("text-[11.5px]", to && v ? "text-accent" : "text-muted")}>{l}</div></>;
              return to && v ? <button key={l} onClick={() => pickSource(to)} className="rounded-[10px] bg-fill-2 py-2.5 hover:brightness-95">{tile}</button>
                : <div key={l} className="rounded-[10px] bg-fill-2 py-2.5">{tile}</div>;
            })}
          </div>
          <p className="px-5 pb-4 text-[12px] text-muted">Your practice questions for this exam, each answer checked. Tap Questions or Mistakes for extra practice from them.</p>
        </Card>
        <Card>
          <CardHeader title="Practice sessions" subtitle="Tap one to review" />
          <div className="px-3 pb-3">
            {bank.isLoading ? <Skeleton className="h-20" /> : (bank.data?.sessions ?? []).filter((s) => s.finished_at).length === 0 ? <div className="px-2 pb-2 text-[13px] text-muted">Your finished sessions appear here with their scores.</div> : (
              <div className="space-y-1">{bank.data!.sessions.filter((s) => s.finished_at).slice(0, 12).map((s) => {
                const pct = Math.round((100 * (s.correct ?? 0)) / Math.max(1, s.total));
                const pass = s.round ? path.data?.pass_percent : exam?.mock.pass_percent;
                return (
                  <button key={s.id} onClick={() => setReview(s.id)} className="w-full flex items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-fill-2">
                    <div className={clsx("rounded-num text-[15px] font-semibold w-12 text-right", pass ? (pct >= pass ? "text-success" : "text-danger") : "")}>{pct}%</div>
                    <div className="flex-1 min-w-0"><div className="text-[13.5px] font-medium">{s.round ? "Study path · " : ""}{MODE_LABEL[s.mode]} · {s.total} q</div><div className="text-[12px] text-muted">{s.finished_at!.slice(0, 16)}{s.seconds_used ? ` · ${fmtTime(s.seconds_used)}` : ""} · {SOURCE_LABEL[s.source]}</div></div>
                    <ChevronRight className="size-4 text-faint" />
                  </button>
                );
              })}</div>
            )}
          </div>
        </Card>
      </div>
      <ReviewSheet id={review} exam={exam} onClose={() => setReview(null)} onRetake={async () => { const id = review; setReview(null); if (id != null) mistakes(id); }} />
    </div>
  );
}

// ---------------------------------------------------------------- the study path
const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
function stepLabel(s: PathStep, exam: ExamInfo): string {
  if (s.mode === "quick") return `Quick-fire · ${s.n} questions`;
  if (s.mode === "timed") return `Timed · ${s.n} questions · ${Math.round((s.n * exam.seconds_per_question) / 60)} min`;
  return `Full mock exam · ${s.n} questions · ${fmtMinutes(exam.mock.minutes)}`;
}
const STAGE: Record<PathStep["mode"], string> = { quick: "Quick-fire", timed: "Timed practice", full: "Full mock exam" };

function PathCard({ exam, path, onStart, onResume, onRestart }: { exam: ExamInfo; path: ExamPath; onStart: (round: string) => void; onResume: (id: number) => void; onRestart: () => void }) {
  const passed = path.steps.filter((s) => s.status === "passed").length;
  const done = path.runs.filter((r) => r.completed_at);
  const [report, setReport] = useState<number | null>(null);
  const current = path.runs.find((r) => r.cycle === path.cycle);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><div className="font-semibold text-[17px]">Study path{path.cycle > 1 ? ` · run ${path.cycle}` : ""}</div>
          <div className="text-[13px] text-muted mt-0.5">Pass each round with {path.pass_percent}% or more to unlock the next. A round you retake gets a fresh mix of questions with the answers in a new order. Your progress is saved, so you can stop and carry on any time.</div></div>
        <div className="text-right">
          {path.complete ? <Badge tone="success">Path complete</Badge> : <span className="text-[13px] text-muted rounded-num">{passed} of {path.steps.length} passed</span>}
          {done.length > 0 && <div className="text-[12px] text-muted mt-1">Completed {done.length === 1 ? "once" : `${done.length} times`}</div>}
        </div>
      </div>
      <Progress value={(100 * passed) / path.steps.length} tone="success" className="mt-3" />
      {path.complete && current && (
        <div className="mt-4 rounded-[12px] bg-success-soft/60 px-4 py-3.5 flex items-start gap-3 flex-wrap">
          <Trophy className="size-5 text-success shrink-0 mt-0.5" />
          <div className="flex-1 min-w-[220px] text-[13.5px]"><b>You completed the study path{path.cycle > 1 ? ` (run ${path.cycle})` : ""} on {current.completed_at?.slice(0, 10)}.</b>
            <span className="text-muted"> {current.cards_added ? `${current.cards_added} questions you got wrong are now flashcards in the "My exam mistakes" deck.` : "No new mistakes to turn into flashcards."} The report has your study notes.</span></div>
          <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => setReport(path.cycle)}><FileText className="size-3.5" /> Report</Button><Button size="sm" onClick={onRestart}><RotateCcw className="size-3.5" /> Start again</Button></div>
        </div>
      )}
      {done.filter((r) => r.cycle !== path.cycle || !path.complete).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
          <span className="text-muted">Earlier runs:</span>
          {done.filter((r) => r.cycle !== path.cycle).map((r) => <button key={r.cycle} onClick={() => setReport(r.cycle)} className="text-accent hover:underline">Run {r.cycle} report · {r.completed_at?.slice(0, 10)}</button>)}
        </div>
      )}
      <ReportSheet exam={exam} cycle={report} onClose={() => setReport(null)} />
      <div className="mt-4 space-y-1.5">
        {path.steps.map((s, i) => {
          const stage = i === 0 || path.steps[i - 1].mode !== s.mode ? STAGE[s.mode] : null;
          const sub = s.status === "locked" ? "Locked: pass the round above to unlock it"
            : `Pass with ${path.pass_percent}%${s.best != null ? ` · best ${s.best}%` : ""}${s.attempts ? ` · ${s.attempts} attempt${s.attempts > 1 ? "s" : ""}` : ""}${s.resume_id ? " · in progress" : ""}`;
          const go = () => (s.resume_id ? onResume(s.resume_id) : onStart(s.id));
          return (
            <div key={s.id}>
              {stage && <div className="text-[11.5px] font-semibold uppercase tracking-wide text-faint px-1 pt-2 pb-1">{stage}</div>}
              <div className={clsx("flex items-center gap-3 rounded-[12px] px-3 py-2.5", s.status === "open" && "bg-accent-soft/60 ring-1 ring-accent/30", s.status === "locked" && "opacity-55")}>
                <div className={clsx("size-9 rounded-full grid place-items-center shrink-0 text-[14px] font-semibold rounded-num", s.status === "passed" ? "bg-success text-white" : s.status === "open" ? "bg-accent text-white" : "bg-fill text-muted")}>
                  {s.status === "passed" ? <Check className="size-4" strokeWidth={3} /> : s.status === "locked" ? <Lock className="size-4" /> : i + 1}
                </div>
                <div className="flex-1 min-w-0"><div className="text-[14.5px] font-medium">{stepLabel(s, exam)}</div><div className="text-[12.5px] text-muted">{sub}</div></div>
                {s.status === "open" && <Button variant="primary" onClick={go}>{s.resume_id ? "Resume" : "Start"}</Button>}
                {s.status === "passed" && <Button size="sm" onClick={go}>{s.resume_id ? "Resume" : "Practise again"}</Button>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ReportSheet({ exam, cycle, onClose }: { exam: ExamInfo; cycle: number | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["exam-path-report", exam.id, cycle], queryFn: () => api.get<PathReport>(`/api/exam-path/${exam.id}/report?cycle=${cycle}`), enabled: cycle != null });
  const r = q.data;
  const hm = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  let topic = "";
  return (
    <Drawer open={cycle != null} onClose={onClose} title={`Study path report${cycle && cycle > 1 ? ` · run ${cycle}` : ""}`} width={720}>
      {!r ? <Skeleton className="h-40" /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[["Attempts", r.attempts], ["Questions", r.answered], ["Correct", `${r.percent}%`], ["Time", hm(r.seconds)]].map(([l, v]) => (
              <div key={l} className="rounded-[10px] bg-fill-2 py-2.5"><div className="rounded-num text-[20px] font-semibold">{v}</div><div className="text-[11.5px] text-muted">{l}</div></div>))}
          </div>
          <div className="text-[13px] text-muted">{r.exam} · started {r.started_at.slice(0, 10)} · {r.completed_at ? `completed ${r.completed_at.slice(0, 10)}` : "in progress"}{r.cards_added ? ` · ${r.cards_added} mistakes added to the "${r.deck}" flashcards` : ""}</div>
          <div><a href={`/api/exam-path/${exam.id}/report.pdf?cycle=${r.cycle}`} download><Button size="sm"><Download className="size-3.5" /> Download as PDF</Button></a></div>
          <div>
            <div className="font-semibold text-[15px] mb-2">Rounds</div>
            <div className="rounded-[12px] bg-fill-2 divide-y divide-border">{r.rounds.filter((x) => x.attempts).map((x) => (
              <div key={x.id} className="px-3.5 py-2.5 flex items-center gap-3 text-[13px]">
                <div className="flex-1 min-w-0"><div className="font-medium">{STAGE[x.mode]} · {x.n} questions</div><div className="text-muted">{x.attempts} attempt{x.attempts > 1 ? "s" : ""} · first {x.first}% · best {x.best}%{x.passed_on ? ` · passed ${x.passed_on.slice(0, 10)}` : ""}</div></div>
                {x.passed_on ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
              </div>))}</div>
          </div>
          <div>
            <div className="font-semibold text-[15px] mb-2">Topics, weakest first</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">{r.by_topic.map((t) => <div key={t.topic} className="text-[13px]"><div className="flex justify-between gap-2"><span className="truncate">{t.topic}</span><span className="rounded-num text-muted">{t.correct}/{t.total}</span></div><Progress value={t.percent} tone={t.percent >= 75 ? "success" : t.percent >= 50 ? "warn" : "danger"} className="mt-1" /></div>)}</div>
          </div>
          <div>
            <div className="font-semibold text-[15px]">Study notes: {r.wrong.length} question{r.wrong.length === 1 ? "" : "s"} you got wrong</div>
            <div className="text-[12.5px] text-muted mb-2">Grouped by topic, weakest first. They are also in your flashcards, in the "{r.deck}" deck.</div>
            <div className="space-y-3">{r.wrong.map((w, i) => {
              const head = w.topic !== topic ? (topic = w.topic) : null;
              return (
                <div key={i}>
                  {head && <div className="text-[12px] font-semibold uppercase tracking-wide text-faint pt-2 pb-1">{head}</div>}
                  <Card className="p-4">
                    <div className="font-medium text-[14.5px] leading-relaxed">{w.question}</div>
                    <div className="mt-2 space-y-1">{w.options.map((o, j) => <div key={j} className={clsx("rounded-[9px] px-3 py-2 text-[13.5px]", j === w.answer_index ? "bg-success-soft/70 font-medium" : "text-muted")}><span className="rounded-num mr-2">{"ABCDEF"[j]}</span>{o}</div>)}</div>
                    <div className="mt-2 text-[13px] text-muted">{w.explanation}{w.reference && <span className="block mt-1 text-[12px]"><BookOpen className="size-3 inline mr-1" />Read more: {w.reference}</span>}{w.times_wrong > 1 && <span className="block mt-1 text-[12px] text-danger">Wrong {w.times_wrong} times</span>}</div>
                  </Card>
                </div>
              );
            })}</div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- choosing what to practise
function StartCard({ exam, bank, source, setSource, onStart }: { exam: ExamInfo; bank?: ExamBank; source: Source; setSource: (s: Source) => void; onStart: (s: ExamSession) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("quick");
  const [n, setN] = useState(5);
  const blueprint = !!exam.weights?.length || exam.id === "notce";
  const pool = exam.topics;
  const [topics, setTopics] = useState<string[] | null>(null);
  const sel = topics ?? exam.topics;
  const sizes = mode === "quick" ? [5, 10, 15] : [10, 20, 30, 50];
  useEffect(() => { setN(mode === "quick" ? 5 : 20); }, [mode]);
  const total = bank?.total ?? 0, unseen = bank ? bank.total - bank.answered : 0;
  const start = useMutation({
    mutationFn: () => api.post<ExamSession>("/api/exam-sessions", { exam: exam.id, mode, source: mode === "full" ? "bank" : source, n, topics: mode === "full" ? [] : sel }),
    onSuccess: onStart, onError: (e) => toast("error", (e as Error).message),
  });
  const available = mode === "full" || source === "bank" ? total : bank?.mistakes ?? 0;
  return (
    <Card id="exam-start" className="p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={mode} onChange={setMode} options={[{ value: "quick", label: "Quick-fire" }, { value: "timed", label: "Timed practice" }, { value: "full", label: "Full mock exam" }]} />
      </div>
      {mode === "full" ? (
        <div className="rounded-[12px] bg-accent-soft/60 px-4 py-3 text-[13.5px]">
          <div className="font-semibold">{exam.mock.questions} questions · {exam.mock.minutes >= 60 ? `${Math.floor(exam.mock.minutes / 60)} h${exam.mock.minutes % 60 ? ` ${exam.mock.minutes % 60} min` : ""}` : `${exam.mock.minutes} min`}{exam.mock.pass_percent ? ` · pass about ${exam.mock.pass_percent}%` : ""}</div>
          <div className="text-muted text-[12.5px] mt-0.5">{exam.mock.published ? "Same length and time as the real exam's published format." : "Typical Prometric length; your eligibility letter has the exact format."} One question at a time, flag and come back, submit at the end.</div>
          <div className="text-muted text-[12.5px] mt-1.5">{total === 0 ? "No questions in the bank for this exam yet." : total < exam.mock.questions ? `Your bank has ${total} questions, so this mock uses all of them (the real exam has ${exam.mock.questions}), with the time scaled to match.` : unseen >= exam.mock.questions ? `All from your bank, questions you haven't seen yet: ${unseen} unseen of ${total}.` : `From your bank: the ${unseen} you haven't seen, then ones you got wrong, then the rest.`}</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={source} onChange={setSource} options={[{ value: "bank", label: `Question bank${bank ? ` (${bank.total})` : ""}` }, { value: "mistakes", label: `My mistakes${bank ? ` (${bank.mistakes})` : ""}` }]} />
          </div>
          <div>
            <div className="text-[13px] text-muted mb-2">{blueprint ? "Exam domains" : "Topics"}</div>
            <div className="flex flex-wrap gap-1.5">{pool.map((t, i) => <button key={t} onClick={() => setTopics((cur) => { const s = cur ?? exam.topics; return s.includes(t) ? s.filter((x) => x !== t) : [...s, t]; })} className={clsx("rounded-full px-3 py-1 text-[13px] font-medium transition", sel.includes(t) ? "bg-accent text-white" : "bg-fill text-text hover:brightness-95")}>{t}{exam.weights?.[i] != null && i < exam.topics.length ? <span className="opacity-70 ml-1">{exam.weights[i]}%</span> : null}{bank?.by_topic[t] ? <span className="opacity-60 ml-1">· {bank.by_topic[t]}</span> : null}</button>)}</div>
          </div>
        </>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        {mode !== "full" && <Select value={n} onChange={(e) => setN(Number(e.target.value))} className="w-auto min-w-[170px]">{sizes.map((x) => <option key={x} value={x}>{x} questions{mode === "timed" ? ` · ${Math.round((x * exam.seconds_per_question) / 60)} min` : ""}</option>)}</Select>}
        <Button variant="primary" size="lg" loading={start.isPending} disabled={(mode !== "full" && sel.length === 0) || available === 0} onClick={() => start.mutate()}>
          <GraduationCap className="size-4" /> {start.isPending ? "Preparing…" : mode === "full" ? "Start full mock" : mode === "timed" ? "Start timed practice" : "Start"}
        </Button>
      </div>
      {mode !== "full" && available === 0 && <p className="text-[12.5px] text-muted">{source === "mistakes" ? "No outstanding mistakes for this exam." : "No questions in the bank for this exam yet."}</p>}
      <p className="text-[12px] text-muted flex gap-1.5"><Info className="size-3.5 shrink-0 mt-0.5" />Practice questions in the style of the exam, not real exam questions. Every answer key has been checked; still check anything surprising in your textbook.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- taking a session
type SessionProps = { session: ExamSession; exam?: ExamInfo; passMark?: number; next?: string; onLeave: () => void; onExit: () => void; onMistakes: () => void; onRetry?: () => void; onNext?: () => void };
function SessionView({ session, exam, passMark, next, onLeave, onExit, onMistakes, onRetry, onNext }: SessionProps) {
  const toast = useToast();
  const items = session.items;
  const cbt = session.mode !== "quick";
  // pick up where she left off: answers, flags and time are saved on the server as she goes
  const [answers, setAnswers] = useState<Answers>(() => Object.fromEntries(items.filter((i) => i.picked != null || i.flagged)
    .map((i) => [i.position, { picked: i.picked ?? undefined, flagged: i.flagged || undefined }])));
  const [result, setResult] = useState<ExamSession | null>(session.finished_at ? session : null);
  const [idx, setIdx] = useState(() => (cbt ? Math.max(0, items.findIndex((i) => i.picked == null)) : 0));
  const [palette, setPalette] = useState(false);
  const usedBefore = session.seconds_used ?? 0;
  const started = useRef(Date.now() - usedBefore * 1000);
  const limit = session.time_limit ?? null;
  const [left, setLeft] = useState<number | null>(limit != null ? Math.max(0, limit - usedBefore) : null);
  const answered = Object.values(answers).filter((a) => a.picked !== undefined).length;

  const payload = () => ({
    answers: items.map((it) => ({ position: it.position, picked: answers[it.position]?.picked ?? null, flagged: !!answers[it.position]?.flagged })),
    seconds_used: limit != null && left != null ? limit - left : Math.round((Date.now() - started.current) / 1000),
  });
  const latest = useRef(payload);
  latest.current = payload;
  const url = `/api/exam-sessions/${session.id}/progress`;
  const saveNow = () => api.post(url, latest.current()).catch(() => {});
  useEffect(() => {  // each answer or flag, shortly after she makes it
    if (result) return;
    const t = setTimeout(saveNow, 400);
    return () => clearTimeout(t);
  }, [answers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {  // the clock, every 15 seconds, and whenever she switches away from the app
    if (result) return;
    const t = setInterval(saveNow, 15000);
    const away = () => { if (document.visibilityState === "hidden") navigator.sendBeacon?.(url, new Blob([JSON.stringify(latest.current())], { type: "application/json" })); };
    document.addEventListener("visibilitychange", away);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", away); };
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (left == null || result) return;
    const t = setInterval(() => setLeft((l) => (l == null ? l : Math.max(0, l - 1))), 1000);
    return () => clearInterval(t);
  }, [left == null, result]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useMutation({
    mutationFn: () => api.post<ExamSession>(`/api/exam-sessions/${session.id}/submit`, {
      answers: items.map((it) => ({ position: it.position, picked: answers[it.position]?.picked ?? null, flagged: !!answers[it.position]?.flagged })),
      seconds_used: limit != null && left != null ? limit - left : Math.round((Date.now() - started.current) / 1000),
    }),
    onSuccess: (r) => setResult(r),
    onError: (e) => toast("error", (e as Error).message),
  });
  useEffect(() => { if (left === 0 && !result && !submit.isPending) { toast("info", "Time's up — your answers have been submitted."); submit.mutate(); } }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (pos: number, j: number) => setAnswers((a) => ({ ...a, [pos]: { ...a[pos], picked: j } }));
  const toggleFlag = (pos: number) => setAnswers((a) => ({ ...a, [pos]: { ...a[pos], flagged: !a[pos]?.flagged } }));
  const confirmSubmit = () => {
    const missing = items.length - answered;
    if (missing > 0 && !confirm(`${missing} question${missing > 1 ? "s are" : " is"} unanswered. Submit anyway?`)) return;
    submit.mutate();
  };

  if (result) return <Results session={result} exam={exam} passMark={passMark} next={next} onExit={onExit} onMistakes={onMistakes} onRetry={onRetry} onNext={onNext} />;

  const header = (
    <Card className="px-4 py-3 flex items-center gap-3 flex-wrap sticky top-2 z-10">
      <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Leave for now? Your answers and time are saved, and you can carry on later.")) { await saveNow(); onLeave(); } }}><ChevronLeft className="size-4" /> Exit</Button>
      <div className="font-semibold text-[14px] flex-1 min-w-0 truncate">{exam ? `${flag(exam.country)} ${exam.name}` : session.exam} · {MODE_LABEL[session.mode]}</div>
      {left != null && <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-semibold rounded-num", left < 300 ? "bg-danger-soft text-danger" : "bg-fill")}><Timer className="size-4" />{fmtTime(left)}</span>}
      <span className="text-[13px] text-muted">{answered}/{items.length} answered</span>
      <Button size="sm" variant="primary" loading={submit.isPending} onClick={confirmSubmit}>Submit</Button>
    </Card>
  );

  if (!cbt) {
    // Quick-fire: all questions on one page, feedback as soon as she answers
    return (
      <div className="space-y-3 max-w-3xl">
        {header}
        {items.map((it) => <QuestionCard key={it.position} it={it} picked={answers[it.position]?.picked} reveal={answers[it.position]?.picked !== undefined} onPick={(j) => pick(it.position, j)} />)}
        <Button variant="primary" size="lg" disabled={answered < items.length} loading={submit.isPending} onClick={() => submit.mutate()}>Finish & save</Button>
      </div>
    );
  }

  const it = items[idx];
  return (
    <div className="space-y-3 max-w-3xl">
      {header}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[13px] text-muted">Question <b className="text-text rounded-num">{idx + 1}</b> of {items.length}</span>
          <div className="flex gap-2">
            <Button size="sm" variant={answers[it.position]?.flagged ? "danger" : "secondary"} onClick={() => toggleFlag(it.position)}><Flag className="size-3.5" /> {answers[it.position]?.flagged ? "Flagged" : "Flag"}</Button>
            <Button size="sm" onClick={() => setPalette(true)}><LayoutGrid className="size-3.5" /> All questions</Button>
          </div>
        </div>
        <QuestionBody it={it} picked={answers[it.position]?.picked} reveal={false} onPick={(j) => pick(it.position, j)} />
        <div className="flex justify-between mt-5">
          <Button disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronLeft className="size-4" /> Previous</Button>
          {idx < items.length - 1 ? <Button variant="primary" onClick={() => setIdx(idx + 1)}>Next <ChevronRight className="size-4" /></Button>
            : <Button variant="primary" loading={submit.isPending} onClick={confirmSubmit}>Submit exam</Button>}
        </div>
      </Card>
      <Drawer open={palette} onClose={() => setPalette(false)} title="All questions" width={560}>
        <div className="flex gap-3 text-[12px] text-muted mb-3"><span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-accent" /> answered</span><span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-warn-soft border border-warn" /> flagged</span><span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-fill" /> not answered</span></div>
        <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
          {items.map((q, i) => { const a = answers[q.position]; return (
            <button key={q.position} onClick={() => { setIdx(i); setPalette(false); }}
              className={clsx("h-10 rounded-[9px] text-[13px] font-semibold rounded-num", a?.flagged ? "bg-warn-soft text-warn ring-1 ring-warn" : a?.picked !== undefined ? "bg-accent text-white" : "bg-fill text-text", i === idx && "outline outline-2 outline-offset-1 outline-accent")}>{i + 1}</button>
          ); })}
        </div>
      </Drawer>
    </div>
  );
}

function QuestionBody({ it, picked, reveal, onPick }: { it: ExamItem; picked?: number | null; reveal: boolean; onPick?: (j: number) => void }) {
  const ok = picked === it.answer_index;
  return (
    <>
      <div className="flex items-center gap-2 text-[12px] text-muted mb-2"><Badge>{it.topic}</Badge><Badge tone={it.difficulty === "deep" ? "accent" : "neutral"}>{it.difficulty}</Badge></div>
      <div className="font-medium text-[15.5px] leading-relaxed">{it.question}</div>
      <div className="mt-3 space-y-1.5">
        {it.options.map((o, j) => (
          <button key={j} disabled={reveal || !onPick} onClick={() => onPick?.(j)}
            className={clsx("w-full text-left rounded-[10px] border px-3.5 py-3 text-[14.5px] transition", picked === j ? "border-accent bg-accent-soft/60" : "border-border hover:border-border-strong",
              reveal && j === it.answer_index && "border-success bg-success-soft/60", reveal && picked === j && j !== it.answer_index && "border-danger bg-danger-soft/60")}>
            <span className="rounded-num text-faint mr-2">{"ABCD"[j]}</span>{o}
          </button>
        ))}
      </div>
      {reveal && <div className="mt-3 text-[13.5px] text-muted flex gap-2">{ok ? <CheckCircle2 className="size-4 text-success shrink-0 mt-0.5" /> : <XCircle className="size-4 text-danger shrink-0 mt-0.5" />}<span>{picked == null && <b className="text-text">Not answered. </b>}{it.explanation}{it.reference && <span className="block mt-1 text-[12px]"><BookOpen className="size-3 inline mr-1" />Read more: {it.reference}</span>}</span></div>}
    </>
  );
}

function QuestionCard(props: { it: ExamItem; picked?: number | null; reveal: boolean; onPick?: (j: number) => void }) {
  const { it, picked, reveal } = props;
  return <Card className={clsx("p-5", reveal && (picked === it.answer_index ? "border-success/40" : "border-danger/40"))}><div className="text-[12px] text-faint mb-1">Question {it.position + 1}</div><QuestionBody {...props} /></Card>;
}

// ---------------------------------------------------------------- results and review
function Results({ session, exam, passMark, next, onExit, onMistakes, onRetry, onNext }: Omit<SessionProps, "onLeave">) {
  const [filter, setFilter] = useState<"all" | "wrong" | "flagged">("wrong");
  const pct = Math.round((100 * (session.correct ?? 0)) / Math.max(1, session.total));
  const round = !!session.round && passMark != null;  // a study-path round: its own pass mark unlocks the next round
  const pass = round ? passMark : exam?.mock.pass_percent ?? null;
  const shown = useMemo(() => session.items.filter((it) => filter === "all" || (filter === "wrong" && !it.correct) || (filter === "flagged" && it.flagged)), [session, filter]);
  const wrong = session.items.filter((it) => !it.correct).length;
  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-6">
        <div className="flex items-center gap-6 flex-wrap">
          <div className={clsx("size-28 rounded-full grid place-items-center shrink-0", pass == null ? "bg-accent-soft" : pct >= pass ? "bg-success-soft" : "bg-danger-soft")}>
            <div className="text-center"><div className="rounded-num text-[32px] font-bold leading-none">{pct}%</div><div className="text-[12px] text-muted mt-1">{session.correct}/{session.total}</div></div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[20px] font-bold">{round ? (pct >= pass! ? "Round passed" : "Not passed yet") : pass == null ? "Session complete" : pct >= pass ? "Above the pass mark" : "Below the pass mark"}</div>
            <div className="text-[14px] text-muted mt-1">{round
              ? (pct >= pass! ? (next ? `Next unlocked: ${next}.` : "That was the last round.") : `You need ${pass}% to unlock the next round. Try it again: you get a fresh mix (questions you haven't seen first, then ones you got wrong), with the answers in a new order.`)
              : <>{exam?.name} · {MODE_LABEL[session.mode]}{session.seconds_used ? ` · ${fmtTime(session.seconds_used)}` : ""}{pass != null ? ` · pass about ${pass}%` : exam?.id === "nbcot" ? " · NBCOT reports a scaled score, not a percentage" : ""}</>}</div>
            <div className="flex flex-wrap gap-2 mt-3">
              {round && pct >= pass! && onNext && <Button variant="primary" onClick={onNext}>Next round <ChevronRight className="size-4" /></Button>}
              {round && pct < pass! && onRetry && <Button variant="primary" onClick={onRetry}><RotateCcw className="size-4" /> Try again</Button>}
              {wrong > 0 && <Button variant={round ? "secondary" : "primary"} onClick={onMistakes}><RotateCcw className="size-4" /> Practise my mistakes ({wrong})</Button>}
              <a href={`/api/exam-sessions/${session.id}/pdf`} download><Button><Download className="size-4" /> PDF with answers</Button></a>
              <Button variant="ghost" onClick={onExit}>{round ? "Back to study path" : "Back to exams"}</Button>
            </div>
          </div>
        </div>
        {session.by_topic.length > 1 && (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
            {session.by_topic.map((t) => <div key={t.topic} className="text-[13px]"><div className="flex justify-between"><span className="truncate">{t.topic}</span><span className="rounded-num text-muted">{t.correct}/{t.total}</span></div><Progress value={t.percent} tone={t.percent >= 75 ? "success" : t.percent >= 50 ? "warn" : "danger"} className="mt-1" /></div>)}
          </div>
        )}
      </Card>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-[17px]">Review</h3>
        <Segmented value={filter} onChange={setFilter} options={[{ value: "wrong", label: `Wrong (${wrong})` }, { value: "flagged", label: `Flagged (${session.items.filter((i) => i.flagged).length})` }, { value: "all", label: "All" }]} />
      </div>
      {shown.length === 0 ? <Card><Empty icon={<CheckCircle2 />} title={filter === "wrong" ? "No wrong answers" : "Nothing here"} /></Card> : shown.map((it) => <QuestionCard key={it.position} it={it} picked={it.picked} reveal />)}
    </div>
  );
}

function ReviewSheet({ id, exam, onClose, onRetake }: { id: number | null; exam?: ExamInfo; onClose: () => void; onRetake: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["exam-session", id], queryFn: () => api.get<ExamSession>(`/api/exam-sessions/${id}`), enabled: id != null });
  const del = useMutation({ mutationFn: () => api.del(`/api/exam-sessions/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["exam-bank"] }); onClose(); } });
  const s = q.data;
  const pct = s ? Math.round((100 * (s.correct ?? 0)) / Math.max(1, s.total)) : 0;
  return (
    <Drawer open={id != null} onClose={onClose} title="Session review" width={720}>
      {!s ? <Skeleton className="h-40" /> : (
        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="rounded-num text-[34px] font-bold">{pct}%</div>
            <div className="flex-1 text-[13.5px] text-muted">{s.correct}/{s.total} · {MODE_LABEL[s.mode]} · {SOURCE_LABEL[s.source]}<br />{s.finished_at?.slice(0, 16)}{s.seconds_used ? ` · ${fmtTime(s.seconds_used)}` : ""}{exam?.mock.pass_percent ? ` · pass about ${exam.mock.pass_percent}%` : ""}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.items.some((i) => !i.correct) && <Button variant="primary" size="sm" onClick={onRetake}><RotateCcw className="size-3.5" /> Practise my mistakes ({s.items.filter((i) => !i.correct).length})</Button>}
            <a href={`/api/exam-sessions/${s.id}/pdf`} download><Button size="sm"><Download className="size-3.5" /> PDF</Button></a>
            <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this session? The questions stay in your bank.")) del.mutate(); }}><Trash2 className="size-3.5" /> Delete</Button>
          </div>
          {s.by_topic.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">{s.by_topic.map((t) => <div key={t.topic} className="text-[13px]"><div className="flex justify-between"><span className="truncate">{t.topic}</span><span className="rounded-num text-muted">{t.correct}/{t.total}</span></div><Progress value={t.percent} tone={t.percent >= 75 ? "success" : t.percent >= 50 ? "warn" : "danger"} className="mt-1" /></div>)}</div>}
          <div className="space-y-3">{s.items.map((it) => <QuestionCard key={it.position} it={it} picked={it.picked} reveal />)}</div>
        </div>
      )}
    </Drawer>
  );
}

