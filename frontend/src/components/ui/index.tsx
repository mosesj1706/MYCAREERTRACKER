import { clsx } from "clsx";
import type { ReactNode, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const v = {
    primary: "bg-accent text-white hover:brightness-110 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]",
    secondary: "bg-surface border border-border hover:border-border-strong hover:bg-surface-2",
    ghost: "hover:bg-surface-2 text-muted hover:text-text",
    danger: "bg-danger-soft text-danger border border-transparent hover:border-danger/40",
  }[variant];
  const s = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-[15px] gap-2" }[size];
  return (
    <button disabled={disabled || loading}
      className={clsx("inline-flex items-center justify-center rounded-lg font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none", v, s, className)} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Card
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("card", className)} {...rest}>{children}</div>;
}
export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div>
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-[13px] text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Badge
export type Tone = "neutral" | "accent" | "success" | "warn" | "danger";
export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: ReactNode; dot?: boolean }) {
  const t = {
    neutral: "bg-surface-2 text-muted border-border",
    accent: "bg-accent-soft text-accent border-transparent",
    success: "bg-success-soft text-success border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
  }[tone];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium leading-5", t, className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}

// ---------------------------------------------------------------- Stat
export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <Card className="px-5 py-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-muted uppercase tracking-wider">{label}</div>
        <div className={clsx("num text-[26px] font-semibold leading-tight mt-1 truncate", tone === "success" && "text-success", tone === "warn" && "text-warn", tone === "danger" && "text-danger")}>{value}</div>
        {hint && <div className="text-[12px] text-faint mt-1 truncate">{hint}</div>}
      </div>
      {icon && <div className="text-faint shrink-0">{icon}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------- Gauge (radial score)
export function Gauge({ value, size = 120, stroke = 10, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? "var(--success)" : pct >= 45 ? "var(--warn)" : "var(--danger)";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num font-semibold leading-none" style={{ fontSize: size * 0.24 }}>{Math.round(pct)}<span className="text-muted" style={{ fontSize: size * 0.12 }}>%</span></span>
        {label && <span className="text-[11px] text-muted mt-1">{label}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Progress bar
export function Progress({ value, tone = "accent", className }: { value: number; tone?: Tone; className?: string }) {
  const bg = { neutral: "bg-muted", accent: "bg-accent", success: "bg-success", warn: "bg-warn", danger: "bg-danger" }[tone];
  return (
    <div className={clsx("h-1.5 w-full rounded-full bg-surface-2 overflow-hidden", className)}>
      <div className={clsx("h-full rounded-full transition-all duration-700", bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Skeleton / Empty
export function Skeleton({ className }: { className?: string }) { return <div className={clsx("skeleton", className)} />; }
export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon && <div className="text-faint mb-3">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {body && <div className="text-sm text-muted mt-1 max-w-sm">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Inputs
export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx("h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-[var(--ring)] outline-none transition", className)} {...rest} />;
}
export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx("w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-[var(--ring)] outline-none transition resize-y", className)} {...rest} />;
}
export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx("h-9 rounded-lg border border-border bg-surface px-3 text-sm focus:border-accent outline-none transition", className)} {...rest}>{children}</select>;
}

// ---------------------------------------------------------------- Page header
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Segmented control
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={clsx("px-3 h-7 rounded-md text-[13px] font-medium transition whitespace-nowrap", value === o.value ? "bg-surface shadow-sm text-text" : "text-muted hover:text-text")}>{o.label}</button>
      ))}
    </div>
  );
}
