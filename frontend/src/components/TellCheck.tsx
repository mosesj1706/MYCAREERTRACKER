import { useState } from "react";
import { ScanSearch } from "lucide-react";
import { clsx } from "clsx";
import { api } from "../lib/api";
import { Badge, Button, type Tone } from "./ui";
import { useToast } from "./Toast";

export interface TellSection { label: string; text: string; kind?: "prose" | "bullets" }
interface Finding { rule: string; where: string; detail: string; weight: number }
interface Stats { sentences: number; words: number; mean_len: number; burstiness: number; type_token_ratio: number; opener_repeat: number }
interface Detector { score: number | null; band: string; words: number; observer: string; performer: string }
interface Row { label: string; kind: string; tells: { score: number; label: string; findings: Finding[]; stats: Stats }; detector: Detector | null }
interface Report { sections: Row[]; detector_available: boolean; detector_note: string | null }

const tone = (score: number): Tone => (score < 15 ? "success" : score < 40 ? "warn" : "danger");
const bandTone: Record<string, Tone> = { "human-like": "success", borderline: "warn", "model-like": "danger", "too short": "neutral" };

/**
 * "Does this read as AI-written?" Two layers: a deterministic scan that names the sentence and the
 * reason (always on), and the Binoculars score from two local models (optional, slower first run).
 * `url` fetches a prebuilt report (profile / application); `sections` posts arbitrary text.
 */
export function TellCheck({ url, sections, compact }: { url?: string; sections?: TellSection[]; compact?: boolean }) {
  const toast = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<false | "scan" | "detector">(false);
  const run = async (detector: boolean) => {
    setBusy(detector ? "detector" : "scan");
    try {
      const r = url
        ? await api.get<Report>(`${url}${url.includes("?") ? "&" : "?"}detector_on=${detector}`)
        : await api.post<Report>("/api/tells", { sections, detector });
      setReport(r);
    } catch (e) { toast("error", (e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-[13px] font-semibold">Reads as AI-written?</h3>
          {!compact && <p className="text-[12px] text-faint">Names the sentence and the reason, so you can fix it rather than guess.</p>}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" loading={busy === "scan"} onClick={() => run(false)}><ScanSearch className="size-3.5" /> Scan</Button>
          <Button size="sm" variant="secondary" loading={busy === "detector"} onClick={() => run(true)} title="Binoculars score from two local models. First run loads ~6 GB of weights.">+ detector score</Button>
        </div>
      </div>
      {report && report.detector_note && <p className="text-[12px] text-faint">Detector not installed: <code className="num">{report.detector_note}</code></p>}
      {report?.sections.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-surface-2/60">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border gap-2 flex-wrap">
            <span className="text-[12px] font-medium text-muted">{s.label}</span>
            <div className="flex items-center gap-1.5">
              <Badge tone={tone(s.tells.score)}>{s.tells.label} · {s.tells.score}</Badge>
              {s.detector && <span title={`Binoculars ${s.detector.score ?? "-"} over ${s.detector.words} words. Below 0.85 reads as generic model prose, above 0.95 as a person writing about specifics. Calibrated on this app's own text.`}>
                <Badge tone={bandTone[s.detector.band] ?? "neutral"} className="num">detector: {s.detector.band}{s.detector.score !== null && ` · ${s.detector.score.toFixed(2)}`}</Badge></span>}
            </div>
          </div>
          <div className="px-3 py-2 text-[12.5px] space-y-1.5">
            {s.tells.findings.length === 0 && <div className="text-muted">Nothing found. {s.tells.stats.sentences} {s.kind === "bullets" ? "bullets" : "sentences"}, burstiness {s.tells.stats.burstiness}.</div>}
            {s.tells.findings.map((f, i) => (
              <div key={i} className="flex gap-2">
                <span className={clsx("shrink-0 mt-[3px] size-1.5 rounded-full", f.weight >= 3 ? "bg-danger" : f.weight === 2 ? "bg-warn" : "bg-faint")} />
                <div className="min-w-0">
                  <div className="text-muted italic truncate" title={f.where}>{f.where}</div>
                  <div>{f.detail}</div>
                </div>
              </div>
            ))}
            {!compact && s.tells.stats.sentences >= 4 && (
              <div className="text-[11.5px] text-faint num pt-1">{s.tells.stats.words} words · {s.tells.stats.sentences} {s.kind === "bullets" ? "bullets" : "sentences"} · burstiness {s.tells.stats.burstiness} (humans usually 0.5+) · vocabulary {Math.round(s.tells.stats.type_token_ratio * 100)}% distinct</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
