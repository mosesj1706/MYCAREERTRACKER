import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { Button, Skeleton } from "./ui";
import { CopyBlock } from "./Copy";
import { Drawer } from "./Drawer";
import { useToast } from "./Toast";

interface Section { section: string; label: string; fields: string; text: string }
interface Out { sections: Section[]; copy?: { headline: string; about: string } }

/** Copy-paste-ready LinkedIn text built from the profile. Sections are deterministic; headline + About are model-written on demand. */
export default function LinkedInDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["linkedin"], queryFn: () => api.get<Out>("/api/profile/linkedin"), enabled: open });
  const [copy, setCopy] = useState<Out["copy"] | null>(null);
  const [writing, setWriting] = useState(false);
  const write = async () => {
    setWriting(true);
    try { setCopy((await api.get<Out>("/api/profile/linkedin?write=true")).copy ?? null); }
    catch (e) { toast("error", (e as Error).message); }
    setWriting(false);
  };
  const groups = ["Experience", "Projects", "Skills"];
  return (
    <Drawer open={open} onClose={onClose} title="LinkedIn — what to paste" width={640}>
      <div className="space-y-5">
        <p className="text-[13px] text-muted">Built from the profile, so it says only what the evidence supports. Paste each block into the matching LinkedIn field. Regenerate any time the profile changes.</p>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><h3 className="text-[13px] font-semibold">Headline & About</h3>
            <Button size="sm" variant="primary" loading={writing} onClick={write}><Sparkles className="size-3.5" /> {copy ? "Rewrite" : "Write with the model"}</Button></div>
          {copy ? <>
            <CopyBlock label={`Headline · ${copy.headline.length}/220`} text={copy.headline} />
            <CopyBlock label={`About · ${copy.about.length}/2600`} text={copy.about} />
          </> : <p className="text-[12.5px] text-faint">One model call; written for your target role from the profile only.</p>}
        </div>
        {q.isLoading && <Skeleton className="h-40" />}
        {groups.map((g) => {
          const items = q.data?.sections.filter((s) => s.section === g) ?? [];
          return items.length ? (
            <div key={g} className="space-y-2">
              <h3 className="text-[13px] font-semibold">{g}</h3>
              {items.map((s, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="text-[12px] text-muted whitespace-pre-wrap num">{s.fields}</div>
                  <CopyBlock label={`${s.label} · ${s.text.length} chars`} text={s.text} />
                </div>
              ))}
            </div>
          ) : null;
        })}
      </div>
    </Drawer>
  );
}
