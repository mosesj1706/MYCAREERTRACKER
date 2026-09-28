import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, Download, Eye, FileArchive, FileImage, FileText, FileUp, FolderLock, Lock, Pencil, Trash2, Upload, XCircle } from "lucide-react";
import { api, redirectIfLoggedOut, type Doc, type DocumentsPayload } from "../lib/api";
import { Badge, Button, Card, CardHeader, Empty, Input, PageHeader, Select, Skeleton, Textarea } from "../components/ui";
import { Drawer } from "../components/Drawer";
import { useToast } from "../components/Toast";

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const expiryTone = (d?: number | null) => (d == null ? null : d < 0 ? "danger" : d <= 60 ? "warn" : "neutral") as "danger" | "warn" | "neutral" | null;
const expiryText = (d: number) => (d < 0 ? `expired ${-d} days ago` : d === 0 ? "expires today" : `expires in ${d} days`);

export default function Documents() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ["documents"], queryFn: () => api.get<DocumentsPayload>("/api/documents") });
  const [upload, setUpload] = useState<string | null>(null);   // category preset, "" = choose
  const [edit, setEdit] = useState<Doc | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/documents/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["documents"] }); toast("success", "Deleted."); } });
  const zip = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/documents/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: picked }) });
      redirectIfLoggedOut(r); if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
      const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = "documents.zip"; a.click(); URL.revokeObjectURL(a.href);
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const groups = useMemo(() => {
    const out: { group: string; docs: Doc[] }[] = [];
    const byCat = Object.fromEntries((q.data?.categories ?? []).map((c) => [c.key, c.group]));
    for (const d of q.data?.documents ?? []) {
      const g = byCat[d.category] ?? "Other";
      (out.find((x) => x.group === g) ?? (out.push({ group: g, docs: [] }), out[out.length - 1])).docs.push(d);
    }
    const order = [...new Set((q.data?.categories ?? []).map((c) => c.group))];
    return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  }, [q.data]);

  if (q.isLoading || !q.data) return <Skeleton className="h-72" />;
  const { documents, checklist } = q.data;
  const expiring = documents.filter((d) => d.days_left != null && d.days_left <= 60).sort((a, b) => a.days_left! - b.days_left!);
  const missing = checklist.filter((c) => c.have.length === 0).length;

  return (
    <div>
      <PageHeader title="Documents" subtitle={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Stored privately in your tracker and never sent to the AI.</span>}
        actions={<><Button disabled={!picked.length} loading={zip.isPending} onClick={() => zip.mutate()}><FileArchive className="size-4" /> Zip {picked.length ? `(${picked.length})` : "selected"}</Button><Button variant="primary" onClick={() => setUpload("")}><Upload className="size-4" /> Upload</Button></>} />

      {expiring.length > 0 && (
        <Card className="p-4 mb-4 border-warn/40 bg-warn-soft/30">
          <div className="flex items-center gap-2 font-semibold text-[14px]"><AlertTriangle className="size-4 text-warn" /> Renew soon</div>
          <div className="mt-2 flex flex-wrap gap-2">{expiring.map((d) => <Badge key={d.id} tone={expiryTone(d.days_left)!}>{d.title} · {expiryText(d.days_left!)}</Badge>)}</div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <div className="space-y-4">
          {documents.length === 0 ? (
            <Card><Empty icon={<FolderLock className="size-8" />} title="No documents yet" body="Upload your degree, experience letters, registration and BLS certificate. On the iPad you can pick from Files or take a photo." action={<Button variant="primary" onClick={() => setUpload("")}><Upload className="size-4" /> Upload a document</Button>} /></Card>
          ) : groups.map(({ group, docs }) => (
            <Card key={group}>
              <CardHeader title={group} subtitle={`${docs.length} document${docs.length > 1 ? "s" : ""}`} />
              <div className="px-3 pb-3 space-y-1">
                {docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2/60">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={picked.includes(d.id)} onChange={() => setPicked((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))} />
                    {d.mime === "application/pdf" ? <FileText className="size-5 text-danger shrink-0" /> : <FileImage className="size-5 text-accent shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium truncate">{d.title}</div>
                      <div className="text-[12px] text-muted truncate">{d.category_label} · {size(d.size)} · added {d.created_at.slice(0, 10)}{d.notes ? ` · ${d.notes}` : ""}</div>
                    </div>
                    {d.days_left != null && <Badge tone={expiryTone(d.days_left)!}>{d.days_left < 0 ? "expired" : `${d.expires}`}</Badge>}
                    <div className="flex items-center shrink-0">
                      <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" title="View" className="p-2 text-muted hover:text-text"><Eye className="size-4" /></a>
                      <a href={`/api/documents/${d.id}/file?download=true`} title="Download" className="p-2 text-muted hover:text-text"><Download className="size-4" /></a>
                      <button title="Edit" onClick={() => setEdit(d)} className="p-2 text-muted hover:text-text"><Pencil className="size-4" /></button>
                      <button title="Delete" onClick={() => { if (confirm(`Delete "${d.title}"? This removes the file.`)) del.mutate(d.id); }} className="p-2 text-muted hover:text-danger"><Trash2 className="size-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader title="Checklist for your licence routes" subtitle={checklist.length ? `${checklist.length - missing} of ${checklist.length} document types uploaded` : undefined} />
          <div className="px-4 pb-4">
            {checklist.length === 0 ? <p className="text-[13px] text-muted px-1">Pick a country on <Link to="/countries" className="text-accent hover:underline">Countries & licence</Link> to see which documents its route needs.</p> : (
              <ul className="space-y-1">
                {checklist.map((c) => (
                  <li key={c.key} className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2/60">
                    {c.have.length ? <CheckCircle2 className="size-[18px] text-success shrink-0 mt-0.5" /> : <XCircle className="size-[18px] text-faint shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium">{c.label}{c.have.length > 1 && <span className="text-muted font-normal"> · {c.have.length}</span>}</div>
                      <div className="text-[11.5px] text-faint truncate" title={c.needed_by.join("\n")}>{c.needed_by.slice(0, 2).join(" · ")}{c.needed_by.length > 2 ? ` +${c.needed_by.length - 2}` : ""}</div>
                    </div>
                    {!c.have.length && <button onClick={() => setUpload(c.key)} className="text-[12px] text-accent hover:underline shrink-0 mt-0.5">Upload</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <UploadDrawer category={upload} categories={q.data.categories} onClose={() => setUpload(null)} />
      <EditDrawer doc={edit} categories={q.data.categories} onClose={() => setEdit(null)} />
    </div>
  );
}

function CategorySelect({ value, onChange, categories }: { value: string; onChange: (v: string) => void; categories: DocumentsPayload["categories"] }) {
  const groups = [...new Set(categories.map((c) => c.group))];
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-full mt-1">
      <option value="">Choose…</option>
      {groups.map((g) => <optgroup key={g} label={g}>{categories.filter((c) => c.group === g).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
    </Select>
  );
}

function UploadDrawer({ category, categories, onClose }: { category: string | null; categories: DocumentsPayload["categories"]; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ category: "", title: "", expires: "", notes: "" });
  const [seen, setSeen] = useState<string | null>(null);
  if (category !== seen) { setSeen(category); setF({ category: category ?? "", title: "", expires: "", notes: "" }); setFile(null); }
  const up = useMutation({
    mutationFn: async () => {
      const fd = new FormData(); fd.append("file", file!); Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      const r = await fetch("/api/documents", { method: "POST", body: fd }); redirectIfLoggedOut(r);
      if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["documents"] }); toast("success", "Uploaded."); onClose(); },
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <Drawer open={category !== null} onClose={onClose} title="Upload a document" width={520}>
      <div className="space-y-4">
        <label className={clsx("flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 cursor-pointer text-center", file ? "border-accent text-accent" : "border-border-strong text-muted hover:text-text")}>
          <FileUp className="size-7" />
          <span className="text-[13.5px] font-medium">{file ? file.name : "Choose a PDF or photo"}</span>
          <span className="text-[12px]">{file ? size(file.size) : "On the iPad: Files, Photo Library or Take Photo · up to 20 MB"}</span>
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !f.title) setF((s) => ({ ...s, title: x.name.replace(/\.[^.]+$/, "") })); }} />
        </label>
        <label className="block text-[13px] text-muted">What is it?<CategorySelect value={f.category} onChange={(v) => setF({ ...f, category: v })} categories={categories} /></label>
        <label className="block text-[13px] text-muted">Title<Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Experience letter from your current hospital" className="mt-1" /></label>
        <label className="block text-[13px] text-muted">Expiry date (if it expires)<Input type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} className="mt-1" /></label>
        <label className="block text-[13px] text-muted">Notes<Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Attested? Original with you? Reference number?" className="mt-1" /></label>
        <Button variant="primary" className="w-full" size="lg" disabled={!file || !f.category} loading={up.isPending} onClick={() => up.mutate()}><Upload className="size-4" /> Upload</Button>
      </div>
    </Drawer>
  );
}

function EditDrawer({ doc, categories, onClose }: { doc: Doc | null; categories: DocumentsPayload["categories"]; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [f, setF] = useState({ category: "", title: "", expires: "", notes: "" });
  const [seen, setSeen] = useState<number | null>(null);
  if (doc && doc.id !== seen) { setSeen(doc.id); setF({ category: doc.category, title: doc.title, expires: doc.expires ?? "", notes: doc.notes }); }
  const save = useMutation({
    mutationFn: () => api.patch(`/api/documents/${doc!.id}`, f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["documents"] }); toast("success", "Saved."); onClose(); },
    onError: (e) => toast("error", (e as Error).message),
  });
  return (
    <Drawer open={!!doc} onClose={() => { setSeen(null); onClose(); }} title="Edit document" width={480}>
      <div className="space-y-4">
        <label className="block text-[13px] text-muted">What is it?<CategorySelect value={f.category} onChange={(v) => setF({ ...f, category: v })} categories={categories} /></label>
        <label className="block text-[13px] text-muted">Title<Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="mt-1" /></label>
        <label className="block text-[13px] text-muted">Expiry date<Input type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} className="mt-1" /></label>
        <label className="block text-[13px] text-muted">Notes<Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="mt-1" /></label>
        <Button variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Drawer>
  );
}
