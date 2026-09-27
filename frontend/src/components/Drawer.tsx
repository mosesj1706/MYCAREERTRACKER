import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

// A close we triggered ourselves (history.back after an in-app close) must not be read as the user
// pressing Back on the next sheet. Module-level so it survives StrictMode's double effects in dev.
let skipNextPop = false;

/**
 * An iPad-style form sheet: centred and rounded on wide screens, a bottom sheet on phones. Opening it
 * adds a history entry, so the browser Back button or swipe-back closes the sheet instead of leaving
 * the page. Escape and tapping outside close it too. (Named Drawer for its callers' sake.)
 */
export function Drawer({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ ...(window.history.state ?? {}), sheet: true }, "");
    let poppedByUser = false;
    const onPop = () => {
      if (skipNextPop) { skipNextPop = false; return; }
      poppedByUser = true;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      if (!poppedByUser && window.history.state?.sheet) { skipNextPop = true; window.history.back(); }
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            onClick={onClose} className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60" />
          <motion.div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
            initial={{ opacity: 0, y: 48 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 48 }} transition={{ type: "spring", stiffness: 420, damping: 38 }}
            className="fixed z-50 flex flex-col bg-surface shadow-[var(--shadow-lg)] inset-x-0 bottom-0 h-[94dvh] rounded-t-[18px] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:h-auto sm:max-h-[88dvh] sm:rounded-[18px]"
            style={{ width: `min(${width}px, 100vw)` }}>
            <div className="h-14 px-4 grid grid-cols-[40px_1fr_40px] items-center border-b border-border shrink-0">
              <span />
              <div className="text-[17px] font-semibold text-center truncate">{title}</div>
              <button onClick={onClose} aria-label="Close" className="justify-self-end size-[30px] rounded-full bg-fill text-muted grid place-items-center hover:brightness-95 active:opacity-60">
                <X className="size-4" strokeWidth={2.6} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-5 sm:max-h-[calc(88dvh-56px)]">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
