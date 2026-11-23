import { capitalize } from '@trainingai/shared/format/capitalize';
import { plural } from '@trainingai/shared/format/plural';
import { normalizeMuscle } from '@trainingai/shared/muscles';
import type { ExercisePreview } from '../catalog';
import { loadLabel, weightUnitOf } from '../logging/preferences';
import { initialWeight } from '../logging/targets';
import { intensityToggleModel } from './intensity-toggle';

// The AI plan's pre-workout screen (#3900, mockup 1A): one card for the day's plan, one Start, and
// Deload as a quiet second choice. This is its view model, so each state's header, button and
// controls can be tested without rendering. Every figure is one the app already has: the lift's
// numbers are the session list's (what Start will train), "last time" is `lastWeights`, the note is
// the plan's own `autoregNote`, and the minutes are the toggle model's (`intensityToggleModel`).

/** Lifts drawn before "+ N more". */
export const PLAN_ROWS_SHOWN = 3;

export type PlanPrescription = {
  phase: string;
  phaseAction: string;
  reasoning: string;
  deload?: boolean;
  estimatedSessionDurationMin: number;
  fullSession?: { estimatedSessionDurationMin: number } | null;
  exercises?: readonly { sessionExerciseId: string; autoregNote?: string }[];
};

export type PlanStartInput = {
  /** The program's kind is `ai_dynamic`. Any other kind keeps its screen as it is. */
  aiDynamic: boolean;
  sessionId: string;
  sessionName: string;
  isBaseline: boolean;
  /** The lifts as Start will train them (after Full / Deload is applied). */
  exercises: readonly ExercisePreview[];
  /** The session as the server sent it, before Full puts any weights back. */
  asSent: readonly ExercisePreview[];
  durationMinutes: number | null;
  /** The phase as the screen already words it ("Accumulation · Session 3"). */
  phaseDetail: string | null;
  /** The plan being made right now (`aiPrescriptionPending`). */
  preparing: boolean;
  /** The stored prescription, already hidden when aged out; null when there is none. */
  prescription: PlanPrescription | null | undefined;
  prescriptionStatus: string | undefined;
  /** The Deload side is chosen today. */
  deloadChosen: boolean;
  /** A workout is under way (any session); its stored type once it started. */
  active: { sessionId: string; sessionName: string; intensityMode: 'full' | 'deload' } | null;
  units: Record<string, 'kg' | 'lb'>;
  suggestedToday?: boolean;
  /** Lifts already logged today. */
  completedIds?: readonly string[];
  /** Normalised muscles with a recorded injury. */
  injuredMuscles?: readonly string[];
};

export type PlanRow = {
  id: string;
  name: string;
  /** "3 × 8 @ 82.5 kg" ("3 × 8" for a bodyweight lift). */
  scheme: string;
  /** The change since last time, in the lift's own unit; null when the load is the same or unknown. */
  change: { direction: 'up' | 'down'; amount: string } | null;
  /** The plan's note for this lift; null on a deloaded lift, as on the web card. */
  note: string | null;
  done: boolean;
  /** The lift works a muscle with a recorded injury. */
  injured: boolean;
  deloaded: boolean;
  superset: boolean;
};

export type PlanSuggestion = {
  title: string;
  message: string;
  /** Its own button. Never replaces or blocks Start. */
  action: { kind: 'rest' | 'accept'; label: string } | null;
};

export type PlanStartModel = {
  header: string;
  meta: string;
  rows: PlanRow[];
  /** The plan's reasoning, drawn wrapped under the rows. */
  reason: string | null;
  suggestion: PlanSuggestion | null;
  start: { label: string };
  /** Quiet link under Start; null while a workout is under way or on a baseline. */
  link: { kind: 'deload' | 'full'; label: string } | null;
  /** The stored type, shown as a label once a workout of this session is under way. */
  typeLabel: string | null;
  preparing: boolean;
};

/** The Start button's wording while a workout is under way. */
export function resumeLabel(active: { sessionId: string; sessionName: string }, sessionId: string) {
  return active.sessionId === sessionId ? 'Resume workout' : `Resume ${active.sessionName}`;
}

const lifted = (exercise: ExercisePreview) => exercise.exerciseType === 'weighted';

function plannedLoads(exercise: ExercisePreview) {
  return exercise.sets.flatMap((set) => {
    const weight = initialWeight(exercise, set);
    return weight === null ? [] : [weight];
  });
}

function range(values: number[], format: (value: number) => string) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? format(low) : `${format(low)}–${format(high)}`;
}

function scheme(exercise: ExercisePreview, unit: 'kg' | 'lb') {
  const reps = exercise.sets.map((set) => set.reps);
  const count = exercise.setCount;
  if (!reps.length) {
    return plural(count, 'set', 'sets');
  }
  const base = `${count} × ${range(reps, String)}`;
  const loads = lifted(exercise) ? plannedLoads(exercise) : [];
  if (!loads.length) {
    return base;
  }
  // "80–85 kg": one unit at the end of a range.
  const low = Math.min(...loads);
  const high = Math.max(...loads);
  return low === high
    ? `${base} @ ${loadLabel(low, unit)}`
    : `${base} @ ${loadLabel(low, unit).replace(/ (kg|lb)$/, '')}–${loadLabel(high, unit)}`;
}

function change(exercise: ExercisePreview, unit: 'kg' | 'lb'): PlanRow['change'] {
  if (!lifted(exercise) || !exercise.lastWeights.length) {
    return null;
  }
  const loads = plannedLoads(exercise);
  if (!loads.length) {
    return null;
  }
  const delta = Math.max(...loads) - Math.max(...exercise.lastWeights);
  // Compared as the lifter reads them: a difference that rounds to nothing is "the same".
  const amount = loadLabel(Math.abs(delta), unit).replace(/ (kg|lb)$/, '');
  if (Number(amount) === 0) {
    return null;
  }
  return { direction: delta > 0 ? 'up' : 'down', amount };
}

function suggestionOf(
  prescription: PlanPrescription | null | undefined,
  status: string | undefined,
): PlanSuggestion | null {
  if (!prescription) {
    return null;
  }
  const message = prescription.reasoning.trim();
  if (prescription.phaseAction === 'rest_day_recommended') {
    return {
      title: 'A rest day is suggested',
      message,
      action: { kind: 'rest', label: 'Rest today' },
    };
  }
  if (prescription.phaseAction === 'session_swap_recommended') {
    // Preview has no swap action today, so the note stands alone.
    return { title: 'A different session is suggested', message, action: null };
  }
  // A phase move still waiting (a program before its switch-over, or an old cached plan): the one
  // place Accept remains.
  if (status === 'pending' && prescription.phaseAction === 'transition_recommended') {
    return {
      title: `A move to ${capitalize(prescription.phase)} is waiting`,
      message: 'Start still works with your program as written.',
      action: { kind: 'accept', label: `Accept move to ${capitalize(prescription.phase)}` },
    };
  }
  return null;
}

/** The AI plan's screen model; null on every other kind of program, whose screen is unchanged. */
export function planStartModel(input: PlanStartInput): PlanStartModel | null {
  if (!input.aiDynamic) {
    return null;
  }
  const { prescription, deloadChosen, active } = input;
  const prescribedDeload = !!prescription?.deload;
  const toggle = intensityToggleModel({
    prescription,
    exercises: input.asSent,
    deloadChosen,
    suggestedToday: !!input.suggestedToday,
  });
  const notes = new Map(
    (prescription?.exercises ?? []).map((row) => [row.sessionExerciseId, row.autoregNote?.trim()]),
  );
  const rows = input.exercises.map((exercise): PlanRow => {
    const unit = weightUnitOf(input.units, exercise.id);
    return {
      id: exercise.id,
      name: exercise.name,
      scheme: scheme(exercise, unit),
      change: change(exercise, unit),
      note: !exercise.deloaded && notes.get(exercise.id) ? (notes.get(exercise.id) ?? null) : null,
      done: (input.completedIds ?? []).includes(exercise.id),
      injured: [
        ...exercise.muscles,
        ...(exercise.mainMuscles ?? []),
        ...(exercise.secondaryMuscles ?? []),
      ].some((muscle) => (input.injuredMuscles ?? []).includes(normalizeMuscle(muscle))),
      deloaded: exercise.deloaded,
      superset: exercise.supersetGroup != null,
    };
  });
  const phase = input.phaseDetail ?? (prescription ? capitalize(prescription.phase) : null);
  const header = deloadChosen
    ? `Today's plan · Deload · ${prescribedDeload ? 'prescribed' : 'your choice'}`
    : prescribedDeload
      ? "Today's plan · Full · your choice"
      : phase
        ? `Today's plan · ${phase}`
        : "Today's plan";
  const minutes = toggle.card?.minutes ?? input.durationMinutes;
  const count = plural(rows.length, 'exercise', 'exercises');
  const suggestion = suggestionOf(prescription, input.prescriptionStatus);
  // A rest or swap plan's text is in its note above Start; the card does not say it twice.
  const restOrSwap = ['rest_day_recommended', 'session_swap_recommended'].includes(
    prescription?.phaseAction ?? '',
  );
  const reason = !prescription || restOrSwap ? null : toggle.card?.reason.trim() || null;
  return {
    header,
    meta: `${count}${minutes != null ? ` · about ${Math.round(minutes)} min` : ''}`,
    rows,
    reason,
    suggestion,
    start: {
      label: active
        ? resumeLabel(active, input.sessionId)
        : deloadChosen
          ? 'Start deload'
          : 'Start workout',
    },
    link:
      active || input.isBaseline
        ? null
        : deloadChosen
          ? { kind: 'full', label: 'Train full instead' }
          : { kind: 'deload', label: 'Deload today instead' },
    typeLabel:
      active && active.sessionId === input.sessionId
        ? active.intensityMode === 'deload'
          ? 'Deload session'
          : 'Full session'
        : null,
    preparing: input.preparing,
  };
}
