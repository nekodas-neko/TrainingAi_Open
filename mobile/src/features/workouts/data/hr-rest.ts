import {
  aggregateHrRecoveryByExercise,
  type SetRecoveryInput,
} from '@trainingai/shared/health/hr-recovery-by-exercise';
import {
  SET_HR_NOT_MEASURED,
  SPARSE_WORKOUT_HR_NOTE,
  showSetHr,
} from '@trainingai/shared/workout/workout-hr-density';

/** Said on a set, or an exercise, that has no usable heart rate to judge its rest by (#2299). */
export const REST_NOT_MEASURED = 'Rest not measured with this device';

/**
 * Exercises, in workout order, with no set carrying a recovery reading. The aggregate leaves
 * exactly these out, so the line they get here is the only trace of them.
 */
export function exercisesWithoutRest(sets: SetRecoveryInput[]) {
  const measured = new Set(aggregateHrRecoveryByExercise(sets).map((x) => x.exerciseName));
  return [...new Set(sets.map((x) => x.exerciseName))].filter((x) => !measured.has(x));
}

/**
 * What the recap says for one set's heart rate (#3775): its figures, or the line that replaces them.
 * A sparse workout says why once, at the top, so its sets say nothing here; a set with too few
 * readings around it says so instead of showing a figure built on zero or one reading.
 */
export function setHrLine(
  hrDense: boolean | null | undefined,
  set: { hrMeasured?: boolean; peakBpm: number | null; bpmAtLog?: number | null; hrr1: number | null },
): { kind: 'figures'; text: string } | { kind: 'note'; text: string } | { kind: 'none' } {
  if (hrDense === false) return { kind: 'none' };
  if (!showSetHr(hrDense, set.hrMeasured)) return { kind: 'note', text: SET_HR_NOT_MEASURED };
  return {
    kind: 'figures',
    text:
      `Peak ${set.peakBpm ?? '—'} bpm · End ${set.bpmAtLog ?? '—'} bpm` +
      (set.hrr1 === null ? '' : ` · HRR60 ${set.hrr1} bpm`),
  };
}

/** The one line a sparse workout's recap shows in place of per-set heart rate and recovery. */
export function sparseWorkoutHrNote(hrDense: boolean | null | undefined): string | null {
  return hrDense === false ? SPARSE_WORKOUT_HR_NOTE : null;
}

/** A workout figure (mean, peak) is shown only when it rests on two readings or more. */
export function workoutHrFiguresShown(readingsCount: number | null | undefined): boolean {
  return (readingsCount ?? 0) >= 2;
}
