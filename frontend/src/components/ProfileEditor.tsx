import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Plus, Save, Trash2, X } from "lucide-react";
import { api, redirectIfLoggedOut, type Language, type Profile, type Registration } from "../lib/api";
import { usePack } from "../lib/pack";
import { Button, Input, Segmented, Select, Textarea } from "./ui";
import { Drawer } from "./Drawer";
import { useToast } from "./Toast";

type Tab = "personal" | "experience" | "education" | "skills" | "more";
type Exp = Profile["experience"][number];
type Edu = Profile["education"][number];
type Cert = Profile["certifications"][number];
type Skill = Profile["skills"][number];

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const num = (s: string) => (s.trim() ? Number(s) : null);

/**
 * Edit the profile with forms (the OT pack's replacement for "Edit as JSON"). Everything is edited
 * on a copy and written with one Save; proficiency is chosen from the pack's own wording.
 */
export default function ProfileEditor({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: Profile }) {
  const qc = useQueryClient(); const toast = useToast(); const pack = usePack();
  const [tab, setTab] = useState<Tab>("personal");
  const [p, setP] = useState<Profile>(profile);
  const [seen, setSeen] = useState(false);
  if (open && !seen) { setSeen(true); setP(JSON.parse(JSON.stringify(profile))); }
  if (!open && seen) setSeen(false);
  const set = (patch: Partial<Profile>) => setP({ ...p, ...patch });
  const pi = (patch: Partial<Profile["personal_info"]>) => set({ personal_info: { ...p.personal_info, ...patch } });
  const save = useMutation({
    mutationFn: () => api.put<Profile>("/api/profile", p),
    onSuccess: (r) => { qc.setQueryData(["profile"], r); toast("success", "Profile saved."); onClose(); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const photo = useMutation({
    mutationFn: async (f: File) => { const fd = new FormData(); fd.append("file", f); const r = await fetch("/api/profile/photo", { method: "POST", body: fd }); redirectIfLoggedOut(r); if (!r.ok) throw new Error((await r.json()).detail); },
    onSuccess: () => { setPhotoKey(Date.now()); toast("success", "Photo saved. It appears on CVs for countries that expect one."); },
    onError: (e) => toast("error", (e as Error).message),
  });
  const [photoKey, setPhotoKey] = useState(0);
  const cats = Object.entries(pack.categories);
  const profLabels = pack.proficiency_labels;

  return (
    <Drawer open={open} onClose={onClose} title="Edit profile" width={760}>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Segmented value={tab} onChange={setTab} options={[{ value: "personal", label: "Personal" }, { value: "experience", label: "Experience" }, { value: "education", label: "Education & certs" }, { value: "skills", label: "Skills" }, { value: "more", label: pack.key === "ot" ? "Languages & registration" : "More" }]} />
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}><Save className="size-4" /> Save</Button>
        </div>

        {tab === "personal" && (
          <div className="space-y-4">
            <Grid>
              <F label="Full name"><Input value={p.personal_info.name} onChange={(e) => pi({ name: e.target.value })} /></F>
              <F label="Headline"><Input value={p.personal_info.headline ?? ""} onChange={(e) => pi({ headline: e.target.value })} /></F>
              <F label="Email"><Input value={p.personal_info.email ?? ""} onChange={(e) => pi({ email: e.target.value })} /></F>
              <F label="Phone"><Input value={p.personal_info.phone ?? ""} onChange={(e) => pi({ phone: e.target.value })} /></F>
              <F label="Location"><Input value={p.personal_info.location ?? ""} onChange={(e) => pi({ location: e.target.value })} /></F>
              <F label="LinkedIn"><Input value={p.personal_info.linkedin ?? ""} onChange={(e) => pi({ linkedin: e.target.value })} /></F>
            </Grid>
            {pack.key === "ot" && (
              <>
                <div className="text-[12.5px] text-muted">Shown on the CV only when filled in. Gulf employers usually expect these; leave out anything you'd rather not share.</div>
                <Grid>
                  <F label="Nationality"><Input value={p.personal_info.nationality ?? ""} onChange={(e) => pi({ nationality: e.target.value || null })} /></F>
                  <F label="Date of birth"><Input type="date" value={p.personal_info.date_of_birth ?? ""} onChange={(e) => pi({ date_of_birth: e.target.value || null })} /></F>
                  <F label="Visa status"><Input value={p.personal_info.visa_status ?? ""} placeholder="e.g. Employment visa required" onChange={(e) => pi({ visa_status: e.target.value || null })} /></F>
                  <F label="Notice period"><Input value={p.personal_info.notice_period ?? ""} placeholder="e.g. 1 month" onChange={(e) => pi({ notice_period: e.target.value || null })} /></F>
                </Grid>
                <div className="flex items-center gap-4 rounded-xl border border-border p-3">
                  <img key={photoKey} src={`/api/profile/photo?v=${photoKey}`} onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} onLoad={(e) => { (e.target as HTMLImageElement).style.visibility = "visible"; }} className="size-20 rounded-lg object-cover bg-surface-2" alt="" />
                  <div className="flex-1 text-[13px]"><div className="font-medium">CV photo</div><div className="text-muted text-[12.5px]">A plain, professional photo. Used on CVs for the Gulf, left off for countries that don't expect one.</div></div>
                  <label className="h-9 px-3 inline-flex items-center gap-2 rounded-lg border border-border cursor-pointer text-sm hover:border-border-strong"><ImageUp className="size-4" /> {photo.isPending ? "Saving…" : "Upload"}<input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} /></label>
                </div>
              </>
            )}
            <Grid>
              <F label="Target role"><Input value={p.target.primary_role} onChange={(e) => set({ target: { ...p.target, primary_role: e.target.value } })} /></F>
              <F label="Seniority"><Input value={p.target.seniority} onChange={(e) => set({ target: { ...p.target, seniority: e.target.value } })} /></F>
            </Grid>
            <F label="Summary"><Textarea rows={5} value={p.summary} onChange={(e) => set({ summary: e.target.value })} /></F>
          </div>
        )}

        {tab === "experience" && (
          <List<Exp> items={p.experience} onChange={(experience) => set({ experience })} add="Add a job"
            blank={{ company: "", title: "", location: null, employment_type: "full-time", start: "", end: null, bullets: [], technologies: [] }}
            render={(e, up) => (
              <>
                <Grid>
                  <F label="Job title"><Input value={e.title} onChange={(x) => up({ title: x.target.value })} /></F>
                  <F label="Hospital / employer"><Input value={e.company} onChange={(x) => up({ company: x.target.value })} /></F>
                  <F label="Location"><Input value={e.location ?? ""} onChange={(x) => up({ location: x.target.value || null })} /></F>
                  <F label="Type"><Select value={e.employment_type ?? ""} onChange={(x) => up({ employment_type: x.target.value || null })} className="w-full">{["full-time", "part-time", "contract", "internship", "freelance", "volunteer"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></F>
                  <F label="Start (YYYY-MM)"><Input type="month" value={e.start} onChange={(x) => up({ start: x.target.value })} /></F>
                  <F label="End (empty = current)"><Input type="month" value={e.end ?? ""} onChange={(x) => up({ end: x.target.value || null })} /></F>
                </Grid>
                <F label="What you did (one per line)"><Textarea rows={5} value={e.bullets.join("\n")} onChange={(x) => up({ bullets: lines(x.target.value) })} /></F>
                <F label={pack.key === "ot" ? "Assessments, techniques & equipment (comma-separated)" : "Technologies (comma-separated)"}><Input value={e.technologies.join(", ")} onChange={(x) => up({ technologies: csv(x.target.value) })} /></F>
              </>
            )} />
        )}

        {tab === "education" && (
          <div className="space-y-6">
            <List<Edu> items={p.education} onChange={(education) => set({ education })} add="Add education" title="Education"
              blank={{ institution: "", degree: "", field: null, start_year: null, end_year: null, grade: null }}
              render={(e, up) => (
                <Grid>
                  <F label="Degree"><Input value={e.degree} onChange={(x) => up({ degree: x.target.value })} /></F>
                  <F label="Field"><Input value={e.field ?? ""} onChange={(x) => up({ field: x.target.value || null })} /></F>
                  <F label="Institution"><Input value={e.institution} onChange={(x) => up({ institution: x.target.value })} /></F>
                  <F label="Grade"><Input value={e.grade ?? ""} onChange={(x) => up({ grade: x.target.value || null })} /></F>
                  <F label="Start year"><Input inputMode="numeric" value={e.start_year ?? ""} onChange={(x) => up({ start_year: num(x.target.value) })} /></F>
                  <F label="End year"><Input inputMode="numeric" value={e.end_year ?? ""} onChange={(x) => up({ end_year: num(x.target.value) })} /></F>
                </Grid>
              )} />
            <List<Cert> items={p.certifications} onChange={(certifications) => set({ certifications })} add="Add certification" title="Certifications"
              blank={{ name: "", issuer: null, status: "completed", year: null }}
              render={(c, up) => (
                <Grid>
                  <F label="Name"><Input value={c.name} onChange={(x) => up({ name: x.target.value })} /></F>
                  <F label="Issuer"><Input value={c.issuer ?? ""} onChange={(x) => up({ issuer: x.target.value || null })} /></F>
                  <F label="Status"><Select value={c.status} onChange={(x) => up({ status: x.target.value })} className="w-full"><option value="completed">completed</option><option value="in_progress">in progress</option><option value="planned">planned</option></Select></F>
                  <F label="Year"><Input inputMode="numeric" value={c.year ?? ""} onChange={(x) => up({ year: num(x.target.value) })} /></F>
                </Grid>
              )} />
          </div>
        )}

        {tab === "skills" && (
          <List<Skill> items={p.skills} onChange={(skills) => set({ skills })} add="Add a skill" compact
            blank={{ name: "", category: cats[0]?.[0] ?? "soft", proficiency: "familiar", evidence: [] }}
            render={(s, up) => (
              <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_1fr_0.8fr] gap-2">
                <Input value={s.name} placeholder="Skill" onChange={(x) => up({ name: x.target.value })} />
                <Select value={s.category} onChange={(x) => up({ category: x.target.value })} className="w-full">{cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                <Select value={s.proficiency} onChange={(x) => up({ proficiency: x.target.value as Skill["proficiency"] })} className="w-full">{(Object.keys(profLabels) as (keyof typeof profLabels)[]).map((k) => <option key={k} value={k}>{profLabels[k]}</option>)}</Select>
                <Textarea rows={2} value={s.evidence.join("\n")} placeholder="Evidence, one per line: where you did it" onChange={(x) => up({ evidence: lines(x.target.value) })} className="sm:col-span-3 text-[12.5px]" />
              </div>
            )} />
        )}

        {tab === "more" && (
          <div className="space-y-6">
            <List<Language> items={p.languages ?? []} onChange={(languages) => set({ languages })} add="Add language" title="Languages" compact
              blank={{ name: "", level: "fluent" }}
              render={(l, up) => (
                <div className="grid grid-cols-2 gap-2">
                  <Input value={l.name} placeholder="Language" onChange={(x) => up({ name: x.target.value })} />
                  <Select value={l.level} onChange={(x) => up({ level: x.target.value as Language["level"] })} className="w-full">{["native", "fluent", "professional", "basic"].map((v) => <option key={v} value={v}>{v}</option>)}</Select>
                </div>
              )} />
            <List<Registration> items={p.registrations ?? []} onChange={(registrations) => set({ registrations })} add="Add registration or licence" title="Registrations, memberships & licences"
              blank={{ body: "", kind: "membership", number: null, status: "active", year: null, expires: null }}
              render={(r, up) => (
                <Grid>
                  <F label="Body"><Input value={r.body} placeholder="e.g. AIOTA, Dubai Health Authority" onChange={(x) => up({ body: x.target.value })} /></F>
                  <F label="Kind"><Select value={r.kind} onChange={(x) => up({ kind: x.target.value as Registration["kind"] })} className="w-full">{["registration", "membership", "licence", "exam", "eligibility"].map((v) => <option key={v} value={v}>{v}</option>)}</Select></F>
                  <F label="Number"><Input value={r.number ?? ""} onChange={(x) => up({ number: x.target.value || null })} /></F>
                  <F label="Status"><Input value={r.status} placeholder="active, passed, eligible, in progress" onChange={(x) => up({ status: x.target.value })} /></F>
                  <F label="Year"><Input inputMode="numeric" value={r.year ?? ""} onChange={(x) => up({ year: num(x.target.value) })} /></F>
                  <F label="Valid to (YYYY-MM)"><Input type="month" value={r.expires ?? ""} onChange={(x) => up({ expires: x.target.value || null })} /></F>
                </Grid>
              )} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Grid({ children }: { children: ReactNode }) { return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>; }
function F({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-[12.5px] text-muted"><span className="block mb-1">{label}</span>{children}</label>; }

function List<T>({ items, onChange, blank, render, add, title, compact }: {
  items: T[]; onChange: (v: T[]) => void; blank: T; render: (item: T, update: (patch: Partial<T>) => void) => ReactNode; add: string; title?: string; compact?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      {title && <div className="text-[13px] font-semibold">{title}</div>}
      {items.map((it, i) => (
        <div key={i} className={compact ? "relative rounded-lg border border-border p-2.5 pr-9" : "relative rounded-xl border border-border p-4 pr-10 space-y-3"}>
          {render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))))}
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="absolute top-2.5 right-2.5 p-1 text-faint hover:text-danger" title="Remove">{compact ? <X className="size-4" /> : <Trash2 className="size-4" />}</button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...items, JSON.parse(JSON.stringify(blank))])}><Plus className="size-3.5" /> {add}</Button>
    </div>
  );
}
