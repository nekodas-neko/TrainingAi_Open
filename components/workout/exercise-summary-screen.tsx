"use client";

import { useEffect, useState } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import dynamic from "next/dynamic";
import { ChevronRightIcon, TrophyIcon, ArrowUpIcon, ArrowDownIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@trainingai/shared/utils";
import type { ExerciseSummaryData } from "./types";
import { formatTime, formatSetLoad } from "./utils";
import { repMaxFromOneRm, displayOneRmSeries, isBodyweightType, oneRmLabel, oneRmUnit } from "@trainingai/shared/1rm";
import { cachedFetch } from "@/lib/sqlite/cache";
import { EXERCISE_HISTORY_TTL } from '@trainingai/shared/cache-ttl';
import { SessionClock } from "./session-clock";
import { LastSetRestTimer } from "./last-set-rest-timer";
import { hapticSuccess } from "@/lib/haptics";
import { LiveHrChart } from "@/components/workout/live-hr-chart";
import { getLocalStore } from "@/lib/local-store";
import { todayInTz, shiftDateStr } from "@trainingai/shared/date-utils";

const SparklineChart = dynamic(
  () => import("@/components/ui/sparkline-chart").then(m => ({ default: m.SparklineChart })),
  { ssr: false },
);

interface ExerciseSummaryScreenProps {
  summaryData: ExerciseSummaryData;
  workoutStartMs: number | null;
  onNext: () => void;
  userId?: string;
}

export function ExerciseSummaryScreen({ summaryData, workoutStartMs, onNext, userId }: ExerciseSummaryScreenProps) {
  const tz = useUserTimezone();
  const {
    exName,
    setWeights: sw,
    sets: ss,
    reps: sr,
    lapTimes: slt,
    restSec,
    prevEst1rm,
    allTimePr1rm,
    newEst1rm,
    exerciseType,
    nextExercise,
  } = summaryData;

  const [rmHistory, setRmHistory] = useState<number[]>([]);

  useEffect(() => {
    // Local-first seed (SYN-5) before the cachedFetch revalidates.
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      const cutoffStr = shiftDateStr(todayInTz(tz), -90);
      store.getWorkoutHistory(cutoffStr).then(history => {
        const localEntries: Array<{ date: string; estimated1rm: number | null }> = [];
        for (const { exerciseLogs } of history) {
          for (const el of exerciseLogs) {
            if (el.exerciseName !== exName) continue;
            if (el.sets.every(s => s.deletedAt)) continue;
            localEntries.push({ date: el.loggedAt, estimated1rm: el.estimated1rm });
          }
        }
        localEntries.sort((a, b) => a.date.localeCompare(b.date)); // chronological
        const vals = localEntries.map(e => e.estimated1rm).filter((v): v is number => v != null && v > 0);
        if (vals.length > 0) setRmHistory(vals);
      }).catch(() => {});
    }
    cachedFetch<{ entries: Array<{ estimated1rm: number | null }> } | null>(
      `exercise-history:${exName}`, `/api/exercise-history?name=${encodeURIComponent(exName)}`, EXERCISE_HISTORY_TTL,
      d => {
        const entries = d?.entries ?? [];
        const vals = entries
          .map(e => e.estimated1rm)
          .filter((v): v is number => v != null && v > 0)
          .reverse(); // chronological, current session is last
        setRmHistory(vals);
      },
    ).catch(() => {});
  }, [exName, userId, tz]);

  // E1-7: a "New Personal Record!" badge must beat the ALL-TIME PR, not merely last
  // session — an off-day previous session made every recovery day flash a phantom PR
  // the app then never recorded. Gate on the all-time record (fall back to last
  // session only when there's no PR row yet, e.g. a brand-new exercise).
  const prBar = allTimePr1rm ?? prevEst1rm;
  const isNewPR = newEst1rm > 0 && (prBar == null || newEst1rm > prBar + 0.1);

  useEffect(() => {
    if (isNewPR) hapticSuccess();
  }, [exName, isNewPR]);
  const rmDiff = prevEst1rm != null ? newEst1rm - prevEst1rm : null;
  const RmArrowIcon = rmDiff == null ? null : rmDiff > 0.1 ? ArrowUpIcon : rmDiff < -0.1 ? ArrowDownIcon : ArrowRightIcon;
  const rmColor =
    rmDiff == null
      ? ""
      : rmDiff > 0.1
        ? "text-green-600 dark:text-green-400"
        : rmDiff < -0.1
          ? "text-red-500"
          : "text-muted-foreground";

  const isBodyweight = isBodyweightType(exerciseType);
  const prevRepMax = prevEst1rm != null ? repMaxFromOneRm(prevEst1rm) : null;
  const newRepMax = repMaxFromOneRm(newEst1rm);
  const repDiff = prevRepMax != null ? newRepMax - prevRepMax : null;


  return (
    <div className="flex h-full flex-col bg-page">
      <header className="flex items-center gap-3 border-b px-4 pb-2.5 pt-safe">
        <button onClick={onNext} aria-label="Continue to next exercise" className="rounded-lg p-2.5 hover:bg-muted transition">
          <ChevronRightIcon className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold truncate">{exName}</h1>
          {isNewPR ? (
            <div
              className="pr-pulse-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{
                background: "color-mix(in oklch, var(--accent-amber) 15%, transparent)",
                border: "1px solid color-mix(in oklch, var(--accent-amber) 40%, transparent)",
                color: "var(--accent-amber)",
                animation: "pr-pulse 0.8s ease-out both",
              }}
            >
              <TrophyIcon className="w-3 h-3" /> New Personal Record!
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Set summary</p>
          )}
        </div>
        {workoutStartMs != null && (
          <div
            className="flex-none rounded-xl px-2.5 py-1 text-xs font-mono font-bold tabular-nums"
            style={{ background: "color-mix(in oklch, var(--color-brand) 15%, transparent)", color: "var(--color-brand)" }}
          >
            ⏱ <SessionClock startMs={workoutStartMs} />
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2 space-y-2">
        <LastSetRestTimer />
        <LiveHrChart showSetLines className="mb-4" />
        {nextExercise && (
          <div className="rounded-xl bg-muted px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Up Next</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold truncate">{nextExercise.name}</span>
              <span className="text-sm font-semibold tabular-nums text-muted-foreground flex-none">
                {nextExercise.exerciseType === "bodyweight" && nextExercise.startingWeight === 0
                  ? "Bodyweight"
                  : `${nextExercise.startingWeight} kg`}
              </span>
            </div>
          </div>
        )}
        {/* Per-set weights + reps */}
        <div className="rounded-xl bg-muted px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Sets</p>
          {Array.from({ length: ss ?? 0 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 py-1 border-b border-border/30 last:border-0"
            >
              <div
                className="h-5 w-5 flex-none rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{ background: "color-mix(in oklch, var(--color-brand) 20%, transparent)", color: "var(--color-brand)" }}
              >
                {i + 1}
              </div>
              <div className="flex flex-1 items-center justify-between tabular-nums">
                <span className="text-sm font-semibold">
                  {formatSetLoad(sw?.[i] ?? 0, sr?.[i] ?? 0, exerciseType)}
                </span>
                {slt?.[i] != null && (
                  <span className="text-xs text-muted-foreground">{formatTime(slt[i])}</span>
                )}
              </div>
            </div>
          ))}
          {restSec > 0 && (
            <div className="flex items-center justify-between pt-1.5">
              <span className="text-[10px] text-muted-foreground">Total rest</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{formatTime(restSec)}</span>
            </div>
          )}
        </div>

        {/* Estimated 1RM (weighted) / Rep max (bodyweight) comparison */}
        <div className="rounded-xl bg-muted px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {oneRmLabel(exerciseType)}
            </p>
            {isBodyweight
              ? repDiff != null && repDiff !== 0 && (
                  <p className={cn("text-[10px] font-medium", rmColor)}>
                    {repDiff > 0 ? `+${repDiff}` : `${repDiff}`} rep{Math.abs(repDiff) === 1 ? "" : "s"}
                  </p>
                )
              : rmDiff != null && Math.abs(rmDiff) > 0.1 && (
                  <p className={cn("text-[10px] font-medium", rmColor)}>
                    {rmDiff > 0 ? `+${rmDiff.toFixed(2)} kg` : `${rmDiff.toFixed(2)} kg`}
                  </p>
                )}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">Previous</p>
              <p className="text-base font-bold tabular-nums">
                {isBodyweight
                  ? (prevRepMax != null ? `${prevRepMax} RM` : "—")
                  : (prevEst1rm != null ? `${prevEst1rm} kg` : "—")}
              </p>
            </div>
            {RmArrowIcon && <RmArrowIcon className={cn("h-5 w-5", rmColor)} />}
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">This session</p>
              <p className={cn("text-base font-bold tabular-nums", rmColor)}>
                {isBodyweight ? `${newRepMax} RM` : `${newEst1rm} kg`}
              </p>
            </div>
          </div>
          {rmDiff != null && Math.abs(rmDiff) <= 0.1 && (
            <p className="text-[10px] text-center text-muted-foreground mt-1">Consistent — solid work</p>
          )}
          {rmHistory.length >= 2 && (
            <div className="mt-2">
              <SparklineChart values={displayOneRmSeries(rmHistory, exerciseType)} unit={oneRmUnit(exerciseType)} height={48} />
            </div>
          )}
        </div>

      </div>

      <div className="border-t px-4 pt-3 pb-safe-action-lg">
        <Button
          className="w-full h-12 text-base font-semibold bg-brand hover:opacity-90 text-brand-foreground"
          onClick={onNext}
        >
          Next Exercise →
        </Button>
      </div>
    </div>
  );
}
