import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const Ctx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

/** Notifications as an iOS-style banner: a translucent capsule that drops in at the top. Tap to dismiss. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 w-[min(440px,calc(100vw-24px))] pointer-events-none" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => { const I = Icon[t.kind]; return (
            <motion.button key={t.id} layout initial={{ opacity: 0, y: -24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 500, damping: 36 }}
              onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
              className="pointer-events-auto max-w-full rounded-[22px] px-4 py-2.5 flex items-center gap-2.5 text-[14px] font-medium text-left shadow-[var(--shadow-lg)] border border-border/60"
              style={{ background: "var(--hud)", backdropFilter: "saturate(180%) blur(24px)", WebkitBackdropFilter: "saturate(180%) blur(24px)" }}>
              <I className={"size-[18px] shrink-0 " + (t.kind === "success" ? "text-[var(--switch-on)]" : t.kind === "error" ? "text-danger" : "text-accent")} />
              <span className="min-w-0">{t.text}</span>
            </motion.button>
          ); })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
