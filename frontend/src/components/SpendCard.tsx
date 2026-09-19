import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Card, CardHeader, Skeleton } from "./ui";

interface Usage {
  today: { calls: number; cost: number }; week: { calls: number; cost: number }; all_time: { calls: number; cost: number };
  by_feature: { feature: string; provider: string; calls: number; cost: number; input_tokens: number; output_tokens: number; cache_read: number; fallbacks: number }[];
  model: string; basic_provider: string | null;
}
const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);

/** What the model calls cost, by feature, so the API balance never runs out unnoticed. */
export default function SpendCard() {
  const q = useQuery({ queryKey: ["usage"], queryFn: () => api.get<Usage>("/api/usage"), refetchInterval: 30_000 });
  const u = q.data;
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><Coins className="size-4" />API spend</span>}
        subtitle={u ? <>Claude <span className="num">{u.model}</span> for judgment · {u.basic_provider ? <>{u.basic_provider} (free) for basic calls</> : <>no free tier set — everything on Claude</>}</> : "Loading…"} />
      <div className="px-5 pb-5">
        {!u ? <Skeleton className="h-24" /> : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[["Today", u.today], ["Last 7 days", u.week], ["All time", u.all_time]].map(([label, v]) => {
                const x = v as { calls: number; cost: number };
                return <div key={label as string}><div className="text-[11.5px] uppercase tracking-wider text-faint">{label as string}</div><div className="num text-lg font-semibold">{usd(x.cost)}</div><div className="text-[12px] text-muted">{x.calls} calls</div></div>;
              })}
            </div>
            {u.by_feature.length > 0 && (
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-faint text-left"><th className="font-medium pb-1">Feature (7 days)</th><th className="font-medium pb-1 text-right">Calls</th><th className="font-medium pb-1 text-right">Cached</th><th className="font-medium pb-1 text-right">Cost</th></tr></thead>
                <tbody>
                  {u.by_feature.map((r) => (
                    <tr key={r.feature + r.provider} className="border-t border-border">
                      <td className="py-1"><span className="text-text">{r.feature}</span> <Badge className="ml-1">{r.provider}</Badge>{r.fallbacks > 0 && <span className="text-warn ml-1" title="times the free provider failed and Claude was used">↩ {r.fallbacks}</span>}</td>
                      <td className="py-1 text-right num text-muted">{r.calls}</td>
                      <td className="py-1 text-right num text-muted">{r.input_tokens ? Math.round((100 * r.cache_read) / r.input_tokens) : 0}%</td>
                      <td className="py-1 text-right num">{usd(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
