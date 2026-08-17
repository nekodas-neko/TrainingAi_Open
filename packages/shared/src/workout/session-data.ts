import type { StyleSet, ProgressionStyle } from "@trainingai/shared/types/progression";
import type { ProgramPhase, ProgramSession, ExerciseLibraryEntry, ExerciseType } from "@trainingai/shared/types/program";
import type { ExerciseLog } from "@trainingai/shared/types/log";
import type { AiPrescription } from "@trainingai/shared/types/ai-periodization";
import { resolveStyleForExercise, deloadAwareStylePhase } from "@trainingai/shared/phase-engine";
import { prescriptionStyleForExercise } from "@trainingai/shared/ai-periodization/apply-prescription";
import { deloadOverrideForGoal, deloadStyleForGoal } from "@trainingai/shared/ai-periodization/deload-constants";
import { accessoryTargetRpe } from "@trainingai/shared/ai-periodization/goal-ranges";
import { pctForExpectedRpe } from "@trainingai/shared/ai-periodization/expected-rpe";
import { resolveBodyweightStyle, resolveWorkingBasis } from "@trainingai/shared/1rm";
import { toAestDateStr } from "@trainingai/shared/date-utils";

export interface PerSessionPhaseStatus {
  sessionId: string
  sessionName: string
  phaseStatus: PhaseStatus
}

export interface PhaseStatus {
  phase: ProgramPhase
  cycleInPhase: number
  totalPhaseCycles: number
  completedCycles: number
  totalProgramCycles: number
  sessionsPerCycle: number
  sessionsInCurrentCycle: number
  blockComplete: boolean
  approxWeeksRemaining: number | null
  isDeloadActive: boolean
  isBaseline: boolean
  /** ai_dynamic phases have no fixed cycle count — cycleInPhase/totalPhaseCycles are always 1/1
   *  and meaningless as a "cycle X/Y" label. Clients show "Phase · Session N" instead when set. */
  openEnded?: boolean
  phaseSessionNumber?: number
}

/**
 * Phase status for an ai_dynamic session that none of the earlier, more specific branches in
 * /api/workout-data claimed — not the AMRAP baseline, and not a deload week the user confirmed
 * themselves (the `?aiDeload=1` toggle or Home's "Take deload week now" card).
 *
 * Q-310: this catch-all lived as two verbatim copies in that route, and both hardcoded
 * `isDeloadActive: false` / `phaseType: 'normal'` on the belief that a deload could only arrive
 * through one of the branches above. It also arrives here — when the AI periodization engine
 * chooses `phase: 'deload'` off accumulated fatigue, nobody confirms anything, so this is the
 * only branch left to catch it. The phase NAME title-cased correctly to "Deload" from the same
 * field the flag ignored, which is why the owner saw a session labelled Deload prescribing full
 * weights. One helper, one place, so the two call sites cannot disagree again.
 */
export function aiDynamicFallbackPhaseStatus(
  state: { phase: string; sessionsInPhase: number },
): PhaseStatus {
  const isDeload = state.phase === 'deload'
  return {
    phase: {
      id: '', phaseSetId: '', position: 0,
      name: state.phase.charAt(0).toUpperCase() + state.phase.slice(1),
      durationCycles: 1,
      phaseType: isDeload ? 'deload' : 'normal',
    } as ProgramPhase,
    cycleInPhase: 1,
    totalPhaseCycles: 1,
    completedCycles: state.sessionsInPhase,
    totalProgramCycles: 0,
    sessionsPerCycle: 1,
    sessionsInCurrentCycle: 0,
    blockComplete: false,
    approxWeeksRemaining: null,
    isDeloadActive: isDeload,
    isBaseline: false,
    openEnded: true,
    phaseSessionNumber: state.sessionsInPhase + 1,
  }
}

export interface WorkoutExercise {
  name: string;
  // session_exercises row id — the stable identity AI prescriptions key by (AiPrescriptionExercise
  // .sessionExerciseId). Session identity = DB id, not name (two exercises can share a name).
  sessionExerciseId: string;
  latestWeight: number | null;
  lastSetWeights: number[];
  estimated1rm: number | null;
  // All-time PR 1RM (from personal_records) — distinct from `estimated1rm`, which is
  // the LAST session's estimate. The exercise-summary "New Personal Record!" badge
  // must beat this, not merely last session (E1-7).
  allTimePr1rm: number | null;
  target80: number | null;
  lastDate: string | null;
  defaultSets: number;
  lastSets: number | null;
  lastReps: (number | null)[];
  progressionStyle: StyleSet[] | null;
  styleName: string | null;
  styleId?: string;
  muscleGroups?: string[];
  mainMuscles?: string[];
  secondaryMuscles?: string[];
  exerciseRole?: string;
  instructions?: string;
  exerciseType: ExerciseType;
  equipment?: string[];
  // Exercises sharing a non-null group value alternate as a superset — null
  // for ungrouped exercises and always null when an AI-dynamic prescription
  // drives this session (v1 scope: supersets don't apply to AI-dynamic).
  supersetGroup?: number | null;
  loggedTodayInSession: boolean;
  // When an AI prescription drives this exercise, the final working set is pushed to grow
  // 1RM: 'amrap' (compounds — beat the target reps) or 'plus1' (accessories — one extra rep).
  lastSetMode?: 'amrap' | 'plus1';
  // Per-exercise deload (soreness): chip + revert sheet on the pre-workout screen.
  // preDeloadStyle/preDeloadSets are the model's original prescription, expanded
  // server-side, so "Use full weights" is a pure client-side swap.
  deloaded?: boolean;
  deloadNote?: string;
  preDeloadStyle?: StyleSet[];
  preDeloadSets?: number;
  // Client-only: set by applyDeloadReverts when the user opted back to full weights.
  deloadReverted?: boolean;
}

/** Structural mirror of the repository's `LastRealOneRm` — declared here so `packages/shared`
 *  stays free of an import back into `lib/`. */
export interface LastRealOneRmLike {
  estimated1rm: number
  target80: number | null
}

// All resolved inputs the per-exercise mapping reads. Identical whether the single-tab
// route path or the read-only ?tab=all batch computes them, so both call this one function
// and can never drift.
export interface BuildWorkoutExercisesCtx {
  lastLogs: Map<string, ExerciseLog>;
  /** Last NON-DELOAD 1RM per exercise — the prescription basis since Q-202. Separate from
   *  `lastLogs`, which stays the genuinely most recent log so the screen still shows what was
   *  actually lifted last time. Optional so a caller that has not been migrated degrades to
   *  the seed/PR fallback rather than silently prescribing from a deload. */
  lastRealOneRm?: Map<string, LastRealOneRmLike>;
  prMap: Map<string, number>;
  /** User-entered starting 1RMs (`exercise_estimates`), keyed by exercise name. */
  estimateMap?: Map<string, number>;
  styleById: Map<string, StyleSet[]>;
  styleByName: Map<string, StyleSet[]>;
  styles: ProgressionStyle[];
  libByName: Map<string, ExerciseLibraryEntry>;
  currentPhase: ProgramPhase | null;
  allPhases: ProgramPhase[];
  // True during a confirmed early-deload window (or a natural deload phase). When set and the
  // natural phase isn't already a deload phase, style resolution swaps in the program's deload
  // phase so the prescribed load is genuinely reduced (W5 §4.1).
  isDeloadActive: boolean;
  isBaselinePhase: boolean;
  aiDrivesLoad: boolean;
  aiPrescription: AiPrescription | null;
  aiPhaseLabel: string;
  isAiDynamic: boolean;
  aiDeload: boolean;
  droppedThisCycle: Set<string>;
  loggedTodayInThisSession: Set<string>;
  trainingGoal: string;
}

// Pure mapping from a program session's exercises to the client-facing WorkoutExercise[].
// No DB access, no side effects — every input arrives resolved in `ctx`. This is the exact
// body the single-tab route path used inline; extracting it lets the read-only ?tab=all
// batch reuse it verbatim.
export function buildWorkoutExercises(
  programSession: ProgramSession,
  ctx: BuildWorkoutExercisesCtx,
): WorkoutExercise[] {
  const {
    lastLogs, lastRealOneRm, prMap, estimateMap, styleById, styleByName, styles, libByName,
    currentPhase, allPhases, isDeloadActive, isBaselinePhase, aiDrivesLoad, aiPrescription,
    aiPhaseLabel, isAiDynamic, aiDeload, droppedThisCycle,
    loggedTodayInThisSession, trainingGoal,
  } = ctx;

  // Early-deload style substitution (W5 §4.1) — see deloadAwareStylePhase.
  const styleResolutionPhase = deloadAwareStylePhase(currentPhase, allPhases, isDeloadActive)

  return programSession.exercises
    .filter((ex) => !droppedThisCycle.has(ex.id))
    .map((ex) => {
      const lastLog = lastLogs.get(ex.exerciseName) ?? null;

      // Phase-aware style resolution: let the phase engine pick the style in automatic mode
      let effectiveStyleId: string | null = ex.styleId ?? null
      if (styleResolutionPhase && allPhases.length > 0) {
        const resolved = resolveStyleForExercise(styleResolutionPhase, allPhases, {
          exerciseRole: ex.exerciseRole ?? 'primary',
          styleId: ex.styleId,
        })
        if (resolved !== 'own') effectiveStyleId = resolved
      }

      const resolvedStyle = effectiveStyleId
        ? (styleById.get(effectiveStyleId) ?? null)
        : (lastLog?.styleName ? (styleByName.get(lastLog.styleName) ?? null) : null);

      const lastSetWeights = lastLog?.sets.map(s => s.weightKg) ?? [];
      const lastReps = lastLog?.sets.map(s => s.reps) ?? [];

      // Static-style progression by default
      let defaultSets = isBaselinePhase ? 1 : (resolvedStyle?.length ?? 3)
      let progressionStyle: StyleSet[] | null = isBaselinePhase
        ? null
        : resolvedStyle
          ? resolvedStyle.map(s => ({ pct: s.pct, reps: s.reps, restSec: s.restSec, useFor1rm: s.useFor1rm } as StyleSet))
          : null
      let styleName = isBaselinePhase ? null : (styles.find(s => s.id === effectiveStyleId)?.name ?? lastLog?.styleName ?? null)

      // AI prescription override — the phase-appropriate pct/sets/reps reach the bar.
      // Exercises absent from the prescription keep their static style.
      let lastSetMode: 'amrap' | 'plus1' | undefined
      let deloaded: boolean | undefined
      let deloadNote: string | undefined
      let preDeloadStyle: StyleSet[] | null = null
      let preDeloadSets: number | undefined
      let aiStyleApplied = false
      if (aiDrivesLoad) {
        const p = aiPrescription!.exercises.find(e => e.sessionExerciseId === ex.id)
        if (p) {
          aiStyleApplied = true
          progressionStyle = prescriptionStyleForExercise(p)
          defaultSets = p.sets
          styleName = `AI · ${aiPhaseLabel}`
          if (p.deloaded) {
            deloaded = true
            deloadNote = p.deloadNote
            if (p.preDeload) {
              preDeloadStyle = prescriptionStyleForExercise({ ...p, ...p.preDeload })
              preDeloadSets = p.preDeload.sets
            }
          } else if (aiDeload || isDeloadActive) {
            // Manual Home "Deload" choice (Q-109) — `aiDeload` previously only set cosmetic
            // phase-status/logging metadata and never touched the actual prescribed load once
            // an AI-dynamic prescription was driving it, so picking Deload from Home produced
            // identical numbers to a normal Full session. Applies the same whole-session
            // override the automatic emergency/soreness deload paths use
            // (deloadOverrideForGoal), skipped when the exercise is already deloaded by the
            // automatic engine above so the two reductions don't compound. Reuses
            // preDeloadStyle/preDeloadSets so the existing revert-to-full-weights UI
            // (DeloadInfoSheet) works for a manual deload too.
            // `isDeloadActive` joins it for Q-175: a deload week confirmed from Home sets no
            // `aiDeload` param, so the two entry points only converge if both are read here.
            // Same helper as the un-prescribed branch below (Q-185), so the two cannot drift.
            // Output is identical to the old spread through prescriptionStyleForExercise:
            // that set `useFor1rm: !presc.deloaded`, which was always false here.
            const override = deloadOverrideForGoal(trainingGoal)
            preDeloadStyle = progressionStyle
            preDeloadSets = defaultSets
            progressionStyle = deloadStyleForGoal(trainingGoal) as StyleSet[]
            defaultSets = override.sets
            deloaded = true
            deloadNote = "Deload"
          }
        }
      }

      // Q-185: every reduction above lives inside `if (aiDrivesLoad)` and keys off a
      // prescription entry, so an exercise the AI does not name never reached one. Measured on
      // the running dev server: during a confirmed deload week, two prescribed lifts came back
      // at 50% / 2 sets beside an accessory unchanged at its base style, 75% / 3 sets. A whole
      // session whose prescription is missing or expired was worse — every exercise at full
      // load with `isDeloadActive: true` on its own phase status.
      //
      // Owner decision 2026-08-12: lighten them too, so a deload week means what it says.
      //
      // Static programs are deliberately excluded. They have `ProgramPhase` rows, so
      // `deloadAwareStylePhase` has already swapped in the deload phase's style above, and
      // reducing again here would compound the two. An ai_dynamic program has no phase rows and
      // therefore nothing to swap to — which is exactly why only it needs this.
      //
      // No `!isBaselinePhase` clause here, deliberately: it is unreachable. A baseline phase
      // sets `progressionStyle` to null, so an un-prescribed exercise is stopped by the length
      // check; and a PRESCRIBED one has already been deloaded by the AI branch above, so
      // `!deloaded` stops it. Verified by mutation — deleting such a clause failed zero tests.
      // (That the AI branch deloads a baseline lift at all contradicts the baseline carve-out
      // `estimateOneRm`/`shouldCountTowardPr` apply — filed as Q-211, pre-existing.)
      if (
        !deloaded && isAiDynamic &&
        (aiDeload || isDeloadActive) &&
        progressionStyle && progressionStyle.length > 0
      ) {
        const override = deloadOverrideForGoal(trainingGoal)
        preDeloadStyle = progressionStyle
        preDeloadSets = defaultSets
        progressionStyle = deloadStyleForGoal(trainingGoal) as StyleSet[]
        defaultSets = override.sets
        deloaded = true
        deloadNote = "Deload"
      }

      // Last-set push to grow 1RM — applies to any AI-dynamic working set, whether the AI
      // prescription is driving or the session is still on the base style (e.g. the first
      // session before the first prescription is generated). Keep fatigue sane: only the main
      // lift goes AMRAP; secondary compounds and accessories take a controlled +1 rep.
      if (isAiDynamic && !isBaselinePhase && progressionStyle && progressionStyle.length > 0) {
        lastSetMode = (ex.exerciseRole ?? 'primary') === 'primary' ? 'amrap' : 'plus1'
      }

      const libEntry = libByName.get(ex.exerciseName.toLowerCase())

      // Bodyweight: prescribe reps as % of the rep max (from the personal record so an
      // easy day never lowers targets), round down, min 1. See resolveBodyweightStyle's
      // own comment for why this gates on the per-exercise aiStyleApplied, not the
      // session-level aiDrivesLoad.
      const bwType = libEntry?.exerciseType ?? 'weighted';

      // Base-style accessory intensity: when an AI-dynamic accessory is still on its base style
      // (no AI prescription driving it yet — exactly the state that produced the owner's light
      // 60% reading), derive each set's load from the goal target RPE instead of the stored light
      // %. Keeps effort constant across the set's reps. Weighted only (bodyweight carries no %1RM);
      // skipped on baseline/deload and when the AI prescription already set the load.
      if (
        isAiDynamic && !isBaselinePhase && !aiDeload && !isDeloadActive && !aiStyleApplied &&
        bwType === 'weighted' && (ex.exerciseRole ?? 'primary') === 'accessory' &&
        progressionStyle && progressionStyle.length > 0
      ) {
        const targetRpe = accessoryTargetRpe(trainingGoal);
        progressionStyle = progressionStyle.map(s => ({
          ...s,
          pct: Math.min(85, Math.max(40, pctForExpectedRpe(targetRpe, s.reps))),
        }));
      }

      progressionStyle = resolveBodyweightStyle({
        bwType,
        style: progressionStyle,
        isBaselinePhase,
        aiStyleApplied,
        basis: resolveWorkingBasis({
          lastNonDeload1rm: lastRealOneRm?.get(ex.exerciseName)?.estimated1rm,
          seedEstimate: estimateMap?.get(ex.exerciseName),
          allTimePr1rm: prMap.get(ex.exerciseName),
        }) ?? 0,
      });

      return {
        name: ex.exerciseName,
        sessionExerciseId: ex.id,
        latestWeight: lastSetWeights[0] ?? null,
        lastSetWeights,
        // One resolver for every weight path (Q-5). This used to read the last log alone,
        // so a user-entered starting 1RM never reached the bar and the workout screen fell
        // through to a hardcoded 60 kg.
        estimated1rm: resolveWorkingBasis({
          lastNonDeload1rm: lastRealOneRm?.get(ex.exerciseName)?.estimated1rm,
          seedEstimate: estimateMap?.get(ex.exerciseName),
          allTimePr1rm: prMap.get(ex.exerciseName),
        }),
        allTimePr1rm: prMap.get(ex.exerciseName) ?? null,
        // From the last NON-DELOAD session, not the last log (Q-202). A deload row stores
        // target_80 = 0, and this field is both the displayed target and the value the weight
        // dial pre-fills to — so reading it off the last log showed "0 kg" and started every
        // set at zero for the whole session after a deload.
        target80: lastRealOneRm?.get(ex.exerciseName)?.target80 ?? lastLog?.target80 ?? null,
        lastDate: lastLog?.loggedAt ? toAestDateStr(lastLog.loggedAt) : null,
        defaultSets,
        lastSets: lastLog?.sets.length ?? null,
        lastReps,
        progressionStyle,
        styleName,
        styleId: effectiveStyleId ?? undefined,
        exerciseRole: ex.exerciseRole ?? 'primary',
        muscleGroups: ex.muscleGroups,
        mainMuscles: libEntry?.muscles.filter(m => m.role === "main").map(m => m.muscle) ?? ex.muscleGroups,
        secondaryMuscles: libEntry?.muscles.filter(m => m.role === "secondary").map(m => m.muscle) ?? [],
        instructions: libEntry?.instructions,
        exerciseType: libEntry?.exerciseType ?? 'weighted',
        equipment: libEntry?.equipment,
        loggedTodayInSession: loggedTodayInThisSession.has(ex.exerciseName),
        lastSetMode,
        deloaded,
        deloadNote,
        preDeloadStyle: preDeloadStyle ?? undefined,
        preDeloadSets,
        // AI-dynamic prescriptions flatten supersets (v1 scope decision).
        supersetGroup: aiDrivesLoad ? null : (ex.supersetGroup ?? null),
      } satisfies WorkoutExercise;
    });
}
