"use client";

import { useEffect, useState } from "react";
import { TimerIcon } from "lucide-react";
import { formatTime } from "./utils";
import type { SessionTimingResponse, ExerciseTiming } from "@/app/api/workout-sessions/[id]/timing/route";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { WORKOUT_TIMING_TTL } from "@trainingai/shared/cache-ttl";

// "25 min" / "1m 30s" for headline totals; bars use formatTime (M:SS).
function fmtMin(sec: number): string {
  const m = sec / 60;
  if (m >= 10) return `${Math.round(m)} min`;
  const mm = Math.floor(sec / 60);
  const ss = Math.round(sec % 60);
  return ss === 0 ? `${mm} min` : `${mm}m ${ss}s`;
}

/**
 * End-of-workout time summary: how your actual setup (bar-load), set-work and rest time compared
 * to what the session was planned around, per exercise and overall. The headline is the rest
 * budget — resting well over plan is the single biggest, most fixable source of session bloat.
 */
export function TimeSummaryCard({ workoutSessionId }: { workoutSessionId: string }) {
  const [data, setData] = useState<SessionTimingResponse | null>(null);
  const [failed, setFailed] = useState(false);

  // Seeded from cache for instant paint, then revalidated. A completed session's timing
  // never changes, so a revisit shows the breakdown immediately instead of a blank card
  // while the request runs (the done screen fires several at once, right as
  // complete-workout is still doing HR sync and the next prescription's regeneration).
  // Seeded in an effect, never a useState initializer — a cache read during render is a
  // hydration mismatch (session 165).
  useEffect(() => {
    let cancelled = false;
    const key = `workout-timing:${workoutSessionId}`;
    const seed = readCacheSync<SessionTimingResponse>(key);
    if (seed) setData(seed);
    cachedFetch<SessionTimingResponse>(
      key, `/api/workout-sessions/${workoutSessionId}/timing`, WORKOUT_TIMING_TTL,
      (d) => { if (!cancelled) setData(d); },
      { onError: () => { if (!cancelled && !seed) setFailed(true); } },
    ).catch(() => { if (!cancelled && !seed) setFailed(true); });
    return () => { cancelled = true; };
  }, [workoutSessionId]);

  // No timing recorded (an older session, or logged without the set/rest timers) — say nothing.
  if (failed || (data && !data.hasData)) return null;

  const restActual = data?.totals.restActualSec ?? null;
  const restExpected = data?.totals.restExpectedSec ?? 0;
  const restDiff = restActual != null ? restActual - restExpected : null;

  return (
    <div className="w-full max-w-xs rounded-2xl bg-muted/40 border border-border p-4 space-y-3 text-left">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <TimerIcon className="h-3.5 w-3.5" />
        Time summary
      </p>

      {!data ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted/60" />
      ) : (
        <>
          {/* Rest-budget headline */}
          {restActual != null && restExpected > 0 && (
            <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">Rest this session</p>
              <div className="flex items-end justify-between gap-3">
                <span className="text-base font-bold tabular-nums" style={{ color: restDiff != null && restDiff > 60 ? "var(--accent-amber, #f59e0b)" : "var(--color-brand)" }}>
                  {fmtMin(restActual)}
                  <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">actual</span>
                </span>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                  {fmtMin(restExpected)}
                  <span className="ml-1 text-[10px] font-medium uppercase tracking-wide">planned</span>
                </span>
              </div>
              <TimeBar actualSec={restActual} expectedSec={restExpected} kind="rest" />
              {restDiff != null && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {restDiff > 60
                    ? `You rested about ${fmtMin(restDiff)} longer than planned. Tightening rest toward the target keeps you in the zone and trims the session.`
                    : restDiff < -60
                      ? `You kept rest ${fmtMin(-restDiff)} tighter than planned — great density, just make sure heavy sets still feel recovered.`
                      : `Your rest was right on target — nicely paced.`}
                </p>
              )}
            </div>
          )}

          {/* Per-exercise setup / work / rest */}
          <div className="space-y-3">
            {data.exercises.map((ex, i) => (
              <ExerciseRow key={`${ex.name}-${i}`} ex={ex} />
            ))}
          </div>

          {/* What "planned" means for each row */}
          <div className="border-t border-border/50 pt-2 space-y-0.5">
            <p className="text-[9px] leading-snug text-muted-foreground/70">
              <b className="text-muted-foreground">Planned rest</b> = {data.sources.rest}.
            </p>
            <p className="text-[9px] leading-snug text-muted-foreground/70">
              <b className="text-muted-foreground">Planned setup</b> = {data.sources.setup}; <b className="text-muted-foreground">planned work</b> = {data.sources.work}.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function ExerciseRow({ ex }: { ex: ExerciseTiming }) {
  const rows: Array<{ label: string; actual: number; expected: number; kind: "setup" | "work" | "rest" }> = [];
  if (ex.setupActualSec != null) rows.push({ label: "Setup", actual: ex.setupActualSec, expected: ex.setupExpectedSec, kind: "setup" });
  if (ex.workActualSec != null) rows.push({ label: "Work", actual: ex.workActualSec, expected: ex.workExpectedSec, kind: "work" });
  if (ex.restActualSec != null && ex.restExpectedSec > 0) rows.push({ label: "Rest", actual: ex.restActualSec, expected: ex.restExpectedSec, kind: "rest" });
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground truncate">{ex.name}</p>
      {rows.map(r => <LabelledBar key={r.label} {...r} />)}
    </div>
  );
}

function LabelledBar({ label, actual, expected, kind }: { label: string; actual: number; expected: number; kind: "setup" | "work" | "rest" }) {
  const over = actual > expected * 1.05;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="w-12 flex-none uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold" style={{ color: over ? (kind === "rest" ? "var(--accent-amber, #f59e0b)" : "#0ea5e9") : "var(--color-brand)" }}>{formatTime(actual)}</span>
          <span className="text-muted-foreground"> actual · {formatTime(expected)} planned</span>
        </span>
      </div>
      <div className="mt-1">
        <TimeBar actualSec={actual} expectedSec={expected} kind={kind} />
      </div>
    </div>
  );
}

// A track with the planned time marked by a tick and the actual time drawn as a fill. Over-target
// rest is amber (fixable bloat); over-target work/setup is sky (took longer — often heavier/grindier
// or a slow station); at-or-under target is the brand colour.
function TimeBar({ actualSec, expectedSec, kind }: { actualSec: number; expectedSec: number; kind: "setup" | "work" | "rest" }) {
  const scaleMax = Math.max(actualSec, expectedSec, 1) * 1.12;
  const actualPct = Math.min(100, (actualSec / scaleMax) * 100);
  const expectedPct = Math.min(100, (expectedSec / scaleMax) * 100);
  const over = actualSec > expectedSec * 1.05;
  const fill = over ? (kind === "rest" ? "var(--accent-amber, #f59e0b)" : "#0ea5e9") : "var(--color-brand)";
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted/60">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${actualPct}%`, background: fill }} />
      {/* planned-time target tick */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/55" style={{ left: `calc(${expectedPct}% - 1px)` }} aria-hidden />
    </div>
  );
}
