import { clsx } from "clsx";
import type { ReactNode, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useBack } from "../../lib/nav";

// Apple-style primitives: filled / tinted / plain buttons, inset-grouped cards, capsule badges,
// filled text fields, a segmented control and a switch. Colours come from the tokens in index.css.

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const v = {
    primary: "bg-accent text-white hover:brightness-[1.08]",
    secondary: "bg-fill text-accent hover:brightness-[0.97] dark:hover:brightness-[1.15]",
    ghost: "text-accent hover:bg-fill-2",
    danger: "bg-danger-soft text-danger hover:brightness-[0.98]",
  }[variant];
  const s = { sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[9px]", md: "h-9 px-3.5 text-[14px] gap-1.5 rounded-[10px]", lg: "h-11 px-5 text-[15px] gap-2 rounded-[12px]" }[size];
  return (
    <button disabled={disabled || loading}
      className={clsx("inline-flex items-center justify-center whitespace-nowrap font-semibold transition-[filter,background-color,opacity] duration-150 active:opacity-70 disabled:opacity-40 disabled:pointer-events-none select-none", v, s, className)} {...rest}>
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
    <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
        {subtitle && <p className="text-[13px] text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- Badge (capsule)
export type Tone = "neutral" | "accent" | "success" | "warn" | "danger";
export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: ReactNode; dot?: boolean }) {
  const t = {
    neutral: "bg-fill text-muted",
    accent: "bg-accent-soft text-accent",
    success: "bg-success-soft text-success",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5", t, className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}

// ---------------------------------------------------------------- Stat (Health-style tile)
export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] font-semibold text-muted leading-tight">{label}</div>
        {icon && <div className="size-7 rounded-full bg-accent-soft text-accent grid place-items-center shrink-0 [&_svg]:size-[15px]">{icon}</div>}
      </div>
      <div className={clsx("rounded-num text-[30px] font-semibold leading-tight mt-1.5 truncate", tone === "success" && "text-success", tone === "warn" && "text-warn", tone === "danger" && "text-danger")}>{value}</div>
      {hint && <div className="text-[12.5px] text-muted mt-0.5 truncate">{hint}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------- Gauge (activity-ring style score)
export function Gauge({ value, size = 120, stroke = 11, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? "var(--switch-on)" : pct >= 45 ? "#ff9500" : "#ff3b30";
  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--fill)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="rounded-num font-semibold leading-none" style={{ fontSize: size * 0.25 }}>{Math.round(pct)}<span className="text-muted" style={{ fontSize: size * 0.12 }}>%</span></span>
        {label && <span className="text-[11px] text-muted mt-1">{label}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Progress bar
export function Progress({ value, tone = "accent", className }: { value: number; tone?: Tone; className?: string }) {
  const bg = { neutral: "bg-muted", accent: "bg-accent", success: "bg-[var(--switch-on)]", warn: "bg-[#ff9500]", danger: "bg-[#ff3b30]" }[tone];
  return (
    <div className={clsx("h-1.5 w-full rounded-full bg-fill overflow-hidden", className)}>
      <div className={clsx("h-full rounded-full transition-all duration-700", bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Skeleton / Empty
export function Skeleton({ className }: { className?: string }) { return <div className={clsx("skeleton", className)} />; }
export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon && <div className="size-16 rounded-full bg-fill-2 text-muted grid place-items-center mb-4 [&_svg]:size-7">{icon}</div>}
      <div className="text-[17px] font-semibold">{title}</div>
      {body && <div className="text-[14px] text-muted mt-1.5 max-w-sm leading-relaxed">{body}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Inputs (filled fields)
const field = "w-full rounded-[10px] border border-transparent bg-fill-2 px-3 text-[15px] text-text placeholder:text-faint outline-none transition focus:bg-surface focus:border-accent focus:ring-4 focus:ring-[var(--ring)]";
export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(field, "h-10", className)} {...rest} />;
}
export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(field, "py-2.5 resize-y leading-relaxed", className)} {...rest} />;
}
const chevron = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%238e8e93' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";
export function Select({ className, children, style, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(field, "h-10 pr-9 appearance-none bg-no-repeat cursor-pointer truncate", className)}
      style={{ backgroundImage: chevron, backgroundSize: "12px", backgroundPosition: "right 12px center", ...style }} {...rest}>{children}</select>
  );
}

// ---------------------------------------------------------------- Switch (iOS toggle)
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={clsx("relative inline-flex h-[28px] w-[46px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40", checked ? "bg-[var(--switch-on)]" : "bg-fill")}>
      <span className={clsx("absolute top-[2px] left-[2px] size-6 rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200", checked && "translate-x-[18px]")} />
    </button>
  );
}
/** A row with a label on the left and a switch on the right, as in iOS Settings. */
export function SwitchRow({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-[14px] leading-snug cursor-pointer" onClick={() => onChange(!checked)}>{children}{hint && <span className="block text-[12.5px] text-muted mt-0.5">{hint}</span>}</span>
      <Switch checked={checked} onChange={onChange} label={typeof children === "string" ? children : undefined} />
    </div>
  );
}

// ---------------------------------------------------------------- Page header (large title + back)
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const back = useBack();
  return (
    <div className="mb-6">
      {back && (
        <button onClick={back.go} className="-ml-1.5 mb-1 inline-flex items-center gap-0.5 text-[15px] text-accent hover:opacity-70 active:opacity-50">
          <ChevronLeft className="size-5" strokeWidth={2.4} />{back.label}
        </button>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[30px] leading-[36px] font-bold tracking-[-0.022em]">{title}</h1>
          {subtitle && <p className="text-[15px] text-muted mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Segmented control
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-[9px] bg-fill p-[2px] max-w-full overflow-x-auto" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={clsx("px-3 h-7 rounded-[7px] text-[13px] font-medium transition-all whitespace-nowrap",
            value === o.value ? "bg-surface dark:bg-[#636366] text-text shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]" : "text-muted hover:text-text")}>{o.label}</button>
      ))}
    </div>
  );
}
