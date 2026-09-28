import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, Flag, GraduationCap, Info, LayoutGrid, RotateCcw, Timer, Trash2, XCircle } from "lucide-react";
import { api, type ExamBank, type ExamInfo, type ExamItem, type ExamSession, type ExamsPayload, type Gap } from "../lib/api";
import { flag } from "../lib/pack";
import { Badge, Button, Card, CardHeader, Empty, Progress, Segmented, Select, Skeleton } from "../components/ui";
import { Drawer } from "../components/Drawer";
import { useToast } from "../components/Toast";

type Mode = "quick" | "timed" | "full";
type Source = "new" | "bank" | "mistakes";
type Answers = Record<number, { picked?: number; flagged?: boolean }>;
const GULF = ["AE", "SA", "QA", "OM", "KW", "BH"];
const PROGRESS_KEY = "exam-progress";  // an unfinished timed session survives switching apps on the iPad

const fmtTime = (s: number) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
const MODE_LABEL: Record<Mode, string> = { quick: "Quick-fire", timed: "Timed practice", full: "Full mock" };
const SOURCE_LABEL: Record<Source, string> = { new: "New questions", bank: "Question bank", mistakes: "My mistakes" };

/**
 * Licensing-exam practice (OT): pick an exam, then practise quick-fire sets, timed sets or a full-length mock
 * from new questions, the exam's question bank, or past mistakes. Every session is saved with a review.
 */
export default function ExamPractice() {
  const toast = useToast(); const qc = useQueryClient();
  const catalogue = useQuery({ queryKey: ["exams"], queryFn: () => api.get<ExamsPayload>("/api/exams") });
  const exams = catalogue.data?.exams ?? [];
  const [examId, setExamId] = useState("");
  useEffect(() => { if (!examId && exams.length) setExamId((exams.find((e) => e.tracked) ?? exams.find((e) => e.selected_country) ?? exams[0]).id); }, [examId, exams]);
  const exam = exams.find((e) => e.id === examId);
  const bank = useQuery({ queryKey: ["exam-bank", examId], queryFn: () => api.get<ExamBank>(`/api/exam-bank/${examId}`), enabled: !!examId });
  const [active, setActive] = useState<ExamSession | null>(null);
  const [review, setReview] = useState<number | null>(null);
  const [resume, setResume] = useState<{ id: number; answers: Answers; left: number | null; at: number } | null>(() => { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null"); } catch { return null; } });

  const resumeSession = async () => {
    if (!resume) return;
    try { const s = await api.get<ExamSession>(`/api/exam-sessions/${resume.id}`); if (s.finished_at) { clearProgress(); return; } setExamId(s.exam); setActive(s); }
    catch { clearProgress(); }
  };
  const clearProgress = () => { try { localStorage.removeItem(PROGRESS_KEY); } catch {} setResume(null); };
  const discard = () => { if (resume) api.del(`/api/exam-sessions/${resume.id}`).catch(() => {}); clearProgress(); };
  const done = () => { setActive(null); clearProgress(); qc.invalidateQueries({ queryKey: ["exam-bank"] }); qc.invalidateQueries({ queryKey: ["mcq-stats"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); };
  // leaving mid-session keeps the saved progress, so the Resume banner offers it again
  const leave = () => { try { setResume(JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null")); } catch {} setActive(null); };

  if (active) return <SessionView key={active.id} session={active} exam={exams.find((e) => e.id === active.exam)} initial={resume?.id === active.id ? resume : null}
    onLeave={leave} onExit={done} onMistakes={async () => { try { const s = await api.post<ExamSession>("/api/exam-sessions", { exam: active.exam, mode: "quick", source: "mistakes", retry_of: active.id }); clearProgress(); setActive(s); } catch (e) { toast("error", (e as Error).message); } }} />;

  const groups: [string, ExamInfo[]][] = [
    ["Your countries", exams.filter((e) => e.selected_country)],
    ["Gulf", exams.filter((e) => !e.selected_country && GULF.includes(e.country))],
    ["Other countries", exams.filter((e) => !e.selected_country && !GULF.includes(e.country))],
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <div className="space-y-4">
        {resume && (
          <Card className="p-4 flex items-center gap-3 border-accent/40">
            <Timer className="size-5 text-accent shrink-0" />
            <div className="flex-1 text-[14px]"><b>You have an unfinished exam.</b> <span className="text-muted">{Object.values(resume.answers).filter((a) => a.picked !== undefined).length} answered{resume.left != null ? `, ${fmtTime(resume.left)} left` : ""}.</span></div>
            <Button size="sm" variant="primary" onClick={resumeSession}>Resume</Button>
            <Button size="sm" variant="ghost" onClick={() => { if (confirm("Discard this unfinished exam?")) discard(); }}>Discard</Button>
          </Card>
        )}
        <Card className="p-5">
          <label className="text-[13px] block"><div className="text-muted mb-1.5">Licensing exam</div>
            <Select value={examId} onChange={(e) => setExamId(e.target.value)} className="w-full">
              {groups.map(([g, list]) => list.length > 0 && <optgroup key={g} label={g}>{list.map((e) => <option key={e.id} value={e.id}>{flag(e.country)} {e.name} · {e.country_name}</option>)}</optgroup>)}
            </Select></label>
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
        {exam && <StartCard key={exam.id} exam={exam} bank={bank.data} onStart={(s) => { clearProgress(); setActive(s); }} />}
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
            {[["Questions", bank.data?.total], ["Answered", bank.data?.answered], ["Mistakes", bank.data?.mistakes]].map(([l, v]) => (
              <div key={l as string} className="rounded-[10px] bg-fill-2 py-2.5"><div className="rounded-num text-[22px] font-semibold">{v ?? "–"}</div><div className="text-[11.5px] text-muted">{l}</div></div>
            ))}
          </div>
          <p className="px-5 pb-4 text-[12px] text-muted">Every checked question you get is kept here, so you can practise again without waiting for new ones.</p>
        </Card>
        <Card>
          <CardHeader title="Practice sessions" subtitle="Tap one to review" />
          <div className="px-3 pb-3">
            {bank.isLoading ? <Skeleton className="h-20" /> : (bank.data?.sessions ?? []).filter((s) => s.finished_at).length === 0 ? <div className="px-2 pb-2 text-[13px] text-muted">Your finished sessions appear here with their scores.</div> : (
              <div className="space-y-1">{bank.data!.sessions.filter((s) => s.finished_at).slice(0, 12).map((s) => {
                const pct = Math.round((100 * (s.correct ?? 0)) / Math.max(1, s.total));
                const pass = exam?.mock.pass_percent;
                return (
                  <button key={s.id} onClick={() => setReview(s.id)} className="w-full flex items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-fill-2">
                    <div className={clsx("rounded-num text-[15px] font-semibold w-12 text-right", pass ? (pct >= pass ? "text-success" : "text-danger") : "")}>{pct}%</div>
                    <div className="flex-1 min-w-0"><div className="text-[13.5px] font-medium">{MODE_LABEL[s.mode]} · {s.total} q</div><div className="text-[12px] text-muted">{s.finished_at!.slice(0, 16)}{s.seconds_used ? ` · ${fmtTime(s.seconds_used)}` : ""} · {SOURCE_LABEL[s.source]}</div></div>
                    <ChevronRight className="size-4 text-faint" />
                  </button>
                );
              })}</div>
            )}
          </div>
        </Card>
      </div>
      <ReviewSheet id={review} exam={exam} onClose={() => setReview(null)} onRetake={async () => { const id = review; setReview(null); try { const s = await api.post<ExamSession>("/api/exam-sessions", { exam: examId, mode: "quick", source: "mistakes", retry_of: id }); setActive(s); } catch (e) { toast("error", (e as Error).message); } }} />
    </div>
  );
}

// ---------------------------------------------------------------- choosing what to practise
function StartCard({ exam, bank, onStart }: { exam: ExamInfo; bank?: ExamBank; onStart: (s: ExamSession) => void }) {
  const toast = useToast();
  const gaps = useQuery({ queryKey: ["gaps", 1], queryFn: () => api.get<Gap[]>("/api/gaps?min_jobs=1") });
  const [mode, setMode] = useState<Mode>("quick");
  const [source, setSource] = useState<Source>("new");
  const [n, setN] = useState(5);
  const blueprint = !!exam.weights?.length || exam.id === "notce";
  const gapTopics = blueprint ? [] : (gaps.data ?? []).filter((g) => g.pressure > 0 && !["credentials", "soft"].includes(g.category ?? "")).slice(0, 4).map((g) => g.skill).filter((g) => !exam.topics.includes(g));
  const pool = [...exam.topics, ...gapTopics];
  const [topics, setTopics] = useState<string[] | null>(null);
  const sel = topics ?? (blueprint ? exam.topics : exam.topics.slice(0, 3));
  const sizes = mode === "quick" ? [5, 10, 15] : [10, 20, 30, 50];
  useEffect(() => { setN(mode === "quick" ? 5 : 20); }, [mode]);
  const unseen = bank ? bank.total - bank.answered : 0;
  const needNew = mode === "full" ? Math.max(0, exam.mock.questions - unseen) : source === "new" ? n : 0;
  const start = useMutation({
    mutationFn: () => api.post<ExamSession>("/api/exam-sessions", { exam: exam.id, mode, source: mode === "full" ? "bank" : source, n, topics: mode === "full" ? [] : sel }),
    onSuccess: onStart, onError: (e) => toast("error", (e as Error).message),
  });
  const available = source === "bank" ? bank?.total ?? 0 : source === "mistakes" ? bank?.mistakes ?? 0 : Infinity;
  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={mode} onChange={setMode} options={[{ value: "quick", label: "Quick-fire" }, { value: "timed", label: "Timed practice" }, { value: "full", label: "Full mock exam" }]} />
      </div>
      {mode === "full" ? (
        <div className="rounded-[12px] bg-accent-soft/60 px-4 py-3 text-[13.5px]">
          <div className="font-semibold">{exam.mock.questions} questions · {exam.mock.minutes >= 60 ? `${Math.floor(exam.mock.minutes / 60)} h${exam.mock.minutes % 60 ? ` ${exam.mock.minutes % 60} min` : ""}` : `${exam.mock.minutes} min`}{exam.mock.pass_percent ? ` · pass about ${exam.mock.pass_percent}%` : ""}</div>
          <div className="text-muted text-[12.5px] mt-0.5">{exam.mock.published ? "Same length and time as the real exam's published format." : "Typical Prometric length; your eligibility letter has the exact format."} One question at a time, flag and come back, submit at the end.</div>
          <div className="text-muted text-[12.5px] mt-1.5">{needNew > 0 ? `Uses ${Math.min(unseen, exam.mock.questions)} unseen questions from your bank and writes ${needNew} new ones (about ${Math.max(1, Math.ceil(needNew / 60))} min to prepare).` : "All questions come from your bank: ready straight away."}</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={source} onChange={setSource} options={[{ value: "new", label: "New questions" }, { value: "bank", label: `Question bank${bank ? ` (${bank.total})` : ""}` }, { value: "mistakes", label: `My mistakes${bank ? ` (${bank.mistakes})` : ""}` }]} />
          </div>
          <div>
            <div className="text-[13px] text-muted mb-2">{blueprint ? "Exam domains" : "Topics"}</div>
            <div className="flex flex-wrap gap-1.5">{pool.map((t, i) => <button key={t} onClick={() => setTopics(sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t])} className={clsx("rounded-full px-3 py-1 text-[13px] font-medium transition", sel.includes(t) ? "bg-accent text-white" : "bg-fill text-text hover:brightness-95")}>{t}{exam.weights?.[i] != null && i < exam.topics.length ? <span className="opacity-70 ml-1">{exam.weights[i]}%</span> : null}{bank?.by_topic[t] ? <span className="opacity-60 ml-1">· {bank.by_topic[t]}</span> : null}</button>)}</div>
          </div>
        </>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        {mode !== "full" && <Select value={n} onChange={(e) => setN(Number(e.target.value))} className="w-auto min-w-[170px]">{sizes.map((x) => <option key={x} value={x}>{x} questions{mode === "timed" ? ` · ${Math.round((x * exam.seconds_per_question) / 60)} min` : ""}</option>)}</Select>}
        <Button variant="primary" size="lg" loading={start.isPending} disabled={(mode !== "full" && sel.length === 0) || (mode !== "full" && available === 0)} onClick={() => start.mutate()}>
          <GraduationCap className="size-4" /> {start.isPending ? (needNew > 12 ? `Preparing ${mode === "full" ? exam.mock.questions : n} questions…` : "Writing questions…") : mode === "full" ? "Start full mock" : mode === "timed" ? "Start timed practice" : "Start"}
        </Button>
      </div>
      {mode !== "full" && source !== "new" && available === 0 && <p className="text-[12.5px] text-muted">{source === "mistakes" ? "No outstanding mistakes for this exam." : "The bank is empty for this exam: practise with new questions first."}</p>}
      <p className="text-[12px] text-muted flex gap-1.5"><Info className="size-3.5 shrink-0 mt-0.5" />AI-written practice in the style of the exam, not real exam questions. A second review checks every answer key and drops disputed questions; still check anything surprising in your textbook.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- taking a session
function SessionView({ session, exam, initial, onLeave, onExit, onMistakes }: { session: ExamSession; exam?: ExamInfo; initial: { answers: Answers; left: number | null } | null; onLeave: () => void; onExit: () => void; onMistakes: () => void }) {
  const toast = useToast();
  const [answers, setAnswers] = useState<Answers>(initial?.answers ?? {});
  const [result, setResult] = useState<ExamSession | null>(session.finished_at ? session : null);
  const [idx, setIdx] = useState(0);
  const [palette, setPalette] = useState(false);
  const started = useRef(Date.now());
  const limit = session.time_limit ?? null;
  const [left, setLeft] = useState<number | null>(initial?.left ?? limit);
  const cbt = session.mode !== "quick";
  const items = session.items;
  const answered = Object.values(answers).filter((a) => a.picked !== undefined).length;

  // keep progress so an interrupted session can be resumed
  useEffect(() => {
    if (result) return;
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ id: session.id, answers, left, at: Date.now() })); } catch {}
  }, [answers, left, result, session.id]);
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
    onSuccess: (r) => { setResult(r); try { localStorage.removeItem(PROGRESS_KEY); } catch {} },
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

  if (result) return <Results session={result} exam={exam} onExit={onExit} onMistakes={onMistakes} />;

  const header = (
    <Card className="px-4 py-3 flex items-center gap-3 flex-wrap sticky top-2 z-10">
      <Button size="sm" variant="ghost" onClick={() => { if (confirm("Leave this session? Your answers so far are kept, and you can resume it.")) onLeave(); }}><ChevronLeft className="size-4" /> Exit</Button>
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
function Results({ session, exam, onExit, onMistakes }: { session: ExamSession; exam?: ExamInfo; onExit: () => void; onMistakes: () => void }) {
  const [filter, setFilter] = useState<"all" | "wrong" | "flagged">("wrong");
  const pct = Math.round((100 * (session.correct ?? 0)) / Math.max(1, session.total));
  const pass = exam?.mock.pass_percent ?? null;
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
            <div className="text-[20px] font-bold">{pass == null ? "Session complete" : pct >= pass ? "Above the pass mark" : "Below the pass mark"}</div>
            <div className="text-[14px] text-muted mt-1">{exam?.name} · {MODE_LABEL[session.mode]}{session.seconds_used ? ` · ${fmtTime(session.seconds_used)}` : ""}{pass != null ? ` · pass about ${pass}%` : exam?.id === "nbcot" ? " · NBCOT reports a scaled score, not a percentage" : ""}</div>
            <div className="flex flex-wrap gap-2 mt-3">
              {wrong > 0 && <Button variant="primary" onClick={onMistakes}><RotateCcw className="size-4" /> Practise my mistakes ({wrong})</Button>}
              <a href={`/api/exam-sessions/${session.id}/pdf`} download><Button><Download className="size-4" /> PDF with answers</Button></a>
              <Button variant="ghost" onClick={onExit}>Back to exams</Button>
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

