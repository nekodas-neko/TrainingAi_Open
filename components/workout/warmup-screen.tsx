"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronLeftIcon, DumbbellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { MuscleHeatmap, type MuscleActivation } from "@/components/muscle-heatmap";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import { formatTime } from "./utils";
import { useElapsedSec } from "./session-clock";

// Fallback only — used until the session's budget is known (`workout-data` has not landed yet).
// The real goal is computed from the session budget by `warmupGoalSecFor` in workout-screen.tsx,
// which is the same `warmupBudgetMin()` the planner already trims the exercise list against.
// It was a flat 600 for every session, which is what made a 30-minute Quick session still show a
// 10-minute warm-up (Q-212).
export const WARMUP_GOAL_SEC_FALLBACK = 600; // 10 minutes

interface WarmupScreenProps {
  sessionType: string;
  exercises: WorkoutExercise[];
  workoutStartMs: number | null;
  /** Seconds of warm-up this session is budgeted, scaled to its length. */
  warmupGoalSec: number;
  onBeginExercises: () => void;
  onBack: () => void;
}

export function WarmupScreen({ sessionType, exercises, workoutStartMs, warmupGoalSec, onBeginExercises, onBack }: WarmupScreenProps) {
  const sessionElapsedSec = useElapsedSec(workoutStartMs);
  const [exerciseMedia, setExerciseMedia] = useState<Record<string, { gif: string | null; img: string | null }>>({});
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || exercises.length === 0) return;
    fetchedRef.current = true;
    Promise.all(
      exercises.map(ex =>
        fetch(`/api/exercise-gif?name=${encodeURIComponent(ex.name)}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            // Prefetch binaries so the service worker caches them for offline use
            if (d?.gifUrl) fetch(d.gifUrl).catch(() => null);
            if (d?.imageUrl) fetch(d.imageUrl).catch(() => null);
            return [ex.name, { gif: d?.gifUrl ?? null, img: d?.imageUrl ?? null }] as [string, { gif: string | null; img: string | null }];
          })
          .catch(() => [ex.name, { gif: null, img: null }] as [string, { gif: string | null; img: string | null }])
      )
    ).then(pairs => {
      setExerciseMedia(Object.fromEntries(pairs));
    });
  }, [exercises]);

  // Stable identity so the memoized MuscleHeatmap doesn't re-render on every 1Hz
  // session-clock tick (PERF-2) — this array previously was rebuilt fresh each render.
  const { assignments, primaryMuscles } = useMemo(() => {
    const muscleMap = new Map<string, "main" | "secondary">();
    for (const ex of exercises) {
      for (const m of ex.mainMuscles ?? []) muscleMap.set(m, "main");
      for (const m of ex.secondaryMuscles ?? []) {
        if (!muscleMap.has(m)) muscleMap.set(m, "secondary");
      }
    }
    return {
      assignments: [...muscleMap.entries()].map(([muscle, role]) => ({ muscle, role })) as MuscleActivation[],
      primaryMuscles: [...muscleMap.entries()].filter(([, r]) => r === "main").map(([m]) => m),
    };
  }, [exercises]);

  const warmupProgress = Math.min(1, sessionElapsedSec / warmupGoalSec);
  const warmupDone = warmupProgress >= 1;

  return (
    <div className="flex flex-col h-full bg-page">
      <header className="flex items-center gap-3 border-b px-4 pb-3 pt-safe">
        <button onClick={onBack} aria-label="Go back" className="rounded-lg p-2.5 hover:bg-muted transition">
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold">{sessionType} — Warm Up</h1>
        </div>
        <div
          className="flex-none rounded-xl px-3 py-1.5 text-sm font-mono font-bold tabular-nums"
          style={{ background: "color-mix(in oklch, var(--color-brand) 15%, transparent)", color: "var(--color-brand)" }}
        >
          {formatTime(sessionElapsedSec)}
        </div>
      </header>

      {/* Warmup timer bar */}
      <div className="px-4 pt-2.5 pb-1 border-b border-border/30">
        <div className="flex items-center justify-between mb-1.5">
          <span
            className="text-[11px] font-bold uppercase tracking-widest"
            style={{ color: warmupDone ? "#22c55e" : "var(--color-brand)" }}
          >
            {warmupDone ? "✓ Warm up complete" : "Warm up timer"}
          </span>
          <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
            {formatTime(Math.min(sessionElapsedSec, warmupGoalSec))}{" "}
            <span className="opacity-50">/ {formatTime(warmupGoalSec)}</span>
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "color-mix(in oklch, var(--color-brand) 10%, transparent)" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${warmupProgress * 100}%`,
              transition: "width 1s linear",
              background: warmupDone
                ? "#22c55e"
                : "linear-gradient(90deg, var(--color-brand), color-mix(in oklch, var(--color-brand) 60%, #00d4ff))",
              boxShadow: warmupDone ? "0 0 8px #22c55e88" : "0 0 8px color-mix(in oklch, var(--color-brand) 60%, transparent)",
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {/* Focus muscles + mini heatmap side by side */}
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            {primaryMuscles.length > 0 && (
              <div
                className="rounded-2xl p-3 h-full"
                style={{ background: "color-mix(in oklch, var(--color-brand) 6%, transparent)", border: "1px solid color-mix(in oklch, var(--color-brand) 20%, transparent)" }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--color-brand)" }}>
                  Focus on warming up
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {primaryMuscles.map(m => (
                    <span
                      key={m}
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                      style={{ background: "color-mix(in oklch, var(--color-brand) 20%, transparent)", color: "var(--color-brand)", border: "1px solid color-mix(in oklch, var(--color-brand) 30%, transparent)" }}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          {assignments.length > 0 && (
            <div className="flex-none w-28">
              <MuscleHeatmap assignments={assignments} compact />
            </div>
          )}
        </div>

        {/* Exercise list */}
        {exercises.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--color-brand)" }}>
              Today&apos;s exercises
            </p>
            {exercises.map((ex, idx) => {
              const media = exerciseMedia[ex.name];
              const thumbSrc = media?.gif ?? media?.img ?? null;
              return (
                <div
                  key={`${ex.name}-${idx}`}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                  style={{ background: "color-mix(in oklch, var(--color-muted) 60%, transparent)", border: "1px solid color-mix(in oklch, var(--color-border) 60%, transparent)" }}
                >
                  {thumbSrc ? (
                    <div className="relative h-10 w-10 flex-none rounded-lg overflow-hidden bg-white">
                      <Image src={thumbSrc} alt="" fill sizes="40px"
                        unoptimized={thumbSrc.endsWith('.gif')} className="object-cover" />
                    </div>
                  ) : (
                    <div className="h-10 w-10 flex-none rounded-lg flex items-center justify-center" style={{ background: "color-mix(in oklch, var(--color-muted) 80%, transparent)" }}>
                      <DumbbellIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate leading-tight">{ex.name}</p>
                    {ex.mainMuscles && ex.mainMuscles.length > 0 && (
                      <p className="text-[11px] font-medium truncate leading-tight" style={{ color: "var(--color-brand)", opacity: 0.8 }}>
                        {ex.mainMuscles.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* General tips — compact */}
        <div
          className="rounded-2xl p-3"
          style={{ background: "color-mix(in oklch, var(--color-muted) 40%, transparent)", border: "1px solid color-mix(in oklch, var(--color-border) 50%, transparent)" }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">General warmup</p>
          <div className="space-y-1.5">
            {[
              "5 min cardio — raise core temperature",
              "Dynamic stretches for today's muscles",
              "2–3 ramp-up sets at 40–60% of working weight",
            ].map(tip => (
              <div key={tip} className="flex items-start gap-2">
                <div className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full" style={{ background: "var(--color-brand)" }} />
                <p className="text-xs text-muted-foreground">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t px-4 pt-4 pb-safe-action-lg">
        <Button
          className="w-full h-14 text-base font-semibold text-brand-foreground"
          style={{ background: "var(--color-brand)" }}
          onClick={onBeginExercises}
        >
          <DumbbellIcon className="mr-2 h-5 w-5" />
          Begin Exercises
        </Button>
      </div>
    </div>
  );
}
