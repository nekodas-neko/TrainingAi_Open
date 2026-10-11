import { displayOneRm } from '@trainingai/shared/1rm';
import { AppText, Card, Stack } from '../../../shared/ui';
import { exerciseResult } from '../logging/summary';
import { formatSetLoad } from '../logging/targets';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout';

export function ExerciseResult({
  workout,
  exercise,
  showTitle = true,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  showTitle?: boolean;
}) {
  const result = exerciseResult(workout, exercise);
  return (
    <Card tone="brand">
      {showTitle && <AppText variant="heading">{exercise.name}</AppText>}
      <Stack direction="row" justify="space-between" wrap>
        <AppText variant="label">
          {result.sets} sets · {result.reps} reps
        </AppText>
        {result.repMax !== null ? (
          <AppText variant="label">{result.repMax} rep max</AppText>
        ) : result.estimate !== null ? (
          <AppText variant="label">
            Est. 1RM {displayOneRm(result.estimate, exercise.exerciseType).text}
          </AppText>
        ) : null}
      </Stack>
      {exercise.sets.map((set, index) =>
        set.completedAt === null ? null : (
          <AppText key={set.id} tone="muted">
            Set {index + 1} · {formatSetLoad(exercise, set)}
            {set.rpe === null
              ? ''
              : ` · RPE ${set.rpe}${set.rpeSource === 'expected' ? ' expected' : ''}`}
          </AppText>
        ),
      )}
      {exercise.deloaded && (
        <AppText variant="caption" tone="muted">
          Deload work · excluded from 1RM estimates
        </AppText>
      )}
      {result.ratedRpe !== null && (
        <AppText variant="caption" tone="muted">
          Rated effort · {result.ratedRpe.toFixed(1)} RPE average
        </AppText>
      )}
    </Card>
  );
}
