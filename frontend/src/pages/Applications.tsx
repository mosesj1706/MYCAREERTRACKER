import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { clsx } from "clsx";
import { ExternalLink, GripVertical, RefreshCw, Trash2, Target, ChevronRight, Download, Wand2, AlertTriangle, Mail } from "lucide-react";
import { api, type Agency, type Application, type CountriesPayload } from "../lib/api";
import { flag, usePack } from "../lib/pack";
import { Badge, Button, Empty, Gauge, PageHeader, Textarea, Input, Select } from "../components/ui";
import { Drawer } from "../components/Drawer";
import { CopyBlock } from "../components/Copy";
import { TellCheck } from "../components/TellCheck";
import { useToast } from "../components/Toast";
import { scoreTone, timeAgo } from "../lib/util";
import { Link } from "react-router-dom";

const COLS: { key: string; label: string; tone: "neutral" | "accent" | "success" | "warn" | "danger" }[] = [
  { key: "saved", label: "Saved", tone: "neutral" }, { key: "applied", label: "Applied", tone: "accent" }, { key: "screening", label: "Screening", tone: "accent" },
  { key: "interview", label: "Interview", tone: "warn" }, { key: "offer", label: "Offer", tone: "success" }, { key: "rejected", label: "Rejected", tone: "danger" },
];

export default function Applications() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["applications"], queryFn: () => api.get<{ items: Application[]; counts: Record<string, number> }>("/api/applications") });
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragging, setDragging] = useState<Application | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patch<Application>(`/api/applications/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["applications"] });
      const prev = qc.getQueryData<{ items: Application[]; counts: Record<string, number> }>(["applications"]);
      if (prev) qc.setQueryData(["applications"], { ...prev, items: prev.items.map((a) => (a.id === id ? { ...a, status } : a)) });
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["applications"], ctx.prev); toast("error", (e as Error).message); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["applications"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); qc.invalidateQueries({ queryKey: ["gaps"] }); },
  });

  const byCol = useMemo(() => {
    const m: Record<string, Application[]> = Object.fromEntries(COLS.map((c) => [c.key, []]));
    for (const a of q.data?.items ?? []) (m[a.status] ??= []).push(a);
    return m;
  }, [q.data]);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const id = Number(e.active.id); const to = e.over?.id as string | undefined;
    const a = q.data?.items.find((x) => x.id === id);
    if (a && to && a.status !== to) setStatus.mutate({ id, status: to });
  };

  const open = q.data?.items.find((a) => a.id === openId) ?? null;

  return (
    <div>
      <PageHeader title="Applications" subtitle={q.data ? `${q.data.items.length} tracked · drag cards between stages` : undefined}
        actions={<Link to="/tailor"><Button variant="primary"><Target className="size-4" /> Analyze a job</Button></Link>} />
      {q.isSuccess && q.data.items.length === 0 ? (
        <Empty title="Nothing tracked yet" body="Analyze a job description and click Track — it lands here with the full fit assessment attached." action={<Link to="/tailor"><Button variant="primary">Analyze a job</Button></Link>} />
      ) : (
        <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setDragging(q.data!.items.find((a) => a.id === Number(e.active.id)) ?? null)} onDragEnd={onDragEnd}>
          <div className="grid grid-flow-col auto-cols-[minmax(230px,1fr)] gap-3 items-start overflow-x-auto pb-3 -mx-4 px-4 md:-mx-8 md:px-8">
            {COLS.map((c) => <Column key={c.key} col={c} items={byCol[c.key] ?? []} onOpen={setOpenId} />)}
          </div>
          <DragOverlay>{dragging ? <CardView a={dragging} overlay /> : null}</DragOverlay>
        </DndContext>
      )}
      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open ? `${open.title}${open.company ? " · " + open.company : ""}` : ""}>
        {open && <Detail a={open} onClose={() => setOpenId(null)} />}
      </Drawer>
    </div>
  );
}

function Column({ col, items, onOpen }: { col: (typeof COLS)[number]; items: Application[]; onOpen: (id: number) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div ref={setNodeRef} className={clsx("rounded-xl border border-dashed p-2 min-h-[240px] transition", isOver ? "border-accent bg-accent-soft/40" : "border-border bg-surface-2/40")}>
      <div className="flex items-center justify-between px-1.5 py-1 mb-1.5"><Badge tone={col.tone} dot>{col.label}</Badge><span className="num text-[12px] text-faint">{items.length}</span></div>
      <div className="space-y-2">{items.map((a) => <DraggableCard key={a.id} a={a} onOpen={onOpen} />)}</div>
    </div>
  );
}

function DraggableCard({ a, onOpen }: { a: Application; onOpen: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: a.id });
  return (
    <div ref={setNodeRef} {...attributes} className={clsx(isDragging && "opacity-30")}>
      <CardView a={a} onOpen={() => onOpen(a.id)} handle={<button {...listeners} className="touch-none p-2 -my-2 -ml-3 -mr-2 text-faint hover:text-muted cursor-grab active:cursor-grabbing" title="Drag"><GripVertical className="size-4" /></button>} />
    </div>
  );
}

function CardView({ a, onOpen, handle, overlay }: { a: Application; onOpen?: () => void; handle?: React.ReactNode; overlay?: boolean }) {
  const tone = scoreTone(a.match_score);
  return (
    <div className={clsx("card p-3 group", overlay && "rotate-2 shadow-2xl", onOpen && "cursor-pointer hover:border-border-strong")} onClick={onOpen}>
      <div className="flex items-start gap-1.5">
        {handle}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold leading-snug line-clamp-2">{a.title}</div>
          <div className="text-[12px] text-muted truncate mt-0.5">{a.country && <span className="mr-1" title={a.country}>{flag(a.country)}</span>}{a.company || "—"}</div>
        </div>
        <span className={clsx("num text-[12px] font-semibold px-1.5 py-0.5 rounded-md shrink-0", tone === "success" ? "bg-success-soft text-success" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger")}>{Math.round(a.match_score)}%</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-[11.5px] text-faint"><span>{timeAgo(a.updated_at)}</span>{onOpen && <ChevronRight className="size-3.5 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition" />}</div>
    </div>
  );
}

function Detail({ a, onClose }: { a: Application; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast(); const pack = usePack(); const ot = pack.key === "ot";
  const [notes, setNotes] = useState(a.notes); const [url, setUrl] = useState(a.url ?? "");
  const [country, setCountry] = useState(a.country ?? ""); const [agency, setAgency] = useState<Agency>(a.agency ?? {});
  const ctry = useQuery({ queryKey: ["countries"], queryFn: () => api.get<CountriesPayload>("/api/countries"), enabled: ot });
  const inval = () => { qc.invalidateQueries({ queryKey: ["applications"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); qc.invalidateQueries({ queryKey: ["gaps"] }); };
  const save = useMutation({ mutationFn: () => api.patch(`/api/applications/${a.id}`, ot ? { notes, url: url || null, country: country || null, agency } : { notes, url: url || null }), onSuccess: () => { inval(); toast("success", "Saved."); } });
  const rescore = useMutation({ mutationFn: () => api.post<Application>(`/api/applications/${a.id}/rescore`), onSuccess: (r) => { inval(); toast("success", `Re-scored: ${Math.round(a.match_score)}% → ${Math.round(r.match_score)}%`); }, onError: (e) => toast("error", (e as Error).message) });
  const del = useMutation({ mutationFn: () => api.del(`/api/applications/${a.id}`), onSuccess: () => { inval(); onClose(); toast("info", "Deleted."); } });
  const tailorIt = useMutation({ mutationFn: () => api.post<Application>(`/api/applications/${a.id}/tailor`), onSuccess: () => { inval(); toast("success", a.tailored ? "Re-tailored against the current profile." : "Tailored: summary, bullets and cover letter are below; the resume PDF is ready."); }, onError: (e) => toast("error", (e as Error).message) });
  const counts = { strong: a.match.matches.filter((m) => m.strength === "strong").length, partial: a.match.matches.filter((m) => m.strength === "partial").length, none: a.match.matches.filter((m) => m.strength === "none").length };
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-5">
        <Gauge value={a.match_score} size={104} label="fit" />
        <div className="text-[13px] space-y-1.5">
          <div className="flex gap-1.5"><Badge tone="success">{counts.strong} strong</Badge><Badge tone="warn">{counts.partial} partial</Badge><Badge tone="danger">{counts.none} missing</Badge></div>
          <div className="text-muted">Status <Badge tone="accent" className="ml-1">{a.status}</Badge>{a.applied_at && <span className="ml-2">applied {a.applied_at.slice(0, 10)}</span>}</div>
          {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">Open posting <ExternalLink className="size-3.5" /></a>}
        </div>
      </div>
      <div className="text-[13.5px] leading-relaxed rounded-lg border border-border bg-surface-2/50 px-4 py-3"><span className="font-semibold">Verdict.</span> {a.match.verdict}</div>
      <div className="text-[13px] flex flex-wrap items-center gap-1.5"><span className="text-muted">Close first:</span>{a.match.top_gaps.map((g) => <Badge key={g}>{g}</Badge>)}</div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => rescore.mutate()} loading={rescore.isPending}><RefreshCw className="size-4" /> Re-score with current profile</Button>
        <Link to="/interview" state={{ app_id: a.id }}><Button className="w-full">Practice for this job</Button></Link>
        {ot && <Link to="/cover-letters" state={{ app_id: a.id }}><Button className="w-full"><Mail className="size-4" /> Write cover letter</Button></Link>}
        <Button onClick={() => tailorIt.mutate()} loading={tailorIt.isPending} title="Rewrites the summary and bullets for this JD and drafts the cover letter. One model call, about a minute."><Wand2 className="size-4" /> {a.tailored ? "Re-tailor for this job" : "Tailor resume for this job"}</Button>
        {a.tailored && <a href={`/api/applications/${a.id}/resume.pdf`} download><Button className="w-full"><Download className="size-4" /> Tailored resume PDF</Button></a>}
      </div>
      {ot && (a.job.licence_required || a.job.facility_type || (a.job.package?.length ?? 0) > 0) && (
        <div className="text-[13px] flex flex-wrap gap-1.5">{a.job.licence_required && <Badge tone="warn">Licence: {a.job.licence_required}</Badge>}{a.job.facility_type && <Badge>{a.job.facility_type}</Badge>}{a.job.package?.map((x) => <Badge key={x} tone="success">{x}</Badge>)}</div>
      )}
      <div className="space-y-2">
        {ot && (
          <>
            <label className="text-[12px] font-medium text-muted uppercase tracking-wider">Country</label>
            <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full"><option value="">Not set</option>{ctry.data?.countries.map((c) => <option key={c.code} value={c.code}>{flag(c.code)} {c.name}</option>)}</Select>
            <label className="text-[12px] font-medium text-muted uppercase tracking-wider block pt-1">Recruitment agency</label>
            <div className="grid grid-cols-2 gap-2">
              <Input value={agency.name ?? ""} onChange={(e) => setAgency({ ...agency, name: e.target.value })} placeholder="Agency name (if any)" />
              <Input value={agency.mea_registration ?? ""} onChange={(e) => setAgency({ ...agency, mea_registration: e.target.value })} placeholder="MEA registration no." />
              <Input value={agency.contact ?? ""} onChange={(e) => setAgency({ ...agency, contact: e.target.value })} placeholder="Contact person / phone" className="col-span-2" />
            </div>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!agency.fee_asked} onChange={() => setAgency({ ...agency, fee_asked: !agency.fee_asked })} /> The agency asked me to pay a fee</label>
            {agency.fee_asked && <div className="rounded-lg border border-danger/40 bg-danger-soft/40 px-3 py-2.5 text-[12.5px] flex gap-2"><AlertTriangle className="size-4 text-danger shrink-0 mt-0.5" /><span>Warning sign. A genuine employer or agency doesn't charge candidates for a job offer. In India, check the agency's licence on the Ministry of External Affairs' eMigrate site before paying anything.</span></div>}
            {agency.name && !agency.mea_registration && !agency.fee_asked && <div className="text-[12px] text-muted">Tip: ask for their MEA registration number and check it on eMigrate.</div>}
          </>
        )}
        <label className="text-[12px] font-medium text-muted uppercase tracking-wider block pt-1">Job URL</label>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <label className="text-[12px] font-medium text-muted uppercase tracking-wider">Notes</label>
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter name, dates, what they asked, next step…" />
        <div className="flex justify-end"><Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
      </div>
      {a.tailored && <><CopyBlock label="Tailored summary" text={a.tailored.summary} /><CopyBlock label="Cover letter" text={a.tailored.cover_letter} /><TellCheck url={`/api/applications/${a.id}/tells`} onApplied={inval} /></>}
      <details className="text-[13px]"><summary className="cursor-pointer text-muted hover:text-text">Job description</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-[12.5px] text-muted leading-relaxed">{a.jd_text}</pre></details>
      <div className="pt-2 border-t border-border flex justify-end"><Button variant="danger" size="sm" onClick={() => confirm("Delete this application and its analysis?") && del.mutate()}><Trash2 className="size-4" /> Delete</Button></div>
    </div>
  );
}
