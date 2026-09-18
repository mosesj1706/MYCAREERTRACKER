import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function Drawer({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
          <motion.aside initial={{ x: width }} animate={{ x: 0 }} exit={{ x: width }} transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed right-0 top-0 bottom-0 z-50 bg-surface border-l border-border shadow-2xl flex flex-col" style={{ width }}>
            <div className="h-14 px-5 flex items-center justify-between border-b border-border shrink-0">
              <div className="font-semibold truncate">{title}</div>
              <button onClick={onClose} className="text-muted hover:text-text"><X className="size-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
