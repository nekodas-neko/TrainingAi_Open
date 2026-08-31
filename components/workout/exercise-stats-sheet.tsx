"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { RotateCcwIcon, ChevronDownIcon, ChevronUpIcon, TrophyIcon, ZapIcon } from "lucide-react";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import type { ExerciseHistoryEntry } from "@/app/api/exercise-history/route";
import { MuscleHeatmap, type MuscleActivation } from "@/components/muscle-heatmap";
import { SparklineChart } from "@/components/ui/sparkline-chart";
import { formatSheetDate, mround125 } from "./utils";
import { calculate1RM, calc1RM, repMaxFromOneRm, BW_REF, displayOneRm, displayOneRmSeries, isBodyweightType, oneRmUnit } from "@trainingai/shared/1rm";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { EXERCISE_HISTORY_TTL } from '@trainingai/shared/cache-ttl';
import { useExerciseMediaFor } from '@/lib/hooks/use-exercise-media';

interface ExerciseStatsSheetProps {
  exercise: WorkoutExercise | null;
  isDoneToday: boolean;
  onClose: () => void;
  onRedo: () => void;
}

function ExerciseMedia({ name, gifUrl, imageUrl }: { name: string; gifUrl: string | null; imageUrl: string | null }) {
  const [showGif, setShowGif] = useState(false);
  const displayUrl = showGif && gifUrl ? gifUrl : (imageUrl ?? gifUrl);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#ffffff" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={displayUrl ?? undefined}
        alt={`${name} demonstration`}
        className="w-full object-contain max-h-40"
        loading="lazy"
        onLoad={() => { if (!showGif && gifUrl && displayUrl !== gifUrl) setShowGif(true); }}
      />
      {gifUrl && !showGif && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={gifUrl} alt="" className="hidden" onLoad={() => setShowGif(true)} />
      )}
    </div>
  );
}

export function ExerciseStatsSheet({ exercise, isDoneToday, onClose, onRedo }: ExerciseStatsSheetProps) {
  const [entries, setEntries] = useState<ExerciseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  // Shares `exercise-media:<name>` with the warm-up and ready screens, so re-opening an exercise
  // the session already showed paints its clip from cache. A media failure raises the same flag the
  // history one does, which is why `onError` is passed at all.
  const { media } = useExerciseMediaFor(exercise?.name, { onError: () => setError(true) });

  // History only. The skeleton and the error line below both name the history, and the media now
  // resolves on its own — folding the gif into this promise made a seeded history wait on a picture.
  useEffect(() => {
    if (!exercise) { setEntries([]); setError(false); return; }

    // Seed history from cache so re-opening an exercise shows its sets on the first frame.
    const seeded = readCacheSync<{ entries: ExerciseHistoryEntry[] } | null>(`exercise-history:${exercise.name}`);
    if (seeded?.entries) setEntries(seeded.entries);
    setLoading(!seeded?.entries);
    setError(false);

    void cachedFetch<{ entries: ExerciseHistoryEntry[] } | null>(
      `exercise-history:${exercise.name}`, `/api/exercise-history?name=${encodeURIComponent(exercise.name)}`, EXERCISE_HISTORY_TTL,
      d => setEntries(d?.entries ?? []),
    ).catch(() => {
      setError(true);
      setEntries([]);
    }).finally(() => setLoading(false));
  }, [exercise?.name]);

  if (!exercise) return null;

  // Working weight: highest % set in the progression style × current 1RM,
  // or target80 if no style is set.
  const workingWeight = (() => {
    const style = exercise.progressionStyle;
    if (style && exercise.estimated1rm) {
      const maxPct = Math.max(...style.map(s => s.pct));
      return mround125(exercise.estimated1rm * maxPct / 100);
    }
    return exercise.target80 != null ? mround125(exercise.target80) : null;
  })();

  // 1RM rep targets
  const isBodyweight = isBodyweightType(exercise.exerciseType);
  const current1rm = exercise.estimated1rm;
  const allTime1rm = entries.length > 0
    ? Math.max(...entries.map(e => e.estimated1rm).filter((v): v is number => v != null && v > 0))
    : null;
  const rmTargets = (() => {
    if (!workingWeight || !current1rm) return null;
    const style = exercise.progressionStyle;
    const highestPctSet = style && style.length > 0
      ? style.reduce((a, b) => b.pct > a.pct ? b : a)
      : null;

    let matchReps: number;
    let estFn: (r: number) => number;

    if (highestPctSet) {
      // With prescriptionFactor applied at log time, hitting the prescribed reps exactly
      // reproduces the current 1RM. One extra rep beats it.
      matchReps = highestPctSet.reps;
      estFn = (r: number) => calculate1RM([workingWeight], [r], [highestPctSet]).estimated1rm;
    } else {
      // No style: invert the canonical Epley/Brzycki average (lib/1rm.ts) to estimate
      // the rep count needed, rather than a bespoke pure-Epley formula that disagreed
      // with the saved 1RM the logged reps would actually produce.
      matchReps = Math.max(1, repMaxFromOneRm(current1rm, workingWeight - BW_REF));
      estFn = (r: number) => calc1RM(workingWeight, r);
    }

    const beatReps = matchReps + 1;
    const belowReps = Math.max(1, matchReps - 1);
    return [
      { label: "Below 1RM", beat: false, reps: belowReps, est: estFn(belowReps), color: "#ef4444" },
      { label: "Match 1RM", beat: false, reps: matchReps, est: estFn(matchReps), color: "#22c55e" },
      { label: "Beat 1RM", beat: true, reps: beatReps, est: estFn(beatReps), color: "var(--accent-cyan)" },
    ];
  })();

  // 1RM history for sparkline — chronological order, latest last. Bodyweight estimates are
  // BW_REF-relative, so the series is converted to reps before it is drawn (finding Q-12).
  const rms = displayOneRmSeries(
    [...entries].reverse().map(e => e.estimated1rm).filter((v): v is number => v != null && v > 0),
    exercise.exerciseType,
  );

  // RPE trend — avg (actual − expected) per session, chronological order, latest last
  const rpeDeltas = [...entries].reverse().map(e => e.rpeDelta).filter((v): v is number => v != null);

  // Muscle assignments
  const muscleActivations: MuscleActivation[] = [
    ...(exercise.mainMuscles ?? []).map(m => ({ muscle: m, role: "main" as const })),
    ...(exercise.secondaryMuscles ?? []).map(m => ({ muscle: m, role: "secondary" as const })),
  ];

  return (
    <Sheet open={!!exercise} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[90dvh] flex flex-col px-4">
        <SheetHeader className="flex-none">
          <SheetTitle>{exercise.name}</SheetTitle>
          {exercise.lastDate && (
            <p className="text-xs text-muted-foreground">
              Last: {exercise.lastSets != null ? `${exercise.lastSets} sets` : ""}
              {exercise.lastReps.length > 0
                ? exercise.lastReps.map((r, i) => {
                    const ws = exercise.lastSetWeights ?? [];
                    const w = ws[i] ?? ws[ws.length - 1];
                    return w != null ? ` · ${r}×${w}kg` : ` · ${r} reps`;
                  }).join("")
                : ""}
              {" · "}{formatSheetDate(exercise.lastDate)}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pb-2">

          {/* Exercise media — JPEG loads instantly, GIF replaces it once ready */}
          {(media.imageUrl || media.gifUrl) && (
            <ExerciseMedia name={exercise.name} gifUrl={media.gifUrl} imageUrl={media.imageUrl} />
          )}

          {/* 1RM rep targets */}
          {rmTargets && workingWeight && (
            <div className="rounded-xl border p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                {isBodyweight ? "Rep targets" : `Rep targets at ${workingWeight} kg`}
              </p>
              {allTime1rm != null && (
                <div className="flex items-center gap-1.5 text-xs mb-1.5" style={{ color: "var(--accent-amber)" }}>
                  <TrophyIcon className="w-3 h-3" />
                  <span>All-time: <strong>{isBodyweight ? displayOneRm(allTime1rm, "bodyweight").text : `${allTime1rm.toFixed(1)} kg`}</strong></span>
                </div>
              )}
              {rmTargets.map(t => (
                <div
                  key={t.label}
                  className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0"
                  style={{ color: t.color }}
                >
                  <span className="flex items-center gap-1 text-sm">
                    {t.label}
                    {t.beat && <ZapIcon className="h-3.5 w-3.5 flex-none" aria-hidden />}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {isBodyweight ? `${t.reps} reps` : `${t.reps} reps → ~${t.est} kg`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 1RM sparkline */}
          {rms.length >= 2 && (
            <div className="rounded-xl border p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                {isBodyweight ? "Rep max trend" : "1RM trend"} ({rms.length} sessions)
              </p>
              <SparklineChart values={rms} unit={oneRmUnit(exercise.exerciseType)} height={52} />
            </div>
          )}

          {/* RPE trend — positive means sets are feeling harder than the prescribed intensity expects */}
          {rpeDeltas.length >= 2 && (
            <div className="rounded-xl border p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                RPE trend ({rpeDeltas.length} sessions)
              </p>
              <SparklineChart values={rpeDeltas.map(d => Math.round(d * 10) / 10)} unit="Δ RPE" height={52} />
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              {[1, 2].map(i => <div key={i} className="h-8 animate-pulse rounded-xl bg-muted" />)}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-destructive/80">Failed to load exercise history</p>
            </div>
          )}

          {/* How-to instructions */}
          {exercise.instructions && (
            <div className="rounded-xl border overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                onClick={() => setInstructionsOpen(o => !o)}
                aria-expanded={instructionsOpen}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">How to perform</span>
                {instructionsOpen
                  ? <ChevronUpIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {instructionsOpen && (
                <p className="px-3 pb-3 text-sm text-muted-foreground leading-relaxed">
                  {exercise.instructions}
                </p>
              )}
            </div>
          )}

          {/* Muscle map */}
          {muscleActivations.length > 0 && (
            <div className="rounded-xl border p-3 flex items-center gap-4">
              <MuscleHeatmap assignments={muscleActivations} className="w-16 flex-none" compact />
              <div className="flex flex-wrap gap-1.5">
                {(exercise.mainMuscles ?? []).map(m => (
                  <span
                    key={m}
                    className="text-[11px] rounded-lg px-2.5 py-1 font-medium"
                    style={{
                      background: "color-mix(in oklch, var(--color-brand) 10%, transparent)",
                      color: "var(--color-brand)",
                      border: "1px solid color-mix(in oklch, var(--color-brand) 22%, transparent)",
                    }}
                  >
                    {m}
                  </span>
                ))}
                {(exercise.secondaryMuscles ?? []).map(m => (
                  <span
                    key={m}
                    className="text-[11px] rounded-lg px-2.5 py-1 font-medium"
                    style={{
                      background: "color-mix(in oklch, #f59e0b 12%, transparent)",
                      color: "#f59e0b",
                      border: "1px solid color-mix(in oklch, #f59e0b 25%, transparent)",
                    }}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Re-do button — only shown for exercises already done today */}
        {isDoneToday && (
          <div className="flex-none pt-2 border-t">
            <Button
              variant="outline"
              className="w-full h-12"
              onClick={() => { onClose(); onRedo(); }}
            >
              <RotateCcwIcon className="h-4 w-4 mr-2" />
              Re-do this exercise
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
