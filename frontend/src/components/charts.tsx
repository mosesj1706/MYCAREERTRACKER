import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line, LabelList } from "recharts";

export const SERIES = ["#007aff", "#ff9500", "#34c759", "#af52de"];  // Apple system blue, orange, green, purple
const tick = { fill: "var(--muted)", fontSize: 12 };
const tooltipStyle = { contentStyle: { background: "var(--hud)", border: "none", borderRadius: 12, fontSize: 13, boxShadow: "var(--shadow-lg)", backdropFilter: "blur(20px)" }, labelStyle: { color: "var(--muted)" }, cursor: { fill: "var(--fill-2)" } };

export function WeeklyActivity({ rows }: { rows: { week: string; activity: string; count: number }[] }) {
  const acts = ["JDs analyzed", "Applied", "Mock interviews", "MCQs answered"];
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  const data = weeks.map((w) => ({ week: w, ...Object.fromEntries(acts.map((a) => [a, rows.find((r) => r.week === w && r.activity === a)?.count ?? 0])) }));
  return (
    <ResponsiveContainer debounce={80} width="100%" height={220}>
      <BarChart data={data} barGap={3} barCategoryGap={24}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="week" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
        <Tooltip {...tooltipStyle} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
        {acts.map((a, i) => <Bar key={a} dataKey={a} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={18} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Funnel({ rows }: { rows: { stage: string; count: number }[] }) {
  return (
    <ResponsiveContainer debounce={80} width="100%" height={200}>
      <BarChart data={rows} layout="vertical" barCategoryGap={10}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="stage" tick={tick} axisLine={false} tickLine={false} width={72} />
        <Tooltip {...tooltipStyle} />
        {/* No entrance animation here: a LabelList inside an animated Bar loops re-renders when the
            container resizes (sidebar show/hide) in Recharts 3 and crashes the page. */}
        <Bar dataKey="count" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          <LabelList dataKey="count" position="right" style={{ fill: "var(--muted)", fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function McqTrend({ rows }: { rows: { week: string; accuracy: number; answered: number }[] }) {
  return (
    <ResponsiveContainer debounce={80} width="100%" height={200}>
      <LineChart data={rows}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="week" tick={tick} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={tick} axisLine={false} tickLine={false} width={32} unit="%" />
        <Tooltip {...tooltipStyle} />
        <Line type="monotone" dataKey="accuracy" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, fill: SERIES[0] }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
