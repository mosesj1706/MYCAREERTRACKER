import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/util";
import { clsx } from "clsx";

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={async () => { if (await copyText(text)) { setOk(true); setTimeout(() => setOk(false), 1500); } }}
      className={clsx("inline-flex items-center gap-1 text-[12px] text-muted hover:text-text transition", className)} title="Copy">
      {ok ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}{ok ? "Copied" : "Copy"}
    </button>
  );
}

export function CopyBlock({ text, label }: { text: string; label?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-[12px] font-medium text-muted">{label}</span><CopyButton text={text} />
      </div>
      <div className="px-3 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap">{text}</div>
    </div>
  );
}
