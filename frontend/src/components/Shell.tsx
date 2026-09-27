import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { LayoutDashboard, UserRound, Target, KanbanSquare, Radar, MessagesSquare, GraduationCap, Sun, Moon, MonitorSmartphone, PanelLeftClose, PanelLeftOpen, Globe2, FolderLock, NotebookPen, Mail } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, type Profile } from "../lib/api";
import { usePack, type Pack } from "../lib/pack";
import { BackContext, type Back } from "../lib/nav";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; key: string };
const TECH_NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, key: "d" },
  { to: "/tailor", label: "Analyze a job", icon: Target, key: "a" },
  { to: "/applications", label: "Applications", icon: KanbanSquare, key: "p" },
  { to: "/gaps", label: "Gap analysis", icon: Radar, key: "g" },
  { to: "/interview", label: "Interview", icon: MessagesSquare, key: "i" },
  { to: "/learning", label: "Learning", icon: GraduationCap, key: "l" },
  { to: "/profile", label: "Profile", icon: UserRound, key: "u" },
];
// OT: interview practice is the main section, so it sits right under the dashboard.
const OT_NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, key: "d" },
  { to: "/interview", label: "Interview practice", icon: MessagesSquare, key: "i" },
  { to: "/tailor", label: "Analyze a job", icon: Target, key: "a" },
  { to: "/applications", label: "Applications", icon: KanbanSquare, key: "p" },
  { to: "/cover-letters", label: "Cover letters", icon: Mail, key: "w" },
  { to: "/countries", label: "Countries & licence", icon: Globe2, key: "c" },
  { to: "/documents", label: "Documents", icon: FolderLock, key: "o" },
  { to: "/cpd", label: "CPD & cases", icon: NotebookPen, key: "k" },
  { to: "/gaps", label: "Gap analysis", icon: Radar, key: "g" },
  { to: "/learning", label: "Learning", icon: GraduationCap, key: "l" },
  { to: "/profile", label: "Profile", icon: UserRound, key: "u" },
];
const navFor = (p: Pack) => (p.key === "ot" ? OT_NAV : TECH_NAV);

type Appearance = "light" | "dark" | "system";
/** Light, dark, or follow the device (the default, as in any Apple app). */
function useAppearance() {
  const [mode, setMode] = useState<Appearance>(() => { try { const t = localStorage.getItem("theme"); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; } });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", mode === "dark" || (mode === "system" && mq.matches));
    apply();
    try { if (mode === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", mode); } catch {}
    if (mode !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);
  return [mode, setMode] as const;
}

/** In-app back stack: a sidebar tap starts a new stack, a link inside a page pushes, browser back pops. */
function useBackStack(labels: Record<string, string>): Back | null {
  const loc = useLocation() as { pathname: string; state?: { root?: boolean } | null };
  const type = useNavigationType();
  const navigate = useNavigate();
  const stack = useRef<string[]>([]);
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => {
    const path = loc.pathname;
    const s = stack.current;
    if (type === "POP") { const i = s.lastIndexOf(path); stack.current = i >= 0 ? s.slice(0, i + 1) : [path]; }
    else if (loc.state?.root || s.length === 0) stack.current = [path];
    else if (type === "REPLACE") stack.current = [...s.slice(0, -1), path];
    else if (s[s.length - 1] !== path) stack.current = [...s, path];
    const st = stack.current;
    setPrev(st.length > 1 ? st[st.length - 2] : null);
  }, [loc, type]);
  return useMemo(() => (prev ? { label: labels[prev] ?? "Back", go: () => navigate(-1) } : null), [prev, labels, navigate]);
}

export function Shell() {
  const [appearance, setAppearance] = useAppearance();
  // No saved choice yet: start collapsed on narrow screens (iPad portrait, Split View).
  const [collapsed, setCollapsed] = useState(() => { try { const s = localStorage.getItem("nav"); return s ? s === "min" : window.innerWidth < 1024; } catch { return false; } });
  const nav = useNavigate();
  const loc = useLocation();
  const pack = usePack();
  const NAV = navFor(pack);
  const labels = useMemo(() => Object.fromEntries(NAV.map((n) => [n.to, n.label])), [NAV]);
  const back = useBackStack(labels);
  const main = useRef<HTMLElement>(null);
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile | null>("/api/profile") });
  useEffect(() => {
    document.title = pack.app_name;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", pack.home_name);
  }, [pack.app_name, pack.home_name]);
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [loc.pathname]);

  // keyboard: g then key
  useEffect(() => {
    let pending = false;
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (e.key === "g") { pending = true; setTimeout(() => (pending = false), 800); return; }
      if (!pending) return;
      const to = NAV.find((n) => n.key === e.key)?.to;
      if (to) { nav(to, { state: { root: true } }); pending = false; }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [nav, NAV]);

  const initials = (profile?.personal_info.name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const APPEARANCE: { v: Appearance; icon: typeof Sun; label: string }[] = [{ v: "light", icon: Sun, label: "Light" }, { v: "dark", icon: Moon, label: "Dark" }, { v: "system", icon: MonitorSmartphone, label: "Auto" }];

  return (
    <div className="flex h-full">
      <aside className={clsx("material shrink-0 border-r border-border flex flex-col transition-[width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] z-10", collapsed ? "w-[68px]" : "w-[248px]")}>
        <div className={clsx("flex items-center gap-2.5 pt-5 pb-4", collapsed ? "px-[14px]" : "px-4")}>
          <div className="size-10 rounded-[11px] bg-gradient-to-b from-[#3d9bff] to-[#0062e6] grid place-items-center text-white shrink-0 font-bold text-[13px] tracking-tight leading-none select-none shadow-[0_1px_2px_rgba(0,0,0,0.15)]">{pack.mark}</div>
          {!collapsed && <div className="font-semibold tracking-[-0.015em] text-[17px] truncate">{pack.app_name}</div>}
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 space-y-0.5">
          {NAV.map(({ to, label, icon: I, end }) => (
            <NavLink key={to} to={to} end={end} title={label} state={{ root: true }}
              className={({ isActive }) => clsx("group flex items-center gap-3 h-10 rounded-[10px] text-[15px] transition-colors", collapsed ? "justify-center px-0" : "px-2.5",
                isActive ? "bg-accent text-white font-semibold" : "text-text hover:bg-fill-2 active:bg-fill")}>
              {({ isActive }) => <><I className={clsx("size-[19px] shrink-0", isActive ? "text-white" : "text-accent")} strokeWidth={2} />{!collapsed && <span className="truncate">{label}</span>}</>}
            </NavLink>
          ))}
        </nav>
        <div className="px-2.5 pb-4 pt-3 space-y-2 border-t border-border">
          {!collapsed ? (
            <div className="flex rounded-[9px] bg-fill p-[2px]" role="radiogroup" aria-label="Appearance">
              {APPEARANCE.map(({ v, icon: I, label }) => (
                <button key={v} role="radio" aria-checked={appearance === v} onClick={() => setAppearance(v)} title={label}
                  className={clsx("flex-1 h-7 rounded-[7px] inline-flex items-center justify-center gap-1.5 text-[12px] font-medium transition-all", appearance === v ? "bg-surface dark:bg-[#636366] shadow-[0_3px_8px_rgba(0,0,0,0.12)] text-text" : "text-muted")}>
                  <I className="size-3.5" />{label}
                </button>
              ))}
            </div>
          ) : (
            <button onClick={() => setAppearance(appearance === "light" ? "dark" : appearance === "dark" ? "system" : "light")} title={`Appearance: ${appearance}`} className="flex items-center justify-center h-10 w-full rounded-[10px] text-accent hover:bg-fill-2">
              {appearance === "light" ? <Sun className="size-[19px]" /> : appearance === "dark" ? <Moon className="size-[19px]" /> : <MonitorSmartphone className="size-[19px]" />}
            </button>
          )}
          <button onClick={() => { const next = !collapsed; setCollapsed(next); try { localStorage.setItem("nav", next ? "min" : "full"); } catch {} }}
            className={clsx("flex items-center gap-3 h-10 w-full rounded-[10px] text-[15px] text-accent hover:bg-fill-2", collapsed ? "justify-center" : "px-2.5")} title={collapsed ? "Show sidebar" : "Hide sidebar"}>
            {collapsed ? <PanelLeftOpen className="size-[19px]" /> : <PanelLeftClose className="size-[19px]" />}{!collapsed && "Hide sidebar"}
          </button>
          {profile && (
            <NavLink to="/profile" state={{ root: true }} className={clsx("flex items-center gap-2.5 rounded-[10px] py-1.5 hover:bg-fill-2", collapsed ? "justify-center" : "px-1.5")} title={profile.personal_info.name}>
              <div className="size-8 rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#8e8e93] text-white text-[12px] font-semibold grid place-items-center shrink-0">{initials || "?"}</div>
              {!collapsed && <div className="min-w-0"><div className="text-[13px] font-semibold truncate">{profile.personal_info.name}</div><div className="text-[12px] text-muted truncate">{profile.target.primary_role}</div></div>}
            </NavLink>
          )}
        </div>
      </aside>
      <main ref={main} className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-10 md:px-9 md:pt-9">
          <BackContext.Provider value={back}>
            <Outlet />
          </BackContext.Provider>
        </div>
      </main>
    </div>
  );
}
