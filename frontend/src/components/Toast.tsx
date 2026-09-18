import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const Ctx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-[360px]">
        <AnimatePresence>
          {items.map((t) => { const I = Icon[t.kind]; return (
            <motion.div key={t.id} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
              className="card px-4 py-3 flex items-start gap-3 text-sm">
              <I className={"size-4 mt-0.5 shrink-0 " + (t.kind === "success" ? "text-success" : t.kind === "error" ? "text-danger" : "text-accent")} />
              <div className="flex-1">{t.text}</div>
              <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-faint hover:text-text"><X className="size-4" /></button>
            </motion.div>
          ); })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
