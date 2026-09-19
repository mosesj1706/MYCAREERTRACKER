import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, GitBranch, RefreshCw } from "lucide-react";
import { api, type GitHubStatus, type GitHubSyncResult } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input } from "./ui";
import { useToast } from "./Toast";

const PROF_LABEL: Record<string, string> = { learning: "Learning", familiar: "Familiar", hands_on: "Hands-on", expert: "Expert" };

/** Connects a GitHub account: pulls repos, asks the model what they prove, adds that as skill evidence. */
export default function GitHubCard() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ["github"], queryFn: () => api.get<GitHubStatus>("/api/github") });
  const [username, setUsername] = useState("");
  useEffect(() => { if (q.data?.username && !username) setUsername(q.data.username); }, [q.data?.username, username]);
  const [changes, setChanges] = useState<GitHubSyncResult["changes"] | null>(null);
  const sync = useMutation({
    mutationFn: () => api.post<GitHubSyncResult>("/api/github/sync", { username }),
    onSuccess: (r) => {
      qc.setQueryData(["github"], { username: r.snapshot.username, snapshot: r.snapshot });
      qc.setQueryData(["profile"], r.profile); qc.invalidateQueries({ queryKey: ["applications"] });
      setChanges(r.changes);
      toast("success", r.changes.length ? `Profile updated — ${r.changes.length} skill${r.changes.length === 1 ? "" : "s"} changed.` : "Synced. No proficiency changes.");
    },
    onError: (e) => toast("error", (e as Error).message),
  });
  const snap = q.data?.snapshot;
  const withCode = snap?.repos.filter((r) => r.has_code) ?? [];
  const empty = snap?.repos.filter((r) => !r.has_code) ?? [];

  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><GitBranch className="size-4" />GitHub</span>}
        subtitle={snap ? `Synced ${snap.fetched_at.slice(0, 10)} · ${withCode.length} repos with code` : "Turn shipped code into skill evidence"} />
      <div className="px-5 pb-5 space-y-3">
        <div className="flex gap-2">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="GitHub username" className="flex-1" />
          <Button variant="primary" loading={sync.isPending} disabled={!username.trim()} onClick={() => sync.mutate()}>
            <RefreshCw className="size-4" /> {sync.isPending ? "Reading repos…" : snap ? "Re-sync" : "Connect"}
          </Button>
        </div>
        <p className="text-[12px] text-muted">Public repos need no login. Proficiency only goes up (max hands-on) and only where the code shows the skill. Forks and empty repos are ignored. Add <code>GITHUB_TOKEN</code> to <code>.env</code> to include private repos.</p>
        {changes && changes.length > 0 && (
          <div className="rounded-lg border border-border bg-surface-2 p-3 text-[12.5px]">
            <div className="font-medium mb-1">Changed this sync</div>
            <ul className="space-y-0.5">{changes.map((c) => <li key={c.skill} className="text-muted"><span className="text-text">{c.skill}</span> · {c.from ? `${PROF_LABEL[c.from]} → ` : "new · "}{PROF_LABEL[c.to]}</li>)}</ul>
          </div>
        )}
        {snap && (
          <ul className="space-y-2">
            {withCode.map((r) => (
              <li key={r.full_name} className="text-[13px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 min-w-0"><a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline truncate">{r.name}</a>{r.private && <Badge>private</Badge>}</span>
                  <span className="num text-[11.5px] text-faint shrink-0">{r.commits ?? "?"} commits · {r.pushed_at.slice(0, 10)}</span>
                </div>
                {r.description && <div className="text-[12.5px] text-muted line-clamp-2">{r.description}</div>}
                <div className="flex flex-wrap gap-1 mt-1">{Object.keys(r.languages).slice(0, 4).map((l) => <Badge key={l}>{l}</Badge>)}</div>
              </li>
            ))}
            {empty.length > 0 && <li className="text-[12px] text-faint">Skipped (no code): {empty.map((r) => r.name).join(", ")}</li>}
          </ul>
        )}
        {snap && snap.notes.length > 0 && (
          <div>
            <div className="text-[11.5px] uppercase tracking-wider text-faint mb-1.5">What a recruiter sees here</div>
            <ul className="space-y-2">{snap.notes.map((n, i) => <li key={i} className="flex gap-2 text-[12.5px] text-muted"><Flag className="size-3.5 mt-0.5 shrink-0 text-warn" />{n}</li>)}</ul>
          </div>
        )}
      </div>
    </Card>
  );
}
