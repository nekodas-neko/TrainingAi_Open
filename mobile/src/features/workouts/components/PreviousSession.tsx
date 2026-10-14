import { useState } from 'react';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { displayOneRm, oneRmLabel } from '@trainingai/shared/1rm';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { previousValueChanges } from '../logging/reuse';
import { formatSetLoad } from '../logging/targets';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { exerciseHistorySpec } from '../data/models';

export function PreviousSession({
  workout,
  exercise,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
}) {
  const journal = useWorkoutJournal();
  const [preview, setPreview] = useState<ReturnType<typeof previousValueChanges> | null>(
    null,
  );
  const history = useWorkoutResource(
    exerciseHistorySpec(exercise.name),
    preview !== null,
  );
  const sources = history.data?.entries.filter(
    (x) =>
      x.date
        .replace(/\//g, '-')
        .startsWith(exercise.lastDate?.replace(/\//g, '-') ?? 'unknown') &&
      JSON.stringify(x.weightKg) === JSON.stringify(exercise.lastWeights) &&
      JSON.stringify(x.reps) === JSON.stringify(exercise.lastReps),
  );
  const source = sources?.length === 1 ? sources[0] : null;
  const changes = previousValueChanges(exercise);
  return (
    <Card>
      <AppText variant="micro" tone="muted">
        {exercise.lastDate?.replace(/\//g, '-') === workout.date
          ? 'Earlier today'
          : 'Previous session'}
        {exercise.lastDate ? ` - ${exercise.lastDate}` : ''}
      </AppText>
      <Stack direction="row" align="center" gap="md">
        <Stack direction="row" wrap gap="xs" style={{ flex: 1 }}>
          {exercise.lastReps.length ? (
            exercise.lastReps.map((reps, index) => {
              const weight = exercise.lastWeights[index];
              const label =
                weight === undefined
                  ? `${reps} reps - load unavailable`
                  : formatSetLoad(exercise, {
                      weight: String(weight),
                      reps: String(reps),
                    });
              return (
                <Badge
                  key={index}
                  label={
                    exercise.exerciseType === 'weighted'
                      ? label.replace(' reps', '')
                      : label
                  }
                />
              );
            })
          ) : (
            <AppText variant="caption" tone="muted">
              No previous sets available.
            </AppText>
          )}
        </Stack>
        {exercise.estimated1rm !== null && (
          <Stack align="center" gap="xs">
            <AppText variant="micro" tone="muted">
              {oneRmLabel(exercise.exerciseType)}
            </AppText>
            <AppText variant="heading" tone="brand">
              {displayOneRm(exercise.estimated1rm, exercise.exerciseType).text}
            </AppText>
          </Stack>
        )}
      </Stack>
      <AppButton
        title="Reuse previous values"
        variant="ghost"
        disabled={!changes.length || !!workout.runningSet || journal.busy}
        onPress={() => setPreview(changes)}
      />
      {!changes.length && (
        <AppText variant="micro" tone="muted">
          No matching unstarted sets with complete history to copy.
        </AppText>
      )}
      <Sheet
        visible={preview !== null}
        title="Review previous values"
        onClose={() => setPreview(null)}
      >
        <AppText variant="caption" tone="muted">
          Source: {exercise.lastDate}. {source?.isDeload ? 'Deload session. ' : ''}
          {workout.isBaseline ? 'Current workout is a baseline. ' : ''}
          {exercise.deloaded ? 'Current exercise is deloaded. ' : ''}
          {exercise.lastReps.length !== exercise.sets.length
            ? 'The set counts differ. '
            : ''}
          Only matching unstarted sets change. Prescriptions, completed sets and set count
          stay intact. Copying does not log a set.
        </AppText>
        {!source && (
          <AppText variant="micro" tone="muted">
            Previous phase details are unavailable; these are recorded values, not a
            recommendation for today.
          </AppText>
        )}
        {preview?.map((x) => (
          <Stack key={x.setId} gap="xs">
            <AppText variant="label">Set {x.number}</AppText>
            <AppText variant="caption">
              {formatSetLoad(exercise, { weight: x.beforeWeight, reps: x.beforeReps })} →{' '}
              {formatSetLoad(exercise, x)}
            </AppText>
          </Stack>
        ))}
        <ConfirmationCard
          title="Apply these values?"
          message="You can adjust each copied value before starting its set."
          confirmLabel="Copy values"
          busy={journal.busy}
          onCancel={() => setPreview(null)}
          onConfirm={() => {
            if (preview) {
              void journal.controller
                ?.reusePrevious(workout.id, exercise.id, preview)
                .then((saved) => {
                  if (saved) {
                    setPreview(null);
                  }
                });
            }
          }}
        />
      </Sheet>
    </Card>
  );
}
