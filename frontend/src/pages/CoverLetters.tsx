import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { Download, FileText, Mail, Save, Trash2, Wand2 } from "lucide-react";
import { api, type Application, type CountriesPayload, type CoverLetter } from "../lib/api";
import { flag } from "../lib/pack";
import { Badge, Button, Card, Empty, Input, PageHeader, Segmented, Select, SwitchRow, Textarea } from "../components/ui";
import { CopyButton } from "../components/Copy";
import { TellCheck } from "../components/TellCheck";
import { useToast } from "../components/Toast";

type Length = "short" | "standard" | "long";
type Tone = "formal" | "warm";

export default function CoverLetters() {
  const qc = useQueryClient(); const toast = useToast();
  const loc = useLocation() as { state?: { app_id?: number } };
  const apps = useQuery({ queryKey: ["applications"], queryFn: () => api.get<{ items: Application[] }>("/api/applications") });
  const ctry = useQuery({ queryKey: ["countries"], queryFn: () => api.get<CountriesPayload>("/api/countries") });
  const letters = useQuery({ queryKey: ["cover-letters"], queryFn: () => api.get<CoverLetter[]>("/api/cover-letters") });
  const [source, setSource] = useState<"job" | "paste">("job");
  const [appId, setAppId] = useState<number>(loc.state?.app_id ?? 0);
  const [jd, setJd] = useState(""); const [title, setTitle] = useState("");
  const [country, setCountry] = useState<string>("");
  const [length, setLength] = useState<Length>("standard"); const [tone, setTone] = useState<Tone>("formal");
  const [addressee, setAddressee] = useState(""); const [extra, setExtra] = useState("");
  const [inc, setInc] = useState({ include_licence: true, include_notice: true, include_visa: false });
  const [openId, setOpenId] = useState<number | null>(null);

  const app = apps.data?.items.find((a) => a.id === appId);
  useEffect(() => { if (!appId && apps.data?.items.length && source === "job") setAppId(apps.data.items[0].id); }, [apps.data, appId, source]);
  useEffect(() => { setCountry(app?.country ?? ctry.data?.selection.primary ?? ""); }, [app?.id, app?.country, ctry.data?.selection.primary]);

  const gen = useMutation({
    mutationFn: () => api.post<CoverLetter>("/api/cover-letters", {
      app_id: source === "job" ? appId || null : null, jd_text: source === "paste" ? jd : null, title: source === "paste" ? title || null : null,
      country: country || null, length, tone, addressee, extra, ...inc }),
    onSuccess: (l) => { qc.invalidateQueries({ queryKey: ["cover-letters"] }); setOpenId(l.id); toast("success", "Letter written. Read it before you send it."); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const countryName = (code?: string | null) => ctry.data?.countries.find((c) => c.code === code)?.name;
  const selected = ctry.data?.countries.filter((c) => ctry.data!.selection.selected.includes(c.code)) ?? [];
  const list = (letters.data ?? []).filter((l) => source === "job" && appId ? l.application_id === appId : true);
  const canGo = source === "job" ? !!appId : jd.trim().length > 80;

  return (
    <div>
      <PageHeader title="Cover letters" subtitle="Written from the job, your fit for it and the country's norms. It only claims what your profile supports." />
      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-4 items-start">
        <Card className="p-5 space-y-4">
          <Segmented value={source} onChange={setSource} options={[{ value: "job", label: "A tracked job" }, { value: "paste", label: "Paste a job ad" }]} />
          {source === "job" ? (
            apps.data?.items.length ? (
              <label className="block text-[13px] text-muted">Job
                <Select value={appId} onChange={(e) => setAppId(Number(e.target.value))} className="w-full mt-1">
                  {apps.data.items.map((a) => <option key={a.id} value={a.id}>{a.title}{a.company ? ` · ${a.company}` : ""}</option>)}
                </Select>
                {app && <div className="text-[12px] mt-1.5 flex gap-1.5 flex-wrap"><Badge>{Math.round(app.match_score)}% fit</Badge>{app.job.licence_required && <Badge tone="warn">{app.job.licence_required}</Badge>}</div>}
              </label>
            ) : <p className="text-[13px] text-muted">No tracked jobs yet. Analyze a job first, or paste an ad.</p>
          ) : (
            <>
              <label className="block text-[13px] text-muted">Job title & employer<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Occupational Therapist, Neuro Rehab · Dubai" className="mt-1" /></label>
              <Textarea rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job ad…" className="text-[13px]" />
            </>
          )}
          <label className="block text-[13px] text-muted">Country style
            <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full mt-1">
              <option value="">No specific country</option>
              {(selected.length ? selected : ctry.data?.countries ?? []).map((c) => <option key={c.code} value={c.code}>{flag(c.code)} {c.name}</option>)}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-[13px] text-muted">Length<div className="mt-1"><Segmented value={length} onChange={setLength} options={[{ value: "short", label: "Short" }, { value: "standard", label: "Std" }, { value: "long", label: "Long" }]} /></div></div>
            <div className="text-[13px] text-muted">Tone<div className="mt-1"><Segmented value={tone} onChange={setTone} options={[{ value: "formal", label: "Formal" }, { value: "warm", label: "Warm" }]} /></div></div>
          </div>
          <label className="block text-[13px] text-muted">Address it to (optional)<Input value={addressee} onChange={(e) => setAddressee(e.target.value)} placeholder="e.g. Dr Ayesha Rahman, or the agency's name" className="mt-1" /></label>
          <div className="rounded-[12px] bg-fill-2 px-4 py-1 divide-y divide-border">
            {([["include_licence", "Licence status", "Only what your progress shows"], ["include_notice", "Notice period", undefined], ["include_visa", "Visa status", undefined]] as const).map(([k, l, h]) => (
              <SwitchRow key={k} checked={inc[k]} onChange={(v) => setInc({ ...inc, [k]: v })} hint={h}>{l}</SwitchRow>
            ))}
          </div>
          <label className="block text-[13px] text-muted">Anything else to mention (optional)<Textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. I speak Malayalam and Hindi; available from December" className="mt-1" /></label>
          <Button variant="primary" size="lg" className="w-full" disabled={!canGo} loading={gen.isPending} onClick={() => gen.mutate()}><Wand2 className="size-4" /> {gen.isPending ? "Writing (about 30 s)…" : "Write cover letter"}</Button>
        </Card>

        <div className="space-y-3 min-w-0">
          {list.length === 0 ? (
            <Card><Empty icon={<Mail className="size-8" />} title="No letters yet" body="Pick a job on the left and write one. Every version is kept here so you can compare and edit." /></Card>
          ) : list.map((l) => <LetterCard key={l.id} l={l} open={openId === l.id} onToggle={() => setOpenId(openId === l.id ? null : l.id)} countryName={countryName(l.country)} />)}
        </div>
      </div>
    </div>
  );
}

function LetterCard({ l, open, onToggle, countryName }: { l: CoverLetter; open: boolean; onToggle: () => void; countryName?: string }) {
  const qc = useQueryClient(); const toast = useToast();
  const [text, setText] = useState(l.text);
  useEffect(() => setText(l.text), [l.text]);
  const dirty = text !== l.text;
  const save = useMutation({ mutationFn: () => api.patch<CoverLetter>(`/api/cover-letters/${l.id}`, { text }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["cover-letters"] }); toast("success", "Saved."); } });
  const del = useMutation({ mutationFn: () => api.del(`/api/cover-letters/${l.id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["cover-letters"] }) });
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (
    <Card>
      <button onClick={onToggle} className="w-full text-left px-5 py-4 flex items-center gap-3">
        <FileText className="size-5 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[14px] truncate">{l.title}</div>
          <div className="text-[12px] text-muted">{l.created_at.slice(0, 16)} · {String(l.options.length ?? "standard")} · {String(l.options.tone ?? "formal")}{countryName ? ` · ${countryName} style` : ""}</div>
        </div>
        <Badge>{open ? "Hide" : "Open"}</Badge>
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-3">
          <Textarea rows={16} value={text} onChange={(e) => setText(e.target.value)} className={clsx("text-[14px] leading-relaxed font-[system-ui]")} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-faint mr-auto">{words} words{dirty && <span className="text-warn"> · unsaved changes</span>}</span>
            <CopyButton text={text} className="px-2" />
            <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}><Save className="size-3.5" /> Save edits</Button>
            <a href={`/api/cover-letters/${l.id}/pdf`} download><Button size="sm" disabled={dirty} title={dirty ? "Save first" : undefined}><Download className="size-3.5" /> PDF</Button></a>
            <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this version?")) del.mutate(); }}><Trash2 className="size-3.5" /></Button>
          </div>
          <Card className="p-4"><TellCheck url={`/api/cover-letters/${l.id}/tells`} compact onApplied={() => qc.invalidateQueries({ queryKey: ["cover-letters"] })} /></Card>
        </div>
      )}
    </Card>
  );
}
