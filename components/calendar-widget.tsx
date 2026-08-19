"use client";

import { useEffect, useMemo, useState } from "react";
import { useDrag } from "@use-gesture/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn, localDateString, shortSessionName } from "@trainingai/shared/utils";
import { getPaletteEntry } from "@trainingai/shared/session-palette";
import type { ProgramSession } from "@trainingai/shared/types/program";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { readLocalCalendarOverlay, mergeCalendarOverlay, EMPTY_OVERLAY, type CalendarData } from "@/lib/calendar/local-overlay";
import { TTL_LONG, TTL_MEDIUM } from '@trainingai/shared/cache-ttl';

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

// Module-level so the no-program fallback keeps one identity across renders.
const EMPTY_SESSIONS: ProgramSession[] = [];

// Stable color index for sessions not found in the active program (e.g. old ad-hoc entries)
function stableIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

interface CalendarWidgetProps {
  onDayClick?: (date: string, sessions: string[]) => void;
  /** Enables the local-only overlay. Without it the calendar is server-only, as it was before. */
  userId?: string;
}

export function CalendarWidget({ onDayClick, userId }: CalendarWidgetProps) {
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth() + 1);
  const mm = String(viewMonth).padStart(2, '0');

  const meta = useCachedValue<{ program?: { sessions?: ProgramSession[] } }>(
    'workout-data:meta', '/api/workout-data?tab=meta', TTL_LONG,
  );
  const programSessions = meta?.program?.sessions ?? EMPTY_SESSIONS;

  // `settled` is what `loading` always meant here: it was set false on success AND on failure and
  // never set back to true, so it only ever dimmed the first paint. Kept rather than replaced with
  // `data === null`, which would leave the grid dimmed forever after a failed fetch.
  const [settled, setSettled] = useState(false);
  const data = useCachedValue<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }>(
    `calendar-data:${viewYear}-${mm}`,
    `/api/calendar-data?year=${viewYear}&month=${viewMonth}`,
    TTL_MEDIUM,
    { onError: () => setSettled(true) },
  );
  useEffect(() => { if (data) setSettled(true); }, [data]);
  const loading = !settled;

  // Days the device knows about but the server does not yet — an activity or workout saved while
  // offline, or one whose push has not landed. Cached separately from the server payload so a
  // cachedFetch revalidation can't drop it, and merged at render (Q-41 finding 1).
  const [overlay, setOverlay] = useState<CalendarData>(EMPTY_OVERLAY);
  useEffect(() => {
    let cancelled = false;
    readLocalCalendarOverlay(userId, viewYear, viewMonth)
      .then((o) => { if (!cancelled) setOverlay(o); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, viewYear, viewMonth]);

  const merged = useMemo(() => mergeCalendarOverlay(data, overlay), [data, overlay]);

  // name (lowercase) → position from the active program
  const nameToPos = useMemo(
    () => new Map(programSessions.map((s) => [s.name.toLowerCase(), s.position])),
    [programSessions],
  );

  function getDotClass(sessionName: string): string {
    const pos = nameToPos.has(sessionName.toLowerCase())
      ? nameToPos.get(sessionName.toLowerCase())!
      : stableIndex(sessionName);
    return getPaletteEntry(pos).dotClass;
  }

  const goBack = () => {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12); }
    else setViewMonth((m) => m - 1);
  };

  const goForward = () => {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1); }
    else setViewMonth((m) => m + 1);
  };

  const bindMonthSwipe = useDrag(
    ({ movement: [mx], last, velocity: [vx] }) => {
      if (!last) return;
      if (Math.abs(mx) < 60 && vx < 0.5) return;
      if (mx < 0) goForward();
      else goBack();
    },
    { axis: "x", filterTaps: true, pointer: { touch: true } },
  );

  const todayStr = localDateString();
  const firstDayOfWeek = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const startOffset = (firstDayOfWeek + 6) % 7;
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const monthLabel = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Training Calendar
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={goBack}
            className="min-h-0 rounded-md p-1 hover:bg-muted transition"
            aria-label="Previous month"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <span className="text-xs font-medium tabular-nums w-24 text-center">{monthLabel}</span>
          <button
            onClick={goForward}
            className="min-h-0 rounded-md p-1 hover:bg-muted transition"
            aria-label="Next month"
          >
            <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-0.5">
            {d}
          </div>
        ))}
      </div>

      <div
        {...bindMonthSwipe()}
        data-swipe-carousel
        style={{ touchAction: "pan-y" }}
        className={cn("grid grid-cols-7 gap-y-0.5", loading && "opacity-40 pointer-events-none")}
      >
        {Array.from({ length: totalCells }, (_, idx) => {
          const day = idx - startOffset + 1;
          const isValid = day >= 1 && day <= daysInMonth;
          if (!isValid) return <div key={idx} />;

          const dateStr = `${viewYear}/${mm}/${String(day).padStart(2, "0")}`;
          const isToday = dateStr === todayStr;
          const sessions = merged.trainedDays[dateStr] ?? [];
          const hasActivity = (merged.activityDays[dateStr] ?? []).length > 0;
          const isClickable = !!onDayClick;

          const inner = (
            <>
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
                  isToday && "bg-foreground text-background font-bold",
                  !isToday && sessions.length > 0 && "text-foreground",
                  !isToday && sessions.length === 0 && "text-muted-foreground",
                )}
              >
                {day}
              </div>
              <div className="flex gap-0.5 h-1.5 items-center justify-center">
                {sessions.length > 0 || hasActivity
                  ? (
                    <>
                      {sessions.map((s) => (
                        <div key={s} className={cn("h-1 w-1 rounded-full", getDotClass(s))} />
                      ))}
                      {hasActivity && <div className="h-1 w-1 rounded-full bg-cyan-400" />}
                    </>
                  )
                  : data !== null && dateStr <= todayStr
                  ? <span className="text-[7px] font-medium text-muted-foreground/50 leading-none uppercase tracking-wide">rest</span>
                  : null
                }
              </div>
            </>
          );

          if (isClickable) {
            return (
              <button
                key={idx}
                onClick={() => onDayClick(dateStr, sessions)}
                className="flex flex-col items-center py-0.5 rounded-lg hover:bg-muted transition active:scale-95"
              >
                {inner}
              </button>
            );
          }

          return (
            <div key={idx} className="flex flex-col items-center py-0.5">
              {inner}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-border">
        {programSessions.map((s) => (
          <div key={s.id} className="flex items-center gap-1">
            <div className={cn("h-1.5 w-1.5 rounded-full", getPaletteEntry(s.position).dotClass)} />
            <span className="text-[10px] text-muted-foreground truncate max-w-[96px]">{shortSessionName(s.name)}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
          <span className="text-[10px] text-muted-foreground">Activity</span>
        </div>
      </div>
    </div>
  );
}
