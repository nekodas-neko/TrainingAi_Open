"use client";

import { useEffect, useState } from "react";
import { ChevronRightIcon, MessageSquareIcon, WandSparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatInTimeZone } from "date-fns-tz";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
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
              <div key={c.id} className="flex items-start gap-2.5 py-2.5 border-b border-border/40 last:border-b-0">
                <WandSparklesIcon
                  className="h-3.5 w-3.5 shrink-0 mt-0.5"
                  style={{ color: c.undoneAt ? "var(--muted-foreground)" : "var(--accent-purple)" }}
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] leading-snug ${c.undoneAt ? "line-through text-muted-foreground" : ""}`}>
                    {c.summary}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {formatWhen(c.appliedAt, tz)}
                    {c.undoneAt && " · undone"}
                  </p>
                </div>
              </div>
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
