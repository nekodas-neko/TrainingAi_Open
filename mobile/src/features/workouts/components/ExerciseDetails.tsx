import { AppButton, AppText, Card, Stack } from '../../../shared/ui';
import { barShareOfOneRm } from '@trainingai/shared/1rm';
import { plateBreakdown } from '@trainingai/shared/workout/plate-loading';
import type { WorkoutExercise, WorkoutRecord, WorkoutSet } from '../logging/workout';
import {
  cappedTarget,
  isAmrap,
  loadBasis,
  roundLoad,
  weightStep,
} from '../logging/targets';

export function ExerciseDetails({
  workout,
  exercise,
  set,
  onAdjust,
  onHistory,
  onCalculator,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  set?: WorkoutSet;
  onAdjust: () => void;
  onHistory: () => void;
  onCalculator: () => void;
}) {
  const weight = Number(set?.weight);
  const percent =
    exercise.exerciseType === 'weighted'
      ? barShareOfOneRm(weight, exercise.estimated1rm)
      : null;
  const plates =
    exercise.exerciseType === 'weighted' && exercise.equipment.includes('barbell')
      ? plateBreakdown(weight)
      : null;
  const cap = set ? cappedTarget(exercise, set) : null;
  const ramp =
    !workout.soloExerciseId &&
    !workout.isBaseline &&
    exercise.exerciseType === 'weighted' &&
    weight > 0;
  return (
    <>
      {set && (
        <Card>
          <AppText variant="label">Working load</AppText>
          {percent !== null && (
            <AppText variant="caption" tone="muted">
              Current load: {percent}% of estimated 1RM
            </AppText>
          )}
          <AppText variant="caption" tone="muted">
            {loadBasis(exercise, set)}
          </AppText>
          {plates && (
            <AppText variant="caption" tone="muted">
              {plates.perSide.length
                ? `${plates.perSide.join(' + ')} kg per side`
                : 'Empty bar'}
              {plates.exact ? '' : ` · closest ${plates.achievableKg} kg`}
            </AppText>
          )}
          {cap !== null && (
            <AppText variant="caption" tone="muted">
              Automatic target capped at {cap} kg.
            </AppText>
          )}
          {!workout.isBaseline &&
            exercise.exerciseType === 'weighted' &&
            isAmrap(workout, exercise, exercise.sets.indexOf(set)) &&
            set.planned &&
            weight === set.plannedWeight && (
              <AppText variant="caption" tone="muted">
                {set.planned.reps} reps = maintain 1RM · {set.planned.reps + 1}+ reps =
                beat it
              </AppText>
            )}
        </Card>
      )}
      {exercise.exerciseType === 'weighted' && (
        <AppButton
          title="1RM calculator"
          icon="calculator"
          variant="surface"
          onPress={onCalculator}
        />
      )}
      {exercise.instructions && (
        <Card>
          <AppText variant="label">Technique</AppText>
          <AppText>{exercise.instructions}</AppText>
        </Card>
      )}
      {ramp && (
        <Card>
          <AppText variant="label">Suggested ramp-up loads</AppText>
          <AppText variant="caption" tone="muted">
            Suggestions relative to the working load. These do not log sets or change your
            prescription.
          </AppText>
          {[
            { pct: 50, reps: 5 },
            { pct: 74, reps: 3 },
            { pct: 92, reps: 1 },
          ].map((x) => (
            <Stack key={x.pct} direction="row" justify="space-between">
              <AppText variant="caption" tone="muted">
                {x.pct}%
              </AppText>
              <AppText variant="label">
                {roundLoad((weight * x.pct) / 100, weightStep(exercise.equipment))} kg ×{' '}
                {x.reps} reps
              </AppText>
            </Stack>
          ))}
        </Card>
      )}
      {set && (
        <AppButton
          title="Adjust starting set"
          icon="edit"
          variant="surface"
          onPress={onAdjust}
        />
      )}
      <AppButton
        title="Exercise history"
        icon="history"
        variant="surface"
        onPress={onHistory}
      />
    </>
  );
}
