import { ShieldCheck, TriangleAlert } from "lucide-react";

export interface Finding { kind: "number" | "licence"; quote: string; detail: string }

/**
 * Authenticity findings for text she will send (app/core/factcheck.py): numbers that are not in her
 * profile or the job ad, and licence claims her tracker does not show as done. Nothing is changed
 * automatically; she fixes the text or confirms it is true.
 */
export function Checks({ checks, clean = true }: { checks?: Finding[]; clean?: boolean }) {
  if (!checks) return null;
  if (checks.length === 0) return clean ? (
    <div className="flex items-center gap-2 text-[12.5px] text-success"><ShieldCheck className="size-4" /> Every number and licence claim matches your profile, the job ad and your licence tracker.</div>
  ) : null;
  return (
    <div className="rounded-[12px] bg-warn-soft px-4 py-3">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold text-warn"><TriangleAlert className="size-4" /> Check before sending</div>
      <ul className="mt-2 space-y-2 text-[13px]">
        {checks.map((c, i) => <li key={i}><span className="italic">“{c.quote}”</span><span className="block text-muted text-[12.5px] mt-0.5">{c.detail}. Fix it, or confirm it's true and add it to your profile.</span></li>)}
      </ul>
    </div>
  );
}
