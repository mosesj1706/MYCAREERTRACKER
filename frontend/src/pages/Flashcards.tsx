import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { CheckCircle2, EyeOff, Info, Layers, RotateCcw } from "lucide-react";
import { api, type Flashcard, type FlashcardSummary } from "../lib/api";
import { Badge, Button, Card, Empty, Progress, Segmented, Select, Skeleton } from "../components/ui";
import { useToast } from "../components/Toast";

/**
 * Revision flashcards (OT): pick a deck and topic, flip each card, then say whether you knew it. Known cards come
 * back after longer gaps; missed ones come back at the end of the round and again tomorrow.
 */
export default function Flashcards() {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["flashcards"], queryFn: () => api.get<FlashcardSummary>("/api/flashcards") });
  const [deck, setDeck] = useState("");
  const [topic, setTopic] = useState("");
  const [n, setN] = useState(20);
  const [round, setRound] = useState<Flashcard[] | null>(null);
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api.get<Flashcard[]>(`/api/flashcards/next?n=${n}${deck ? `&deck=${encodeURIComponent(deck)}` : ""}${topic ? `&topic=${encodeURIComponent(topic)}` : ""}`),
    onSuccess: (cards) => cards.length ? setRound(cards) : toast("info", "Nothing due here today. Pick another deck or topic."),
    onError: (e) => toast("error", (e as Error).message),
  });
  const s = summary.data;

  if (round) return <Round cards={round} onExit={() => { setRound(null); qc.invalidateQueries({ queryKey: ["flashcards"] }); }} />;
  if (summary.isLoading) return <Skeleton className="h-48" />;
  if (!s || s.decks.length === 0) return <Empty icon={<Layers />} title="No flashcards yet" body="Decks you add show up here for daily revision." />;

  const pick = s.decks.filter((d) => !deck || d.deck === deck);
  const due = pick.reduce((a, d) => a + d.due, 0), fresh = pick.reduce((a, d) => a + d.new, 0);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={deck} onChange={setDeck} options={[{ value: "", label: "All decks" }, ...s.decks.map((d) => ({ value: d.deck, label: d.deck }))]} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={topic} onChange={(e) => setTopic(e.target.value)} className="w-auto min-w-[220px]">
            <option value="">All topics</option>
            {s.topics.map((t) => <option key={t.topic} value={t.topic}>{t.topic} · {t.total}</option>)}
          </Select>
          <Select value={n} onChange={(e) => setN(Number(e.target.value))} className="w-auto">{[10, 20, 40].map((x) => <option key={x} value={x}>{x} cards</option>)}</Select>
          <Button variant="primary" size="lg" loading={start.isPending} onClick={() => start.mutate()}><Layers className="size-4" /> Start</Button>
        </div>
        <p className="text-[13px] text-muted">{due > 0 ? `${due} card${due === 1 ? "" : "s"} due for review, then new ones.` : `${fresh} new card${fresh === 1 ? "" : "s"} to learn; nothing due for review yet.`}</p>
        <p className="text-[12px] text-muted flex gap-1.5"><Info className="size-3.5 shrink-0 mt-0.5" />Imported revision notes, not checked line by line. If a card is wrong or out of date, hide it, and check anything surprising in your textbook.</p>
      </Card>
      <Card>
        <div className="px-5 pt-4 pb-1 font-semibold text-[15px]">Your decks</div>
        <div className="px-3 pb-3 space-y-1">{s.decks.map((d) => (
          <div key={d.deck} className="rounded-[10px] px-2 py-2.5">
            <div className="flex items-center justify-between gap-2"><div className="text-[13.5px] font-medium">{d.deck}</div>{d.due > 0 && <Badge tone="accent">{d.due} due</Badge>}</div>
            <Progress value={(100 * d.known) / Math.max(1, d.total)} tone="success" className="mt-2" />
            <div className="text-[12px] text-muted mt-1">{d.known} known · {d.total - d.new} seen · {d.total} cards</div>
          </div>
        ))}</div>
        {s.hidden > 0 && <p className="px-5 pb-4 text-[12px] text-muted">{s.hidden} hidden card{s.hidden === 1 ? "" : "s"}.</p>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- a round of cards
function Round({ cards, onExit }: { cards: Flashcard[]; onExit: () => void }) {
  const toast = useToast();
  const [queue, setQueue] = useState(cards);
  const [shown, setShown] = useState(false);
  const [knew, setKnew] = useState(0);
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const card = queue[0];
  const done = cards.length - new Set(queue.map((c) => c.id)).size;

  const next = (rest: Flashcard[]) => { setQueue(rest); setShown(false); };
  const answer = (k: boolean) => {
    api.post(`/api/flashcards/${card.id}/grade`, { knew: k }).catch((e) => toast("error", (e as Error).message));
    if (k) { if (!missed.has(card.id)) setKnew((x) => x + 1); next(queue.slice(1)); }
    else { setMissed((m) => new Set(m).add(card.id)); next([...queue.slice(1), card]); }  // missed: once more at the end
  };
  const hide = () => {
    api.post(`/api/flashcards/${card.id}/hide`, { hidden: true }).then(() => toast("info", "Card hidden.")).catch((e) => toast("error", (e as Error).message));
    next(queue.filter((c) => c.id !== card.id));
  };

  if (!card) return (
    <Card className="p-8 text-center max-w-[520px] mx-auto">
      <CheckCircle2 className="size-10 text-success mx-auto" />
      <div className="text-[20px] font-semibold mt-3">Round done</div>
      <div className="text-[14px] text-muted mt-1">Knew {knew} of {cards.length} first time{missed.size ? ` · ${missed.size} to see again tomorrow` : ""}.</div>
      <Button variant="primary" size="lg" className="mt-5" onClick={onExit}>Back to decks</Button>
    </Card>
  );
  return (
    <div className="max-w-[680px] mx-auto space-y-3">
      <div className="flex items-center gap-3">
        <Progress value={(100 * done) / cards.length} className="flex-1" />
        <span className="text-[13px] text-muted rounded-num">{done}/{cards.length}</span>
        <Button size="sm" variant="ghost" onClick={onExit}>End</Button>
      </div>
      <Card className={clsx("p-6 min-h-[300px] flex flex-col", !shown && "cursor-pointer")} onClick={() => !shown && setShown(true)}>
        <div className="flex items-center gap-2 text-[12px] text-muted"><span>{card.topic}</span><span className="text-faint">·</span><span>{card.deck}</span>{missed.has(card.id) && <Badge tone="warn">again</Badge>}</div>
        <div className="text-[19px] font-semibold leading-snug mt-3">{card.front}</div>
        {shown ? <div className="mt-5 pt-4 border-t border-border text-[15.5px] leading-relaxed whitespace-pre-line">{card.back}</div>
          : <div className="mt-auto pt-6 text-center text-[13.5px] text-accent">Tap to show the answer</div>}
      </Card>
      {shown && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="danger" size="lg" onClick={() => answer(false)}><RotateCcw className="size-4" /> Again</Button>
          <Button variant="primary" size="lg" onClick={() => answer(true)}><CheckCircle2 className="size-4" /> Knew it</Button>
        </div>
      )}
      <div className="text-center"><button onClick={hide} className="text-[12.5px] text-muted hover:text-text inline-flex items-center gap-1"><EyeOff className="size-3.5" /> Hide this card (wrong or out of date)</button></div>
    </div>
  );
}
