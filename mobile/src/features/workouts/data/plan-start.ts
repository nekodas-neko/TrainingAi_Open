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
  exercises?: readonly { sessionExerciseId: string; autoregNote?: string; deloadNote?: string }[];
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
  /** The Deload side is on screen: chosen today and its rows have loaded. */
  deloadChosen: boolean;
  /** A deload was asked for and its rows are still loading: the link is busy, the card unchanged. */
  deloadLoading?: boolean;
  /** Why a requested deload is not on screen ("Could not load the deload. …"); null otherwise. */
  deloadFailure?: string | null;
  /**
   * Each lift's top load from the last completed session of this type that was not a deload, in
   * kg, keyed by lift id (`lastComparableLoads`). A lift with no entry has no comparison.
   */
  previousTops?: Readonly<Record<string, number>>;
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
  /** The plan's reasoning, drawn wrapped under the rows; null while the plan is only pending. */
  reason: string | null;
  /** Lines the card draws under the rows, each a fact about what will be trained. */
  notes: string[];
  /** A deload that could not be loaded: said at the top of the card. */
  failure: string | null;
  /** How many notes sit on lifts behind "+ N more", so the collapsed card can say so. */
  notesBehindMore: number;
  suggestion: PlanSuggestion | null;
  start: { label: string };
  /** Quiet link under Start; null while a workout is under way or on a baseline. */
  link: { kind: 'deload' | 'full'; label: string; busy: boolean } | null;
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

function change(
  exercise: ExercisePreview,
  unit: 'kg' | 'lb',
  previousTop: number | undefined,
  dayIsDeload: boolean,
): PlanRow['change'] {
  // An arrow means "this lift's planned load moved since the last comparable session": none on a
  // deload day or a deloaded lift, an unloaded lift, or when either number is missing.
  if (dayIsDeload || exercise.deloaded || !lifted(exercise) || !previousTop || previousTop <= 0) {
    return null;
  }
  const loads = plannedLoads(exercise);
  if (!loads.length) {
    return null;
  }
  const top = Math.max(...loads);
  if (top <= 0) {
    return null;
  }
  const delta = top - previousTop;
  // Compared as the lifter reads them: a difference that rounds to nothing is "the same".
  const amount = loadLabel(Math.abs(delta), unit).replace(/ (kg|lb)$/, '');
  if (Number(amount) === 0) {
    return null;
  }
  return { direction: delta > 0 ? 'up' : 'down', amount };
}

type JournalWorkout = {
  sessionId: string;
  status: string;
  intensityMode: string;
  startedAt: number;
  exercises: readonly {
    id: string;
    exerciseType: string;
    weightUnit: 'kg' | 'lb';
    skipped?: boolean;
    sets: readonly { weight: string; completedAt: number | null }[];
  }[];
};

/**
 * Each lift's top logged load (kg) from the last completed workout of THIS session that was not a
 * deload, in the lift's current unit. The phone's journal keeps a finished workout for two weeks
 * once uploaded; beyond that a lift has no entry and no arrow. Never compares across sessions.
 */
export function lastComparableLoads(
  workouts: readonly JournalWorkout[],
  sessionId: string,
  units: Record<string, 'kg' | 'lb'>,
): Record<string, number> {
  const tops: Record<string, number> = {};
  const recent = workouts
    .filter(
      (workout) =>
        workout.sessionId === sessionId &&
        workout.status === 'completed' &&
        workout.intensityMode !== 'deload',
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  for (const workout of recent) {
    for (const exercise of workout.exercises) {
      if (exercise.id in tops || exercise.skipped || exercise.exerciseType !== 'weighted') {
        continue;
      }
      if (exercise.weightUnit !== weightUnitOf(units, exercise.id)) {
        continue;
      }
      const loads = exercise.sets
        .filter((set) => set.completedAt !== null)
        .map((set) => Number(set.weight))
        .filter((weight) => Number.isFinite(weight) && weight > 0);
      if (loads.length) {
        tops[exercise.id] = Math.max(...loads);
      }
    }
  }
  return tops;
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
  const { prescription, active } = input;
  const prescribedDeload = !!prescription?.deload;
  // A plan that is only `pending` does not drive the load: the rows carry the program's numbers, so
  // the plan's reasoning and its per-lift notes would describe numbers the person is not seeing.
  const pending = input.prescriptionStatus === 'pending';
  // A prescribed deload whose rows cannot be put back to full (no `preDeloadStyle`: a plan stored
  // before the numbers were recorded) stays deloaded under Full. What is drawn follows what is trained.
  const light = input.exercises.filter((exercise) => exercise.deloaded);
  const stayLight = light.filter((exercise) => !exercise.preDeloadStyle?.length);
  const allStayLight = prescribedDeload && stayLight.length > 0 && stayLight.length === input.exercises.length;
  const someStayLight = prescribedDeload && !allStayLight && !input.deloadChosen && stayLight.length > 0;
  // When Full cannot be told apart from the deload, the deload is what is on screen.
  const deloadChosen = input.deloadChosen || allStayLight;
  const toggle = intensityToggleModel({
    prescription,
    exercises: input.asSent,
    deloadChosen,
    suggestedToday: !!input.suggestedToday,
  });
  const notes = new Map(
    (prescription?.exercises ?? []).map((row) => [
      row.sessionExerciseId,
      { autoreg: row.autoregNote?.trim(), deload: row.deloadNote?.trim() },
    ]),
  );
  const rows = input.exercises.map((exercise): PlanRow => {
    const unit = weightUnitOf(input.units, exercise.id);
    const lines = notes.get(exercise.id);
    const note = pending ? null : ((exercise.deloaded ? lines?.deload : lines?.autoreg) ?? null);
    return {
      id: exercise.id,
      name: exercise.name,
      scheme: scheme(exercise, unit),
      change: change(exercise, unit, input.previousTops?.[exercise.id], deloadChosen),
      note: note || null,
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
  const deloadMinutes = prescription?.estimatedSessionDurationMin;
  const fullMinutes = prescription?.fullSession?.estimatedSessionDurationMin;
  const minutesText = (() => {
    if (someStayLight && deloadMinutes != null && fullMinutes != null) {
      // Part of the session is full and part light: the honest figure is the span between them.
      const low = Math.round(Math.min(deloadMinutes, fullMinutes));
      const high = Math.round(Math.max(deloadMinutes, fullMinutes));
      return low === high ? ` · about ${low} min` : ` · about ${low}–${high} min`;
    }
    const minutes = someStayLight && deloadMinutes != null ? deloadMinutes : (toggle.card?.minutes ?? input.durationMinutes);
    return minutes != null ? ` · about ${Math.round(minutes)} min` : '';
  })();
  const suggestion = suggestionOf(prescription, input.prescriptionStatus);
  // A rest or swap plan's text is in its note above Start; the card does not say it twice.
  const restOrSwap = ['rest_day_recommended', 'session_swap_recommended'].includes(
    prescription?.phaseAction ?? '',
  );
  const reasonText = someStayLight
    ? 'Full numbers where they were recorded; the lifts below stay at the deload numbers.'
    : allStayLight
      ? prescription?.reasoning
      : toggle.card?.reason;
  const reason = !prescription || restOrSwap || pending ? null : reasonText?.trim() || null;
  const lines: string[] = [];
  if (someStayLight) {
    const names = stayLight.map((exercise) => exercise.name).join(', ');
    lines.push(
      `${stayLight.length} ${stayLight.length === 1 ? 'lift stays' : 'lifts stay'} light: ${names}`,
    );
  }
  if (allStayLight) {
    lines.push('Full numbers are not available for this plan yet');
  }
  if (input.preparing) {
    lines.push(
      "Your AI workout is still being prepared, so these numbers may change in a moment. Starting asks for it, and uses your program as written if it can't be made.",
    );
  }
  return {
    header,
    meta: `${plural(rows.length, 'exercise', 'exercises')}${minutesText}`,
    rows,
    reason,
    notes: lines,
    failure: input.deloadFailure ?? null,
    notesBehindMore: rows.slice(PLAN_ROWS_SHOWN).filter((row) => row.note).length,
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
          ? allStayLight
            ? null
            : { kind: 'full', label: 'Train full instead', busy: false }
          : { kind: 'deload', label: 'Deload today instead', busy: !!input.deloadLoading },
    typeLabel:
      active && active.sessionId === input.sessionId
        ? active.intensityMode === 'deload'
          ? 'Deload session'
          : 'Full session'
        : null,
    preparing: input.preparing,
  };
}
