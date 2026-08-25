"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRightIcon, MessageSquareIcon, WandSparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatInTimeZone } from "date-fns-tz";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import {
  invalidateCoachHistory,
  invalidateProgramStructure,
  invalidateGoalRecommendations,
} from "@/lib/cache-groups";
import { COACH_HISTORY_TTL } from "@trainingai/shared/cache-ttl";

interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}
interface AppliedChange {
  id: string;
  summary: string;
  appliedAt: string;
  undoneAt: string | null;
}
interface CoachHistoryPayload {
  threads?: ThreadSummary[];
  changes?: AppliedChange[];
}

const COACH_HISTORY_KEY = "coach-history";

interface CoachHistoryProps {
  onOpenThread: (threadId: string) => void;
  onNewConversation: () => void;
  /** The user's timezone, threaded from the session — never the device's. */
  tz: string;
}

/**
 * Two halves with very different costs, deliberately shown as one list.
 *
 * **Applied changes** are the half worth having: the rows already exist because Apply wrote them,
 * so listing them is one query and no new storage, and they answer "when did I change that, and
 * why" — which nothing else in the app can. **Conversations** are the expensive half (a table, rows
 * that grow with use) and are capped at 30 days. If storage ever bites, the bottom half can go and
 * the top half still earns its place.
 */
export function CoachHistory({ onOpenThread, onNewConversation, tz }: CoachHistoryProps) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  /** Per-change refusal text. The 409 "you've trained since" is the route's normal answer, not a
   *  fault — it is the window closing — so it reads as a state on the row rather than an error. */
  const [refusal, setRefusal] = useState<Record<string, string>>({});
  const inFlight = useRef(false);

  const undo = useCallback(async (id: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setUndoing(id);
    setRefusal(r => (id in r ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== id)) : r));
    try {
      const res = await fetch(`/api/coach/apply/${id}/undo`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefusal(r => ({ ...r, [id]: data.error ?? "Could not undo this change" }));
        return;
      }
      // The row re-styles itself struck-through the moment this lands, which is the feedback.
      setChanges(cs => cs.map(c => (c.id === id ? { ...c, undoneAt: new Date().toISOString() } : c)));
      // **The route's own `invalidateProgramStructure()` runs on the SERVER, where `lib/cache-groups`
      // reaches localStorage/sessionStorage and the on-device SQLite cache — i.e. nothing.** Without
      // these three the programme the undo just restored keeps painting from cache for a full TTL,
      // which is this repo's most-repeated bug class. Undo is rare and does not know which of the
      // five domains it reversed (the history payload carries only a summary), so it clears the
      // superset: the cost is a refetch, and the alternative is stale training data.
      await Promise.all([
        invalidateProgramStructure(),
        invalidateGoalRecommendations(),
        invalidateCoachHistory(),
      ]).catch(() => {});
    } catch {
      setRefusal(r => ({ ...r, [id]: "Could not reach the server" }));
    } finally {
      inFlight.current = false;
      setUndoing(null);
    }
  }, []);

  // Seeded before paint (in an effect, never a useState initializer — a cache read there causes
  // hydration drift): opening history used to blank the list and re-query on every visit, and the
  // rows only move when a conversation is saved or a change applied, both of which invalidate.
  useEffect(() => {
    const seed = readCacheSync<CoachHistoryPayload>(COACH_HISTORY_KEY);
    if (seed) {
      setThreads(seed.threads ?? []);
      setChanges(seed.changes ?? []);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    cachedFetch<CoachHistoryPayload>(
      COACH_HISTORY_KEY, "/api/coach/threads", COACH_HISTORY_TTL,
      data => {
        if (cancelled || !data) return;
        setThreads(data.threads ?? []);
        setChanges(data.changes ?? []);
      },
    )
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-5 px-4 pt-2">
      {changes.length > 0 && (
        <section>
          <h2 className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Changes you&apos;ve made
          </h2>
          <div className="flex flex-col">
            {changes.map(c => (
              <ChangeRow
                key={c.id}
                id={c.id}
                summary={c.summary}
                when={formatWhen(c.appliedAt, tz)}
                undone={c.undoneAt != null}
                busy={undoing === c.id}
                refusal={refusal[c.id] ?? null}
                onUndo={undo}
              />
            ))}
          </div>
        </section>
      )}

      {threads.length > 0 && (
        <section>
          <h2 className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Recent conversations
          </h2>
          <div className="flex flex-col">
            {threads.map(t => (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenThread(t.id)}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenThread(t.id);
                  }
                }}
                className="flex items-center gap-2.5 py-3 border-b border-border/40 last:border-b-0 min-h-[56px] cursor-pointer active:bg-muted/40"
              >
                <MessageSquareIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{t.title || "Untitled"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatWhen(t.updatedAt, tz)} · {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                  </p>
                </div>
                <ChevronRightIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            ))}
          </div>
        </section>
      )}

      {loaded && threads.length === 0 && changes.length === 0 && (
        <p className="text-[13px] text-muted-foreground py-6 text-center">Nothing here yet.</p>
      )}

      <Button className="w-full h-12" onClick={onNewConversation}>
        New conversation
      </Button>
    </div>
  );
}

/** `toLocale*String` without an explicit `timeZone` renders in the DEVICE's zone, not the user's —
 *  invisible while the phone sits in the zone the data was recorded in, wrong the moment it does
 *  not. `formatInTimeZone` is the same call with the decision made explicitly. */
function formatWhen(iso: string, tz: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return formatInTimeZone(then, tz, "d MMM");
}

/**
 * One applied change, with the Undo the route has always supported and nothing ever called (Q-467).
 *
 * The whole undo subsystem shipped built and unreachable: an auth-gated, ownership-scoped
 * `POST /api/coach/apply/[id]/undo`, an `undo()` handler in all five domains, a `captureBefore()`
 * in each that exists only for it, the `undoneAt` column — and this list already styled a row
 * struck-through for a state the user had no way to reach. The only way back was to ask the Coach
 * to change it again, which is a *new* change against current state rather than a restore, and for
 * `early_deload` or `program_phase` may not be expressible at all.
 *
 * **The 409 is a state, not an error.** The window is "until the next workout started after the
 * change" — once a session has been shaped by it, reversing would silently disagree with training
 * already done. So a refusal replaces the button with its own sentence instead of toasting a
 * failure: the user has not done anything wrong, and there is nothing to retry.
 *
 * Its own component so the memoised row takes scalars from inside `.map()`, where a hook cannot
 * live and an inline arrow would defeat `React.memo` silently (Q-490).
 */
const ChangeRow = memo(function ChangeRow({
  id, summary, when, undone, busy, refusal, onUndo,
}: {
  id: string;
  summary: string;
  when: string;
  undone: boolean;
  busy: boolean;
  refusal: string | null;
  onUndo: (id: string) => void;
}) {
  const press = useCallback(() => onUndo(id), [id, onUndo]);
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-border/40 last:border-b-0">
      <WandSparklesIcon
        className="h-3.5 w-3.5 shrink-0 mt-0.5"
        style={{ color: undone ? "var(--muted-foreground)" : "var(--accent-purple)" }}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] leading-snug ${undone ? "line-through text-muted-foreground" : ""}`}>
          {summary}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {when}
          {undone && " · undone"}
        </p>
        {refusal && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{refusal}</p>}
      </div>
      {!undone && !refusal && (
        <Button
          variant="ghost"
          onClick={press}
          disabled={busy}
          aria-label={`Undo: ${summary}`}
          className="shrink-0 h-9 px-2.5 text-[11px] font-semibold text-muted-foreground"
        >
          {busy ? "Undoing…" : "Undo"}
        </Button>
      )}
    </div>
  );
});

