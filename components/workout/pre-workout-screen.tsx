"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import { BatteryLowIcon, CheckIcon, ChevronLeftIcon, DumbbellIcon, RefreshCwIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@trainingai/shared/utils";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import type { SessionLogEntry } from "./types";
import { formatSheetDate, mround125, modalWeight, avgReps, deloadOverrideOutcome } from "./utils";
import { displayOneRm } from "@trainingai/shared/1rm";
import { RoleChip } from "./role-chip";
import type { PrescriptionStatus } from "@trainingai/shared/types/ai-periodization";
import type { DurationPreset } from "@trainingai/shared/workout/duration-model";
import { DeloadToggle } from "@/components/workout/deload-toggle";
import { AiBaselineBanner } from "./ai-baseline-banner";
import { AiPrescriptionCard } from "./ai-prescription-card";
import { SessionDurationPicker } from "./session-duration-picker";
import { LeaveWorkoutDialog } from "./leave-workout-dialog";
import { StartWorkoutCountdown } from "./start-workout-countdown";
import { useTransitionRouter } from "@/lib/view-transition";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { formatInTimeZone } from "date-fns-tz";

const ExerciseStatsSheet = dynamic(
  () => import("./exercise-stats-sheet").then((m) => ({ default: m.ExerciseStatsSheet })),
  { ssr: false },
);

const DeloadInfoSheet = dynamic(
  () => import("./deload-info-sheet").then((m) => ({ default: m.DeloadInfoSheet })),
  { ssr: false },
);

interface PreWorkoutScreenProps {
  sessionType: string;
  exercises: WorkoutExercise[];
  loading: boolean;
  todayLogged: Set<string>;
  sessionLog: SessionLogEntry[];
  onLaunchExercise: (idx: number, solo: boolean) => void;
  onStartWorkout: () => void;
  onRefresh: () => void;
  onCompleteWorkout: () => void;
  // True once the workout has started (workoutStartMs set) — this screen is also the
  // mid-workout hub shown between exercises, so leaving it via the back button needs
  // the same "leave workout?" confirmation as the in-exercise back arrow.
  workoutActive?: boolean;
  onLeaveWorkout?: () => void;
  // Resumes the sequential workout at the next un-logged exercise (non-solo, so
  // finishing it auto-advances like a fresh workout) — used instead of "Start
  // Workout" when returning to this hub mid-workout, so the existing
  // workoutSessionId/timers carry over instead of minting a new session.
  onContinueWorkout?: () => void;
  phaseStatus?: import('@/app/api/workout-data/route').PhaseStatus | null;
  periodization?: {
    state: import('@trainingai/shared/types/ai-periodization').SessionPeriodization;
    signals: { exercises: Array<{ sessionExerciseId: string; name: string; current1rm: number | null; role: string; rm1Trend: 'up' | 'flat' | 'down'; rm1ChangeKg: number }> };
  } | null;
  periodizationLoading?: boolean;
  // A fresh AI prescription is regenerating: show a "preparing" state instead of the
  // base-program numbers (which the AI is about to replace), and hold the Start button.
  prescriptionPending?: boolean;
  // The regeneration didn't land within the poll window (AI slow/offline) — reveal the
  // base numbers with a note so the workout is never blocked.
  prescriptionGenTimedOut?: boolean;
  // The session's own configured time budget, shown as the "Standard" option's sublabel.
  sessionBudgetMin?: number;
  // Regenerate today's prescription against a different time budget. Omitted (undefined)
  // hides the picker entirely — e.g. on a non-ai_dynamic program, where there is no
  // prescription to regenerate.
  onDurationPresetChange?: (preset: DurationPreset) => void;
  // Today's intensity choice, moved here from Home (Q-109-followup). Undefined hides it, on the
  // same grounds as the duration picker: only the ai_dynamic path honours it.
  deload?: boolean;
  onDeloadChange?: (next: boolean) => void;
  /** The readiness engine is asking for a deload today — labels the toggle rather than gating it. */
  deloadRecommended?: boolean;
  /** BF-64: `Full` was explicitly chosen over a deload prescription, so the revert is running. */
  overrideFull?: boolean;
  /** Deloaded exercises the override could not revert — no `preDeload` block was recorded. */
  overrideBlockedNames?: string[];
  onPrescriptionStatusChange?: (status: PrescriptionStatus) => void;
  onPhaseChanged?: () => void;
  onToggleDeloadRevert?: (name: string) => void;
}

export function PreWorkoutScreen({
  sessionType,
  exercises,
  loading,
  todayLogged,
  onLaunchExercise,
  onStartWorkout,
  onRefresh,
  onCompleteWorkout,
  workoutActive = false,
  onLeaveWorkout,
  onContinueWorkout,
  phaseStatus,
  periodization,
  periodizationLoading,
  prescriptionPending = false,
  prescriptionGenTimedOut = false,
  sessionBudgetMin,
  onDurationPresetChange,
  deload = false,
  onDeloadChange,
  deloadRecommended = false,
  overrideFull = false,
  overrideBlockedNames = [],
  onPrescriptionStatusChange,
  onPhaseChanged,
  onToggleDeloadRevert,
}: PreWorkoutScreenProps) {
  const tz = useUserTimezone();
  const router = useTransitionRouter();
  const [statsExercise, setStatsExercise] = useState<WorkoutExercise | null>(null);
  const [deloadExercise, setDeloadExercise] = useState<WorkoutExercise | null>(null);
  const [countingDown, setCountingDown] = useState(false);
  const [confirmBackOpen, setConfirmBackOpen] = useState(false);

  const handleBackClick = () => {
    if (workoutActive) {
      setConfirmBackOpen(true);
    } else {
      router.back();
    }
  };
  const onStartWorkoutRef = useRef(onStartWorkout);
  onStartWorkoutRef.current = onStartWorkout;

  const today = formatInTimeZone(new Date(), tz, "EEEE d MMMM");

  const allDoneToday =
    !loading &&
    exercises.length > 0 &&
    exercises.every((ex) => todayLogged.has(ex.name) || ex.loggedTodayInSession);

  // Live estimated 1RM per prescription exercise, sourced from the same workout-data
  // `estimated1rm` the bar loads from, so the card's weight matches the actual set.
  const liveOneRm: Record<string, number | null> = {};
  const lastSetModeById: Record<string, 'amrap' | 'plus1' | undefined> = {};
  const equipmentById: Record<string, string[] | undefined> = {};
  // Bodyweight movements have no kg 1RM to narrate — the card's rationale bullets branch on this.
  const exerciseTypeById: Record<string, string | undefined> = {};
  const prescForWeights = periodization?.state.prescription;
  if (prescForWeights) {
    // Keyed by sessionExerciseId (DB id), not name — two exercises in one session can
    // share a name, which would otherwise collapse them in the lookup map.
    const oneRmById = new Map(exercises.map((e) => [e.sessionExerciseId, e.estimated1rm]));
    const modeById = new Map(exercises.map((e) => [e.sessionExerciseId, e.lastSetMode]));
    const equipmentByIdSrc = new Map(exercises.map((e) => [e.sessionExerciseId, e.equipment]));
    const typeByIdSrc = new Map(exercises.map((e) => [e.sessionExerciseId, e.exerciseType]));
    for (const pe of prescForWeights.exercises) {
      liveOneRm[pe.sessionExerciseId] = oneRmById.get(pe.sessionExerciseId) ?? null;
      lastSetModeById[pe.sessionExerciseId] = modeById.get(pe.sessionExerciseId);
      equipmentById[pe.sessionExerciseId] = equipmentByIdSrc.get(pe.sessionExerciseId);
      exerciseTypeById[pe.sessionExerciseId] = typeByIdSrc.get(pe.sessionExerciseId);
    }
  }
  const exerciseSignalsById: Record<string, { role: string; rm1Trend: 'up' | 'flat' | 'down'; rm1ChangeKg: number }> = {};
  for (const se of periodization?.signals.exercises ?? []) {
    exerciseSignalsById[se.sessionExerciseId] = { role: se.role, rm1Trend: se.rm1Trend, rm1ChangeKg: se.rm1ChangeKg };
  }

  return (
    <div className="flex h-full flex-col bg-page">
      <header className="flex items-center gap-3 border-b px-4 pb-4 pt-safe">
        <button onClick={handleBackClick} aria-label="Back to sessions" className="rounded-lg p-2.5 hover:bg-muted transition">
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          {sessionType
            ? <h1 className="text-lg font-bold">{sessionType}</h1>
            : <div className="h-6 w-32 rounded bg-muted animate-pulse" />}

          <p className="text-sm text-muted-foreground">{today}</p>
          {phaseStatus && !phaseStatus.isDeloadActive && (
            <p className="text-xs text-muted-foreground">
              {phaseStatus.openEnded
                ? `${phaseStatus.phase.name} · Session ${phaseStatus.phaseSessionNumber}`
                : `${phaseStatus.phase.name} · Cycle ${phaseStatus.cycleInPhase}/${phaseStatus.totalPhaseCycles}`}
            </p>
          )}
        </div>
        <button
          onClick={onRefresh}
          // Q-86: this button's own re-fetch (workout-data + periodization status) resolves
          // from cache almost immediately, which used to leave it spinning-then-idle while an
          // unrelated AI generation (duration-preset switch or the auto-poll trigger) was still
          // running underneath — read as "I tapped refresh, nothing happened". Disabled/spinning
          // for the full `prescriptionPending` window instead of just its own fetch, and
          // disabled (not just visually busy) so a tap can't race the in-flight generation with
          // a second, redundant one.
          disabled={loading || prescriptionPending}
          aria-label="Refresh workout data"
          className="rounded-lg p-2.5 hover:bg-muted transition text-muted-foreground disabled:opacity-40"
          title="Refresh workout data"
        >
          <RefreshCwIcon className={cn("h-5 w-5", (loading || prescriptionPending) && "animate-spin")} />
        </button>
      </header>

      {phaseStatus?.isDeloadActive && (
        <div className="mx-4 mt-3 rounded-xl bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          {phaseStatus.phase.phaseType === 'deload'
            ? phaseStatus.openEnded
              ? `Deload — ${phaseStatus.phase.name} · Session ${phaseStatus.phaseSessionNumber}`
              : `Deload — ${phaseStatus.phase.name} · Cycle ${phaseStatus.cycleInPhase} of ${phaseStatus.totalPhaseCycles}`
            : `Recovery Week — Fatigue detected · ${phaseStatus.phase.name} paused`}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-28">
        {/* Cache-seeded: `periodization` paints instantly from the last-known state and
         *  revalidates in the background — don't gate on periodizationLoading, or a fresh
         *  fetch hides an already-available seed and the card pops in ~2s later. The skeleton
         *  below is reserved space for the true cold-start case only (no seed yet). */}
        {/* Today's intensity, above the phase-dependent block on purpose (Q-109-followup): it is a
            choice about today's session, not about an existing prescription. Gating it on one — as
            the duration picker below is — would leave no way to pick Deload before a prescription
            exists, which is exactly the case Home's old Deload button covered. */}
        {onDeloadChange && !phaseStatus?.isDeloadActive && (
          <DeloadToggle
            value={deload}
            disabled={prescriptionPending}
            recommended={deloadRecommended}
            prescribedDeload={
              // Derived from the prescription this screen already holds rather than passed in: the
              // label is a statement ABOUT that prescription, so reading it from anywhere else is
              // how the two came to disagree (BF-8). A consumed one describes a session that has
              // already run.
              periodization?.state.prescriptionStatus !== 'consumed'
              && !!periodization?.state.prescription?.deload
            }
            onChange={onDeloadChange}
          />
        )}
        {!loading && periodization && (
          <div className="mb-4">
            {periodization.state.phase === 'baseline' && !periodization.state.baselineComplete ? (
              <AiBaselineBanner
                exercises={periodization.signals.exercises.map(ex => ({
                  name: ex.name,
                  suggestedWeightKg: ex.current1rm != null ? mround125(ex.current1rm * 0.7) : null,
                }))}
              />
            ) : periodization.state.prescription && periodization.state.prescriptionStatus !== 'consumed' ? (
              <>
              {onDurationPresetChange && (
                <SessionDurationPicker
                  value={periodization.state.prescription.durationPreset ?? 'standard'}
                  standardMin={sessionBudgetMin ?? 60}
                  estimatedMin={periodization.state.prescription.estimatedSessionDurationMin}
                  disabled={prescriptionPending}
                  onChange={onDurationPresetChange}
                />
              )}
              <AiPrescriptionCard
                prescription={periodization.state.prescription}
                prescriptionStatus={periodization.state.prescriptionStatus}
                liveOneRm={liveOneRm}
                lastSetModeById={lastSetModeById}
                equipmentById={equipmentById}
                exerciseTypeById={exerciseTypeById}
                exerciseSignalsById={exerciseSignalsById}
                sessionId={periodization.state.programSessionId}
                onStatusChange={onPrescriptionStatusChange ?? (() => {})}
                onPhaseChanged={onPhaseChanged}
                overrideFull={overrideFull}
                overrideBlockedNames={overrideBlockedNames}
                overrideOutcome={deloadOverrideOutcome(exercises, overrideFull)}
              />
              </>
            ) : null}
          </div>
        )}
        {!loading && !periodization && periodizationLoading && (
          <div className="mb-4 h-24 animate-pulse rounded-2xl bg-muted" />
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {prescriptionGenTimedOut ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Couldn&apos;t generate your AI prescription just now — showing your base program. Tap refresh to try again.</span>
              </div>
            ) : null}
            {/* While a fresh AI prescription regenerates, keep the (base-program) list on
                screen and swap only this heading — plus hold the Start button below. The old
                full-screen "Preparing" takeover replaced the already-painted list, which read
                as a numbers→preparing→numbers flash on every open. An in-place heading swap is
                the same one line at the same height, so nothing reflows. */}
            <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground font-medium uppercase tracking-wide">
              {prescriptionPending ? (
                <>
                  <RefreshCwIcon className="h-3.5 w-3.5 animate-spin text-[var(--color-brand)]" aria-hidden />
                  Preparing your AI workout…
                </>
              ) : (
                "Recommended workout"
              )}
            </p>
            {exercises.map((ex, idx) => {
              const doneToday = todayLogged.has(ex.name) || ex.loggedTodayInSession;
              return (
                <div
                  key={`${ex.name}-${idx}`}
                  className={cn(
                    "w-full flex items-center justify-between rounded-xl px-3 py-3 transition-all border",
                    doneToday
                      ? "border-green-500/30 bg-green-500/10"
                      : "border-border bg-muted/80",
                  )}
                  style={!doneToday ? { background: "linear-gradient(135deg, color-mix(in oklch, var(--color-brand) 15%, transparent), color-mix(in oklch, var(--color-brand) 5%, transparent))", borderColor: "color-mix(in oklch, var(--color-brand) 35%, transparent)" } : {}}
                >
                  <div className="min-w-0 flex-1">
                    <button
                      className="w-full text-left hover:opacity-80 active:scale-[0.99] transition-all"
                      onClick={() => setStatsExercise(ex)}
                    >
                      <p className="font-medium truncate flex items-center gap-2">
                        {ex.name}
                        {doneToday && <CheckIcon className="h-4 w-4 text-green-500 flex-none" />}
                      </p>
                      {((ex.mainMuscles?.length ?? 0) + (ex.secondaryMuscles?.length ?? 0) > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(ex.mainMuscles ?? []).map(m => (
                            <span key={m} className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium bg-brand/20 text-brand">
                              {m}
                            </span>
                          ))}
                          {(ex.secondaryMuscles ?? []).map(m => (
                            <span key={m} className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium border border-brand/40 text-brand/80">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                      {ex.styleName && !ex.progressionStyle && (
                        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-0.5"><TriangleAlertIcon className="w-3 h-3" /> Style not found</p>
                      )}
                      {ex.lastDate ? (
                        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                          {(() => {
                            const reps = avgReps(ex.lastReps, 'floor');
                            const weight = modalWeight(ex.lastSetWeights ?? []);
                            const parts: string[] = [];
                            if (reps != null && weight != null) parts.push(`${reps} × ${weight}kg`);
                            else if (reps != null) parts.push(`${reps} reps`);
                            if (ex.estimated1rm != null) {
                              parts.push(ex.exerciseType === "bodyweight"
                                ? `${displayOneRm(ex.estimated1rm, "bodyweight").text}`
                                : `est 1RM ~${Math.round(ex.estimated1rm)}kg`);
                            }
                            return parts.join(" · ");
                          })()}
                          {" · "}
                          {formatSheetDate(ex.lastDate)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">No previous data</p>
                      )}
                    </button>
                    {/* Sibling real button, not nested in the stats button above (UI-1) */}
                    {(ex.deloaded || ex.deloadReverted) && (
                      <button
                        type="button"
                        onClick={() => setDeloadExercise(ex)}
                        className={cn(
                          // Grown to ~25px of real ink rather than given an invisible box: the
                          // stats button above is a sibling 4px away, and a hit area that reached
                          // into it would win the overlap (later in DOM order) and swallow taps
                          // meant for it — the failure mode Q-160 measured on the carousel dots.
                          "tap-dense mt-1.5 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium",
                          ex.deloaded
                            ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        <BatteryLowIcon className="h-3 w-3" />
                        {ex.deloaded ? (ex.deloadNote ?? "Deload") : "Deload off — full weights"}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-none items-center gap-2 self-center pl-2">
                    <RoleChip role={exerciseSignalsById[ex.sessionExerciseId]?.role} />
                    {doneToday && (
                      <button
                        onClick={() => onLaunchExercise(idx, true)}
                        aria-label="Re-log this exercise"
                        className="flex-none rounded-lg p-2.5 text-muted-foreground hover:bg-green-100 dark:hover:bg-green-900 hover:text-foreground transition"
                        title="Re-log this exercise"
                      >
                        <RotateCcwIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t px-4 pt-4 pb-safe-action-lg">
        {allDoneToday && !workoutActive ? (
          // E1-3: everything's logged but there's no active workout (already completed
          // earlier today, or app restarted). The green "Complete Workout" CTA here
          // would complete a freshly-minted, never-created session id → 404 + a
          // dead-lettering outbox mutation + an empty done screen. Show a done state.
          <div className="flex h-14 w-full items-center justify-center rounded-md bg-green-500/10 text-base font-semibold text-green-600">
            <CheckIcon className="mr-2 h-5 w-5" />
            Done for today
          </div>
        ) : allDoneToday ? (
          <Button
            className="w-full h-14 text-base font-semibold bg-green-500 hover:bg-green-600 text-white"
            onClick={onCompleteWorkout}
          >
            <CheckIcon className="mr-2 h-5 w-5" />
            Complete Workout
          </Button>
        ) : workoutActive ? (
          <Button
            className="w-full h-14 text-base font-semibold bg-brand hover:opacity-90 text-brand-foreground"
            disabled={loading || exercises.length === 0}
            onClick={onContinueWorkout}
          >
            <DumbbellIcon className="mr-2 h-5 w-5" />
            Continue Workout
          </Button>
        ) : (
          <Button
            className="w-full h-14 text-base font-semibold bg-brand hover:opacity-90 text-brand-foreground"
            disabled={loading || exercises.length === 0 || prescriptionPending}
            onClick={() => setCountingDown(true)}
          >
            {prescriptionPending ? (
              <>
                <RefreshCwIcon className="mr-2 h-5 w-5 animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <DumbbellIcon className="mr-2 h-5 w-5" />
                Start Workout
              </>
            )}
          </Button>
        )}
      </div>

      {/* Countdown overlay — self-ticking leaf, see start-workout-countdown.tsx (PRF-16) */}
      {countingDown && (
        <StartWorkoutCountdown
          from={3}
          onComplete={() => { onStartWorkoutRef.current(); setCountingDown(false); }}
          onCancel={() => setCountingDown(false)}
        />
      )}

      <ExerciseStatsSheet
        exercise={statsExercise}
        isDoneToday={statsExercise
          ? (todayLogged.has(statsExercise.name) || statsExercise.loggedTodayInSession)
          : false}
        onClose={() => setStatsExercise(null)}
        onRedo={() => {
          if (statsExercise) {
            const idx = exercises.findIndex(e => e.name === statsExercise.name);
            if (idx !== -1) onLaunchExercise(idx, true);
          }
        }}
      />

      <DeloadInfoSheet
        exercise={deloadExercise}
        onClose={() => setDeloadExercise(null)}
        onToggleRevert={(name) => onToggleDeloadRevert?.(name)}
      />

      <LeaveWorkoutDialog
        open={confirmBackOpen}
        onStay={() => setConfirmBackOpen(false)}
        onLeave={() => {
          setConfirmBackOpen(false);
          onLeaveWorkout?.();
          router.back();
        }}
      />
    </div>
  );
}
