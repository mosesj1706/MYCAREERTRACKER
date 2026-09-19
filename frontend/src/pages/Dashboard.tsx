import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Briefcase, Send, Reply, Percent, MessagesSquare, BrainCircuit, Flag, Sparkles } from "lucide-react";
import { api, type Analytics, type Application, type Gap, type LearningPlan, type Profile } from "../lib/api";
import { Button, Card, CardHeader, Empty, Gauge, PageHeader, Progress, Skeleton, Stat, Badge } from "../components/ui";
import { WeeklyActivity, Funnel, McqTrend } from "../components/charts";
import SpendCard from "../components/SpendCard";

const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

export default function Dashboard() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile | null>("/api/profile") });
  const analytics = useQuery({ queryKey: ["analytics"], queryFn: () => api.get<Analytics>("/api/analytics") });
  const apps = useQuery({ queryKey: ["applications"], queryFn: () => api.get<{ items: Application[] }>("/api/applications") });
  const gaps = useQuery({ queryKey: ["gaps", 1], queryFn: () => api.get<Gap[]>("/api/gaps?min_jobs=1") });
  const plan = useQuery({ queryKey: ["plan"], queryFn: () => api.get<LearningPlan | null>("/api/plan") });

  if (profile.isSuccess && !profile.data) {
    return <Empty icon={<Sparkles className="size-8" />} title="Let's build your profile first" body="Everything here is computed from your profile. Upload your resume and set a target role." action={<Link to="/profile"><Button variant="primary">Go to Profile <ArrowRight className="size-4" /></Button></Link>} />;
  }
  const k = analytics.data?.kpis;
  const p = profile.data;
  const best = apps.data?.items.slice().sort((a, b) => b.match_score - a.match_score)[0];
  const topGaps = (gaps.data ?? []).filter((g) => g.pressure > 0).slice(0, 5);
  const pp = plan.data?.portfolio_project;
  const milestonesDone = pp ? pp.milestones.filter((m) => m.done).length : 0;

  return (
    <div>
      <PageHeader title={p ? `Good to see you, ${p.personal_info.name.split(" ")[0]}` : "Dashboard"}
        subtitle={p ? <>Targeting <span className="text-text font-medium">{p.target.primary_role}</span> · {p.hands_on} hands-on skills · {p.years} yrs experience</> : undefined}
        actions={<Link to="/tailor"><Button variant="primary"><Target className="size-4" /> Analyze a job</Button></Link>} />

      <motion.div {...fade} className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {k ? <>
          <Stat label="JDs tracked" value={k.tracked} icon={<Briefcase className="size-5" />} hint={`${k.applied} applied`} />
          <Stat label="Response rate" value={k.response_rate == null ? "—" : `${k.response_rate}%`} icon={<Reply className="size-5" />} hint="reached screening+" tone={k.response_rate != null && k.response_rate >= 30 ? "success" : undefined} />
          <Stat label="Avg match (applied)" value={k.avg_score_applied == null ? "—" : `${k.avg_score_applied}%`} icon={<Percent className="size-5" />} hint={k.avg_score_rejected != null ? `rejected avg ${k.avg_score_rejected}%` : "no rejections yet"} />
          <Stat label="Practice" value={k.interviews} icon={<MessagesSquare className="size-5" />} hint={k.mcq_accuracy == null ? "no MCQs yet" : `MCQ accuracy ${k.mcq_accuracy}% (${k.mcq_answered})`} />
        </> : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <motion.div {...fade} transition={{ delay: 0.05 }} className="lg:col-span-2">
          <Card>
            <CardHeader title="Learn next" subtitle="Ranked by pressure across every job you've analyzed" action={<Link to="/gaps" className="text-[13px] text-accent hover:underline">Gap analysis →</Link>} />
            <div className="px-5 pb-5">
              {gaps.isLoading ? <Skeleton className="h-24" /> : topGaps.length === 0 ? <div className="text-sm text-muted">Analyze a few jobs and this fills in.</div> : (
                <div className="space-y-2.5">
                  {topGaps.map((g, i) => (
                    <div key={g.skill} className="flex items-center gap-3">
                      <div className="num text-[12px] text-faint w-4">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{g.skill}</span>
                          <span className="text-[12px] text-muted shrink-0">{g.jobs} JD{g.jobs > 1 ? "s" : ""} · must-have in {g.must_have}</span>
                        </div>
                        <Progress value={g.coverage} tone={g.coverage >= 75 ? "success" : g.coverage >= 40 ? "warn" : "danger"} className="mt-1.5" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div {...fade} transition={{ delay: 0.1 }}>
          <Card className="h-full">
            <CardHeader title="Best current match" subtitle={best ? `${best.title}${best.company ? " @ " + best.company : ""}` : "No applications yet"} />
            <div className="px-5 pb-5 flex items-center gap-5">
              {best ? <>
                <Gauge value={best.match_score} size={112} label="fit" />
                <div className="text-[13px] space-y-1.5 min-w-0">
                  <div><Badge tone="accent">{best.status}</Badge></div>
                  <div className="text-muted">Gaps: <span className="text-text">{best.match.top_gaps.slice(0, 3).join(", ")}</span></div>
                  <Link to="/applications" className="text-accent hover:underline inline-block">Open pipeline →</Link>
                </div>
              </> : <div className="text-sm text-muted">Paste a job description on the <Link className="text-accent" to="/tailor">Analyze</Link> page.</div>}
            </div>
          </Card>
        </motion.div>
      </div>

      {pp && (
        <motion.div {...fade} transition={{ delay: 0.15 }} className="mt-4">
          <Card className="px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-muted uppercase tracking-wider">Portfolio project</div>
                <div className="font-semibold truncate mt-0.5">{pp.name} <span className="text-muted font-normal">· {plan.data!.weeks_to_complete} wks @ {plan.data!.weekly_hours_assumed}h</span></div>
              </div>
              <div className="num text-sm text-muted shrink-0">{milestonesDone}/{pp.milestones.length} milestones</div>
              <Link to="/learning"><Button size="sm">Open plan</Button></Link>
            </div>
            <Progress value={(100 * milestonesDone) / Math.max(1, pp.milestones.length)} className="mt-3" tone="success" />
          </Card>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <motion.div {...fade} transition={{ delay: 0.2 }}><Card><CardHeader title="Weekly activity" subtitle="Are you doing the work?" /><div className="px-3 pb-3">{analytics.data ? (analytics.data.weekly.length ? <WeeklyActivity rows={analytics.data.weekly} /> : <div className="text-sm text-muted px-2 pb-3">Nothing yet — analyze a job to start the clock.</div>) : <Skeleton className="h-[220px]" />}</div></Card></motion.div>
        <motion.div {...fade} transition={{ delay: 0.25 }}><Card><CardHeader title="Pipeline" subtitle="Applications that reached each stage" /><div className="px-3 pb-3">{analytics.data ? <Funnel rows={analytics.data.funnel} /> : <Skeleton className="h-[200px]" />}</div></Card></motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <motion.div {...fade} transition={{ delay: 0.3 }}><Card><CardHeader title="MCQ accuracy" subtitle="Weekly, from the interview playground" /><div className="px-3 pb-3">{analytics.data ? (analytics.data.mcq_trend.length ? <McqTrend rows={analytics.data.mcq_trend} /> : <div className="text-sm text-muted px-2 pb-3 flex items-center gap-2"><BrainCircuit className="size-4" /> Answer some quick-fire questions to see a trend.</div>) : <Skeleton className="h-[200px]" />}</div></Card></motion.div>
        <motion.div {...fade} transition={{ delay: 0.35 }}>
          <Card>
            <CardHeader title="What a recruiter will probe" subtitle="From your profile — rehearse these" />
            <div className="px-5 pb-5 space-y-2">
              {p?.risk_flags.slice(0, 4).map((r, i) => (
                <div key={i} className="flex gap-2.5 text-[13px] text-muted"><Flag className="size-3.5 mt-0.5 shrink-0 text-warn" /><span>{r}</span></div>
              ))}
              {p && p.risk_flags.length > 4 && <Link to="/profile" className="text-[13px] text-accent hover:underline">+{p.risk_flags.length - 4} more on your profile</Link>}
            </div>
          </Card>
        </motion.div>
      </div>

      <motion.div {...fade} transition={{ delay: 0.4 }} className="mt-4"><SpendCard /></motion.div>
    </div>
  );
}
function Target(props: { className?: string }) { return <Send {...props} />; }
