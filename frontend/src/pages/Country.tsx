import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { clsx } from "clsx";
import { Briefcase, CheckCircle2, ChevronDown, Circle, CircleDashed, CircleSlash, ExternalLink, FileCheck2, Globe2, MessagesSquare, Search, Star, Wallet } from "lucide-react";
import { api, type CountriesPayload, type Country, type DocumentsPayload, type Route, type StepProgress } from "../lib/api";
import { flag } from "../lib/pack";
import { Badge, Button, Card, CardHeader, Empty, Input, PageHeader, Progress, Skeleton } from "../components/ui";
import { useToast } from "../components/Toast";

const STATUS: Record<StepProgress["status"], { label: string; icon: typeof Circle; cls: string }> = {
  todo: { label: "To do", icon: Circle, cls: "text-faint" },
  in_progress: { label: "In progress", icon: CircleDashed, cls: "text-warn" },
  done: { label: "Done", icon: CheckCircle2, cls: "text-success" },
  not_needed: { label: "Not needed", icon: CircleSlash, cls: "text-faint" },
};
const ORDER: StepProgress["status"][] = ["todo", "in_progress", "done", "not_needed"];

export default function CountryPage() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ["countries"], queryFn: () => api.get<CountriesPayload>("/api/countries") });
  const save = useMutation({
    mutationFn: (sel: CountriesPayload["selection"]) => api.put<CountriesPayload>("/api/countries/selection", sel),
    onSuccess: (d) => { qc.setQueryData(["countries"], d); qc.invalidateQueries({ queryKey: ["documents"] }); },
    onError: (e) => toast("error", (e as Error).message),
  });
  if (q.isLoading || !q.data) return <Skeleton className="h-72" />;
  const { countries, selection } = q.data;
  const toggle = (code: string) => {
    const selected = selection.selected.includes(code) ? selection.selected.filter((c) => c !== code) : [...selection.selected, code];
    save.mutate({ ...selection, selected });
  };
  const chosen = [...selection.selected].sort((a, b) => (a === selection.primary ? -1 : b === selection.primary ? 1 : 0))
    .map((c) => countries.find((x) => x.code === c)!).filter(Boolean);
  const gulf = countries.filter((c) => c.region === "gulf"), other = countries.filter((c) => c.region !== "gulf");

  return (
    <div>
      <PageHeader title="Countries & licence" subtitle="Pick where you want to work. Each country shows its licence route, what employers expect, and your progress." />
      <Card className="p-5">
        <div className="text-[12px] font-medium text-muted uppercase tracking-wider mb-2">Gulf · full licence routes built in</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">{gulf.map((c) => <CountryChip key={c.code} c={c} on={selection.selected.includes(c.code)} primary={selection.primary === c.code} onClick={() => toggle(c.code)} />)}</div>
        <div className="text-[12px] font-medium text-muted uppercase tracking-wider mt-5 mb-2">Other countries · pulled live from the regulator's site</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">{other.map((c) => <CountryChip key={c.code} c={c} on={selection.selected.includes(c.code)} primary={selection.primary === c.code} onClick={() => toggle(c.code)} />)}</div>
        <p className="text-[12.5px] text-muted mt-4">Built-in steps are the usual pattern as of {countries[0]?.verified ?? "2026"}, not legal advice. Rules change: use <b className="text-text">Check current rules</b> on any route to read what the regulator's own site says today.</p>
      </Card>

      {chosen.length === 0 ? (
        <Card className="mt-4"><Empty icon={<Globe2 className="size-8" />} title="No country picked yet" body="Tap one or more countries above. Your licence checklist, CV style, cover letters and interview practice all follow what you pick." /></Card>
      ) : chosen.map((c) => <CountrySection key={c.code} c={c} data={q.data!} onSelection={(sel) => save.mutate(sel)} />)}
    </div>
  );
}

function CountryChip({ c, on, primary, onClick }: { c: Country; on: boolean; primary: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={clsx("relative rounded-xl border px-3 py-2.5 text-left transition", on ? "border-accent bg-accent-soft/60" : "border-border hover:border-border-strong bg-surface")}>
      <div className="flex items-center gap-2 pr-3"><span className="text-xl leading-none">{flag(c.code)}</span><span className="text-[13px] font-semibold leading-tight">{c.name}</span></div>
      <div className="text-[11.5px] text-muted mt-1 truncate">{c.routes.map((r) => r.regulator).join(" · ")}</div>
      {primary && <Star className="size-3.5 absolute top-2 right-2 text-accent fill-current" />}
    </button>
  );
}

function CountrySection({ c, data, onSelection }: { c: Country; data: CountriesPayload; onSelection: (s: CountriesPayload["selection"]) => void }) {
  const sel = data.selection;
  const tracked = sel.routes[c.code] ?? [c.routes[0].id];
  const toggleRoute = (id: string) => {
    const next = tracked.includes(id) ? tracked.filter((r) => r !== id) : [...tracked, id];
    if (next.length) onSelection({ ...sel, routes: { ...sel.routes, [c.code]: next } });
  };
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2.5"><span className="text-3xl leading-none">{flag(c.code)}</span><div><h2 className="text-lg font-bold tracking-tight">{c.name}</h2><div className="text-[12.5px] text-muted">{c.currency}{sel.primary === c.code ? " · primary country" : ""}</div></div></div>
        {sel.primary === c.code ? <Badge tone="accent"><Star className="size-3 fill-current" /> Primary</Badge>
          : <Button size="sm" onClick={() => onSelection({ ...sel, primary: c.code })}><Star className="size-3.5" /> Make primary</Button>}
      </div>
      <p className="text-[13.5px] text-muted mb-3 max-w-4xl">{c.summary}</p>
      {c.routes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3"><span className="text-[12.5px] text-muted mr-1">Track:</span>
          {c.routes.map((r) => <button key={r.id} onClick={() => toggleRoute(r.id)} className={clsx("rounded-full border px-3 py-1 text-[12.5px] font-medium transition", tracked.includes(r.id) ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text")}>{r.regulator} · {r.area}</button>)}
        </div>
      )}
      <div className="space-y-4">{c.routes.filter((r) => tracked.includes(r.id)).map((r) => <RouteCard key={r.id} r={r} data={data} />)}</div>
      <CountryInfo c={c} />
    </section>
  );
}

function RouteCard({ r, data }: { r: Route; data: CountriesPayload }) {
  const qc = useQueryClient(); const toast = useToast();
  const docs = useQuery({ queryKey: ["documents"], queryFn: () => api.get<DocumentsPayload>("/api/documents") });
  const have = new Set((docs.data?.documents ?? []).map((d) => d.category));
  const docLabel = Object.fromEntries((docs.data?.categories ?? []).map((c) => [c.key, c.label]));
  const prog = data.progress[r.id] ?? {};
  const counted = r.steps.filter((s) => prog[s.id]?.status !== "not_needed");
  const done = counted.filter((s) => prog[s.id]?.status === "done").length;
  const check = useMutation({
    mutationFn: () => api.post(`/api/countries/check/${r.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["countries"] }); toast("success", `Checked ${r.regulator}'s official site.`); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const last = data.checks[r.id];
  return (
    <Card>
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><h3 className="font-semibold text-[15px]">{r.regulator_full}</h3>{r.area && <Badge>{r.area}</Badge>}</div>
          <div className="text-[12.5px] text-muted mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {r.exam_name && <span>Exam: <span className="text-text">{r.exam_name}</span> via {r.exam_provider}</span>}
            {r.portal && <span>Portal: <span className="text-text">{r.portal}</span></span>}
            <a href={r.official_url} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">Official site <ExternalLink className="size-3" /></a>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {r.steps.length > 0 && <div className="w-36"><div className="flex justify-between text-[12px] text-muted mb-1"><span>{done}/{counted.length} steps</span></div><Progress value={(100 * done) / Math.max(1, counted.length)} tone="success" /></div>}
          <Button size="sm" loading={check.isPending} onClick={() => check.mutate()}><Search className="size-3.5" /> {check.isPending ? "Reading official site (1–2 min)…" : "Check current rules"}</Button>
        </div>
      </div>
      {r.steps.length === 0 && !last && <div className="px-5 pb-5 text-[13px] text-muted">Steps for this country are not built in yet. <b className="text-text">Check current rules</b> reads the regulator's own site and lists the route with sources.</div>}
      {r.steps.length > 0 && (
        <ol className="px-3 pb-3">
          {r.steps.map((s, i) => <StepRow key={s.id} n={i + 1} routeId={r.id} step={s} p={prog[s.id]} have={have} docLabel={docLabel} />)}
        </ol>
      )}
      {last && (
        <details className="mx-5 mb-5 rounded-lg border border-border bg-surface-2/50" open={r.steps.length === 0}>
          <summary className="px-4 py-2.5 text-[13px] cursor-pointer font-medium">From the official site · checked {last.checked_at.replace("T", " ")}</summary>
          <div className="px-4 pb-4 text-[13.5px] prose-chat"><ReactMarkdown>{last.summary}</ReactMarkdown></div>
          {last.sources.length > 0 && <div className="px-4 pb-4 text-[12.5px] space-y-1"><div className="text-muted">Sources</div>{last.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="block text-accent hover:underline truncate">{s.title || s.url}</a>)}</div>}
        </details>
      )}
    </Card>
  );
}

function StepRow({ n, routeId, step, p, have, docLabel }: { n: number; routeId: string; step: Route["steps"][number]; p?: StepProgress; have: Set<string>; docLabel: Record<string, string> }) {
  const qc = useQueryClient(); const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: p?.date ?? "", cost: p?.cost ?? "", notes: p?.notes ?? "" });
  const status = p?.status ?? "todo";
  const save = useMutation({
    mutationFn: (body: Partial<StepProgress>) => api.put<CountriesPayload>(`/api/licence/${routeId}/${step.id}`, { status, ...form, ...body }),
    onSuccess: (d) => { qc.setQueryData(["countries"], d); qc.invalidateQueries({ queryKey: ["dashboard-licence"] }); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const S = STATUS[status];
  const next = ORDER[(ORDER.indexOf(status) + 1) % ORDER.length];
  return (
    <li className={clsx("rounded-lg transition", open && "bg-surface-2/60")}>
      <div className="flex items-start gap-3 px-2 py-2.5">
        <button onClick={() => save.mutate({ status: next })} title={`Mark as ${STATUS[next].label.toLowerCase()}`} className={clsx("mt-0.5 shrink-0 p-1 -m-1", S.cls)}><S.icon className="size-[19px]" /></button>
        <button onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx("text-[13.5px] font-medium", status === "done" && "line-through opacity-60", status === "not_needed" && "opacity-50")}><span className="num text-faint mr-1.5">{n}.</span>{step.title}</span>
            {status === "in_progress" && <Badge tone="warn">in progress</Badge>}
            {p?.date && <span className="num text-[11.5px] text-faint">{p.date}</span>}
          </div>
          {!open && <div className="text-[12px] text-muted truncate mt-0.5">{step.detail}</div>}
        </button>
        <div className="hidden sm:flex flex-wrap gap-1 justify-end max-w-[40%]">
          {step.docs.map((d) => <span key={d} title={have.has(d) ? "Uploaded" : "Not uploaded yet"} className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]", have.has(d) ? "bg-success-soft text-success" : "bg-surface-2 text-faint")}>{have.has(d) && <FileCheck2 className="size-3" />}{docLabel[d] ?? d}</span>)}
        </div>
        <ChevronDown onClick={() => setOpen((o) => !o)} className={clsx("size-4 text-faint shrink-0 mt-1 cursor-pointer transition", open && "rotate-180")} />
      </div>
      {open && (
        <div className="px-10 pb-4 space-y-3">
          <p className="text-[13px] text-muted leading-relaxed">{step.detail}</p>
          <div className="flex flex-wrap gap-1.5">{ORDER.map((st) => <button key={st} onClick={() => save.mutate({ status: st })} className={clsx("rounded-md border px-2.5 py-1 text-[12.5px]", status === st ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text")}>{STATUS[st].label}</button>)}</div>
          <div className="grid grid-cols-1 sm:grid-cols-[150px_150px_1fr_auto] gap-2 items-end">
            <label className="text-[12px] text-muted">Date<Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1" /></label>
            <label className="text-[12px] text-muted">Cost<Input value={form.cost} placeholder="e.g. AED 1,000" onChange={(e) => setForm({ ...form, cost: e.target.value })} className="mt-1" /></label>
            <label className="text-[12px] text-muted">Notes<Input value={form.notes} placeholder="Reference numbers, what's pending…" onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1" /></label>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({})}>Save</Button>
          </div>
          {step.docs.length > 0 && <div className="text-[12.5px] text-muted">Documents for this step: {step.docs.map((d) => docLabel[d] ?? d).join(", ")} · <Link to="/documents" className="text-accent hover:underline">Open documents</Link></div>}
        </div>
      )}
    </li>
  );
}

function Block({ icon, title, items, text }: { icon: React.ReactNode; title: string; items?: string[]; text?: string }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon}{title}</span>} />
      <div className="px-5 pb-5 text-[13px] text-muted leading-relaxed">
        {text && <p>{text}</p>}
        {items && <ul className="space-y-1.5 list-disc pl-4">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </div>
    </Card>
  );
}

function CountryInfo({ c }: { c: Country }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      {c.cv_norms && <Block icon={<FileCheck2 className="size-4 text-accent" />} title="What a CV looks like here" items={c.cv_norms} />}
      {c.cover_letter_norms && <Block icon={<FileCheck2 className="size-4 text-accent" />} title="Cover letters" items={c.cover_letter_norms} />}
      {c.interview_style && <Block icon={<MessagesSquare className="size-4 text-accent" />} title="How interviews run" text={c.interview_style} />}
      {c.package_notes && <Block icon={<Wallet className="size-4 text-accent" />} title="Salary & package" items={c.package_notes} />}
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Briefcase className="size-4 text-accent" />Where to look for jobs</span>} />
        <div className="px-5 pb-5 flex flex-wrap gap-2">{c.job_sites.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-3 py-1.5 text-[13px] hover:border-border-strong inline-flex items-center gap-1.5">{s.name}<ExternalLink className="size-3 text-faint" /></a>)}{c.job_sites.length === 0 && <span className="text-[13px] text-muted">Use Check current rules and the regulator's site.</span>}</div>
        {c.region === "gulf" && <p className="px-5 pb-5 -mt-2 text-[12.5px] text-muted">Many Gulf hires go through agencies. A genuine agency never asks you for a fee; in India, check it is registered with the Ministry of External Affairs.</p>}
      </Card>
      {c.language_test && <Block icon={<Globe2 className="size-4 text-accent" />} title="English test" text={c.language_test} />}
    </div>
  );
}
