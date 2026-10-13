import { AppText, Badge, Card, Disclosure, Stack } from '../../../shared/ui';
import type { ExercisePreview } from '../catalog';
import { prescribedWeight } from '../logging/targets';

export function ExercisePreviewCard({
  exercise,
  position,
}: {
  exercise: ExercisePreview;
  position: number;
}) {
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Exercise {position}
      </AppText>
      <AppText variant="heading">{exercise.name}</AppText>
      {exercise.muscles.length > 0 && (
        <Stack direction="row" wrap>
          {exercise.muscles.map((muscle) => (
            <Badge key={muscle} label={muscle} tone="activity" />
          ))}
        </Stack>
      )}
      <AppText variant="label">
        {exercise.setCount} sets{exercise.style ? ` · ${exercise.style}` : ''}
      </AppText>
      {exercise.deloaded && <Badge label="Deload" />}
      {exercise.lastSetMode && (
        <Badge label={exercise.lastSetMode === 'amrap' ? 'Last set AMRAP' : 'Last set +1 rep'} />
      )}
      <Disclosure title={`Details: ${exercise.name}`}>
        {exercise.sets.map((set) => (
          <Stack key={set.number} direction="row" justify="space-between" wrap>
            <AppText variant="caption">
              Set {set.number}: {set.reps === 0 ? 'Reps unspecified' : `${set.reps} reps`}
              {exercise.exerciseType === 'weighted' && set.percent > 0
                ? ` · ${set.percent}% 1RM`
                : ''}
              {prescribedWeight(exercise, set) === null
                ? ''
                : ` · ${prescribedWeight(exercise, set)} kg`}
            </AppText>
            <AppText variant="caption" tone="muted">
              {set.restSeconds} sec rest
            </AppText>
          </Stack>
        ))}
        {exercise.instructions && (
          <AppText variant="caption" tone="muted">
            {exercise.instructions}
          </AppText>
        )}
      </Disclosure>
    </Card>
  );
}
