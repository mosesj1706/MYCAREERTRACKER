import { useEffect, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronDown, Download, Sparkles, Bookmark, BookmarkCheck, ShieldAlert, Wand2 } from "lucide-react";
import { clsx } from "clsx";
import { api, type JobAnalysis, type MatchResult, type RequirementMatch, type TailoredOutput, type Application } from "../lib/api";
import { Badge, Button, Card, CardHeader, Gauge, Input, PageHeader, Textarea } from "../components/ui";
import { CopyBlock } from "../components/Copy";
import { useToast } from "../components/Toast";
import { download, scoreTone, usePersistedState } from "../lib/util";

type Analysis = { jd: string; job: JobAnalysis; match: MatchResult; app_id?: number; tailored?: TailoredOutput };

const STRENGTH: Record<RequirementMatch["strength"], { label: string; tone: "success" | "warn" | "danger"; hint: string }> = {
  strong: { label: "Strong", tone: "success", hint: "Hands-on evidence in your profile" },
  partial: { label: "Partial", tone: "warn", hint: "Adjacent or self-described as learning" },
  none: { label: "Missing", tone: "danger", hint: "Nothing in your profile supports it" },
};

export default function Tailor() {
  const [jd, setJd] = usePersistedState("tailor.jd", "");
  const [a, setA] = usePersistedState<Analysis | null>("tailor.analysis", null);
  const [url, setUrl] = useState("");
  const toast = useToast();
  const qc = useQueryClient();

  // Persist straight to sessionStorage in onSuccess: useMutation callbacks still fire if the user
  // navigated away mid-request, but component state would be gone.
  const analyze = useMutation({
    mutationKey: ["analyze"],
    mutationFn: (text: string) => api.post<{ job: JobAnalysis; match: MatchResult }>("/api/jd/analyze", { jd_text: text }).then((r) => ({ jd: text, job: r.job, match: r.match })),
    onSuccess: (r) => { try { sessionStorage.setItem("tailor.analysis", JSON.stringify(r)); } catch {} setA(r); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const inFlight = useIsMutating({ mutationKey: ["analyze"] }) > 0;
  const track = useMutation({
    mutationFn: () => api.post<Application>("/api/applications", { jd_text: a!.jd, job: a!.job, match: a!.match, url: url || null, company: a!.job.company, tailored: a!.tailored ?? null }),
    onSuccess: (r) => { setA({ ...a!, app_id: r.id }); qc.invalidateQueries({ queryKey: ["applications"] }); qc.invalidateQueries({ queryKey: ["gaps"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); toast("success", `Tracking #${r.id} — it's in your pipeline.`); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const tailor = useMutation({
    mutationFn: () => api.post<TailoredOutput>("/api/jd/tailor", { jd_text: a!.jd, job: a!.job, match: a!.match, app_id: a!.app_id ?? null }),
    onSuccess: (t) => { setA({ ...a!, tailored: t }); toast("success", "Tailored content ready."); },
    onError: (e) => toast("error", (e as Error).message),
  });

  useEffect(() => {
    if (inFlight) return;
    try { const s = sessionStorage.getItem("tailor.analysis"); if (s) { const parsed = JSON.parse(s) as Analysis; if (!a || parsed.jd !== a.jd || (parsed.tailored && !a.tailored)) setA(parsed); } } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight]);
  const stale = a && a.jd !== jd;
  const busy = inFlight;

  return (
    <div>
      <PageHeader title="Analyze a job" subtitle="Paste a job description. You get the honest fit first; tailoring is a deliberate second step." />

      <Card className="p-5">
        <Textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={a && !stale ? 5 : 12} placeholder="Paste the full job description here — responsibilities, requirements, nice-to-haves. The more complete, the better the analysis."
          className="font-[system-ui] text-[13.5px] leading-relaxed" />
        <div className="flex items-center justify-between mt-3">
          <div className="text-[12px] text-faint">{jd.trim().split(/\s+/).filter(Boolean).length} words {stale && <span className="text-warn ml-2">· edited since last analysis</span>}</div>
          <Button variant="primary" loading={busy} disabled={jd.trim().length < 80} onClick={() => analyze.mutate(jd)}>
            <Sparkles className="size-4" /> {busy ? "Extracting requirements & judging fit…" : a && !stale ? "Re-analyze" : "Analyze fit"}
          </Button>
        </div>
        {busy && <div className="mt-3 text-[13px] text-muted">This takes 1–2 minutes: two model passes — requirement extraction, then a per-requirement judgment against your profile with evidence.</div>}
      </Card>

      <AnimatePresence>
        {a && !stale && (
          <motion.div key="result" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 space-y-4">
            {/* headline */}
            <Card className="p-5">
              <div className="flex gap-6">
                <Gauge value={a.match.score} size={136} label="fit score" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold tracking-tight">{a.job.title}{a.job.company && <span className="text-muted font-medium"> · {a.job.company}</span>}</h2>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <Badge>{a.job.seniority}</Badge>{a.job.years_required != null && <Badge>{a.job.years_required}+ yrs</Badge>}{a.job.location && <Badge>{a.job.location}</Badge>}
                        <Badge tone="success">{a.match.matches.filter((m) => m.strength === "strong").length} strong</Badge>
                        <Badge tone="warn">{a.match.matches.filter((m) => m.strength === "partial").length} partial</Badge>
                        <Badge tone="danger">{a.match.matches.filter((m) => m.strength === "none").length} missing</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.app_id ? <Badge tone="success"><BookmarkCheck className="size-3.5" /> Tracked #{a.app_id}</Badge> : <>
                        <Input placeholder="Job URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} className="w-56 h-9" />
                        <Button variant="primary" loading={track.isPending} onClick={() => track.mutate()}><Bookmark className="size-4" /> Track</Button>
                      </>}
                    </div>
                  </div>
                  <p className="text-[13.5px] text-muted mt-2">{a.job.summary}</p>
                  <div className={clsx("mt-3 rounded-lg border px-4 py-3 text-[13.5px] leading-relaxed",
                    scoreTone(a.match.score) === "success" ? "border-success/30 bg-success-soft/40" : scoreTone(a.match.score) === "warn" ? "border-warn/30 bg-warn-soft/40" : "border-danger/30 bg-danger-soft/40")}>
                    <span className="font-semibold">Verdict.</span> {a.match.verdict}
                  </div>
                  <div className="mt-3 text-[13px] flex flex-wrap items-center gap-1.5"><span className="text-muted mr-1">Close first:</span>{a.match.top_gaps.map((g, i) => <Badge key={g} tone={i === 0 ? "danger" : "neutral"}>{i + 1}. {g}</Badge>)}</div>
                </div>
              </div>
            </Card>

            {/* requirement board */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(["strong", "partial", "none"] as const).map((s) => (
                <Card key={s}>
                  <CardHeader title={<span className="flex items-center gap-2"><span className={clsx("size-2 rounded-full", s === "strong" ? "bg-success" : s === "partial" ? "bg-warn" : "bg-danger")} />{STRENGTH[s].label}</span>} subtitle={STRENGTH[s].hint} />
                  <div className="px-3 pb-3 space-y-1.5">
                    {a.match.matches.filter((m) => m.strength === s).sort((x, y) => (x.importance === y.importance ? 0 : x.importance === "must_have" ? -1 : 1)).map((m) => <ReqRow key={m.skill} m={m} />)}
                  </div>
                </Card>
              ))}
            </div>

            {a.job.red_flags.length > 0 && (
              <Card className="px-5 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-warn" /> Red flags in this posting</div>
                <ul className="mt-2 space-y-1 text-[13px] text-muted list-disc pl-5">{a.job.red_flags.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </Card>
            )}

            {/* tailoring */}
            {!a.tailored ? (
              <Card className="p-5 flex items-center justify-between gap-4">
                <div><div className="font-semibold">Tailor your resume for this job</div><div className="text-[13px] text-muted mt-0.5">Rewritten summary and bullets mapped to their requirements, a cover letter, and the list of things you must not claim.</div></div>
                <Button variant="primary" size="lg" loading={tailor.isPending} onClick={() => tailor.mutate()}><Wand2 className="size-4" /> {tailor.isPending ? "Writing…" : "Generate"}</Button>
              </Card>
            ) : (
              <TailoredView t={a.tailored} job={a.job} score={a.match.score} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReqRow({ m }: { m: RequirementMatch }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border hover:border-border-strong transition">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="text-[13px] font-medium flex-1 truncate">{m.skill}</span>
        {m.importance === "must_have" && <span className="text-[10.5px] font-semibold uppercase tracking-wider text-accent">must</span>}
        <ChevronDown className={clsx("size-3.5 text-faint transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-3 pb-3 text-[12.5px] text-muted space-y-2">
          <p>{m.evidence}</p>
          {m.how_to_close && <p className="rounded-md bg-accent-soft/60 text-text px-2.5 py-2"><span className="font-medium text-accent">Close it: </span>{m.how_to_close}</p>}
        </div>
      )}
    </div>
  );
}

function TailoredView({ t, job, score }: { t: TailoredOutput; job: JobAnalysis; score: number }) {
  const md = `# ${job.title}${job.company ? " - " + job.company : ""}\n\nMatch score: ${score}%\n\n## Summary\n${t.summary}\n\n## Bullets\n${t.bullets.map((b) => "- " + b.rewritten).join("\n")}\n\n## Cover letter\n${t.cover_letter}\n\n## Do not claim\n${t.honesty_notes.map((n) => "- " + n).join("\n")}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Tailored for this job</h3>
        <Button size="sm" onClick={() => download("tailored_application.md", md)}><Download className="size-4" /> Download .md</Button>
      </div>
      <Card className="p-5 border-danger/30">
        <div className="flex items-center gap-2 font-semibold text-danger"><ShieldAlert className="size-4" /> Do not claim these</div>
        <p className="text-[12.5px] text-muted mt-0.5">Read this first. The JD asks for them; your profile doesn't support them. Each has a truthful alternative.</p>
        <ul className="mt-3 space-y-2 text-[13px]">{t.honesty_notes.map((n, i) => <li key={i} className="flex gap-2"><span className="text-danger">•</span><span>{n}</span></li>)}</ul>
      </Card>
      <CopyBlock label="Professional summary" text={t.summary} />
      <Card>
        <CardHeader title="Rewritten bullets" subtitle="Each one now speaks to a specific requirement" />
        <div className="px-5 pb-5 space-y-3">
          {t.bullets.map((b, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="text-[13.5px] leading-relaxed">{b.rewritten}</div>
              <div className="flex items-start justify-between gap-3 mt-2"><div className="text-[12px] text-faint"><span className="text-accent">↳ {b.why}</span><br />was: <span className="italic">{b.original}</span></div><CopyBlockInline text={b.rewritten} /></div>
            </div>
          ))}
        </div>
      </Card>
      <CopyBlock label="Cover letter" text={t.cover_letter} />
      <div className="text-[12.5px] text-muted flex flex-wrap gap-1.5 items-center"><span>Keywords now present:</span>{t.keywords_added.map((k) => <Badge key={k}>{k}</Badge>)}</div>
    </div>
  );
}
import { CopyButton as CopyBlockInline } from "../components/Copy";
