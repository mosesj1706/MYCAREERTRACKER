import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { api, type Gap, type Application } from "../lib/api";
import { Badge, Card, CardHeader, Empty, PageHeader, Progress, Segmented, Skeleton, Button } from "../components/ui";

export default function Gaps() {
  const apps = useQuery({ queryKey: ["applications"], queryFn: () => api.get<{ items: Application[] }>("/api/applications") });
  const n = apps.data?.items.length ?? 0;
  const [min, setMin] = useState<"1" | "2" | "3">("2");
  const minJobs = Math.min(Number(min), Math.max(1, n));
  const q = useQuery({ queryKey: ["gaps", minJobs], queryFn: () => api.get<Gap[]>(`/api/gaps?min_jobs=${minJobs}`) });
  const gaps = (q.data ?? []).filter((g) => g.pressure > 0);
  const covered = (q.data ?? []).filter((g) => g.strong === g.jobs).sort((a, b) => b.jobs - a.jobs);
  const maxP = Math.max(1, ...gaps.map((g) => g.pressure));

  if (apps.isSuccess && n === 0) return <Empty title="No data yet" body="Gap analysis aggregates every requirement from every job you track. Analyze and track a few first." action={<Link to="/tailor"><Button variant="primary">Analyze a job</Button></Link>} />;

  return (
    <div>
      <PageHeader title="Gap analysis" subtitle={`Every requirement across ${n} tracked job${n === 1 ? "" : "s"}, weighted by importance and how far you got. Pressure = what the gap is costing you in the market you're actually applying to.`}
        actions={<Segmented value={min} onChange={setMin} options={[{ value: "1", label: "All skills" }, { value: "2", label: "In ≥2 JDs" }, { value: "3", label: "In ≥3 JDs" }]} />} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Learn next" subtitle="Sorted by pressure. The bar is your coverage today." />
          <div className="px-5 pb-5">
            {q.isLoading ? <Skeleton className="h-64" /> : gaps.length === 0 ? <div className="text-sm text-muted">No gaps at this threshold — nice.</div> : (
              <div className="divide-y divide-border">
                {gaps.map((g, i) => (
                  <div key={g.skill} className="py-3 flex items-center gap-4">
                    <div className="num text-[12px] text-faint w-5 text-right">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-[14px] truncate">{g.skill}</div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge>{g.jobs} JD{g.jobs > 1 ? "s" : ""}</Badge>
                          {g.must_have > 0 && <Badge tone="accent">must-have ×{g.must_have}</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <Progress value={g.coverage} tone={g.coverage >= 75 ? "success" : g.coverage >= 40 ? "warn" : "danger"} className="flex-1" />
                        <span className="num text-[12px] text-muted w-10 text-right">{Math.round(g.coverage)}%</span>
                      </div>
                    </div>
                    <div className="w-28 shrink-0">
                      <div className="text-[10.5px] uppercase tracking-wider text-faint">pressure</div>
                      <div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-surface-2 overflow-hidden"><div className={clsx("h-full rounded-full", i === 0 ? "bg-danger" : "bg-muted")} style={{ width: `${(100 * g.pressure) / maxP}%` }} /></div><span className="num text-[12px]">{g.pressure.toFixed(1)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Already covered" subtitle="Strong in every JD that asked" />
            <div className="px-5 pb-5 flex flex-wrap gap-1.5">{covered.map((g) => <Badge key={g.skill} tone="success">{g.skill} <span className="opacity-70">×{g.jobs}</span></Badge>)}{covered.length === 0 && <span className="text-sm text-muted">—</span>}</div>
          </Card>
          {gaps.length > 0 && (
            <Card>
              <CardHeader title="Suggested order" subtitle="Top five, by pressure" />
              <ol className="px-5 pb-5 space-y-2 text-[13px]">
                {gaps.slice(0, 5).map((g, i) => <li key={g.skill} className="flex gap-2"><span className="num text-faint">{i + 1}.</span><span><span className="font-medium">{g.skill}</span> <span className="text-muted">— {g.jobs}/{n} JDs, must-have in {g.must_have}, coverage {Math.round(g.coverage)}%</span></span></li>)}
              </ol>
              <div className="px-5 pb-5"><Link to="/learning"><Button size="sm" variant="primary" className="w-full">Build a learning plan from this</Button></Link></div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
