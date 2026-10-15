import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ExternalLink, FileUp, Search, Trash2 } from "lucide-react";
import { api, redirectIfLoggedOut, type StudyFile } from "../lib/api";
import { Button, Card, Empty, Input, Skeleton } from "../components/ui";
import { useToast } from "../components/Toast";

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Study materials (OT): PDFs exactly as they are, such as prep books and the regulator's guideline. Tapping one opens
 * it in the device's own PDF viewer, which on the iPad has zoom, search and "Open in Books".
 */
export default function StudyMaterials() {
  const qc = useQueryClient(); const toast = useToast();
  const files = useQuery({ queryKey: ["library"], queryFn: () => api.get<StudyFile[]>("/api/library") });
  const [q, setQ] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/library", { method: "POST", body: fd }); redirectIfLoggedOut(r);
      if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["library"] }); toast("success", "Added to your study materials."); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/library/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
    onError: (e) => toast("error", (e as Error).message),
  });

  const list = (files.data ?? []).filter((f) => !q || `${f.title} ${f.notes}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="max-w-3xl space-y-4">
      <Card className="p-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a PDF" className="pl-9 w-full" />
        </div>
        <input ref={picker} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
        <Button variant="primary" loading={upload.isPending} onClick={() => picker.current?.click()}><FileUp className="size-4" /> Add a PDF</Button>
      </Card>
      {files.isLoading ? <Skeleton className="h-40" /> : (files.data ?? []).length === 0
        ? <Card><Empty icon={<BookOpen />} title="No study materials yet" body="Add prep books, guidelines or notes as PDFs to read them here." /></Card>
        : list.length === 0 ? <p className="text-[13.5px] text-muted px-1">No PDF matches "{q}".</p>
        : (
          <div className="space-y-2">
            {list.map((f) => (
              <Card key={f.id} className="p-4 flex items-center gap-3">
                <div className="size-11 rounded-[10px] bg-accent-soft text-accent grid place-items-center shrink-0"><BookOpen className="size-5" /></div>
                <a href={`/api/library/${f.id}/file`} target="_blank" rel="noreferrer" className="flex-1 min-w-0 group">
                  <div className="text-[15px] font-medium group-hover:text-accent">{f.title}</div>
                  <div className="text-[12.5px] text-muted">{f.pages ? `${f.pages} pages · ` : ""}{size(f.bytes)} · added {f.added_at.slice(0, 10)}</div>
                  {f.notes && <div className="text-[12.5px] text-muted mt-0.5">{f.notes}</div>}
                </a>
                <a href={`/api/library/${f.id}/file`} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink className="size-3.5" /> Open</Button></a>
                <Button size="sm" variant="ghost" title="Remove" onClick={() => { if (confirm(`Remove "${f.title}" from your study materials?`)) remove.mutate(f.id); }}><Trash2 className="size-4" /></Button>
              </Card>
            ))}
          </div>
        )}
      <p className="text-[12px] text-muted px-1">These PDFs are kept on this app's own storage for your use only. Tap one to read it; on the iPad you can zoom, search inside it, or open it in Books.</p>
    </div>
  );
}
