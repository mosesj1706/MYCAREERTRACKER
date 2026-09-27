import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AlertTriangle, Check, Download, ImageOff } from "lucide-react";
import { api, type CountriesPayload } from "../lib/api";
import { flag } from "../lib/pack";
import { Drawer } from "./Drawer";
import { Button, SwitchRow } from "./ui";

interface CvFormat { photo: "expected" | "optional" | "avoid"; details: string[]; paper: "A4" | "Letter"; document: "CV" | "Resume"; pages: string; references: boolean }
type CountryWithCv = CountriesPayload["countries"][number] & { cv_format?: CvFormat };

const DETAIL = { nationality: "nationality", date_of_birth: "date of birth", visa_status: "visa status", notice_period: "notice period" } as Record<string, string>;
const describe = (f: CvFormat) => [
  f.photo === "expected" ? "Photo" : f.photo === "optional" ? "Photo optional" : "No photo",
  f.details.length ? f.details.map((d) => DETAIL[d]).join(", ") : "no personal details",
  f.paper === "Letter" ? "US Letter" : "A4", f.pages, f.document === "Resume" ? "titled Resume" : null, f.references ? "references line" : null,
].filter(Boolean).join(" · ");

/**
 * Download the CV in a country's conventions (OT pack): photo or none, which personal details,
 * paper size, length. The photo follows the country's standard unless she overrides it, with a
 * warning where employers avoid photos.
 */
export default function CvSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ["countries"], queryFn: () => api.get<CountriesPayload & { cv_standard: CvFormat }>("/api/countries"), enabled: open });
  const photo = useQuery({ queryKey: ["photo-exists"], queryFn: () => fetch("/api/profile/photo", { cache: "no-store" }).then((r) => r.ok), enabled: open });
  const [code, setCode] = useState<string>("");
  const [withPhoto, setWithPhoto] = useState(false);
  const countries = (q.data?.countries ?? []) as CountryWithCv[];
  const selected = countries.filter((c) => q.data?.selection.selected.includes(c.code));
  const others = countries.filter((c) => !q.data?.selection.selected.includes(c.code));
  useEffect(() => { if (open && q.data && !code) setCode(q.data.selection.primary ?? "intl"); }, [open, q.data, code]);
  const fmt: CvFormat | undefined = code === "intl" ? q.data?.cv_standard : countries.find((c) => c.code === code)?.cv_format;
  const c = countries.find((x) => x.code === code);
  useEffect(() => { if (fmt) setWithPhoto(fmt.photo === "expected"); }, [code, fmt?.photo]); // eslint-disable-line react-hooks/exhaustive-deps

  const href = `/api/resume.pdf?country=${encodeURIComponent(code || "intl")}&photo=${withPhoto}`;

  return (
    <Drawer open={open} onClose={onClose} title="Download CV" width={600}>
      <div className="space-y-5">
        <p className="text-[14px] text-muted leading-relaxed">Healthcare CVs follow different rules in each country. Pick where you're applying and the CV is laid out to match.</p>
        <div>
          <div className="text-[13px] text-muted uppercase tracking-wide px-1 mb-1.5">Your countries</div>
          <div className="rounded-[12px] bg-fill-2 overflow-hidden divide-y divide-border">
            {selected.map((x) => <Row key={x.code} active={code === x.code} onPick={() => setCode(x.code)} title={<>{flag(x.code)}&nbsp; {x.name}</>} sub={x.cv_format ? describe(x.cv_format) : undefined} />)}
            <Row active={code === "intl"} onPick={() => setCode("intl")} title="International (no country)" sub={q.data ? describe(q.data.cv_standard) : undefined} />
          </div>
        </div>
        {others.length > 0 && (
          <details>
            <summary className="text-[14px] text-accent cursor-pointer px-1">Other countries</summary>
            <div className="mt-2 rounded-[12px] bg-fill-2 overflow-hidden divide-y divide-border">
              {others.map((x) => <Row key={x.code} active={code === x.code} onPick={() => setCode(x.code)} title={<>{flag(x.code)}&nbsp; {x.name}</>} sub={x.cv_format ? describe(x.cv_format) : undefined} />)}
            </div>
          </details>
        )}
        {fmt && (
          <div className="rounded-[12px] bg-fill-2 px-4 py-2">
            <SwitchRow checked={withPhoto} onChange={setWithPhoto} hint={fmt.photo === "expected" ? "Expected here." : fmt.photo === "optional" ? "Optional here; many employers prefer none." : "Employers here avoid photos."}>Include photo</SwitchRow>
            {withPhoto && fmt.photo === "avoid" && <div className="flex gap-2 text-[12.5px] text-warn pb-2"><AlertTriangle className="size-4 shrink-0" />{c?.name ?? "These"} employers usually reject or ignore CVs with photos. Only include one if the job asks for it.</div>}
            {withPhoto && photo.data === false && <div className="flex gap-2 text-[12.5px] text-muted pb-2"><ImageOff className="size-4 shrink-0" />No photo uploaded yet: add one in Edit profile → Personal.</div>}
          </div>
        )}
        {c?.cv_norms && (
          <div>
            <div className="text-[13px] text-muted uppercase tracking-wide px-1 mb-1.5">{c.name} CV conventions</div>
            <ul className="rounded-[12px] bg-fill-2 px-4 py-3 space-y-1.5 text-[13.5px] list-disc pl-8">{c.cv_norms.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}
        <a href={href} download className="block"><Button variant="primary" size="lg" className="w-full" disabled={!fmt}><Download className="size-4" /> Download {fmt?.document ?? "CV"}{c ? ` for ${c.name}` : ""}</Button></a>
      </div>
    </Drawer>
  );
}

function Row({ active, onPick, title, sub }: { active: boolean; onPick: () => void; title: React.ReactNode; sub?: string }) {
  return (
    <button onClick={onPick} className={clsx("w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors", active ? "bg-accent-soft/60" : "hover:bg-fill-2")}>
      <div className="flex-1 min-w-0"><div className="text-[15px]">{title}</div>{sub && <div className="text-[12.5px] text-muted truncate">{sub}</div>}</div>
      {active && <Check className="size-5 text-accent shrink-0" strokeWidth={2.5} />}
    </button>
  );
}
