"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { CalculatorIcon, ChevronLeftIcon, DumbbellIcon, ListIcon, SkipForwardIcon, ZapIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkoutExercise, PhaseStatus } from "@/app/api/workout-data/route";
import { formatSheetDate, mround125, mroundStep, mroundStepUp, weightStepFor, plateBreakdown } from "./utils";
import { ActiveSetCard } from "./active-set-card";
import { SetsGrid } from "./sets-grid";
import { Live1rmReadout } from "./live-1rm-readout";
import { LiveHrChart } from "@/components/workout/live-hr-chart";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { wouldDiscardWork } from "./leave-guard";
import { OneRmCalculatorDialog } from "./one-rm-calculator-dialog";
import { MuscleHeatmap, type MuscleActivation } from "@/components/muscle-heatmap";
import { cachedFetch } from "@/lib/sqlite/cache";
import { displayOneRm, displayOneRmSeries } from "@trainingai/shared/1rm";
import { EXERCISE_HISTORY_TTL } from '@trainingai/shared/cache-ttl';
import { getLocalStore } from "@/lib/local-store";
import { todayInTz, shiftDateStr } from "@trainingai/shared/date-utils";
import { SessionRing, SessionPill, ExerciseClock, WarmupRampProgress, RestTimer } from "./workout-clocks";
import { useWorkoutStore } from "@/lib/stores/workout-store";
import { warmupRampSectionSec } from "@trainingai/shared/workout/duration-model";

interface ActiveWorkoutScreenProps {
  exercise: WorkoutExercise | undefined;
  exerciseIndex: number;
  totalExercises: number;
  soloMode: boolean;
  timerStarted: boolean;
  sets: number;
  onWeightChange: (setIdx: number, value: number) => void;
  currentSet: number;
  lapStartMs: number | null;
  workoutPhase: "rest" | "set";
  // The just-logged set's live rest anchor (lastSetRestStartMs in the store) — not
  // the per-exercise buffered restStartMs, which is clobbered by superset handoff
  // and would show the wrong exercise's countdown (TMR-1).
  restStartMs: number | null;
  currentRestSec: number;
  exerciseStartMs: number | null;
  workoutStartMs: number | null;
  onRepChange: (setIndex: number, value: number) => void;
  onStartSet: () => void;
  onLogCurrentSet: () => void;
  onCompleteSet: () => void;
  onStart: () => void;
  onBack: () => void;
  onSkip: () => void;
  sessionName?: string;
  /** The header's phase/position/deload line, already resolved — see `sessionContextLabel`. */
  sessionContext?: string;
  isBaseline?: boolean;
  activeInjuries?: import('@trainingai/shared/types/injury').Injury[];
  onRpeChange?: (setIdx: number, value: number) => void;
  onRequestInjurySwap?: (exerciseIndex: number, injuredMuscles: string[]) => void;
  userId?: string;
}

export function ActiveWorkoutScreen({
  exercise,
  exerciseIndex,
  totalExercises,
  soloMode,
  timerStarted,
  sets,
  onWeightChange,
  currentSet,
  lapStartMs,
  workoutPhase,
  restStartMs,
  currentRestSec,
  exerciseStartMs,
  workoutStartMs,
  onRepChange,
  onStartSet,
  onLogCurrentSet,
  onCompleteSet,
  onStart,
  onBack,
  onSkip,
  sessionName,
  sessionContext,
  isBaseline,
  activeInjuries = [],
  onRpeChange,
  onRequestInjurySwap,
  userId,
}: ActiveWorkoutScreenProps) {
  // Only the SET-1 working weight is read reactively here (for the warmup ramp + the "load the
  // bar to" header). The per-set weight/reps/lap/rest/RPE the active card renders live on every
  // dial detent are read at the leaf (ActiveSetCard / Live1rmReadout self-subscribe), so a dial
  // detent re-renders only those small leaves — not this ~800-line screen. (The orchestrator above
  // was already isolated from these fields by the props removed in this change.)
  const workingWeight = useWorkoutStore(s => s.perSetWeights[0]);
  // Persisted (not a useRef) so it survives an app-backgrounding remount — the ref
  // this replaced reset to null on remount while the header's session clock (backed
  // by workoutStartMs, which IS persisted) kept counting correctly.
  const readyElapsedBaselineSec = useWorkoutStore(s => s.readyElapsedBaselineSec);
  const setReadyElapsedBaselineSec = useWorkoutStore(s => s.setReadyElapsedBaselineSec);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const confirmActionRef = useRef<(() => void) | null>(null);
  // The dialog is shared between "back" and "skip"; only its verb differs. Title and message hold
  // for both — skipping does leave the exercise, and does drop sets in progress.
  const [confirmLabel, setConfirmLabel] = useState("Leave");
  const [showCalc, setShowCalc] = useState(false);
  const [rmHistory, setRmHistory] = useState<Array<{ date: string; estimated1rm: number | null }>>([]);
  useEffect(() => {
    if (!timerStarted) {
      // Was read off a ref fed by the screen's own 1 Hz tick; derived directly now that the
      // tick lives in the leaves.
      if (readyElapsedBaselineSec == null) {
        setReadyElapsedBaselineSec(workoutStartMs ? Math.max(0, Math.floor((Date.now() - workoutStartMs) / 1000)) : 0);
      }
    } else {
      if (readyElapsedBaselineSec != null) setReadyElapsedBaselineSec(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerStarted]);

  useEffect(() => {
    if (timerStarted || !exercise?.name) return;
    const exName = exercise.name;
    // Local-first seed (SYN-5) before the cachedFetch revalidates — mirrors
    // ExerciseHistorySheet's pattern so the RM history sparkline doesn't sit
    // blank offline mid-workout.
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      const cutoffStr = shiftDateStr(todayInTz(), -90);
      store.getWorkoutHistory(cutoffStr).then(history => {
        const localEntries: Array<{ date: string; estimated1rm: number | null }> = [];
        for (const { exerciseLogs } of history) {
          for (const el of exerciseLogs) {
            if (el.exerciseName !== exName) continue;
            if (el.sets.every(s => s.deletedAt)) continue;
            localEntries.push({ date: el.loggedAt, estimated1rm: el.estimated1rm });
          }
        }
        localEntries.sort((a, b) => a.date.localeCompare(b.date));
        if (localEntries.length > 0) setRmHistory(localEntries.slice(-6));
      }).catch(() => {});
    }
    cachedFetch<{ entries: Array<{ date: string; estimated1rm: number | null }> }>(
      `exercise-history:${exName}`,
      `/api/exercise-history?name=${encodeURIComponent(exName)}`,
      EXERCISE_HISTORY_TTL,
      d => { if (d?.entries) setRmHistory(d.entries.slice(0, 6).reverse()); },
    );
  }, [exercise?.name, timerStarted, userId]);

  const handleRpeChange = useCallback(
    (value: number) => onRpeChange?.(currentSet, value),
    [onRpeChange, currentSet],
  );

  // Guards an action that would discard work in progress. The rule itself lives in `leave-guard.ts`
  // so it can be tested — this repo has no component-test setup, so inline it was unreachable.
  const withConfirm = (action: () => void, label = "Leave") => {
    if (wouldDiscardWork({
      timerStarted,
      workoutPhase,
      lapCount: useWorkoutStore.getState().lapTimes.length,
    })) {
      confirmActionRef.current = action;
      setConfirmLabel(label);
      setConfirmCloseOpen(true);
    } else {
      action();
    }
  };

  const allSetsLogged = currentSet >= sets;

  const weightStep = weightStepFor(exercise?.equipment);

  const warmupSets = (() => {
    const set1 = workingWeight;
    if (!set1 || set1 <= 0 || soloMode) return null;
    return [
      { pct: 50, reps: 5, label: "prep" },
      { pct: 74, reps: 3, label: "activate" },
      { pct: 92, reps: 1, label: "potentiate" },
    ].map(w => ({ ...w, weight: mroundStep(set1 * w.pct / 100, weightStep) }));
  })();

  const isBodyweight = exercise?.exerciseType === "bodyweight";

  const live1rmStyle = useMemo(
    () => exercise?.progressionStyle?.slice(0, currentSet) ?? null,
    [exercise?.progressionStyle, currentSet],
  );

  // Stable identity so the memoized MuscleHeatmap doesn't re-render on every
  // 1Hz session-clock tick — this array previously was rebuilt fresh each render.
  const muscleMapAssignments = useMemo<MuscleActivation[]>(() => [
    ...(exercise?.mainMuscles ?? []).map(m => ({ muscle: m, role: "main" as const })),
    ...(exercise?.secondaryMuscles ?? []).map(m => ({ muscle: m, role: "secondary" as const })),
  ], [exercise?.mainMuscles, exercise?.secondaryMuscles]);

  const WARMUP_SECTION_SEC = warmupRampSectionSec(exercise?.equipment, warmupSets?.length ?? 0);

  return (
    // Batch L chunk 1 task 4 (confirmed): the active workout main screen already
    // participates in the dynamic wallpaper via bg-page — it was never bg-black.
    // The only opaque-black exception is the floating PiP system overlay
    // (pip-view.tsx), a small always-black Android window, not this screen.
    <div className="flex h-full flex-col bg-page">
      {/* ── Header ── */}
      <header className="flex items-center gap-2 border-b px-3 pt-safe pb-2.5">
        <button
          onClick={() => withConfirm(onBack)}
          aria-label="Back"
          className="rounded-lg p-2 hover:bg-muted transition flex-none"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-xs font-semibold text-muted-foreground truncate">
            {sessionName ?? (soloMode ? "Solo log" : "Workout")}
          </p>
          <p className="text-[10px] text-muted-foreground/60 truncate">
            {sessionContext}
            {soloMode ? "Solo" : `Ex ${exerciseIndex + 1}/${totalExercises}`}
            {timerStarted && <ExerciseClock startMs={exerciseStartMs} />}
          </p>
        </div>
        <button
          onClick={() => setShowCalc(true)}
          aria-label="1RM calculator"
          className="rounded-lg p-2 hover:bg-muted transition text-muted-foreground flex-none"
        >
          <CalculatorIcon className="h-4 w-4" />
        </button>
        <SessionRing startMs={workoutStartMs} />
      </header>

      {!timerStarted ? (
        // ── Ready screen (warmup + bar load + exercise info) ──────────────────
        <>
          <div className="flex flex-1 flex-col items-center gap-3 px-5 pt-3 pb-2 overflow-y-auto">

            {/* Exercise label + session timer row */}
            <div className="w-full flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                {soloMode ? "Solo log" : `Exercise ${exerciseIndex + 1} of ${totalExercises}`}
              </p>
              <SessionPill startMs={workoutStartMs} />
            </div>

            {/* Exercise name */}
            <h2 className="text-3xl font-bold text-center w-full leading-tight">{exercise?.name}</h2>

            {/* Last session */}
            {exercise?.lastDate && exercise.lastReps.length > 0 && (
              <div className="w-full rounded-xl bg-muted/40 border border-border/60 px-3 py-2">
                <p className="text-[10px] text-muted-foreground mb-1.5">Last session — {formatSheetDate(exercise.lastDate)}</p>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex gap-1.5 flex-wrap">
                    {exercise.lastReps.map((r, i) => {
                      const ws = exercise.lastSetWeights ?? [];
                      const w = ws[i] ?? ws[ws.length - 1];
                      let label: string;
                      if (isBodyweight && (w == null || w === 0)) {
                        label = `${r} reps`;
                      } else if (isBodyweight) {
                        label = `${w! > 0 ? `+${w}` : w}×${r}`;
                      } else {
                        label = w != null ? `${w}×${r}` : `${r} reps`;
                      }
                      return (
                        <span key={i} className="rounded-lg bg-muted border border-border/60 px-2 py-0.5 text-[11px] font-semibold">
                          {label}
                        </span>
                      );
                    })}
                  </div>
                  {exercise.estimated1rm != null && (
                    <div className="flex-shrink-0 text-center">
                      <p className="text-[9px] text-muted-foreground font-bold">{isBodyweight ? "REP MAX" : "1RM"}</p>
                      <p className="text-base font-black" style={{ color: "var(--color-brand)" }}>
                        {isBodyweight
                          ? displayOneRm(exercise.estimated1rm, "bodyweight").text
                          : `${mround125(exercise.estimated1rm)} kg`}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Bar loading card — prominent working weight ── */}
            {!isBaseline && !isBodyweight && workingWeight != null && workingWeight > 0 && (
              <div
                className="w-full rounded-2xl px-4 py-4 text-center"
                style={{ background: "color-mix(in oklch, var(--color-brand) 10%, transparent)", border: "1px solid color-mix(in oklch, var(--color-brand) 28%, transparent)" }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--color-brand)" }}>
                  Load the bar to
                </p>
                <p className="text-5xl font-black tabular-nums leading-none" style={{ color: "var(--color-brand)" }}>
                  {workingWeight} kg
                </p>
                {exercise?.progressionStyle?.[0]?.pct && (
                  <p className="text-xs text-muted-foreground mt-1.5">{exercise.progressionStyle[0].pct}% of 1RM · {exercise.progressionStyle[0].reps} reps per set</p>
                )}
                {(() => {
                  const plates = plateBreakdown(workingWeight);
                  if (!plates) return null;
                  return (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {plates.perSide.length === 0
                        ? "Empty bar"
                        : `${plates.perSide.join(" + ")} per side`}
                      {!plates.exact && ` · closest ${plates.achievableKg} kg`}
                    </p>
                  );
                })()}
              </div>
            )}

            {/* Warmup ramp-up — segmented timer */}
            {warmupSets && !isBaseline && !isBodyweight && (
              <WarmupRampProgress
                startMs={workoutStartMs}
                baselineSec={timerStarted ? null : readyElapsedBaselineSec}
                sectionSec={WARMUP_SECTION_SEC}
                warmupSets={warmupSets}
              />
            )}

            {/* AMRAP / Set targets / target80 */}
            {isBaseline ? (
              <div className="rounded-2xl bg-brand/15 px-4 py-3 w-full text-center">
                <p className="text-xs font-medium text-brand uppercase tracking-wide mb-2">AMRAP Test</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Pick a weight you can manage for 8–15 reps. Do as many reps as possible with good form — this sets your working weights for the whole program.
                </p>
                {!isBodyweight && exercise?.estimated1rm != null && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Suggested: ~{mroundStep(exercise.estimated1rm * 0.65, weightStep)} kg (65% of last 1RM)
                  </p>
                )}
              </div>
            ) : isBodyweight ? null : exercise?.progressionStyle && exercise.progressionStyle.length > 0 ? (
              <div className="rounded-2xl bg-brand/15 px-4 py-3 w-full">
                <p className="text-xs font-medium text-brand uppercase tracking-wide mb-2 text-center">Set targets</p>
                <div className="space-y-1">
                  {exercise.progressionStyle.map((s, i) => {
                    const w = exercise.estimated1rm ? mroundStepUp(exercise.estimated1rm * s.pct / 100, weightStep) : null;
                    return (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Set {i + 1} ({s.pct}%)</span>
                        <span className="font-semibold text-brand tabular-nums">
                          {w != null ? `${w} kg` : "—"} × {s.reps} reps
                        </span>
                      </div>
                    );
                  })}
                </div>
                {exercise.estimated1rm != null && (() => {
                  const highPct = exercise.progressionStyle!.reduce((a, b) => b.pct > a.pct ? b : a);
                  return (
                    <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground/70 text-center mt-2 pt-2 border-t border-brand/20">
                      {highPct.reps} reps = maintain 1RM · {highPct.reps + 1}+ reps = beat it <ZapIcon className="w-2.5 h-2.5" />
                    </p>
                  );
                })()}
              </div>
            ) : exercise?.target80 != null ? (
              <div className="rounded-2xl bg-brand/15 px-6 py-3 text-center">
                <p className="text-xs font-medium text-brand uppercase tracking-wide mb-1">Target weight</p>
                <p className="text-4xl font-bold text-brand">{mroundStepUp(exercise.target80, weightStep)} kg</p>
              </div>
            ) : null}

            {/* 1RM trend sparkline */}
            {rmHistory.length >= 2 && (() => {
              const vals = displayOneRmSeries(
                rmHistory.map(h => h.estimated1rm).filter((v): v is number => v != null && v > 0),
                exercise?.exerciseType,
              );
              if (vals.length < 2) return null;
              const minV = Math.min(...vals);
              const maxV = Math.max(...vals);
              const range = maxV - minV || 1;
              // PAD_TOP leaves headroom for the value label above the highest
              // point so it isn't clipped by the SVG viewport on an uptrend.
              const W = 200, H = 56, PAD_X = 8, PAD_TOP = 16, PAD_BOTTOM = 8;
              const points = vals.map((v, i) => {
                const x = PAD_X + (i / (vals.length - 1)) * (W - PAD_X * 2);
                const y = H - PAD_BOTTOM - ((v - minV) / range) * (H - PAD_TOP - PAD_BOTTOM);
                return { x, y, v };
              });
              const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
              const latest = points[points.length - 1];
              return (
                <div className="w-full">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5 text-center">{isBodyweight ? "Rep Max Trend" : "1RM Trend"}</p>
                  <div className="rounded-2xl bg-muted/40 border border-border px-3 py-2">
                    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
                      <polyline points={polyline} fill="none" stroke="var(--color-brand)" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                      {points.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--color-brand)" />
                      ))}
                      <text x={latest.x} y={latest.y - 6} textAnchor="end"
                        fill="var(--color-brand)" fontSize="8" fontWeight="700">
                        {latest.v}{isBodyweight ? " RM" : " kg"}
                      </text>
                    </svg>
                  </div>
                </div>
              );
            })()}

            {/* Muscle map */}
            {exercise && ((exercise.mainMuscles?.length ?? 0) + (exercise.secondaryMuscles?.length ?? 0)) > 0 && (
              <MuscleHeatmap assignments={muscleMapAssignments} className="w-full" />
            )}
          </div>
          <div className="border-t px-4 pt-4 pb-safe-action-lg flex gap-3">
            <Button variant="outline" className="h-14 flex-none px-5" onClick={() => withConfirm(onSkip, "Skip")}>
              {soloMode ? <ListIcon className="h-5 w-5" /> : <SkipForwardIcon className="h-5 w-5" />}
            </Button>
            <Button className="h-14 flex-1 text-base font-semibold bg-brand hover:opacity-90 text-brand-foreground" onClick={onStart}>
              <DumbbellIcon className="mr-2 h-5 w-5" />
              Start Set 1
            </Button>
          </div>
        </>
      ) : (
        // ── Active exercise ───────────────────────────────────────────────────
        <>
          <div className="flex flex-col flex-1 min-h-0 px-4 pt-2.5 pb-2">

            {/* ── Top: exercise name + banners + done chips ── */}
            <div className="flex-none space-y-2 mb-2">
              <div>
                <h2 className="text-xl font-bold leading-tight truncate">{exercise?.name}</h2>
                {exercise?.lastDate && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Last: {exercise.lastReps.join(", ")} reps · {formatSheetDate(exercise.lastDate)}
                  </p>
                )}
              </div>

              {/* Injury warning */}
              {(() => {
                const exerciseMuscles = [...(exercise?.mainMuscles ?? []), ...(exercise?.secondaryMuscles ?? [])];
                const injuredMuscles = exerciseMuscles.filter(mg =>
                  activeInjuries.some(i => i.muscleName.toLowerCase() === mg.toLowerCase())
                );
                return injuredMuscles.length > 0 ? (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 flex items-start gap-2">
                    <TriangleAlertIcon className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="flex-1 flex items-start justify-between gap-2">
                      <p className="text-xs text-amber-400">
                        <span className="font-semibold">Injury active: </span>
                        {injuredMuscles.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')} — train with caution
                      </p>
                      {onRequestInjurySwap && (
                        <button
                          onClick={() => onRequestInjurySwap(exerciseIndex, injuredMuscles)}
                          className="text-xs font-semibold text-amber-400 underline shrink-0"
                        >
                          Swap →
                        </button>
                      )}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* AMRAP banner */}
              {isBaseline && (
                <div
                  className="rounded-xl px-3 py-2 text-xs text-center"
                  style={{ background: 'color-mix(in oklch, var(--color-brand) 10%, transparent)', color: 'var(--color-brand)' }}
                >
                  AMRAP Test — pick a challenging weight and do as many reps as possible with good form
                </div>
              )}

              {/* Sets grid — pre-allocates ALL cells so height never changes as sets complete.
                  Self-subscribing leaf: a dial detent re-renders it, not this screen. */}
              <SetsGrid
                currentSet={currentSet}
                allSetsLogged={allSetsLogged}
                workoutPhase={workoutPhase}
                exerciseType={exercise?.exerciseType}
                isBodyweight={isBodyweight}
              />
            </div>

            {/* Live HR — rest phase only. The set-phase PPG reads poorly under grip/motion,
                so showing it mid-set was both distracting and inaccurate (dropped mid-set
                then ramped during rest). `sinceMs={restStartMs}` shows just the current
                rest's recovery dip; the full-exercise trace lives on the summary card. */}
            {workoutPhase === "rest" && !allSetsLogged && (
              <LiveHrChart sinceMs={restStartMs} compact className="mt-2" />
            )}

            {/* ── Centre: active card or rest timer — always in the same flex zone ── */}
            <div className="flex-1 flex flex-col justify-center min-h-0 gap-3">

              {/* Set phase: active set card */}
              {workoutPhase === "set" && !allSetsLogged && (
                <ActiveSetCard
                  currentSet={currentSet}
                  workoutPhase={workoutPhase}
                  intensityPct={exercise?.progressionStyle?.[currentSet]?.pct}
                  onRepChange={onRepChange}
                  onWeightChange={onWeightChange}
                  isBaseline={isBaseline}
                  lastSetMode={exercise?.lastSetMode}
                  exerciseType={exercise?.exerciseType}
                  equipment={exercise?.equipment}
                  isBodyweight={isBodyweight}
                  onRpeChange={handleRpeChange}
                />
              )}

              {/* Rest phase: timer — same zone as active card */}
              {workoutPhase === "rest" && !allSetsLogged && (
                <div className="flex flex-col items-center">
                  <RestTimer
                    restStartMs={restStartMs}
                    currentRestSec={currentRestSec}
                    onStartSet={onStartSet}
                  />
                  {currentSet >= 1 && exercise?.exerciseType !== "bodyweight" && (
                    <Live1rmReadout
                      currentSet={currentSet}
                      isBodyweight={isBodyweight}
                      style={live1rmStyle}
                      previousEst1rm={exercise?.estimated1rm ?? null}
                    />
                  )}
                </div>
              )}

              {/* All sets done — the last set still earns a rest period, so keep the
                  countdown ring running (non-interactive: there's no next set to skip to). */}
              {allSetsLogged && (
                <div className="flex flex-col items-center gap-3">
                  {workoutPhase === "rest" && restStartMs != null ? (
                    <>
                      <RestTimer restStartMs={restStartMs} currentRestSec={currentRestSec} />
                      <div className="flex flex-col items-center gap-1">
                        <p className="text-sm font-bold" style={{ color: "var(--color-brand)" }}>All sets done!</p>
                        <p className="text-xs text-muted-foreground">Tap Complete to move on</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center py-4 gap-2">
                      <DumbbellIcon className="h-8 w-8" style={{ color: "var(--color-brand)" }} />
                      <p className="text-sm font-bold" style={{ color: "var(--color-brand)" }}>All sets done!</p>
                      <p className="text-xs text-muted-foreground">Tap Complete to move on</p>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* ── Bottom action bar ── */}
          <div className="border-t px-4 pt-3 pb-safe-action-lg flex gap-3">
            <Button
              variant="outline"
              className="h-12 flex-none px-5"
              // Q-63: this was `soloMode ? withConfirm(onSkip) : onSkip()`, so a normal program
              // workout skipped to the next exercise on one tap, discarding in-progress sets and
              // rest. Nothing about the loss is solo-specific.
              onClick={() => withConfirm(onSkip, "Skip")}
            >
              {soloMode ? <ListIcon className="h-5 w-5" /> : <SkipForwardIcon className="h-5 w-5" />}
            </Button>
            {allSetsLogged ? (
              <Button
                className="h-12 flex-1 text-base font-semibold bg-green-500 hover:bg-green-600 text-white"
                onClick={onCompleteSet}
              >
                Complete →
              </Button>
            ) : workoutPhase === "rest" ? (
              <button
                onClick={onStartSet}
                className="h-12 flex-1 rounded-xl text-sm font-bold text-brand-foreground transition hover:opacity-90 active:scale-95 animate-bounce"
                style={{ background: "var(--color-brand)" }}
              >
                Start Set {currentSet + 1}
              </button>
            ) : (
              <button
                onClick={onLogCurrentSet}
                className="h-12 flex-1 rounded-xl text-sm font-bold text-brand-foreground transition hover:opacity-90 active:scale-95"
                style={{ background: "linear-gradient(135deg, var(--color-brand), color-mix(in oklch, var(--color-brand) 70%, #00d4ff))" }}
              >
                {`Log Set ${currentSet + 1}`}
              </button>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmCloseOpen}
        onOpenChange={setConfirmCloseOpen}
        title="Leave this exercise?"
        message="Sets in progress won't be saved if you leave now."
        confirmLabel={confirmLabel}
        cancelLabel="Stay"
        onConfirm={() => {
          setConfirmCloseOpen(false);
          confirmActionRef.current?.();
          confirmActionRef.current = null;
        }}
      />

      <OneRmCalculatorDialog open={showCalc} onOpenChange={setShowCalc} initialWeight={useWorkoutStore.getState().perSetWeights[currentSet] ?? 60} progressionStyle={exercise?.progressionStyle} />
    </div>
  );
}
