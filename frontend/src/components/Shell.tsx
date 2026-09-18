import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { LayoutDashboard, UserRound, Target, KanbanSquare, Radar, MessagesSquare, GraduationCap, Sun, Moon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, type Profile } from "../lib/api";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/tailor", label: "Analyze a job", icon: Target },
  { to: "/applications", label: "Applications", icon: KanbanSquare },
  { to: "/gaps", label: "Gap analysis", icon: Radar },
  { to: "/interview", label: "Interview", icon: MessagesSquare },
  { to: "/learning", label: "Learning", icon: GraduationCap },
  { to: "/profile", label: "Profile", icon: UserRound },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function Shell() {
  const { dark, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("nav") === "min"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("nav", collapsed ? "min" : "full"); } catch {} }, [collapsed]);
  const nav = useNavigate();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => api.get<Profile | null>("/api/profile") });

  // keyboard: g then key
  useEffect(() => {
    let pending = false;
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (e.key === "g") { pending = true; setTimeout(() => (pending = false), 800); return; }
      if (!pending) return;
      const map: Record<string, string> = { d: "/", a: "/tailor", p: "/applications", g: "/gaps", i: "/interview", l: "/learning", u: "/profile" };
      if (map[e.key]) { nav(map[e.key]); pending = false; }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [nav]);

  return (
    <div className="flex h-full">
      <aside className={clsx("shrink-0 border-r border-border bg-surface flex flex-col transition-[width] duration-200", collapsed ? "w-[64px]" : "w-[236px]")}>
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-border">
          <div className="h-8 min-w-8 px-1.5 rounded-lg bg-accent grid place-items-center text-white shrink-0 font-extrabold text-[11px] tracking-tight leading-none select-none">MCT</div>
          {!collapsed && <div className="font-bold tracking-tight text-[15px] truncate">MYCAREERTRACKER</div>}
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ to, label, icon: I, end }) => (
            <NavLink key={to} to={to} end={end} title={label}
              className={({ isActive }) => clsx("flex items-center gap-3 h-9 rounded-lg px-2.5 text-[13.5px] font-medium transition",
                isActive ? "bg-accent-soft text-accent" : "text-muted hover:text-text hover:bg-surface-2")}>
              <I className="size-[18px] shrink-0" />{!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t border-border space-y-0.5">
          <button onClick={toggle} className="flex items-center gap-3 h-9 w-full rounded-lg px-2.5 text-[13.5px] text-muted hover:text-text hover:bg-surface-2">
            {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}{!collapsed && (dark ? "Light mode" : "Dark mode")}
          </button>
          <button onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-3 h-9 w-full rounded-lg px-2.5 text-[13.5px] text-muted hover:text-text hover:bg-surface-2">
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}{!collapsed && "Collapse"}
          </button>
          {!collapsed && profile && (
            <div className="px-2.5 pt-3 pb-1 text-[12px] text-faint truncate">{profile.personal_info.name} · {profile.target.primary_role}</div>
          )}
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-8 py-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
